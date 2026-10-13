import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { customers as customersRepo, DataError, emails, orders as ordersRepo, type Order } from '@/data'
import styles from './SendEmailModal.module.css'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Outcome {
  sentTo: string | null
  emailError: string | null
}

/**
 * "Terminar y enviar": cierra la recepción de la orden y le manda al cliente el
 * correo con sus fotos y notas.
 *
 * La orden se levanta en la computadora y las fotos se suben después desde el
 * celular, así que el correo NO sale al crear la orden: sale aquí, cuando el
 * personal avisa que la evidencia está completa. Cerrar la recepción es lo que
 * habilita el envío (el servidor lo exige), y deja la fecha en la orden.
 *
 * El correo es opcional: si el cliente no tiene, se puede capturar aquí mismo
 * (queda guardado en su ficha) o terminar sin correo.
 */
export function FinishReceptionModal({
  order,
  open,
  syncPending,
  onClose,
  onFinished,
}: {
  order: Order
  open: boolean
  /** Hay fotos u otros cambios de esta orden en la cola offline sin subir. */
  syncPending: boolean
  onClose: () => void
  onFinished: () => void
}) {
  const customer = order.customer
  const savedEmail = customer?.email?.trim() ?? ''

  const [email, setEmail] = useState(savedEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail(customer?.email?.trim() ?? '')
    setBusy(false)
    setError(null)
    setOutcome(null)
  }, [open, customer?.email])

  const photoCount =
    order.generalPhotos.length + order.articles.reduce((total, article) => total + article.photos.length, 0)

  const typed = email.trim()
  const emailValid = EMAIL.test(typed)
  const blocker =
    photoCount === 0
      ? 'Sube al menos una foto antes de terminar.'
      : syncPending
        ? 'Hay fotos sin subir todavía. Espera a que terminen y vuelve a intentar.'
        : null

  async function finish(sendEmail: boolean) {
    setError(null)

    if (sendEmail && !emailValid) {
      setError('Escribe un correo válido, por ejemplo cliente@correo.com.')
      return
    }

    setBusy(true)
    try {
      // El correo capturado se guarda en la ficha del cliente: la próxima orden
      // ya lo trae, y el servidor manda siempre al correo guardado.
      if (customer && typed !== savedEmail && (typed === '' || emailValid)) {
        await customersRepo.updateCustomerEmail(customer.id, typed)
      }

      await ordersRepo.closeReception(order.id)
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo cerrar la recepción.')
      setBusy(false)
      return
    }

    let result: Outcome = { sentTo: null, emailError: null }
    if (sendEmail) {
      try {
        const sent = await emails.sendOrderEmail({ orderId: order.id, kind: 'reception' })
        result = { sentTo: sent.to || typed, emailError: null }
      } catch (cause) {
        // La recepción YA quedó cerrada: lo único pendiente es el correo.
        result = {
          sentTo: null,
          emailError: cause instanceof DataError ? cause.message : 'No se pudo enviar el correo.',
        }
      }
    }

    setOutcome(result)
    setBusy(false)
    onFinished()
  }

  function close() {
    if (busy) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Terminar recepción"
      description={`Orden ${order.folio}`}
      footer={
        outcome ? (
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Cancelar
            </Button>
            <Button disabled={busy || blocker !== null} onClick={() => void finish(false)}>
              Terminar sin correo
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={blocker !== null || !customer || !emailValid}
              onClick={() => void finish(true)}
            >
              Terminar y enviar
            </Button>
          </>
        )
      }
    >
      {outcome ? (
        <div className={styles.body}>
          <p className={styles.success}>Recepción terminada.</p>
          {outcome.sentTo && <p className={styles.success}>Correo enviado a {outcome.sentTo}.</p>}
          {outcome.emailError && (
            <p className={styles.error}>
              {outcome.emailError} La recepción ya quedó cerrada; puedes reenviarlo con «Enviar correo».
            </p>
          )}
          {!outcome.sentTo && !outcome.emailError && (
            <p className={styles.hint}>No se mandó correo. Puedes enviarlo después con «Enviar correo».</p>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <p className={styles.hint}>
            Al terminar, la orden queda con su evidencia completa: {photoCount}{' '}
            {photoCount === 1 ? 'foto' : 'fotos'}. Revisa que estén todas antes de continuar.
          </p>

          {customer ? (
            <Input
              label="Correo del cliente"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              hint={`Para mandarle a ${customer.fullName} sus fotos y su ticket. Se guarda en su ficha.`}
            />
          ) : (
            <p className={styles.hint}>
              Esta orden no tiene cliente, así que no hay a quién mandarle correo. Asígnale uno desde «Editar
              orden» si quieres enviarlo.
            </p>
          )}

          {blocker && <p className={styles.error}>{blocker}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </Modal>
  )
}
