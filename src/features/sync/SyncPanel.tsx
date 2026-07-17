import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { useSyncStatus, type QueuedMutation } from '@/data'
import { useIsAdmin } from '@/app/session'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dates'
import styles from './SyncPanel.module.css'

const TYPE_LABEL: Record<string, string> = {
  'customers.create': 'Cliente nuevo',
  'reception.create': 'Recepción',
  'photos.uploadReceptionPhoto': 'Foto de recepción',
  'signature.upload': 'Firma',
  'cash.open': 'Apertura de caja',
  'cash.addMovement': 'Movimiento de caja',
  'payments.record': 'Cobro',
}

const STATUS_LABEL: Record<QueuedMutation['status'], string> = {
  pending: 'En cola',
  syncing: 'Sincronizando',
  failed: 'No se pudo',
  done: 'Sincronizado',
}

/**
 * Detalle de la cola offline: qué está pendiente/fallido ahora mismo, y qué ya
 * se sincronizó (para responder "¿esta recepción sí se guardó?" sin abrir la
 * consola).
 */
export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'pendientes' | 'historial'>('pendientes')
  const pending = useSyncStatus((state) => state.pending)
  const log = useSyncStatus((state) => state.log)
  const draining = useSyncStatus((state) => state.draining)
  const forceSync = useSyncStatus((state) => state.forceSync)
  const discardMutation = useSyncStatus((state) => state.discardMutation)
  const isAdmin = useIsAdmin()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sincronización"
      description="Lo que se guardó localmente mientras no había conexión, y lo que ya se confirmó."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            loading={draining}
            disabled={pending.length === 0}
            onClick={() => void forceSync()}
          >
            Sincronizar ahora
          </Button>
        </>
      }
    >
      <div className={styles.tabs}>
        <button
          type="button"
          className={cn(styles.tab, tab === 'pendientes' && styles.tabActive)}
          onClick={() => setTab('pendientes')}
        >
          Pendientes{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button
          type="button"
          className={cn(styles.tab, tab === 'historial' && styles.tabActive)}
          onClick={() => setTab('historial')}
        >
          Historial
        </button>
      </div>

      {tab === 'pendientes' ? (
        pending.length === 0 ? (
          <p className={styles.empty}>Todo sincronizado. No hay nada en espera.</p>
        ) : (
          <div className={styles.list}>
            {pending.map((mutation) => (
              <div key={mutation.id} className={styles.item}>
                <div className={styles.itemTop}>
                  <span className={styles.itemType}>{TYPE_LABEL[mutation.type] ?? mutation.type}</span>
                  <span className={cn(styles.status, styles[mutation.status])}>
                    {STATUS_LABEL[mutation.status]}
                  </span>
                </div>
                <div className={styles.itemMeta}>
                  {formatDateTime(mutation.createdAt)} · {mutation.attempts} intento
                  {mutation.attempts === 1 ? '' : 's'}
                </div>
                {mutation.lastError && <div className={styles.error}>{mutation.lastError}</div>}
                {isAdmin && mutation.status === 'failed' && (
                  <Button size="sm" variant="danger" onClick={() => void discardMutation(mutation.id)}>
                    Descartar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )
      ) : log.length === 0 ? (
        <p className={styles.empty}>Todavía no hay nada en el historial.</p>
      ) : (
        <div className={styles.list}>
          {log.map((entry) => (
            <div key={entry.id} className={styles.item}>
              <div className={styles.itemTop}>
                <span className={styles.itemType}>{TYPE_LABEL[entry.type] ?? entry.type}</span>
                <span className={cn(styles.status, styles.done)}>Sincronizado</span>
              </div>
              <div className={styles.itemMeta}>
                {formatDateTime(entry.syncedAt)} · {entry.attempts} intento{entry.attempts === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
