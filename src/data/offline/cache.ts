import { offlineDb } from './db'
import { isOfflineEnabled } from './flag'
import { isNetworkError } from './network'

export interface CachedResult<T> {
  value: T
  /** true = viene de la copia local porque no hubo red; el valor puede estar desactualizado. */
  stale: boolean
  /** Cuándo se guardó la copia que se está sirviendo. null si vino fresca de la red. */
  fetchedAt: string | null
}

/**
 * Read-through con TTL implícito (no expira solo — una copia vieja sigue
 * siendo mejor que una pantalla en blanco): intenta la red primero; si
 * responde, refresca la copia local y la devuelve fresca. Si falla por red,
 * sirve la última copia conocida para esa clave — si no hay ninguna, deja
 * pasar el error tal cual (no hay nada que mostrar).
 *
 * Nunca autoritativo: es exactamente la misma idea que el "estimado" de caja
 * (`formulas/expectedCash.ts`) aplicada a lecturas en vez de al efectivo.
 */
export async function readThrough<T>(key: string, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
  try {
    const value = await fetcher()

    if (isOfflineEnabled()) {
      await offlineDb.cache.put({ key, value, fetchedAt: new Date().toISOString() })
    }

    return { value, stale: false, fetchedAt: null }
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    const cached = await offlineDb.cache.get(key)
    if (!cached) throw cause

    return { value: cached.value as T, stale: true, fetchedAt: cached.fetchedAt }
  }
}
