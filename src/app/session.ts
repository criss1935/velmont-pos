import { create } from 'zustand'
import { auth, cash, offlineSync, startSyncStatusPolling, type CashSession, type Profile } from '@/data'

let syncEngineStarted = false

interface SessionState {
  /** null = no hay sesión. undefined = todavía no sabemos (arrancando). */
  profile: Profile | null | undefined
  /** Caja abierta ahora mismo, si la hay. */
  cashSession: CashSession | null

  bootstrap: () => Promise<void>
  refreshCash: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Estado de sesión: quién opera y con qué caja.
 *
 * La caja vive aquí y no en cada pantalla porque media app necesita saber si hay
 * una abierta: sin caja no se cobra en efectivo, y esa regla la impone la base
 * (ver la política `payments_write`). Tenerlo en un solo lugar evita que una
 * pantalla crea que hay caja y otra crea que no.
 */
export const useSession = create<SessionState>((set, get) => ({
  profile: undefined,
  cashSession: null,

  bootstrap: async () => {
    // Arranca una sola vez por carga de la app — es un no-op si el feature
    // flag de la cola offline está apagado (ver src/data/offline/flag.ts).
    if (!syncEngineStarted) {
      syncEngineStarted = true
      offlineSync.start()
      startSyncStatusPolling()
    }

    const profile = await auth.getCurrentProfile()
    set({ profile })

    if (profile) {
      await get().refreshCash()
    } else {
      set({ cashSession: null })
    }
  },

  refreshCash: async () => {
    set({ cashSession: await cash.getOpenSession() })
  },

  signOut: async () => {
    await auth.signOut()
    set({ profile: null, cashSession: null })
  },
}))

export const useIsAdmin = () => useSession((state) => state.profile?.role === 'admin')
