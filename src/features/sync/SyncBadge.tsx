import { Badge } from '@/components/ui'
import type { OrderSyncStatus } from '@/data'

const TONE = { pending: 'neutral', syncing: 'warning', failed: 'danger' } as const
const LABEL = { pending: 'En cola', syncing: 'Sincronizando', failed: 'Sin sincronizar' } as const

/** Estado de sincronización de una orden concreta — `null` no se pinta (nada pendiente). */
export function SyncBadge({ status }: { status: Exclude<OrderSyncStatus, null> }) {
  return (
    <Badge tone={TONE[status]} dot>
      {LABEL[status]}
    </Badge>
  )
}
