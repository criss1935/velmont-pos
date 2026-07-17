import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { cents, subtractCents, type Cents } from '@/lib/money'
import { isOfflineEnabled } from '../offline/flag'
import { insertIdempotent } from '../offline/idempotent'
import { isNetworkError } from '../offline/network'
import { enqueue } from '../offline/queue'
import { currentUserId } from './auth'
import type { Payment, PaymentMethod } from '../types'

export interface NewPayment {
  orderId: string
  method: PaymentMethod
  amount: Cents
  /** Solo efectivo: con cuánto pagó el cliente. */
  tendered?: Cents
  /** Tarjeta: autorización. Transferencia: folio. */
  reference?: string
  /** Obligatorio si el método es efectivo. */
  cashSessionId?: string | null
}

interface PaymentPayload {
  id: string
  order_id: string
  method: PaymentMethod
  amount_cents: number
  cash_session_id: string | null
  tendered_cents: number | null
  change_cents: number | null
  reference: string | null
  created_by: string | null
}

interface PaymentRow {
  id: string
  order_id: string
  method: PaymentMethod
  amount_cents: number
  tendered_cents: number | null
  change_cents: number | null
  reference: string | null
  created_at: string
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    amount: cents(row.amount_cents),
    tendered: row.tendered_cents === null ? null : cents(row.tendered_cents),
    change: row.change_cents === null ? null : cents(row.change_cents),
    reference: row.reference,
    createdAt: row.created_at,
  }
}

const COLUMNS = 'id, order_id, method, amount_cents, tendered_cents, change_cents, reference, created_at'

export async function applyRecordPayment(payload: PaymentPayload): Promise<Payment> {
  const row = await insertIdempotent<PaymentRow>(
    () => supabase.from('payments').insert(payload).select(COLUMNS).single(),
    () => supabase.from('payments').select(COLUMNS).eq('id', payload.id).single(),
  )
  return toPayment(row)
}

export async function recordPayment(input: NewPayment): Promise<Payment> {
  if (input.method === 'efectivo' && !input.cashSessionId) {
    throw new DataError('No hay una caja abierta. Abre caja antes de cobrar en efectivo.')
  }

  // El cambio lo calcula el cliente porque es lo que ya se le mostró al operador
  // en pantalla; la base lo valida (tendered >= amount) y lo guarda.
  const change =
    input.method === 'efectivo' && input.tendered !== undefined
      ? subtractCents(input.tendered, input.amount)
      : null

  const payload: PaymentPayload = {
    id: crypto.randomUUID(),
    order_id: input.orderId,
    method: input.method,
    amount_cents: input.amount,
    // Tarjeta y transferencia no tocan el cajón: no se atan a una sesión.
    cash_session_id: input.method === 'efectivo' ? (input.cashSessionId ?? null) : null,
    tendered_cents: input.method === 'efectivo' ? (input.tendered ?? null) : null,
    change_cents: change,
    reference: input.reference?.trim() || null,
    created_by: await currentUserId(),
  }

  try {
    return await applyRecordPayment(payload)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    await enqueue({
      type: 'payments.record',
      entityId: payload.id,
      payload: payload as unknown as Record<string, unknown>,
    })

    return {
      id: payload.id,
      orderId: payload.order_id,
      method: payload.method,
      amount: cents(payload.amount_cents),
      tendered: payload.tendered_cents === null ? null : cents(payload.tendered_cents),
      change: payload.change_cents === null ? null : cents(payload.change_cents),
      reference: payload.reference,
      createdAt: new Date().toISOString(),
    }
  }
}

export async function listPaymentsForOrder(orderId: string): Promise<Payment[]> {
  const rows = unwrap(
    await supabase.from('payments').select(COLUMNS).eq('order_id', orderId).order('created_at'),
  )

  return rows.map(toPayment)
}
