import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Card, Input, Modal } from '@/components/ui'
import { cash as cashRepo, DataError, type CashMovementType } from '@/data'
import { useIsAdmin, useSession } from '@/app/session'
import { cashCloseDocument, tryPrint } from '@/features/printing'
import { cn } from '@/lib/cn'
import { cents, formatCents, parseAmount, subtractCents } from '@/lib/money'
import { formatDateTime } from '@/lib/dates'
import styles from './CashPage.module.css'

export function CashPage() {
  const queryClient = useQueryClient()
  const session = useSession((state) => state.cashSession)
  const profile = useSession((state) => state.profile)
  const refreshCash = useSession((state) => state.refreshCash)
  const isAdmin = useIsAdmin()

  const [opening, setOpening] = useState(false)
  const [moving, setMoving] = useState(false)
  const [closing, setClosing] = useState(false)

  const movementsQuery = useQuery({
    queryKey: ['cash-movements', session?.id],
    queryFn: () => cashRepo.listMovements(session!.id),
    enabled: Boolean(session),
  })

  async function refresh() {
    await refreshCash()
    void queryClient.invalidateQueries({ queryKey: ['cash-movements'] })
  }

  if (!session) {
    return (
      <Page title="Caja" subtitle="Sin caja abierta no se puede cobrar en efectivo.">
        <Card accent>
          <div className={styles.closed}>
            <span className={styles.closedIcon} aria-hidden>
              ▤
            </span>
            <div>
              <h2 style={{ fontFamily: 'var(--vm-font-display)', fontSize: 'var(--vm-text-2xl)' }}>
                La caja está cerrada
              </h2>
              <p className={styles.closedText}>
                Abre la caja con el efectivo que hay en el cajón para empezar el turno. Ese fondo
                inicial es lo que después permite cuadrar el corte.
              </p>
            </div>

            <Button variant="primary" size="lg" onClick={() => setOpening(true)}>
              Abrir caja
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
    <Page
      title="Caja"
      subtitle={`Abierta el ${formatDateTime(session.openedAt)}`}
      actions={
        <>
          <Button onClick={() => setMoving(true)}>Entrada / salida</Button>
          {isAdmin && (
            <Button
              variant="primary"
              onClick={() => setClosing(true)}
              disabled={session.hasPendingSync}
              title={session.hasPendingSync ? 'Hay movimientos o cobros sin sincronizar.' : undefined}
            >
              Cerrar caja
            </Button>
          )}
        </>
      }
    >
      <div className={styles.layout}>
        <div>
          <Card accent>
            <div className={styles.expected}>
              <span className={styles.expectedLabel}>Debería haber en el cajón</span>
              <span className={styles.expectedValue} data-numeric>
                {formatCents(session.expected)}
                {session.estimated && <span className={styles.estimatedTag}> (estimado)</span>}
              </span>
              <span className={styles.expectedHint}>
                Fondo inicial + cobros en efectivo + entradas − salidas
              </span>
            </div>
          </Card>

          {session.hasPendingSync && (
            <>
              <div style={{ height: 'var(--vm-space-4)' }} />
              <Card accent>
                <p className={styles.syncBlocked}>
                  Hay movimientos o cobros de esta caja sin sincronizar. El «esperado» de arriba es una
                  estimación local; cerrar caja requiere conexión para calcular el número correcto.
                </p>
              </Card>
            </>
          )}

          <div style={{ height: 'var(--vm-space-4)' }} />

          <Card title="Movimientos" subtitle="Dinero que entra o sale sin ser una venta.">
            {movements.length === 0 ? (
              <p className={styles.emptyMovements}>
                Sin movimientos. Solo hay ventas en esta caja.
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
                    {movement.type === 'entrada' ? '+' : '−'}
                    {formatCents(movement.amount)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>

        <aside>
          <Card title="Resumen del turno">
            <div className={styles.breakdown}>
              <div className={styles.breakdownRow}>
                <span>Fondo inicial</span>
                <span className={styles.breakdownValue} data-numeric>
                  {formatCents(session.opening)}
                </span>
              </div>
              <div className={styles.breakdownRow}>
                <span>Movimientos</span>
                <span className={styles.breakdownValue} data-numeric>
                  {movements.length}
                </span>
              </div>
              <div className={styles.breakdownRow}>
                <span>Esperado ahora{session.estimated && ' (estimado)'}</span>
                <span className={styles.breakdownValue} data-numeric>
                  {formatCents(session.expected)}
                </span>
              </div>
            </div>

            {!isAdmin && (
              <p className={styles.adminOnly}>
                Solo un administrador puede cerrar la caja.
              </p>
            )}
          </Card>
        </aside>
      </div>

      <MovementModal
        sessionId={session.id}
        open={moving}
        onClose={() => setMoving(false)}
        onSaved={() => {
          setMoving(false)
          void refresh()
        }}
      />

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
      title="Abrir caja"
      description="Cuenta el efectivo que hay ahora en el cajón."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Abrir con {formatCents(amount)}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <Input
          label="Fondo inicial"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          hint="Si el cajón está vacío, déjalo en cero."
        />
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */

function MovementModal({
  sessionId,
  open,
  onClose,
  onSaved,
}: {
  sessionId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<CashMovementType>('salida')
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const amount = parseAmount(text) ?? cents(0)
  const canSubmit = amount > 0 && reason.trim() !== '' && !busy

  async function submit() {
    setBusy(true)
    setError(null)

    try {
      await cashRepo.addMovement({ sessionId, type, amount, reason })
      setText('')
      setReason('')
      onSaved()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo registrar el movimiento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Entrada o salida de efectivo"
      description="Dinero que se mueve del cajón sin ser una venta: compras, retiros, devoluciones."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.types}>
          <button
            type="button"
            className={cn(styles.type, type === 'salida' && styles.typeActive)}
            onClick={() => setType('salida')}
          >
            Salida
          </button>
          <button
            type="button"
            className={cn(styles.type, type === 'entrada' && styles.typeActive)}
            onClick={() => setType('entrada')}
          >
            Entrada
          </button>
        </div>

        <Input
          label="Importe"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {/* El motivo es obligatorio: un movimiento de caja sin explicación es
            exactamente lo que hace imposible auditar un descuadre. */}
        <Input
          label="Motivo"
          placeholder="Ej. compra de shampoo"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
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
      await tryPrint(
        cashCloseDocument({
          openedAt: closed.openedAt,
          closedAt: closed.closedAt!,
          opening: closed.opening,
          expected: closed.expected,
          counted: closed.counted!,
          difference: closed.difference!,
          operator,
        }),
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
      title="Cerrar caja"
      description="Cuenta el efectivo del cajón y captúralo. El sistema calcula la diferencia."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={counted === null || busy}
            loading={busy}
            onClick={() => void submit()}
          >
            Cerrar e imprimir corte
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.breakdown}>
          <div className={styles.breakdownRow}>
            <span>Esperado en el cajón</span>
            <span className={styles.breakdownValue} data-numeric>
              {formatCents(session.expected)}
            </span>
          </div>
        </div>

        <Input
          label="Efectivo contado"
          numeric
          prefix="$"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

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
              {difference === 0 ? 'Cuadra' : difference < 0 ? 'Faltante' : 'Sobrante'}
            </span>
            <span className={styles.diffValue} data-numeric>
              {formatCents(difference)}
            </span>
          </div>
        )}

        <Input
          label="Notas del corte"
          placeholder="Opcional"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  )
}
