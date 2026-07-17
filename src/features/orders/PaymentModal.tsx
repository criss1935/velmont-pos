import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import {
  DataError,
  PAYMENT_METHOD_LABEL,
  payments as paymentsRepo,
  type Order,
  type Payment,
  type PaymentMethod,
} from '@/data'
import { useSession } from '@/app/session'
import { cn } from '@/lib/cn'
import {
  addCents,
  cents,
  formatCents,
  MXN_DENOMINATIONS,
  parseAmount,
  subtractCents,
  type Cents,
} from '@/lib/money'
import styles from './PaymentModal.module.css'

const METHODS: PaymentMethod[] = ['efectivo', 'tarjeta', 'transferencia']

export function PaymentModal({
  order,
  open,
  onClose,
  onPaid,
}: {
  order: Order
  open: boolean
  onClose: () => void
  onPaid: (payment: Payment) => void
}) {
  const cashSession = useSession((state) => state.cashSession)
  const refreshCash = useSession((state) => state.refreshCash)

  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [amountText, setAmountText] = useState('')
  const [tenderedText, setTenderedText] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Al abrir, el importe se propone igual al saldo: cobrar el total es lo que
  // pasa en la inmensa mayoría de los casos, y así el operador solo confirma.
  useEffect(() => {
    if (!open) return
    setMethod('efectivo')
    setAmountText((order.balance / 100).toString())
    setTenderedText('')
    setReference('')
    setError(null)
  }, [open, order.balance])

  const amount = parseAmount(amountText) ?? cents(0)
  const tendered = parseAmount(tenderedText)
  const change = tendered !== null ? subtractCents(tendered, amount) : null

  const noCashSession = method === 'efectivo' && !cashSession
  const overpaying = amount > order.balance
  const tenderedTooLow = method === 'efectivo' && tendered !== null && tendered < amount

  const canSubmit =
    amount > 0 && !noCashSession && !overpaying && !tenderedTooLow && !busy

  async function submit() {
    setError(null)
    setBusy(true)

    try {
      const payment = await paymentsRepo.recordPayment({
        orderId: order.id,
        method,
        amount,
        ...(method === 'efectivo' && tendered !== null ? { tendered } : {}),
        ...(reference.trim() ? { reference } : {}),
        cashSessionId: method === 'efectivo' ? (cashSession?.id ?? null) : null,
      })

      // El total esperado en caja cambió: la barra lateral debe reflejarlo ya.
      if (method === 'efectivo') await refreshCash()

      onPaid(payment)
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo registrar el pago.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cobrar"
      description={`Orden ${order.folio} · saldo ${formatCents(order.balance)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!canSubmit}
            loading={busy}
            onClick={() => void submit()}
          >
            Cobrar {formatCents(amount)}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}

        {/* La base RECHAZA un cobro en efectivo sin caja abierta. Avisar aquí,
            antes de que el operador teclee nada, es mejor que dejarle llegar al
            final y fallar con el cliente enfrente. */}
        {noCashSession && (
          <div className={styles.warning}>
            No hay caja abierta. Abre caja para poder cobrar en efectivo, o cobra con tarjeta o
            transferencia.
          </div>
        )}

        <div className={styles.methods}>
          {METHODS.map((option) => (
            <button
              key={option}
              type="button"
              className={cn(styles.method, method === option && styles.methodActive)}
              onClick={() => setMethod(option)}
            >
              {PAYMENT_METHOD_LABEL[option]}
            </button>
          ))}
        </div>

        <Input
          label="Importe a cobrar"
          numeric
          prefix="$"
          inputMode="decimal"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
          {...(overpaying
            ? { error: `No puede exceder el saldo de ${formatCents(order.balance)}.` }
            : {})}
        />

        {method === 'efectivo' && (
          <>
            <Input
              label="Con cuánto paga"
              numeric
              prefix="$"
              inputMode="decimal"
              placeholder="Justo"
              value={tenderedText}
              onChange={(event) => setTenderedText(event.target.value)}
              {...(tenderedTooLow ? { error: 'Es menos que el importe a cobrar.' } : {})}
            />

            {/* Botones de billete: el operador toca el billete que le dieron en
                vez de teclear la cifra. Menos toques y menos errores de dedo. */}
            <div className={styles.denominations}>
              {MXN_DENOMINATIONS.filter((value) => value >= amount).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={styles.denomination}
                  onClick={() => setTenderedText((value / 100).toString())}
                >
                  {formatCents(value)}
                </button>
              ))}
              <button
                type="button"
                className={styles.denomination}
                onClick={() => setTenderedText((amount / 100).toString())}
              >
                Justo
              </button>
            </div>

            {change !== null && change >= 0 && (
              <div className={styles.change}>
                <span className={styles.changeLabel}>Cambio</span>
                <span className={styles.changeValue} data-numeric>
                  {formatCents(change)}
                </span>
              </div>
            )}
          </>
        )}

        {method !== 'efectivo' && (
          <Input
            label={method === 'tarjeta' ? 'Autorización' : 'Folio de transferencia'}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            hint="Opcional, pero ayuda a conciliar después."
          />
        )}

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>Total de la orden</span>
            <span data-numeric>{formatCents(order.total)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Ya pagado</span>
            <span data-numeric>{formatCents(order.paid)}</span>
          </div>
          <div className={cn(styles.summaryRow, styles.summaryTotal)}>
            <span>Quedará debiendo</span>
            <span data-numeric>
              {formatCents(
                subtractCents(order.balance, amount > order.balance ? order.balance : amount),
              )}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Suma de pagos ya aplicados. Se exporta por si otra pantalla la necesita. */
export function paidTotal(list: Payment[]): Cents {
  return addCents(...list.map((payment) => payment.amount))
}
