import { DataError, unwrap, unwrapMaybe } from '../errors'
import { pendingDb } from '../database.pending'
import { isNetworkError } from '../offline/network'
import { cents, type Cents } from '@/lib/money'
import { currentUserId } from './auth'
import type { PettyCashMovement, PettyCashState } from '../types'

/**
 * CAJA CHICA — el fondo de efectivo para gastos menores, separado del cajón.
 *
 * Ver `supabase/migrations/0020_petty_cash.sql` para el modelo. Aquí solo la
 * traducción a tipos de dominio.
 *
 * A diferencia de las ventas, la caja chica NO se encola offline. Es una
 * operación ocasional (fondear el sobre, anotar un gasto), no la ruta caliente
 * del mostrador, y su saldo es un número que dos tablets tienen que ver igual.
 * Encolarla significaría enseñar un saldo estimado que quizá cambie al
 * sincronizar — para un fondo de $500 eso confunde más de lo que ayuda. Sin
 * red, se dice claramente que hace falta conexión.
 */

function offlineGuard(cause: unknown): never {
  if (isNetworkError(cause)) {
    throw new DataError(
      'La caja chica necesita conexión. Cuando vuelva el internet, regístralo.',
    )
  }
  throw cause
}

export async function getState(): Promise<PettyCashState> {
  try {
    const row = unwrapMaybe(
      await pendingDb.from('petty_cash_balance').select('funded_cents, spent_cents, balance_cents').retry(false).maybeSingle(),
    )

    return {
      funded: cents(row?.funded_cents ?? 0),
      spent: cents(row?.spent_cents ?? 0),
      balance: cents(row?.balance_cents ?? 0),
    }
  } catch (cause) {
    return offlineGuard(cause)
  }
}

export async function listMovements(limit = 30): Promise<PettyCashMovement[]> {
  try {
    const rows = unwrap(
      await pendingDb
        .from('petty_cash_movements')
        .select('id, type, amount_cents, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
        .retry(false),
    )

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: cents(row.amount_cents),
      reason: row.reason,
      createdAt: row.created_at,
    }))
  } catch (cause) {
    return offlineGuard(cause)
  }
}

/**
 * Pasa dinero del cajón al fondo. Los dos asientos (salida de caja + fondeo)
 * viven dentro de la RPC porque tienen que ocurrir juntos: si solo pasara el
 * primero, el corte del turno cuadraría contra un fondo que nunca creció.
 */
export async function fund(input: {
  sessionId: string
  amount: Cents
  reason: string
}): Promise<void> {
  if (input.amount <= 0) throw new DataError('El monto debe ser mayor que cero.')
  if (input.reason.trim() === '') throw new DataError('Escribe para qué es el dinero.')

  try {
    unwrapMaybe(
      await pendingDb.rpc('fund_petty_cash', {
        p_movement_id: crypto.randomUUID(),
        p_cash_movement_id: crypto.randomUUID(),
        p_session_id: input.sessionId,
        p_amount: input.amount,
        p_reason: input.reason.trim(),
      }),
    )
  } catch (cause) {
    return offlineGuard(cause)
  }
}

/** Un gasto pagado con el fondo. No toca el cajón: ese dinero ya había salido. */
export async function spend(input: { amount: Cents; reason: string }): Promise<void> {
  if (input.amount <= 0) throw new DataError('El monto debe ser mayor que cero.')
  if (input.reason.trim() === '') throw new DataError('Escribe en qué se gastó.')

  try {
    unwrap(
      await pendingDb
        .from('petty_cash_movements')
        .insert({
          id: crypto.randomUUID(),
          type: 'gasto',
          amount_cents: input.amount,
          reason: input.reason.trim(),
          cash_session_id: null,
          created_by: await currentUserId(),
        })
        .select('id')
        .single(),
    )
  } catch (cause) {
    return offlineGuard(cause)
  }
}
