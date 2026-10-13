import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui'
import { emails, type Order } from '@/data'
import { formatDateTime } from '@/lib/dates'
import styles from './OrderEmailsCard.module.css'

const KIND_LABEL = { reception: 'Recepción (fotos y notas)', receipt: 'Ticket' } as const

/** Qué correos se le han mandado al cliente de esta orden, y si salieron. */
export function OrderEmailsCard({ order }: { order: Order }) {
  const history = useQuery({
    queryKey: ['order-emails', order.id],
    queryFn: () => emails.listOrderEmails(order.id),
  })

  const rows = history.data ?? []

  return (
    <Card title="Correos al cliente">
      <p className={order.receptionClosedAt ? styles.closed : styles.open}>
        {order.receptionClosedAt
          ? `Recepción terminada · ${formatDateTime(order.receptionClosedAt)}`
          : 'Recepción abierta: faltan las fotos o presionar «Terminar y enviar».'}
      </p>

      {history.isLoading ? (
        <p className={styles.empty}>Cargando…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>Todavía no se ha enviado ningún correo.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div>
                <div className={styles.kind}>{KIND_LABEL[row.kind]}</div>
                <div className={styles.meta}>
                  {row.to} · {formatDateTime(row.createdAt)}
                </div>
              </div>
              <span className={row.status === 'sent' ? styles.sent : styles.failed}>
                {row.status === 'sent' ? 'Enviado' : 'Falló'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
