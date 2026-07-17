import { useState } from 'react'
import { Card } from '@/components/ui'
import type { Order } from '@/data'
import { formatDateTime } from '@/lib/dates'
import styles from './ResponsivaCard.module.css'

/** Responsiva y firma del cliente — a nivel de orden, no por artículo. */
export function ResponsivaCard({ order }: { order: Order }) {
  return (
    <Card title="Firma y responsiva">
      <div className={styles.status}>
        <span className={order.responsivaAccepted ? styles.accepted : styles.pending}>
          {order.responsivaAccepted ? 'Responsiva aceptada' : 'Responsiva no registrada'}
        </span>
        {order.responsivaAccepted && order.responsivaAcceptedAt && (
          <span className={styles.date}>{formatDateTime(order.responsivaAcceptedAt)}</span>
        )}
      </div>

      {order.signatureUrl ? (
        <SignatureImage url={order.signatureUrl} />
      ) : (
        <p className={styles.emptyText}>Sin firma capturada.</p>
      )}
    </Card>
  )
}

function SignatureImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <p className={styles.loadError}>No se pudo cargar la firma.</p>
  }

  return (
    <div className={styles.signatureFrame}>
      <img
        src={url}
        alt="Firma del cliente"
        loading="lazy"
        className={styles.signatureImg}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
