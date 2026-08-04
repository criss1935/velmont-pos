import { offlineDb } from './db'
import type { MutationType, QueuedMutation, SyncLogEntry } from './types'

const SYNC_LOG_MAX_AGE_DAYS = 7
const SYNC_LOG_MAX_ENTRIES = 200

/** Guarda un binario (foto, firma) asociado a una mutación pendiente. */
export async function storeBlob(key: string, blob: Blob): Promise<void> {
  await offlineDb.blobs.put({ key, blob, createdAt: new Date().toISOString() })
}

export async function getBlob(key: string): Promise<Blob | null> {
  const row = await offlineDb.blobs.get(key)
  return row?.blob ?? null
}

export async function deleteBlob(key: string): Promise<void> {
  await offlineDb.blobs.delete(key)
}

export interface EnqueueInput {
  type: MutationType
  /** id de fila client-generado — la clave de idempotencia. */
  entityId: string
  payload: Record<string, unknown>
  blobKeys?: string[]
  dependsOn?: string[]
}

export async function enqueue(input: EnqueueInput): Promise<QueuedMutation> {
  const entry: QueuedMutation = {
    id: crypto.randomUUID(),
    type: input.type,
    entityId: input.entityId,
    payload: input.payload,
    blobKeys: input.blobKeys ?? [],
    dependsOn: input.dependsOn ?? [],
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    nextRetryAt: null,
  }
  await offlineDb.queue.add(entry)
  return entry
}

/** Todo lo que no ha terminado (para el indicador de UI y el panel de estado). */
export async function listPending(): Promise<QueuedMutation[]> {
  return offlineDb.queue.where('status').anyOf('pending', 'syncing', 'failed').sortBy('createdAt')
}

export async function listByEntity(entityId: string): Promise<QueuedMutation[]> {
  return offlineDb.queue.filter((mutation) => mutation.entityId === entityId).toArray()
}

export async function markSyncing(id: string): Promise<void> {
  await offlineDb.queue.update(id, { status: 'syncing' })
}

/**
 * Mueve la mutación de `queue` a `sync_log` — no se queda en la cola activa
 * (degradaría el drenado con filas que ya terminaron), pero tampoco desaparece
 * sin dejar rastro (el panel de sincronización necesita poder decir "esto sí
 * se guardó, aquí está el historial").
 */
export async function markDone(id: string): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.queue, offlineDb.sync_log, async () => {
    const entry = await offlineDb.queue.get(id)
    if (!entry) return

    await offlineDb.sync_log.put({
      id: entry.id,
      type: entry.type,
      entityId: entry.entityId,
      attempts: entry.attempts,
      syncedAt: new Date().toISOString(),
    })
    await offlineDb.queue.delete(id)
  })

  await pruneSyncLog()
}

async function pruneSyncLog(): Promise<void> {
  const cutoff = new Date(Date.now() - SYNC_LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await offlineDb.sync_log.where('syncedAt').below(cutoff).delete()

  const count = await offlineDb.sync_log.count()
  if (count > SYNC_LOG_MAX_ENTRIES) {
    const oldest = await offlineDb.sync_log
      .orderBy('syncedAt')
      .limit(count - SYNC_LOG_MAX_ENTRIES)
      .primaryKeys()
    await offlineDb.sync_log.bulkDelete(oldest)
  }
}

/** Historial de lo ya sincronizado, más reciente primero — para el panel de sincronización. */
export async function listSyncLog(): Promise<SyncLogEntry[]> {
  return offlineDb.sync_log.orderBy('syncedAt').reverse().toArray()
}

export async function markFailedRetryable(id: string, error: string, nextRetryAt: string): Promise<void> {
  const current = await offlineDb.queue.get(id)
  await offlineDb.queue.update(id, {
    status: 'pending',
    attempts: (current?.attempts ?? 0) + 1,
    lastError: error,
    nextRetryAt,
  })
}

export async function markFailedTerminal(id: string, error: string): Promise<void> {
  await offlineDb.queue.update(id, { status: 'failed', lastError: error })
}

/**
 * Descarta una mutación fallida sin remedio (ej. una foto corrupta) — se
 * pierde ESA pieza, no el resto de la recepción/orden que ya haya
 * sincronizado. Solo tiene sentido sobre algo que nunca va a poder aplicarse
 * solo; es una acción manual, deliberada, no algo que el motor haga por su
 * cuenta.
 */
export async function discard(id: string): Promise<void> {
  const entry = await offlineDb.queue.get(id)
  if (!entry) return

  await Promise.all(entry.blobKeys.map((key) => deleteBlob(key)))
  await offlineDb.queue.delete(id)
}

/** Quita el backoff de una entrada para que `nextBatch()` la considere de inmediato. */
export async function clearBackoff(id: string): Promise<void> {
  await offlineDb.queue.update(id, { nextRetryAt: null })
}

/**
 * Próximo lote elegible para drenar: `pending`, sin `dependsOn` pendientes, y
 * ya cumplido su backoff, en orden FIFO por `createdAt` (una sola tablet = un
 * solo productor, así que el orden de creación ya es el orden causal real).
 *
 * Lo terminado ya no vive en `queue` (`markDone` lo mueve a `sync_log`), así
 * que "¿ya se cumplió esta dependencia?" se resuelve contra el historial, no
 * contra la cola.
 */
export async function nextBatch(): Promise<QueuedMutation[]> {
  const all = await offlineDb.queue.where('status').equals('pending').sortBy('createdAt')
  const now = new Date().toISOString()

  const depIds = [...new Set(all.flatMap((mutation) => mutation.dependsOn))]
  const doneIds = new Set(
    depIds.length > 0
      ? (await offlineDb.sync_log.bulkGet(depIds)).filter((entry) => entry !== undefined).map((entry) => entry.id)
      : [],
  )

  return all.filter(
    (mutation) =>
      (mutation.nextRetryAt === null || mutation.nextRetryAt <= now) &&
      mutation.dependsOn.every((id) => doneIds.has(id)),
  )
}
