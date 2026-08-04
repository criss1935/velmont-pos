import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Input } from '@/components/ui'
import { CustomerPicker } from '@/features/customers/CustomerPicker'
import {
  catalog,
  DataError,
  PAYMENT_METHOD_LABEL,
  photos as photosRepo,
  reception as receptionRepo,
  settings as settingsRepo,
  type PaymentMethod,
} from '@/data'
import { useSession } from '@/app/session'
import { cn } from '@/lib/cn'
import { cents, formatCents, MXN_DENOMINATIONS, parseAmount, percentOfCents, subtractCents } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import {
  effectivePromisedDate,
  hasHighValue,
  totalOf,
  useReception,
  type DraftArticle,
} from './reception/store'
import { ArticleEditor } from './reception/ArticleEditor'
import { ReceptionSummary } from './reception/ReceptionSummary'
import { SignaturePad } from './reception/SignaturePad'
import styles from './reception/Reception.module.css'

type Step = 'cliente' | 'articulos' | 'responsiva' | 'cobro' | 'confirmar'
const STEPS: { id: Step; label: string }[] = [
  { id: 'cliente', label: 'Cliente' },
  { id: 'articulos', label: 'Artículos' },
  { id: 'responsiva', label: 'Responsiva' },
  { id: 'cobro', label: 'Cobro' },
  { id: 'confirmar', label: 'Confirmar' },
]

const isComplete = (a: DraftArticle) => a.itemType !== '' && a.services.length > 0
const isEmpty = (a: DraftArticle) =>
  a.itemType === '' &&
  a.services.length === 0 &&
  a.photos.length === 0 &&
  a.conditionTags.length === 0 &&
  a.diagramMarks.length === 0 &&
  !a.brand &&
  !a.model &&
  !a.color &&
  a.declaredValue === null

export function ReceivePage() {
  const navigate = useNavigate()
  const cashSession = useSession((s) => s.cashSession)
  const refreshCash = useSession((s) => s.refreshCash)

  const store = useReception()
  const [step, setStep] = useState<Step>('cliente')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // "Sin asignar (venta de paso)" es una decisión EXPLÍCITA, no el estado por
  // default: si solo se dejara pasar con `customer === null`, un cliente que se
  // borró sin querer (✕) o cuyo alta offline no llegó a tiempo también dejaría
  // avanzar, y la orden quedaría huérfana sin que nadie lo haya decidido.
  const [confirmedNoCustomer, setConfirmedNoCustomer] = useState(false)

  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: catalog.listServices, staleTime: 5 * 60_000 })
  const itemTypesQuery = useQuery({ queryKey: ['item-types'], queryFn: settingsRepo.listItemTypes, staleTime: 5 * 60_000 })
  const conditionsQuery = useQuery({ queryKey: ['condition-options'], queryFn: settingsRepo.listConditionOptions, staleTime: 5 * 60_000 })
  const settingsQuery = useQuery({ queryKey: ['business-settings'], queryFn: settingsRepo.getBusinessSettings, staleTime: 5 * 60_000 })

  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])
  const itemTypes = itemTypesQuery.data ?? []
  const conditionOptions = conditionsQuery.data ?? []
  const threshold = settingsQuery.data?.highValueThreshold ?? cents(300000)
  const terms = settingsQuery.data?.receptionTerms ?? ''

  const total = totalOf(store.articles, store.discount)
  const promise = effectivePromisedDate(store.articles, store.promisedAtOverride)
  const editingArticle = store.articles.find((a) => a.key === editingKey) ?? null
  const highValue = hasHighValue(store.articles, threshold)

  // Puertas de avance por paso.
  const articlesReady =
    store.articles.some(isComplete) && store.articles.every((a) => isComplete(a) || isEmpty(a))
  const responsivaReady = store.responsivaAccepted && store.signature !== null
  const canContinue =
    step === 'cliente' ? store.customer !== null || confirmedNoCustomer
    : step === 'articulos' ? articlesReady
    : step === 'responsiva' ? responsivaReady
    : true

  function goNext() {
    const i = STEPS.findIndex((s) => s.id === step)
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!.id)
  }
  function goBack() {
    const i = STEPS.findIndex((s) => s.id === step)
    if (i > 0) setStep(STEPS[i - 1]!.id)
  }

  async function finalize() {
    setError(null)
    setSaving(true)
    try {
      const articles = store.articles.filter(isComplete)
      if (articles.length === 0) throw new DataError('Agrega al menos un artículo con servicios.')

      // Firma → Storage (antes del RPC; su ruta se pasa a create_reception).
      let signaturePath: string | null = null
      if (store.signature) {
        signaturePath = (await photosRepo.uploadSignature(store.signature.blob)).path
      }

      const payment =
        store.payment && store.payment.amount > 0
          ? {
              method: store.payment.method,
              amount: store.payment.amount,
              tendered: store.payment.method === 'efectivo' ? store.payment.tendered : null,
              reference: store.payment.reference || null,
              cashSessionId: store.payment.method === 'efectivo' ? (cashSession?.id ?? null) : null,
            }
          : null

      const orderId = await receptionRepo.createReception({
        customerId: store.customer?.id ?? null,
        articles: articles.map((a) => ({
          itemType: a.itemType,
          brand: a.brand || null,
          model: a.model || null,
          color: a.color || null,
          declaredValue: a.declaredValue,
          conditionTags: a.conditionTags,
          conditionNotes: a.conditionNotes || null,
          items: a.services.map((s) => ({
            serviceId: s.serviceId,
            serviceName: s.serviceName,
            unitPrice: s.unitPrice,
            quantity: s.quantity,
          })),
          diagramMarks: a.diagramMarks,
          photos: a.photos.map((p) => ({ file: p.file, classification: p.classification })),
        })),
        notes: store.notes || null,
        promisedAt: promise,
        discount: store.discount,
        signaturePath,
        responsiva: store.responsivaAccepted,
        payment,
      })

      if (payment?.method === 'efectivo') await refreshCash()
      store.reset()
      // `void`: en react-router 7 navigate() devuelve una promesa, pero no hay
      // nada que esperar — la navegación ocurre igual. Marcarla distingue este
      // caso de una promesa olvidada de verdad, que en un POS sí sería grave.
      void navigate(`/ordenes/${orderId}`)
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo finalizar la recepción.')
      setSaving(false)
    }
  }

  return (
    <Page title="Recibir" subtitle="Documenta el artículo, su estado y genera la nota de recepción." flush>
      <div className={styles.wizard}>
        {/* --- Columna principal --- */}
        <div className={styles.main}>
          <ol className={styles.stepper}>
            {STEPS.map((s, i) => {
              const idx = STEPS.findIndex((x) => x.id === step)
              return (
                <li
                  key={s.id}
                  className={cn(styles.stepItem, i === idx && styles.stepActive, i < idx && styles.stepDone)}
                >
                  <span className={styles.stepNum}>{i < idx ? '✓' : i + 1}</span>
                  {s.label}
                </li>
              )
            })}
          </ol>

          <div className={cn(styles.stepBody, 'vm-scroll')}>
            {step === 'cliente' && (
              <StepCliente
                customer={store.customer}
                onChange={(customer) => {
                  store.setCustomer(customer)
                  if (customer) setConfirmedNoCustomer(false)
                }}
                confirmedNoCustomer={confirmedNoCustomer}
                onConfirmNoCustomer={setConfirmedNoCustomer}
              />
            )}

            {step === 'articulos' && (
              <StepArticulos
                threshold={threshold}
                onEdit={setEditingKey}
              />
            )}

            {step === 'responsiva' && (
              <StepResponsiva terms={terms} highValue={highValue} />
            )}

            {step === 'cobro' && (
              <StepCobro total={total} promise={promise} cashOpen={Boolean(cashSession)} />
            )}

            {step === 'confirmar' && (
              <StepConfirmar total={total} promise={promise} />
            )}
          </div>

          <div className={styles.nav}>
            {error && <div className={styles.navError}>{error}</div>}
            <div className={styles.navButtons}>
              <Button variant="ghost" onClick={goBack} disabled={step === 'cliente' || saving}>
                Atrás
              </Button>
              {step === 'confirmar' ? (
                <Button variant="primary" size="lg" loading={saving} onClick={() => void finalize()}>
                  Finalizar recepción
                </Button>
              ) : (
                <Button variant="primary" size="lg" disabled={!canContinue} onClick={goNext}>
                  Continuar
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* --- Resumen vivo --- */}
        <aside className={styles.aside}>
          <ReceptionSummary styles={styles} />
        </aside>
      </div>

      {editingArticle && (
        <ArticleEditor
          article={editingArticle}
          itemTypes={itemTypes}
          services={services}
          conditionOptions={conditionOptions}
          highValueThreshold={threshold}
          onClose={() => setEditingKey(null)}
        />
      )}
    </Page>
  )
}

// -----------------------------------------------------------------------------
// Pasos
// -----------------------------------------------------------------------------

function StepCliente({
  customer,
  onChange,
  confirmedNoCustomer,
  onConfirmNoCustomer,
}: {
  customer: ReturnType<typeof useReception.getState>['customer']
  onChange: (c: ReturnType<typeof useReception.getState>['customer']) => void
  confirmedNoCustomer: boolean
  onConfirmNoCustomer: (value: boolean) => void
}) {
  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>¿Quién trae el artículo?</h2>
      <p className={styles.stepHint}>Busca al cliente o da de alta uno nuevo. Puede quedar sin asignar (venta de paso).</p>
      <div className={styles.clienteBox}>
        <CustomerPicker value={customer} onChange={onChange} />
      </div>

      {!customer &&
        (confirmedNoCustomer ? (
          <div className={styles.walkInConfirmed}>
            <span>Venta de paso — sin cliente asignado.</span>
            <button type="button" className={styles.walkInUndo} onClick={() => onConfirmNoCustomer(false)}>
              Buscar cliente
            </button>
          </div>
        ) : (
          <button type="button" className={styles.walkInButton} onClick={() => onConfirmNoCustomer(true)}>
            Continuar sin cliente (venta de paso)
          </button>
        ))}
    </div>
  )
}

function StepArticulos({ threshold, onEdit }: { threshold: number; onEdit: (key: string) => void }) {
  const articles = useReception((s) => s.articles)
  const addArticle = useReception((s) => s.addArticle)
  const removeArticle = useReception((s) => s.removeArticle)

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>Artículos recibidos</h2>
      <p className={styles.stepHint}>Cada artículo lleva sus servicios, estado, fotos y diagrama. Toca para editarlo.</p>

      <div className={styles.articleCards}>
        {articles.map((a, i) => {
          const complete = isComplete(a)
          const high = a.declaredValue !== null && a.declaredValue >= threshold
          return (
            <div key={a.key} className={cn(styles.articleCard, !complete && styles.articleCardIncomplete)}>
              <div className={styles.articleCardBody} onClick={() => onEdit(a.key)}>
                <div className={styles.articleCardHead}>
                  <span className={styles.articleCardName}>
                    {[a.itemType, a.brand, a.model].filter(Boolean).join(' ') || `Artículo ${i + 1}`}
                  </span>
                  {high && <span className={styles.articleHighTag}>Alto valor</span>}
                </div>
                <div className={styles.articleCardMeta}>
                  <span>{a.services.length} servicio{a.services.length === 1 ? '' : 's'}</span>
                  <span>{a.conditionTags.length} condición</span>
                  <span>{a.diagramMarks.length} obs.</span>
                  <span>{a.photos.length} fotos</span>
                </div>
                {!complete && (
                  <span className={styles.articleWarn}>Falta tipo de artículo o al menos un servicio</span>
                )}
              </div>
              <div className={styles.articleCardActions}>
                <Button size="sm" onClick={() => onEdit(a.key)}>Editar</Button>
                {articles.length > 1 && (
                  <Button size="sm" variant="danger" onClick={() => removeArticle(a.key)}>Quitar</Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Button variant="secondary" block onClick={() => onEdit(addArticle())}>
        + Agregar otro artículo
      </Button>
    </div>
  )
}

function StepResponsiva({ terms, highValue }: { terms: string; highValue: boolean }) {
  const accepted = useReception((s) => s.responsivaAccepted)
  const setAccepted = useReception((s) => s.setResponsiva)
  const setSignature = useReception((s) => s.setSignature)
  const signature = useReception((s) => s.signature)

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>Responsiva y firma</h2>
      {highValue && (
        <div className={styles.highValue}>
          <span className={styles.highValueTitle}>⚠ Recepción con artículo de alto valor</span>
          <span className={styles.highValueText}>Asegúrate de que el estado y las evidencias queden bien documentados.</span>
        </div>
      )}

      <div className={styles.terms}>{terms}</div>

      <label className={styles.acceptRow}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>El cliente acepta las condiciones de recepción.</span>
      </label>

      <div className={styles.signatureLabel}>Firma del cliente</div>
      <SignaturePad onChange={setSignature} />
      {accepted && !signature && (
        <span className={styles.articleWarn}>Falta la firma del cliente para continuar.</span>
      )}
    </div>
  )
}

function StepCobro({
  total,
  promise,
  cashOpen,
}: {
  total: ReturnType<typeof cents>
  promise: Date | null
  cashOpen: boolean
}) {
  const payment = useReception((s) => s.payment)
  const setPayment = useReception((s) => s.setPayment)
  const discount = useReception((s) => s.discount)
  const setDiscount = useReception((s) => s.setDiscount)
  const notes = useReception((s) => s.notes)
  const setNotes = useReception((s) => s.setNotes)
  const promisedOverride = useReception((s) => s.promisedAtOverride)
  const setPromisedOverride = useReception((s) => s.setPromisedAtOverride)

  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? 'efectivo')
  const [amountText, setAmountText] = useState(payment ? (payment.amount / 100).toString() : '')
  const [tenderedText, setTenderedText] = useState('')

  const amount = parseAmount(amountText) ?? cents(0)
  const tendered = parseAmount(tenderedText)
  const noCash = method === 'efectivo' && !cashOpen && amount > 0
  const overpay = amount > total

  function sync(nextMethod: PaymentMethod, nextAmount: ReturnType<typeof cents>) {
    if (nextAmount > 0) {
      setPayment({
        method: nextMethod,
        amount: nextAmount,
        tendered: nextMethod === 'efectivo' ? tendered : null,
        reference: '',
      })
    } else {
      setPayment(null)
    }
  }

  const METHODS: PaymentMethod[] = ['efectivo', 'tarjeta', 'transferencia']

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>Cobro y anticipo</h2>

      <div className={styles.cobroTotals}>
        <div><span>Total</span><strong data-numeric>{formatCents(total)}</strong></div>
        {(payment?.amount ?? cents(0)) > 0 && (
          <div>
            <span>Saldo</span>
            <strong data-numeric>
              {formatCents(subtractCents(total, (payment!.amount > total ? total : payment!.amount)))}
            </strong>
          </div>
        )}
      </div>

      <div className={styles.methods}>
        {METHODS.map((m) => (
          <button
            key={m}
            type="button"
            className={cn(styles.method, method === m && styles.methodActive)}
            onClick={() => { setMethod(m); sync(m, amount) }}
          >
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      <div className={styles.quickAmounts}>
        <button type="button" className={styles.quick} onClick={() => { setAmountText(''); sync(method, cents(0)) }}>Sin anticipo</button>
        <button type="button" className={styles.quick} onClick={() => { const v = percentOfCents(total, 50); setAmountText((v / 100).toString()); sync(method, v) }}>50%</button>
        <button type="button" className={styles.quick} onClick={() => { setAmountText((total / 100).toString()); sync(method, total) }}>Pago total</button>
      </div>

      <Input
        label="Anticipo"
        numeric
        prefix="$"
        inputMode="decimal"
        placeholder="0.00 (sin anticipo)"
        value={amountText}
        onChange={(e) => { setAmountText(e.target.value); sync(method, parseAmount(e.target.value) ?? cents(0)) }}
        {...(overpay ? { error: `No puede exceder el total de ${formatCents(total)}.` } : {})}
      />

      {noCash && (
        <div className={styles.warning}>
          No puedes registrar un cobro en efectivo mientras la caja esté cerrada. Ábrela, o usa tarjeta o transferencia.
        </div>
      )}

      {method === 'efectivo' && amount > 0 && (
        <div className={styles.denominations}>
          {MXN_DENOMINATIONS.filter((v) => v >= amount).map((v) => (
            <button key={v} type="button" className={styles.denomination} onClick={() => { setTenderedText((v / 100).toString()); sync(method, amount) }}>
              {formatCents(v)}
            </button>
          ))}
        </div>
      )}

      <div className={styles.cobroFields}>
        <Input
          label="Descuento"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          value={discount === 0 ? '' : (discount / 100).toString()}
          onChange={(e) => setDiscount(parseAmount(e.target.value) ?? cents(0))}
        />
        <label className={styles.dateField}>
          Entrega estimada
          <input
            type="date"
            className={styles.dateInput}
            value={promise ? toDateInput(promisedOverride ?? promise) : ''}
            onChange={(e) => setPromisedOverride(e.target.value ? fromDateInput(e.target.value) : null)}
          />
          {promise && <span className={styles.dateHint}>{formatDate(promise.toISOString())}</span>}
        </label>
      </div>

      <label className={styles.conditionNotesLabel}>
        Notas de la orden (opcional)
        <textarea className={styles.conditionNotes} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </div>
  )
}

function StepConfirmar({ total, promise }: { total: ReturnType<typeof cents>; promise: Date | null }) {
  const store = useReception()
  const articles = store.articles.filter(isComplete)
  const advance = store.payment?.amount ?? cents(0)

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>Confirmar recepción</h2>
      <div className={styles.confirmGrid}>
        <ConfirmRow label="Cliente" value={store.customer?.fullName ?? 'Sin asignar'} />
        <ConfirmRow label="Artículos" value={`${articles.length}`} />
        <ConfirmRow label="Total" value={formatCents(total)} />
        {advance > 0 && <ConfirmRow label="Anticipo" value={`${formatCents(advance)} (${store.payment ? PAYMENT_METHOD_LABEL[store.payment.method] : ''})`} />}
        {advance > 0 && <ConfirmRow label="Saldo" value={formatCents(subtractCents(total, advance > total ? total : advance))} />}
        {promise && <ConfirmRow label="Entrega estimada" value={formatDate(promise.toISOString())} />}
        <ConfirmRow label="Responsiva" value={store.responsivaAccepted ? 'Aceptada' : 'Pendiente'} />
        <ConfirmRow label="Firma" value={store.signature ? 'Capturada' : 'Sin firma'} />
      </div>
      <p className={styles.stepHint}>Al finalizar se crea la orden con estado «Recibido», se generan el folio y la nota de recepción, y aparece en el tablero de Órdenes.</p>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.confirmRow}>
      <span className={styles.confirmLabel}>{label}</span>
      <span className={styles.confirmValue}>{value}</span>
    </div>
  )
}

function toDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function fromDateInput(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1)
  date.setHours(18, 0, 0, 0)
  return date
}
