import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { orders as ordersRepo, settings as settingsRepo } from '@/data'
import { receiptDocument, tryPrint } from '@/features/printing'
import styles from './Reception.module.css'

type PrintState =
  | { phase: 'idle' }
  | { phase: 'printing' }
  | { phase: 'printed' }
  | { phase: 'failed'; message: string }

/**
 * Cierre de la recepción.
 *
 * La orden YA está guardada cuando se llega aquí. Todo lo que pasa en esta
 * pantalla es opcional y reintentable: si la impresora está sin papel, si la
 * tablet perdió el internet y no se puede releer la orden para armar el
 * ticket, nada de eso pone en riesgo la venta. Por eso ningún fallo de aquí se
 * presenta como un error de la operación, solo como "no salió el papel".
 *
 * Se dispara una impresión sola al entrar, porque en el mostrador la nota se
 * imprime SIEMPRE — pedir un clic extra para la acción que ocurre el 100% de
 * las veces es fricción pura. El botón queda para reimprimir.
 */
export function ReceptionDone({
  orderId,
  onNew,
  onOpenOrder,
}: {
  orderId: string
  onNew: () => void
  onOpenOrder: () => void
}) {
  const [state, setState] = useState<PrintState>({ phase: 'idle' })
  const [folio, setFolio] = useState<string | null>(null)

  const print = useCallback(async () => {
    setState({ phase: 'printing' })

    try {
      const [order, business] = await Promise.all([
        ordersRepo.getOrder(orderId),
        settingsRepo.getBusinessSettings(),
      ])

      if (!order) {
        setState({
          phase: 'failed',
          message:
            'La orden se guardó, pero todavía no se puede leer para armar la nota. Inténtalo en unos segundos.',
        })
        return
      }

      setFolio(order.folio)

      const failure = await tryPrint(receiptDocument(order, business))
      if (failure) {
        setState({ phase: 'failed', message: failure.message })
        return
      }

      setState({ phase: 'printed' })
    } catch {
      setState({
        phase: 'failed',
        message:
          'La orden se guardó bien, pero no se pudo preparar la nota (puede ser falta de internet). Puedes imprimirla después desde Órdenes.',
      })
    }
  }, [orderId])

  // Una sola impresión automática, aunque React monte el efecto dos veces en
  // desarrollo (StrictMode). Un ticket duplicado en el mostrador es papel
  // tirado y un cliente confundido.
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current) return
    auto.current = true
    void print()
  }, [print])

  return (
    <div className={styles.done}>
      <div className={styles.doneMark} aria-hidden>
        ✓
      </div>

      <h2 className={styles.doneTitle}>Orden registrada</h2>
      {folio && <p className={styles.doneFolio}>Folio {folio}</p>}

      <div className={styles.doneStatus} data-phase={state.phase}>
        {state.phase === 'printing' && 'Mandando la nota a la impresora…'}
        {state.phase === 'printed' && 'La nota se mandó a imprimir. Entrégasela al cliente.'}
        {state.phase === 'failed' && state.message}
        {state.phase === 'idle' && 'Preparando la nota…'}
      </div>

      <div className={styles.doneActions}>
        <Button
          variant="primary"
          size="lg"
          block
          loading={state.phase === 'printing'}
          onClick={() => void print()}
        >
          {state.phase === 'failed' ? 'Intentar imprimir otra vez' : 'Imprimir la nota otra vez'}
        </Button>

        <Button variant="secondary" size="lg" block onClick={onNew}>
          Recibir otro cliente
        </Button>

        <Button variant="ghost" block onClick={onOpenOrder}>
          Ver esta orden
        </Button>
      </div>
    </div>
  )
}
