import { isOfflineEnabled, useSyncStatus } from '@/data'
import styles from './OfflineBanner.module.css'

/**
 * Banner persistente de conectividad — distinto del `SyncIndicator` (que
 * informa el estado de la COLA). Este informa el estado de la CONEXIÓN en sí,
 * visible en cualquier pantalla mientras dure el corte.
 */
export function OfflineBanner() {
  const connectivity = useSyncStatus((state) => state.connectivity)
  const pending = useSyncStatus((state) => state.pending)

  if (!isOfflineEnabled() || connectivity === 'online') return null

  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} aria-hidden />
      Sin conexión — se sigue guardando localmente
      {pending.length > 0 && ` (${pending.length} en espera de sincronizar)`}
    </div>
  )
}
