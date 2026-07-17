import { dispatch } from './dispatch'
import { isOfflineEnabled } from './flag'
import { getConnectivityState, isNetworkError, onConnectivityChange, startConnectivityWatch } from './network'
import * as queue from './queue'

let draining = false
let stopWatch: (() => void) | null = null

function backoffMs(attempts: number): number {
  return Math.min(2000 * 2 ** attempts, 60_000)
}

async function drainOnce(): Promise<void> {
  if (draining) return
  draining = true

  try {
    for (;;) {
      if (getConnectivityState() !== 'online') break

      const batch = await queue.nextBatch()
      const next = batch[0]
      if (!next) break

      await queue.markSyncing(next.id)

      try {
        const handler = dispatch[next.type]
        if (!handler) throw new Error(`Sin dispatcher para "${next.type}".`)
        await handler(next)
        await queue.markDone(next.id)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)

        if (isNetworkError(cause)) {
          await queue.markFailedRetryable(
            next.id,
            message,
            new Date(Date.now() + backoffMs(next.attempts)).toISOString(),
          )
          // La red se acaba de caer otra vez: no insistir con el resto ahora.
          break
        }

        // Error de negocio: no bloquea el resto de la cola, esta entrada
        // queda para revisión humana en el panel de sincronización.
        await queue.markFailedTerminal(next.id, message)
      }
    }
  } finally {
    draining = false
  }
}

/** Arranca el motor: observa conectividad y drena cuando hay red. No-op si el flag está apagado. */
export function start(): () => void {
  if (!isOfflineEnabled()) return () => {}
  if (stopWatch) return stopWatch

  const stopConnectivityWatch = startConnectivityWatch()
  const unsubscribe = onConnectivityChange((state) => {
    if (state === 'online') void drainOnce()
  })

  const stop = () => {
    stopConnectivityWatch()
    unsubscribe()
    stopWatch = null
  }
  stopWatch = stop
  return stop
}

/** Fuerza un intento de drenado inmediato, ignorando el backoff de cada entrada. */
export async function forceDrain(): Promise<void> {
  const pending = await queue.listPending()
  await Promise.all(
    pending
      .filter((mutation) => mutation.status === 'pending' && mutation.nextRetryAt !== null)
      .map((mutation) => queue.clearBackoff(mutation.id)),
  )
  await drainOnce()
}
