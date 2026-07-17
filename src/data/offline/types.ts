/**
 * Tipos de la cola offline. Viven aparte de `../types.ts` (los tipos de
 * dominio): esto es infraestructura de sincronización, no algo que la UI deba
 * conocer en detalle.
 */

export type MutationType =
  | 'customers.create'
  | 'reception.create'
  | 'photos.uploadReceptionPhoto'
  | 'signature.upload'
  | 'cash.open'
  | 'cash.addMovement'
  | 'payments.record'
  | 'supplies.recordMovement'

export type MutationStatus = 'pending' | 'syncing' | 'failed' | 'done'

export interface QueuedMutation {
  /** id de la entrada de cola — no es el id de la fila de negocio. */
  id: string
  type: MutationType
  /** id de fila client-generado: la clave de idempotencia frente a reintentos. */
  entityId: string
  payload: Record<string, unknown>
  /** claves en el store `blobs`, si esta mutación lleva binarios (fotos/firma). */
  blobKeys: string[]
  /** ids de otras QueuedMutation que deben quedar en 'done' antes que esta. */
  dependsOn: string[]
  status: MutationStatus
  attempts: number
  lastError: string | null
  createdAt: string
  nextRetryAt: string | null
}

export interface QueuedBlob {
  key: string
  blob: Blob
  createdAt: string
}

export interface CacheEntry {
  key: string
  /** JSON-serializable — la respuesta ya traducida a tipos de dominio (Cents incluido, se serializa como number). */
  value: unknown
  fetchedAt: string
}

/** Registro de una mutación ya sincronizada — historial, no cola activa. */
export interface SyncLogEntry {
  /** Mismo id que tenía la QueuedMutation — no se genera uno nuevo. */
  id: string
  type: MutationType
  entityId: string
  attempts: number
  syncedAt: string
}
