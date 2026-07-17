import { useState } from 'react'
import { Badge } from '@/components/ui'
import { isOfflineEnabled, useSyncStatus } from '@/data'
import { SyncPanel } from './SyncPanel'
import styles from './SyncIndicator.module.css'

/**
 * Estado de la cola offline, siempre visible mientras el feature flag esté
 * prendido — igual que el pill de caja, para que el operador no tenga que
 * adivinar si algo se quedó sin guardar. Clic abre el detalle (`SyncPanel`).
 */
export function SyncIndicator({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false)
  const pending = useSyncStatus((state) => state.pending)
  const connectivity = useSyncStatus((state) => state.connectivity)
  const draining = useSyncStatus((state) => state.draining)

  if (!isOfflineEnabled()) return null

  const failed = pending.filter((mutation) => mutation.status === 'failed').length

  const tone = failed > 0 ? 'danger' : pending.length > 0 ? 'warning' : connectivity === 'online' ? 'success' : 'neutral'

  const label =
    failed > 0
      ? `${failed} sin sincronizar`
      : draining && pending.length > 0
        ? `Sincronizando ${pending.length}…`
        : pending.length > 0
          ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}`
          : connectivity === 'online'
            ? 'Todo sincronizado'
            : 'Sin conexión'

  return (
    <>
      <button
        type="button"
        className={mobile ? styles.mobileButton : styles.button}
        onClick={() => setOpen(true)}
      >
        <Badge tone={tone} dot>
          {label}
        </Badge>
      </button>

      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
