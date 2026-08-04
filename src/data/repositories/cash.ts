import { supabase } from '../client'
import { DataError, unwrap, unwrapMaybe } from '../errors'
import { cents, type Cents } from '@/lib/money'
import { estimateExpectedCash, summarizePendingForSession } from '../offline/formulas/expectedCash'
import { isOfflineEnabled } from '../offline/flag'
import { insertIdempotent } from '../offline/idempotent'
import { isNetworkError } from '../offline/network'
import { enqueue, listPending } from '../offline/queue'
import { currentUserId } from './auth'
import type { CashMovement, CashMovementType, CashSession } from '../types'

const SNAPSHOT_KEY = 'velmont:cash-session-snapshot'

interface SessionRow {
  id: string
  opened_at: string
  opened_by: string | null
  opening_cents: number
  closed_at: string | null
  closed_by: string | null
  counted_cents: number | null
  expected_cents: number | null
  difference_cents: number | null
  notes: string | null
}

function toCashSession(row: SessionRow, liveExpected: number | null): CashSession {
  return {
    id: row.id,
    openedAt: row.opened_at,
    openedBy: row.opened_by,
    opening: cents(row.opening_cents),
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    counted: row.counted_cents === null ? null : cents(row.counted_cents),
    // Mientras la caja está abierta, el esperado se lee en vivo de la vista.
    // La columna `expected_cents` de la tabla solo se llena al cerrar.
    expected: cents(liveExpected ?? row.expected_cents ?? 0),
    difference: row.difference_cents === null ? null : cents(row.difference_cents),
    notes: row.notes,
  }
}

/**
 * Última caja abierta conocida, guardada tras cada lectura exitosa online.
 * Sin esto, una tablet que se queda sin red no tiene NADA sobre lo que
 * calcular un "esperado" estimado — ni siquiera el fondo inicial.
 */
function saveSnapshot(session: CashSession | null): void {
  if (session === null) {
    window.localStorage.removeItem(SNAPSHOT_KEY)
  } else {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
  }
}

function loadSnapshot(): CashSession | null {
  const raw = window.localStorage.getItem(SNAPSHOT_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as CashSession
    return {
      ...parsed,
      opening: cents(parsed.opening),
      counted: parsed.counted === null ? null : cents(parsed.counted),
      expected: cents(parsed.expected),
      difference: parsed.difference === null ? null : cents(parsed.difference),
    }
  } catch {
    return null
  }
}

/**
 * La caja abierta ahora mismo, o null si no hay ninguna.
 *
 * Es lo primero que consulta la app al arrancar: sin caja abierta no se cobra en
 * efectivo, y la pantalla de venta tiene que saberlo antes de dejar cobrar.
 *
 * El "esperado" se ajusta con lo que todavía está en la cola offline de esta
 * sesión (movimientos, cobros, el anticipo de una recepción encolada) — el
 * servidor aún no los conoce. Sin red, cae a la última copia conocida
 * (`saveSnapshot`). Ninguno de los dos casos es autoritativo: solo evita dejar
 * la pantalla en blanco o mostrando un número que ya se sabe incompleto.
 */
export async function getOpenSession(): Promise<CashSession | null> {
  const pending = isOfflineEnabled() ? await listPending() : []

  try {
    // `.retry(false)`: sin red, que falle a la primera — el fallback al
    // snapshot local ya está listo, no vale la pena esperar los reintentos
    // internos de postgrest-js.
    const row = unwrapMaybe(
      await supabase
        .from('cash_sessions')
        .select(
          `id, opened_at, opened_by, opening_cents, closed_at, closed_by,
           counted_cents, expected_cents, difference_cents, notes`,
        )
        .is('closed_at', null)
        .retry(false)
        .maybeSingle(),
    )

    if (!row) {
      saveSnapshot(null)
      return null
    }

    // `cash_session_expected` es una vista (calcula, no almacena), así que no
    // tiene una llave foránea real hacia `cash_sessions` — PostgREST no puede
    // anidarla en el select de arriba (error PGRST200, "no se encontró
    // relación"). Se consulta aparte.
    const live = unwrapMaybe(
      await supabase
        .from('cash_session_expected')
        .select('expected_cents')
        .eq('cash_session_id', row.id)
        .retry(false)
        .maybeSingle(),
    )

    const session = toCashSession(row, live?.expected_cents ?? null)
    saveSnapshot(session)

    const summary = summarizePendingForSession(session.id, pending)
    if (!summary.hasPending) return session

    return {
      ...session,
      expected: estimateExpectedCash(session.expected, session.id, pending),
      estimated: true,
      hasPendingSync: true,
    }
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    const snapshot = loadSnapshot()
    if (!snapshot) return null

    return {
      ...snapshot,
      expected: estimateExpectedCash(snapshot.expected, snapshot.id, pending),
      estimated: true,
      hasPendingSync: true,
    }
  }
}

export async function applyOpenSession(payload: {
  id: string
  opening_cents: number
  opened_by: string | null
}): Promise<string> {
  const row = await insertIdempotent<{ id: string }>(
    () => supabase.from('cash_sessions').insert(payload).select('id').single(),
    () => supabase.from('cash_sessions').select('id').eq('id', payload.id).single(),
  )
  return row.id
}

export async function openSession(opening: Cents): Promise<string> {
  const id = crypto.randomUUID()
  const payload = { id, opening_cents: opening, opened_by: await currentUserId() }

  try {
    return await applyOpenSession(payload)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    await enqueue({ type: 'cash.open', entityId: id, payload: payload })
    return id
  }
}

/**
 * Corte de caja. El esperado se calcula dentro de la misma transacción que el
 * cierre — ver supabase/migrations/0005 para el porqué. NO se encola nunca:
 * el corte es un documento que se firma e imprime, y solo es correcto si el
 * servidor ya conoce todos los movimientos/cobros de la sesión. La pantalla
 * (`CashPage`) es responsable de no ofrecer "Cerrar caja" mientras
 * `hasPendingSync` sea true.
 */
export async function closeSession(
  sessionId: string,
  counted: Cents,
  notes?: string,
): Promise<CashSession> {
  try {
    const row = unwrap(
      await supabase.rpc('close_cash_session', {
        p_session_id: sessionId,
        p_counted: counted,
        ...(notes ? { p_notes: notes } : {}),
      }),
    )

    saveSnapshot(null) // ya cerrada: no queda "sesión abierta" que cachear

    return {
      id: row.id,
      openedAt: row.opened_at,
      openedBy: row.opened_by,
      opening: cents(row.opening_cents),
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      // La RPC acaba de escribir estas tres columnas, así que no pueden venir
      // nulas — pero el tipo generado las declara nullable porque en la tabla lo
      // son (mientras la caja está abierta). El `?? 0` es la conciliación.
      counted: cents(row.counted_cents ?? 0),
      expected: cents(row.expected_cents ?? 0),
      difference: cents(row.difference_cents ?? 0),
      notes: row.notes,
    }
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo cerrar la caja: sin conexión. Espera a tener señal e intenta de nuevo.')
    }
    throw cause
  }
}

export async function applyAddMovement(payload: {
  id: string
  cash_session_id: string
  type: CashMovementType
  amount_cents: number
  reason: string
  created_by: string | null
}): Promise<void> {
  await insertIdempotent<{ id: string }>(
    () => supabase.from('cash_movements').insert(payload).select('id').single(),
    () => supabase.from('cash_movements').select('id').eq('id', payload.id).single(),
  )
}

export async function addMovement(input: {
  sessionId: string
  type: CashMovementType
  amount: Cents
  reason: string
}): Promise<void> {
  const payload = {
    id: crypto.randomUUID(),
    cash_session_id: input.sessionId,
    type: input.type,
    amount_cents: input.amount,
    reason: input.reason.trim(),
    created_by: await currentUserId(),
  }

  try {
    await applyAddMovement(payload)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    await enqueue({
      type: 'cash.addMovement',
      entityId: payload.id,
      payload: payload,
    })
  }
}

export async function listMovements(sessionId: string): Promise<CashMovement[]> {
  const rows = unwrap(
    await supabase
      .from('cash_movements')
      .select('id, type, amount_cents, reason, created_at')
      .eq('cash_session_id', sessionId)
      .order('created_at', { ascending: false }),
  )

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    amount: cents(row.amount_cents),
    reason: row.reason,
    createdAt: row.created_at,
  }))
}
