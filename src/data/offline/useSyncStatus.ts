import { create } from 'zustand'
import { isOfflineEnabled } from './flag'
import { getConnectivityState, onConnectivityChange, type ConnectivityState } from './network'
import { forceDrain } from './sync-engine'
import { discard, listPending, listSyncLog } from './queue'
import type { QueuedMutation, SyncLogEntry } from './types'

interface SyncStatusState {
  connectivity: ConnectivityState
  pending: QueuedMutation[]
  log: SyncLogEntry[]
  /** El motor está drenando ahora mismo (para la barra "Sincronizando N de M…"). */
  draining: boolean
  refresh: () => Promise<void>
  forceSync: () => Promise<void>
  discardMutation: (id: string) => Promise<void>
}

/**
 * Estado de sincronización reactivo para la UI (indicador, banner, panel).
 * No hay pub-sub sobre Dexie aquí a propósito (evita depender de
 * `liveQuery`/`dexie-react-hooks`): un poll corto de `listPending()` es
 * suficiente para que el indicador se sienta vivo sin más dependencias.
 */
export const useSyncStatus = create<SyncStatusState>((set, get) => ({
  connectivity: getConnectivityState(),
  pending: [],
  log: [],
  draining: false,

  refresh: async () => {
    if (!isOfflineEnabled()) return
    const [pending, log] = await Promise.all([listPending(), listSyncLog()])
    set({ pending, log })
  },

  forceSync: async () => {
    set({ draining: true })
    try {
      await forceDrain()
    } finally {
      set({ draining: false })
      await get().refresh()
    }
  },

  discardMutation: async (id) => {
    await discard(id)
    await get().refresh()
  },
}))

let pollTimer: ReturnType<typeof setInterval> | null = null
let stopConnectivitySub: (() => void) | null = null

/** Arranca el polling de estado. No-op si el feature flag está apagado. */
export function startSyncStatusPolling(): () => void {
  if (!isOfflineEnabled()) return () => {}
  if (pollTimer) return () => {}

  stopConnectivitySub = onConnectivityChange((connectivity) => {
    useSyncStatus.setState({ connectivity })
    void useSyncStatus.getState().refresh()
  })

  void useSyncStatus.getState().refresh()
  pollTimer = setInterval(() => void useSyncStatus.getState().refresh(), 3000)

  return () => {
    stopConnectivitySub?.()
    stopConnectivitySub = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
