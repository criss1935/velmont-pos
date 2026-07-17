import type { QueuedMutation } from './types'

export type OrderSyncStatus = 'pending' | 'syncing' | 'failed' | null

/**
 * Estado de sincronización de una orden concreta, a partir de la cola local.
 * `null` = nada pendiente de esta orden (el caso normal — no se muestra badge).
 *
 * La firma queda fuera a propósito: su mutación (`signature.upload`) solo
 * carga la ruta del archivo, sin el id de la orden — se captura antes de que
 * exista la orden, así que en el momento de encolarla todavía no hay order_id
 * que asociarle. Es una limitación conocida y menor: si todo lo demás de la
 * orden ya sincronizó y solo falta la firma, el badge no lo refleja.
 */
export function statusForOrder(orderId: string, pending: QueuedMutation[]): OrderSyncStatus {
  const relevant = pending.filter((mutation) => {
    if (mutation.entityId === orderId) return true

    if (mutation.type === 'photos.uploadReceptionPhoto') {
      return (mutation.payload as { orderId?: string }).orderId === orderId
    }
    if (mutation.type === 'payments.record') {
      return (mutation.payload as { order_id?: string }).order_id === orderId
    }
    return false
  })

  if (relevant.length === 0) return null
  if (relevant.some((mutation) => mutation.status === 'failed')) return 'failed'
  if (relevant.some((mutation) => mutation.status === 'syncing')) return 'syncing'
  return 'pending'
}
