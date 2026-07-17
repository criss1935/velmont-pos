import { Badge, type BadgeTone } from '@/components/ui'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/data'

/**
 * El color de cada estado se define UNA vez, aquí. El tablero, el detalle y el
 * filtro usan este mismo componente — si el verde de "listo" cambiara en un solo
 * sitio, el operador dejaría de poder fiarse del color.
 */
const TONE: Record<OrderStatus, BadgeTone> = {
  recibido: 'info',
  en_proceso: 'warning',
  listo: 'success',
  entregado: 'neutral',
  cancelado: 'danger',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={TONE[status]} dot>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  )
}
