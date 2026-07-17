import { cents, type Cents } from '@/lib/money'
import type { QueuedMutation } from '../types'

/**
 * Réplica en TS de la vista `cash_session_expected`
 * (supabase/migrations/0001_init.sql): `opening + Σefectivo + Σentradas −
 * Σsalidas`. Aquí solo se recorre la cola LOCAL pendiente de una sesión — el
 * `knownExpected` que se le suma ya trae todo lo que el servidor confirmó.
 * No es autoritativo: es una estimación para no dejar la pantalla en blanco
 * mientras hay pendientes. El anticipo embebido en una recepción encolada
 * (`reception.create`) cuenta igual que un pago suelto.
 */

interface MovementPayload {
  cash_session_id: string
  type: 'entrada' | 'salida'
  amount_cents: number
}

interface PaymentPayload {
  cash_session_id: string | null
  method: string
  amount_cents: number
}

interface ReceptionPayload {
  payment: PaymentPayload | null
}

export interface CashSessionPendingSummary {
  /** Hay alguna mutación (apertura, movimiento o cobro) de esta sesión sin sincronizar. */
  hasPending: boolean
  /** Ajuste neto sobre el "esperado" conocido, en centavos. */
  netCents: number
}

export function summarizePendingForSession(
  sessionId: string,
  pending: QueuedMutation[],
): CashSessionPendingSummary {
  let net = 0
  let hasPending = false

  for (const mutation of pending) {
    if (mutation.type === 'cash.open' && mutation.entityId === sessionId) {
      hasPending = true
      continue
    }

    if (mutation.type === 'cash.addMovement') {
      const payload = mutation.payload as unknown as MovementPayload
      if (payload.cash_session_id === sessionId) {
        hasPending = true
        net += payload.type === 'entrada' ? payload.amount_cents : -payload.amount_cents
      }
      continue
    }

    if (mutation.type === 'payments.record') {
      const payload = mutation.payload as unknown as PaymentPayload
      if (payload.cash_session_id === sessionId && payload.method === 'efectivo') {
        hasPending = true
        net += payload.amount_cents
      }
      continue
    }

    if (mutation.type === 'reception.create') {
      const payload = mutation.payload as unknown as ReceptionPayload
      if (payload.payment && payload.payment.cash_session_id === sessionId && payload.payment.method === 'efectivo') {
        hasPending = true
        net += payload.payment.amount_cents
      }
    }
  }

  return { hasPending, netCents: net }
}

export function estimateExpectedCash(knownExpected: Cents, sessionId: string, pending: QueuedMutation[]): Cents {
  return cents((knownExpected as number) + summarizePendingForSession(sessionId, pending).netCents)
}
