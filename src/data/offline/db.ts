import Dexie, { type Table } from 'dexie'
import type { CacheEntry, QueuedBlob, QueuedMutation, SyncLogEntry } from './types'

/**
 * Base local de la cola offline. `queue` guarda las mutaciones pendientes;
 * `blobs` va aparte porque Dexie no debe serializar binarios pesados (fotos,
 * firma) cada vez que se inspecciona el estado de la cola para la UI. `cache`
 * guarda la última respuesta conocida de cada lectura (catálogo, clientes,
 * órdenes) para servirla si no hay red. `sync_log` es el historial de lo ya
 * sincronizado — vive aparte de `queue` para no degradar el drenado con filas
 * que ya terminaron.
 */
class OfflineDatabase extends Dexie {
  queue!: Table<QueuedMutation, string>
  blobs!: Table<QueuedBlob, string>
  cache!: Table<CacheEntry, string>
  sync_log!: Table<SyncLogEntry, string>

  constructor() {
    super('velmont-offline')
    this.version(1).stores({
      queue: 'id, status, createdAt',
      blobs: 'key',
    })
    this.version(2).stores({
      cache: 'key',
    })
    this.version(3).stores({
      sync_log: 'id, syncedAt',
    })
  }
}

export const offlineDb = new OfflineDatabase()
