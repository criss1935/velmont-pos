import { isStorageError } from '@supabase/storage-js'
import { supabase } from '../client'
import { DataError } from '../errors'
import { listPending } from './queue'

export type ConnectivityState = 'online' | 'offline' | 'checking'

/**
 * postgrest-js ATRAPA los fallos de fetch (WiFi caído, DNS, timeout) y los
 * resuelve como un PostgrestError con `code: ''` — nunca rechaza la promesa
 * (ver `PostgrestBuilder.then()`, el `.catch((fetchError) => ({ error: {
 * code: '', ... } }))`). `unwrap()` convierte eso en un `DataError` igual que
 * un error de negocio real, así que la clase del error NO alcanza para
 * distinguirlos: la única señal fiable de "no hubo respuesta real de
 * Postgrest" es ese `code` vacío. Un error de negocio (RLS, constraint,
 * validación) siempre trae un código real (`23505`, `42501`, `P0001`, …) y
 * nunca se encola.
 *
 * `storage-js` (subida de fotos/firma) es distinto: SÍ rechaza la promesa, y
 * distingue sus propios dos casos — `StorageUnknownError` (no hubo respuesta
 * real: falló el fetch) vs `StorageApiError` (el servidor respondió, con un
 * `status` HTTP real: bucket, RLS, validación — error de negocio). Los
 * repositorios que suben a Storage dejan pasar el `StorageUnknownError` tal
 * cual para que se reconozca aquí; el `StorageApiError` sí se traduce a
 * `DataError` antes de llegar a este punto.
 */
export function isNetworkError(cause: unknown): boolean {
  if (cause instanceof DataError) {
    return cause.cause?.code === ''
  }
  if (isStorageError(cause)) {
    return cause.name === 'StorageUnknownError'
  }
  // Cualquier otra excepción (una que no pasó por postgrest-js ni storage-js)
  // sí es un fallo sin respuesta.
  return true
}

let state: ConnectivityState = navigator.onLine ? 'online' : 'offline'
const listeners = new Set<(state: ConnectivityState) => void>()

function setState(next: ConnectivityState): void {
  if (next === state) return
  state = next
  listeners.forEach((listener) => listener(state))
}

export function getConnectivityState(): ConnectivityState {
  return state
}

export function onConnectivityChange(listener: (state: ConnectivityState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Ping barato: `navigator.onLine` en Android solo dice "hay interfaz de red",
 * no "Supabase responde" (un WiFi de tienda sin internet real marca `true`).
 * Reutiliza RLS existente sobre `profiles`, sin traer datos (`head:true`).
 */
export async function checkConnectivity(): Promise<ConnectivityState> {
  setState('checking')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    const { error } = await supabase
      .from('profiles')
      .select('id', { head: true, count: 'exact' })
      .limit(1)
      .retry(false)
      .abortSignal(controller.signal)
    setState(error ? 'offline' : 'online')
  } catch {
    setState('offline')
  } finally {
    clearTimeout(timeout)
  }

  return getConnectivityState()
}

let watchTimer: ReturnType<typeof setTimeout> | null = null

async function scheduleNextCheck(): Promise<void> {
  const pending = await listPending()
  const delay = pending.length > 0 ? 15_000 : 60_000

  watchTimer = setTimeout(() => {
    void checkConnectivity().finally(() => void scheduleNextCheck())
  }, delay)
}

/** Arranca el watch de conectividad: ping periódico + eventos online/visibilidad. */
export function startConnectivityWatch(): () => void {
  const onOnline = () => void checkConnectivity()
  const onOffline = () => setState('offline')
  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkConnectivity()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  void checkConnectivity()
  void scheduleNextCheck()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    if (watchTimer) clearTimeout(watchTimer)
  }
}
