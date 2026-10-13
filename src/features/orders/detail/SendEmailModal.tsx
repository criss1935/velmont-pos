import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui'
import { DataError, emails, type Order, type OrderEmailKind } from '@/data'
import reception from '../reception/Reception.module.css'
import styles from './SendEmailModal.module.css'

/**
 * "Enviar correo al cliente": envío MANUAL (reenvío o primer envío sin pasar por
 * "Terminar y enviar"). Puede mandar la recepción (fotos y notas con las que se
 * recibió su calzado) o el ticket con lo cobrado hasta ahora. El contenido lo
 * arma el servidor desde la orden guardada, así que lo que se ve en Detalle es
 * lo que le llega. Siempre va con `force`: aquí quien manda es una persona y sabe
 * que es un reenvío.
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
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<OrderEmailKind>('reception')

  const email = order.customer?.email?.trim() ?? ''
  const photoCount =
    order.generalPhotos.length + order.articles.reduce((total, article) => total + article.photos.length, 0)

  const send = useMutation({
    mutationFn: () => emails.sendOrderEmail({ orderId: order.id, kind, message, force: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['order-emails', order.id] }),
  })

  const noPayments = kind === 'receipt' && order.paid <= 0

  function close() {
    if (send.isPending) return
    send.reset()
    setMessage('')
    setKind('reception')
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
            <Button variant="primary" loading={send.isPending} disabled={!email || noPayments} onClick={() => send.mutate()}>
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

          <div className={styles.kinds} role="radiogroup" aria-label="Qué correo enviar">
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'reception'}
              className={kind === 'reception' ? styles.kindActive : styles.kind}
              disabled={send.isPending}
              onClick={() => setKind('reception')}
            >
              Recepción
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'receipt'}
              className={kind === 'receipt' ? styles.kindActive : styles.kind}
              disabled={send.isPending}
              onClick={() => setKind('receipt')}
            >
              Ticket
            </button>
          </div>

          <p className={styles.hint}>
            {kind === 'reception'
              ? `Incluye las notas de la orden, el estado de cada artículo y ${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}.`
              : noPayments
                ? 'Esta orden todavía no tiene cobros: no hay ticket que enviar.'
                : 'Incluye los artículos, el total, los pagos registrados y el saldo.'}
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
