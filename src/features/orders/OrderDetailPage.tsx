import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Card, Modal } from '@/components/ui'
import {
  DataError,
  nextStatus,
  ORDER_STATUS_LABEL,
  orders as ordersRepo,
  payments as paymentsRepo,
  PAYMENT_METHOD_LABEL,
  settings as settingsRepo,
  statusForOrder,
  useSyncStatus,
  type Order,
} from '@/data'
import { paymentDocument, receiptDocument, remisionDocument, tryPrint } from '@/features/printing'
import { SyncBadge } from '@/features/sync/SyncBadge'
import { cn } from '@/lib/cn'
import { formatCents } from '@/lib/money'
import { formatDate, formatDateTime, isOverdue } from '@/lib/dates'
import { ArticleDetail } from './detail/ArticleDetail'
import { ResponsivaCard } from './detail/ResponsivaCard'
import { PaymentModal } from './PaymentModal'
import { StatusBadge } from './StatusBadge'
import styles from './OrderDetailPage.module.css'

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [paying, setPaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersRepo.getOrder(id!),
    enabled: Boolean(id),
  })

  const paymentsQuery = useQuery({
    queryKey: ['payments', id],
    queryFn: () => paymentsRepo.listPaymentsForOrder(id!),
    enabled: Boolean(id),
  })

  const order = orderQuery.data
  const pendingSync = useSyncStatus((state) => state.pending)

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['order', id] })
    void queryClient.invalidateQueries({ queryKey: ['payments', id] })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  const advance = useMutation({
    mutationFn: (next: Parameters<typeof ordersRepo.setOrderStatus>[1]) =>
      ordersRepo.setOrderStatus(id!, next),
    onSuccess: invalidate,
  })

  const cancel = useMutation({
    mutationFn: () => ordersRepo.cancelOrder(id!),
    onSuccess: () => {
      setCancelling(false)
      invalidate()
    },
  })

  async function printReceipt(target: Order) {
    setPrintError(null)
    const business = await settingsRepo.getBusinessSettings()
    const failure = await tryPrint(receiptDocument(target, business))
    if (failure) setPrintError(failure.message)
  }

  async function printRemision(target: Order) {
    setPrintError(null)
    const business = await settingsRepo.getBusinessSettings()
    const failure = await tryPrint(remisionDocument(target, business))
    if (failure) setPrintError(failure.message)
  }

  if (orderQuery.isLoading) {
    return (
      <Page title="Orden">
        <p className={styles.loading}>Cargando…</p>
      </Page>
    )
  }

  if (!order) {
    return (
      <Page title="Orden">
        <p className={styles.notFound}>Esa orden no existe.</p>
      </Page>
    )
  }

  const next = nextStatus(order.status)
  const closed = order.status === 'entregado' || order.status === 'cancelado'
  const late = isOverdue(order.promisedAt) && !closed

  // Entregar con saldo pendiente es la fuga de dinero más común de un negocio
  // así. El botón de entregar se bloquea hasta que la orden esté saldada; para
  // regalarla, hay que dejarla explícitamente en $0 con un descuento.
  const blockedByBalance = next === 'entregado' && order.balance > 0
  const syncStatus = statusForOrder(order.id, pendingSync)

  return (
    <Page
      title={order.folio}
      subtitle={
        <span className={styles.headerMeta}>
          <StatusBadge status={order.status} />
          {syncStatus && <SyncBadge status={syncStatus} />}
          {order.customer ? order.customer.fullName : 'Sin cliente'}
        </span>
      }
      actions={
        <>
          <Button onClick={() => navigate('/ordenes')}>Volver</Button>
          <Button onClick={() => void printReceipt(order)}>Imprimir comprobante</Button>
          <Button onClick={() => void printRemision(order)}>Imprimir remisión</Button>
          {order.balance > 0 && order.status !== 'cancelado' && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Cobrar {formatCents(order.balance)}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.layout}>
        <div>
          <Card accent flush title="Calzado recibido">
            {order.items.map((item) => (
              <div key={item.id} className={styles.item}>
                <span className={styles.qty} data-numeric>
                  {item.quantity}
                </span>

                <div className={styles.itemBody}>
                  <div className={styles.itemName}>{item.serviceName}</div>
                  {item.itemLabel && <div className={styles.itemLabel}>{item.itemLabel}</div>}
                  {item.itemNotes && (
                    <div className={styles.itemNotes}>Al recibir: {item.itemNotes}</div>
                  )}
                </div>

                <span className={styles.itemAmount} data-numeric>
                  {formatCents(item.lineTotal)}
                </span>
              </div>
            ))}
          </Card>

          <div style={{ height: 'var(--vm-space-4)' }} />

          <Card title="Totales">
            <div className={styles.totals}>
              <div className={styles.totalRow}>
                <span>Subtotal</span>
                <span className={styles.totalValue} data-numeric>
                  {formatCents(order.subtotal)}
                </span>
              </div>

              {order.discount > 0 && (
                <div className={styles.totalRow}>
                  <span>Descuento</span>
                  <span className={styles.totalValue} data-numeric>
                    −{formatCents(order.discount)}
                  </span>
                </div>
              )}

              <div className={styles.grand}>
                <span className={styles.grandLabel}>Total</span>
                <span className={styles.grandValue} data-numeric>
                  {formatCents(order.total)}
                </span>
              </div>
            </div>

            {order.balance > 0 ? (
              <div className={styles.balance}>
                <span className={styles.balanceLabel}>Saldo pendiente</span>
                <span className={styles.balanceValue} data-numeric>
                  {formatCents(order.balance)}
                </span>
              </div>
            ) : (
              <div className={styles.settled}>Pagado por completo</div>
            )}
          </Card>

          {/* Órdenes antiguas (creadas antes de la recepción enriquecida, o por
              la venta directa sin wizard) no tienen artículos — no hay nada
              nuevo que mostrar para ellas, y no se fuerza una sección vacía. */}
          {order.articles.length > 0 && (
            <>
              <div style={{ height: 'var(--vm-space-4)' }} />
              {order.articles.map((article, index) => (
                <ArticleDetail key={article.id} article={article} index={index} />
              ))}
            </>
          )}

          <div style={{ height: 'var(--vm-space-4)' }} />
          <ResponsivaCard order={order} />
        </div>

        {/* --- Barra lateral --- */}
        <aside className={styles.side}>
          <Card title="Acciones">
            <div className={styles.actions}>
              {printError && <div className={styles.printError}>{printError}</div>}

              {next && (
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={blockedByBalance}
                  loading={advance.isPending}
                  onClick={() => advance.mutate(next)}
                >
                  {next === 'entregado'
                    ? 'Entregar al cliente'
                    : `Marcar ${ORDER_STATUS_LABEL[next].toLowerCase()}`}
                </Button>
              )}

              {blockedByBalance && (
                <p className={styles.printError}>
                  No se puede entregar con {formatCents(order.balance)} pendientes. Cobra el saldo
                  primero.
                </p>
              )}

              {order.status === 'entregado' && (
                <p style={{ fontSize: 'var(--vm-text-sm)', color: 'var(--vm-text-dim)' }}>
                  Entregada el {formatDateTime(order.deliveredAt!)}.
                </p>
              )}

              {!closed && (
                <Button variant="danger" block onClick={() => setCancelling(true)}>
                  Cancelar orden
                </Button>
              )}
            </div>
          </Card>

          <Card title="Datos">
            <div className={styles.info}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Recibida</span>
                <span className={styles.infoValue}>{formatDateTime(order.receivedAt)}</span>
              </div>

              {order.promisedAt && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Entrega</span>
                  <span className={cn(styles.infoValue, late && styles.late)}>
                    {formatDate(order.promisedAt)}
                    {late && ' · vencida'}
                  </span>
                </div>
              )}

              {order.customer?.phone && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Teléfono</span>
                  <span className={styles.infoValue} data-numeric data-selectable>
                    {order.customer.phone}
                  </span>
                </div>
              )}

              {order.notes && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Notas</span>
                  <span className={styles.infoValue}>{order.notes}</span>
                </div>
              )}
            </div>
          </Card>

          <Card title="Pagos">
            {(paymentsQuery.data ?? []).length === 0 ? (
              <p style={{ fontSize: 'var(--vm-text-sm)', color: 'var(--vm-text-dim)' }}>
                Todavía no se ha cobrado nada.
              </p>
            ) : (
              (paymentsQuery.data ?? []).map((payment) => (
                <div key={payment.id} className={styles.payment}>
                  <div className={styles.paymentMeta}>
                    <span className={styles.paymentMethod}>
                      {PAYMENT_METHOD_LABEL[payment.method]}
                    </span>
                    <span className={styles.paymentDate}>{formatDateTime(payment.createdAt)}</span>
                  </div>
                  <span className={styles.paymentAmount} data-numeric>
                    {formatCents(payment.amount)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </aside>
      </div>

      <PaymentModal
        order={order}
        open={paying}
        onClose={() => setPaying(false)}
        onPaid={(payment) => {
          setPaying(false)
          invalidate()

          // El ticket se imprime con la orden YA actualizada, para que el saldo
          // impreso sea el de después del cobro y no el de antes.
          void ordersRepo.getOrder(order.id).then(async (fresh) => {
            if (!fresh) return
            const business = await settingsRepo.getBusinessSettings()
            const failure = await tryPrint(paymentDocument(fresh, payment, business))
            if (failure) setPrintError(failure.message)
          })
        }}
      />

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="¿Cancelar esta orden?"
        description="La orden no se borra: queda registrada como cancelada. Los pagos ya cobrados no se devuelven automáticamente."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              No, volver
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Sí, cancelar
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--vm-text-sm)', color: 'var(--vm-text-muted)' }}>
          {order.paid > 0
            ? `Esta orden tiene ${formatCents(order.paid)} cobrados. Si hay que devolver el dinero, regístralo como una salida de caja para que quede el rastro.`
            : 'Esta orden no tiene pagos registrados.'}
        </p>
        {cancel.error instanceof DataError && (
          <p className={styles.printError}>{cancel.error.message}</p>
        )}
      </Modal>
    </Page>
  )
}
