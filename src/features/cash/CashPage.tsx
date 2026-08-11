import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Card, Input, Modal } from '@/components/ui'
import {
  cash as cashRepo,
  DataError,
  pettyCash as pettyCashRepo,
  settings as settingsRepo,
  type CashMovementType,
} from '@/data'
import { useIsAdmin, useSession } from '@/app/session'
import { cashCloseDocument, tryPrint } from '@/features/printing'
import { cn } from '@/lib/cn'
import { cents, formatCents, parseAmount, subtractCents, type Cents } from '@/lib/money'
import { formatDateTime } from '@/lib/dates'
import styles from './CashPage.module.css'

/**
 * CAJA
 *
 * Esta pantalla la usa una persona que no creció con software, de pie, con un
 * cliente esperando. El rediseño parte de tres decisiones:
 *
 *  1. Ningún término de contabilidad sin traducir. "Entrada / salida" era un
 *     botón que abría un modal donde HABÍA QUE ELEGIR la dirección; ahora son
 *     dos botones, "Meter dinero" y "Sacar dinero", y el modal ya viene con la
 *     dirección puesta. Se elimina un paso y una equivocación posible.
 *  2. Cada número dice qué significa en la misma frase, no en una leyenda
 *     debajo en gris claro.
 *  3. El resultado del corte se dice en palabras ("Sobran $50", "Todo cuadra")
 *     antes que en cifras. Un signo menos es fácil de no ver.
 */

/** Montos típicos de fondo inicial, para no teclear en una tablet. */
const FONDO_SUGERIDO: Cents[] = [cents(50000), cents(100000), cents(150000), cents(200000)]

/** Motivos que de verdad se repiten en el mostrador. */
const MOTIVOS_SALIDA = ['Compra de material', 'Retiro a la cuenta', 'Devolución a cliente', 'Pago a proveedor']
const MOTIVOS_ENTRADA = ['Cambio para el cajón', 'Depósito del dueño', 'Corrección de un cobro']
const MOTIVOS_GASTO_CHICA = ['Shampoo y limpieza', 'Cintas y agujetas', 'Papelería', 'Taxi o envío', 'Agua y café']

export function CashPage() {
  const queryClient = useQueryClient()
  const session = useSession((state) => state.cashSession)
  const profile = useSession((state) => state.profile)
  const refreshCash = useSession((state) => state.refreshCash)
  const isAdmin = useIsAdmin()

  const [opening, setOpening] = useState(false)
  const [moving, setMoving] = useState<CashMovementType | null>(null)
  const [closing, setClosing] = useState(false)

  const movementsQuery = useQuery({
    queryKey: ['cash-movements', session?.id],
    queryFn: () => cashRepo.listMovements(session!.id),
    enabled: Boolean(session),
  })

  async function refresh() {
    await refreshCash()
    void queryClient.invalidateQueries({ queryKey: ['cash-movements'] })
    void queryClient.invalidateQueries({ queryKey: ['petty-cash'] })
  }

  if (!session) {
    return (
      <Page title="Caja" subtitle="Todavía no se abre la caja de hoy.">
        <Card accent>
          <div className={styles.closed}>
            <span className={styles.closedIcon} aria-hidden>
              ▤
            </span>
            <div>
              <h2 className={styles.closedTitle}>La caja está cerrada</h2>
              <p className={styles.closedText}>
                Cuenta el dinero que hay en el cajón ahora mismo y ábrela con esa cantidad. Al
                final del día el sistema te dirá si cuadra.
              </p>
              <p className={styles.closedText}>
                Mientras esté cerrada no se puede cobrar en efectivo.
              </p>
            </div>

            <Button variant="primary" size="lg" onClick={() => setOpening(true)}>
              Abrir la caja
            </Button>
          </div>
        </Card>

        <OpenCashModal
          open={opening}
          onClose={() => setOpening(false)}
          onOpened={() => {
            setOpening(false)
            void refresh()
          }}
        />
      </Page>
    )
  }

  const movements = movementsQuery.data ?? []

  return (
    <Page title="Caja" subtitle={`Abierta desde el ${formatDateTime(session.openedAt)}`}>
      <div className={styles.layout}>
        <div className={styles.stack}>
          {/* --- El número principal ---------------------------------------- */}
          <Card accent>
            <div className={styles.expected}>
              <span className={styles.expectedLabel}>Dinero que debe haber en el cajón</span>
              <span className={styles.expectedValue} data-numeric>
                {formatCents(session.expected)}
              </span>
              {session.estimated && (
                <span className={styles.estimatedTag}>
                  Aproximado: faltan cobros por sincronizar
                </span>
              )}
              <span className={styles.expectedHint}>
                Es lo que abriste, más lo que se cobró en efectivo, más lo que metiste, menos lo
                que sacaste.
              </span>
            </div>
          </Card>

          {/* --- Las dos acciones del día ----------------------------------- */}
          <div className={styles.bigActions}>
            <button type="button" className={styles.bigAction} onClick={() => setMoving('entrada')}>
              <span className={cn(styles.bigActionIcon, styles.iconIn)} aria-hidden>
                ↓
              </span>
              <span className={styles.bigActionTitle}>Meter dinero</span>
              <span className={styles.bigActionHint}>Dinero que entra al cajón y no es una venta</span>
            </button>

            <button type="button" className={styles.bigAction} onClick={() => setMoving('salida')}>
              <span className={cn(styles.bigActionIcon, styles.iconOut)} aria-hidden>
                ↑
              </span>
              <span className={styles.bigActionTitle}>Sacar dinero</span>
              <span className={styles.bigActionHint}>Una compra, un retiro, una devolución</span>
            </button>
          </div>

          {session.hasPendingSync && (
            <Card accent>
              <p className={styles.syncBlocked}>
                Hay cobros de esta caja que todavía no se guardaron en el servidor. El número de
                arriba es aproximado y no se puede hacer el corte hasta que vuelva el internet.
              </p>
            </Card>
          )}

          <PettyCashCard sessionId={session.id} onChanged={() => void refresh()} />

          <Card
            title="Movimientos de hoy"
            subtitle="Dinero que entró o salió del cajón sin ser una venta."
          >
            {movements.length === 0 ? (
              <p className={styles.emptyMovements}>
                Todavía no hay movimientos. En esta caja solo ha habido ventas.
              </p>
            ) : (
              movements.map((movement) => (
                <div key={movement.id} className={styles.movement}>
                  <div>
                    <div className={styles.movementReason}>{movement.reason}</div>
                    <div className={styles.movementDate}>{formatDateTime(movement.createdAt)}</div>
                  </div>
                  <span
                    className={cn(
                      styles.movementAmount,
                      movement.type === 'entrada' ? styles.in : styles.out,
                    )}
                    data-numeric
                  >
                    {movement.type === 'entrada' ? 'Entró ' : 'Salió '}
                    {formatCents(movement.amount)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* --- Cierre del turno --------------------------------------------- */}
        <aside className={styles.stack}>
          <Card title="Cómo va el turno">
            <div className={styles.breakdown}>
              <div className={styles.breakdownRow}>
                <span>Con lo que abriste</span>
                <span className={styles.breakdownValue} data-numeric>
                  {formatCents(session.opening)}
                </span>
              </div>
              <div className={styles.breakdownRow}>
                <span>Movimientos registrados</span>
                <span className={styles.breakdownValue} data-numeric>
                  {movements.length}
                </span>
              </div>
              <div className={styles.breakdownRow}>
                <span>Debe haber ahora</span>
                <span className={styles.breakdownValue} data-numeric>
                  {formatCents(session.expected)}
                </span>
              </div>
            </div>

            {isAdmin ? (
              <>
                <p className={styles.closeHint}>
                  Al terminar el día, cuenta el dinero del cajón y haz el corte. Se imprime solo.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  block
                  onClick={() => setClosing(true)}
                  disabled={session.hasPendingSync}
                >
                  Contar y cerrar la caja
                </Button>
              </>
            ) : (
              <p className={styles.adminOnly}>
                El corte de caja lo hace el administrador. Tú puedes seguir cobrando y registrando
                movimientos.
              </p>
            )}
          </Card>
        </aside>
      </div>

      {moving && (
        <MovementModal
          sessionId={session.id}
          type={moving}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null)
            void refresh()
          }}
        />
      )}

      <CloseCashModal
        session={session}
        operator={profile?.fullName ?? ''}
        open={closing}
        onClose={() => setClosing(false)}
        onClosed={() => {
          setClosing(false)
          void refresh()
        }}
      />
    </Page>
  )
}

/* -------------------------------------------------------------------------- */
/* Caja chica                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * La caja chica es un fondo aparte para gastos menores: se le mete una cantidad
 * desde el cajón y de ahí se paga el shampoo, las agujetas, el taxi. Vive fuera
 * del turno, así que su saldo no se borra al cerrar la caja.
 *
 * Ver `supabase/migrations/0020_petty_cash.sql` para el modelo y el porqué.
 */
function PettyCashCard({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const [action, setAction] = useState<'fondear' | 'gastar' | null>(null)

  const stateQuery = useQuery({
    queryKey: ['petty-cash', 'state'],
    queryFn: pettyCashRepo.getState,
  })
  const movementsQuery = useQuery({
    queryKey: ['petty-cash', 'movements'],
    queryFn: () => pettyCashRepo.listMovements(8),
  })

  const state = stateQuery.data
  const movements = movementsQuery.data ?? []

  return (
    <Card
      title="Caja chica"
      subtitle="El dinero aparte para gastos pequeños del día: material, envíos, papelería."
    >
      {stateQuery.isError ? (
        <p className={styles.emptyMovements}>
          No se pudo leer la caja chica. Suele ser falta de internet; vuelve a entrar en un momento.
        </p>
      ) : (
        <>
          <div className={styles.pettyBalance}>
            <span className={styles.pettyLabel}>Debe quedar en el sobre</span>
            <span className={styles.pettyValue} data-numeric>
              {state ? formatCents(state.balance) : '—'}
            </span>
            {state && (
              <span className={styles.pettyHint}>
                Se le han metido {formatCents(state.funded)} y se han gastado{' '}
                {formatCents(state.spent)}.
              </span>
            )}
          </div>

          <div className={styles.pettyActions}>
            <Button size="lg" block onClick={() => setAction('fondear')}>
              Poner dinero del cajón
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={!state || state.balance <= 0}
              onClick={() => setAction('gastar')}
            >
              Anotar un gasto
            </Button>
          </div>

          {state && state.balance <= 0 && (
            <p className={styles.pettyEmpty}>
              La caja chica está vacía. Pon dinero del cajón antes de anotar gastos.
            </p>
          )}

          {movements.length > 0 && (
            <div className={styles.pettyList}>
              {movements.map((movement) => (
                <div key={movement.id} className={styles.movement}>
                  <div>
                    <div className={styles.movementReason}>{movement.reason}</div>
                    <div className={styles.movementDate}>{formatDateTime(movement.createdAt)}</div>
                  </div>
                  <span
                    className={cn(
                      styles.movementAmount,
                      movement.type === 'fondeo' ? styles.in : styles.out,
                    )}
                    data-numeric
                  >
                    {movement.type === 'fondeo' ? 'Entró ' : 'Gasto '}
                    {formatCents(movement.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {action && (
        <PettyCashModal
          mode={action}
          sessionId={sessionId}
          max={action === 'gastar' ? (state?.balance ?? cents(0)) : null}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null)
            onChanged()
          }}
        />
      )}
    </Card>
  )
}

function PettyCashModal({
  mode,
  sessionId,
  max,
  onClose,
  onSaved,
}: {
  mode: 'fondear' | 'gastar'
  sessionId: string
  /** Solo para gastos: no se puede gastar más de lo que hay en el sobre. */
  max: Cents | null
  onClose: () => void
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const amount = parseAmount(text) ?? cents(0)
  const overspend = mode === 'gastar' && max !== null && amount > max
  const canSubmit = amount > 0 && reason.trim() !== '' && !overspend && !busy

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      if (mode === 'fondear') {
        await pettyCashRepo.fund({ sessionId, amount, reason })
      } else {
        await pettyCashRepo.spend({ amount, reason })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo registrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'fondear' ? 'Poner dinero en la caja chica' : 'Anotar un gasto de la caja chica'}
      description={
        mode === 'fondear'
          ? 'Este dinero sale del cajón y pasa al sobre de gastos. Queda anotado en los dos lados.'
          : 'Dinero que ya salió del sobre. Guarda el ticket de la compra.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            {mode === 'fondear' ? 'Pasar' : 'Anotar'} {formatCents(amount)}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input
          label="¿Cuánto?"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          {...(overspend && max !== null
            ? { error: `En la caja chica solo hay ${formatCents(max)}.` }
            : {})}
        />

        <ReasonPicker
          label={mode === 'fondear' ? '¿Para qué es?' : '¿En qué se gastó?'}
          suggestions={mode === 'fondear' ? ['Reponer el fondo', 'Fondo inicial del mes'] : MOTIVOS_GASTO_CHICA}
          value={reason}
          onChange={setReason}
        />
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Motivos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * El motivo es obligatorio: un movimiento de dinero sin explicación es
 * exactamente lo que hace imposible auditar un descuadre. Pero escribirlo con
 * el teclado de una tablet, de pie, es lo primero que se abandona — así que se
 * ofrecen los motivos que de verdad se repiten, y el campo libre queda para lo
 * demás.
 */
function ReasonPicker({
  label,
  suggestions,
  value,
  onChange,
}: {
  label: string
  suggestions: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.reasonBlock}>
      <span className={styles.reasonLabel}>{label}</span>

      <div className={styles.reasonChips}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={cn(styles.reasonChip, value === suggestion && styles.reasonChipActive)}
            onClick={() => onChange(value === suggestion ? '' : suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <Input
        placeholder="O escríbelo con tus palabras"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function OpenCashModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean
  onClose: () => void
  onOpened: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const amount = parseAmount(text) ?? cents(0)

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      await cashRepo.openSession(amount)
      setText('')
      onOpened()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo abrir la caja.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir la caja"
      description="Cuenta el dinero que hay ahora en el cajón y escribe cuánto es."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="lg" loading={busy} onClick={() => void submit()}>
            Abrir con {formatCents(amount)}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input
          label="¿Cuánto dinero hay en el cajón?"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          hint="Si el cajón está vacío, déjalo en cero."
        />

        <div className={styles.suggestions}>
          {FONDO_SUGERIDO.map((value) => (
            <button
              key={value}
              type="button"
              className={cn(styles.suggestion, amount === value && styles.suggestionActive)}
              onClick={() => setText((value / 100).toString())}
            >
              {formatCents(value)}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */

function MovementModal({
  sessionId,
  type,
  onClose,
  onSaved,
}: {
  sessionId: string
  /** Ya viene decidida por el botón que se tocó: aquí no se elige dirección. */
  type: CashMovementType
  onClose: () => void
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isIn = type === 'entrada'
  const amount = parseAmount(text) ?? cents(0)
  const canSubmit = amount > 0 && reason.trim() !== '' && !busy

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      await cashRepo.addMovement({ sessionId, type, amount, reason })
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo registrar el movimiento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isIn ? 'Meter dinero al cajón' : 'Sacar dinero del cajón'}
      description={
        isIn
          ? 'Dinero que entra y no viene de una venta.'
          : 'Dinero que sale del cajón: una compra, un retiro, una devolución.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            {isIn ? 'Meter' : 'Sacar'} {formatCents(amount)}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input
          label="¿Cuánto?"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <ReasonPicker
          label={isIn ? '¿De dónde viene?' : '¿Para qué se saca?'}
          suggestions={isIn ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA}
          value={reason}
          onChange={setReason}
        />
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */

function CloseCashModal({
  session,
  operator,
  open,
  onClose,
  onClosed,
}: {
  session: NonNullable<ReturnType<typeof useSession.getState>['cashSession']>
  operator: string
  open: boolean
  onClose: () => void
  onClosed: () => void
}) {
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counted = parseAmount(text)
  const difference = counted !== null ? subtractCents(counted, session.expected) : null

  async function submit() {
    if (counted === null) return

    setBusy(true)
    setError(null)

    try {
      const closed = await cashRepo.closeSession(session.id, counted, notes)

      // El corte se imprime al cerrar: es el documento que se firma. Si la
      // impresión falla, el cierre ya quedó guardado igual — no se pierde.
      const business = await settingsRepo.getBusinessSettings()
      await tryPrint(
        cashCloseDocument(
          {
            openedAt: closed.openedAt,
            closedAt: closed.closedAt!,
            opening: closed.opening,
            expected: closed.expected,
            counted: closed.counted!,
            difference: closed.difference!,
            operator,
          },
          business,
        ),
      )

      setText('')
      setNotes('')
      onClosed()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo cerrar la caja.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cerrar la caja"
      description="Saca todo el dinero del cajón, cuéntalo y escribe cuánto te salió."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={counted === null || busy}
            loading={busy}
            onClick={() => void submit()}
          >
            Cerrar e imprimir el corte
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.breakdown}>
          <div className={styles.breakdownRow}>
            <span>Según el sistema, debe haber</span>
            <span className={styles.breakdownValue} data-numeric>
              {formatCents(session.expected)}
            </span>
          </div>
        </div>

        <Input
          label="¿Cuánto contaste?"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {/* El resultado se dice primero en palabras. Un signo menos delante de
            una cifra es demasiado fácil de pasar por alto justo en el momento
            en que más importa. */}
        {difference !== null && (
          <div
            className={cn(
              styles.difference,
              difference === 0
                ? styles.diffZero
                : difference < 0
                  ? styles.diffShort
                  : styles.diffOver,
            )}
          >
            <span className={styles.diffLabel}>
              {difference === 0
                ? 'Todo cuadra'
                : difference < 0
                  ? 'Falta dinero'
                  : 'Sobra dinero'}
            </span>
            {difference !== 0 && (
              <span className={styles.diffValue} data-numeric>
                {formatCents(cents(Math.abs(difference)))}
              </span>
            )}
            <span className={styles.diffHint}>
              {difference === 0
                ? 'Lo que contaste es exactamente lo que debía haber.'
                : difference < 0
                  ? 'Anota abajo qué pudo haber pasado antes de cerrar.'
                  : 'Hay más dinero del esperado. Anota abajo si sabes por qué.'}
            </span>
          </div>
        )}

        <Input
          label="Notas del corte (opcional)"
          placeholder="Ej. faltó registrar una salida"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  )
}
