import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui'
import { DataError, emails, type Order } from '@/data'
import reception from '../reception/Reception.module.css'
import styles from './SendEmailModal.module.css'

/**
 * "Enviar correo al cliente": le manda las fotos y las notas con las que se
 * recibió su calzado. El contenido lo arma el servidor desde la orden guardada,
 * así que lo que se ve en Detalle es lo que le llega.
 */
export function SendEmailModal({
  order,
  open,
  onClose,
}: {
  order: Order
  open: boolean
  onClose: () => void
}) {
  const [message, setMessage] = useState('')

  const email = order.customer?.email?.trim() ?? ''
  const photoCount =
    order.generalPhotos.length + order.articles.reduce((total, article) => total + article.photos.length, 0)

  const send = useMutation({
    mutationFn: () => emails.sendOrderEmail({ orderId: order.id, message }),
  })

  function close() {
    if (send.isPending) return
    send.reset()
    setMessage('')
    onClose()
  }

  const sentTo = send.data?.to
  const error =
    send.error instanceof DataError ? send.error.message : send.error ? 'No se pudo enviar el correo.' : null

  return (
    <Modal
      open={open}
      onClose={close}
      title="Enviar correo al cliente"
      description={`Orden ${order.folio}`}
      footer={
        sentTo ? (
          <Button variant="primary" onClick={close}>
            Listo
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={send.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" loading={send.isPending} disabled={!email} onClick={() => send.mutate()}>
              Enviar correo
            </Button>
          </>
        )
      }
    >
      {sentTo ? (
        <p className={styles.success}>Correo enviado a {sentTo}.</p>
      ) : (
        <div className={styles.body}>
          {email ? (
            <p className={styles.to}>
              Para: <strong data-selectable>{email}</strong>
            </p>
          ) : (
            <p className={styles.error}>
              {order.customer
                ? `${order.customer.fullName} no tiene correo registrado. Agrégalo en Clientes y vuelve a intentar.`
                : 'Esta orden no tiene cliente. Asígnale uno con correo desde "Editar orden".'}
            </p>
          )}

          <p className={styles.hint}>
            Incluye las notas de la orden, el estado de cada artículo y {photoCount}{' '}
            {photoCount === 1 ? 'foto' : 'fotos'}.
          </p>

          <label className={reception.conditionNotesLabel}>
            Mensaje adicional (opcional)
            <textarea
              className={reception.conditionNotes}
              rows={3}
              maxLength={1000}
              value={message}
              disabled={send.isPending}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </Modal>
  )
}
