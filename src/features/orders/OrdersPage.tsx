import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Input } from '@/components/ui'
import { orders as ordersRepo, ORDER_STATUS_LABEL, statusForOrder, useSyncStatus, type OrderStatus } from '@/data'
import { SyncBadge } from '@/features/sync/SyncBadge'
import { cn } from '@/lib/cn'
import { formatCents } from '@/lib/money'
import { daysAgo, formatRelative, fromDateInput, isOverdue, startOfDay } from '@/lib/dates'
import { StatusBadge } from './StatusBadge'
import styles from './OrdersPage.module.css'

/**
 * Rango de fechas (por fecha de recepción). "Todo" es el default: el tablero de
 * Activas no se acota por fecha, una orden vieja que sigue en el taller tiene que
 * verse. Los rangos sirven para recorrer el histórico (Entregadas / Todas).
 */
const RANGES = [
  { key: 'todo', label: 'Todo', from: null },
  { key: 'hoy', label: 'Hoy', from: () => startOfDay() },
  { key: '7d', label: '7 días', from: () => daysAgo(7) },
  { key: '15d', label: '15 días', from: () => daysAgo(15) },
  { key: '30d', label: '30 días', from: () => daysAgo(30) },
] as const

type RangeKey = (typeof RANGES)[number]['key'] | 'custom'

/** Con un rango el tope de 100 se queda corto: se pide más para no recortar el histórico. */
const RANGE_LIMIT = 500

/**
 * Los filtros del tablero.
 *
 * "Activas" es el primero y el que se abre por defecto: al mostrador le importa
 * lo que está en el taller, no lo que ya salió por la puerta. Que "Entregadas"
 * esté a un toque, pero no sea lo primero, es la diferencia entre un tablero que
 * sirve y uno que hay que filtrar cada mañana.
 */
const TABS: Array<{ key: string; label: string; statuses: OrderStatus[] }> = [
  { key: 'activas', label: 'Activas', statuses: ['recibido', 'en_proceso', 'listo'] },
  { key: 'recibido', label: ORDER_STATUS_LABEL.recibido, statuses: ['recibido'] },
  { key: 'en_proceso', label: ORDER_STATUS_LABEL.en_proceso, statuses: ['en_proceso'] },
  { key: 'listo', label: ORDER_STATUS_LABEL.listo, statuses: ['listo'] },
  { key: 'entregado', label: ORDER_STATUS_LABEL.entregado, statuses: ['entregado'] },
  { key: 'cancelado', label: ORDER_STATUS_LABEL.cancelado, statuses: ['cancelado'] },
  { key: 'todas', label: 'Todas', statuses: [] },
]

export function OrdersPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('activas')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangeKey>('todo')
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')

  const active = TABS.find((item) => item.key === tab) ?? TABS[0]!

  const preset = RANGES.find((item) => item.key === range)
  const from =
    range === 'custom' ? fromDateInput(fromText, 'start') : (preset?.from?.() ?? null)
  const to = range === 'custom' ? fromDateInput(toText, 'end') : null
  const dated = from !== null || to !== null

  const query = useQuery({
    // Las fechas entran a la llave como texto ISO: `from` es un Date nuevo en cada
    // render y, como objeto, haría que la consulta se repitiera sin parar.
    queryKey: ['orders', active.key, search, from?.toISOString() ?? null, to?.toISOString() ?? null],
    queryFn: () =>
      ordersRepo.listOrders({
        status: active.statuses,
        search,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(dated ? { limit: RANGE_LIMIT } : {}),
      }),
    // El tablero lo miran varias personas a la vez y las órdenes cambian de
    // estado en el taller: 15 s mantiene la pantalla viva sin castigar la red.
    refetchInterval: 15_000,
  })

  const list = query.data ?? []
  const pendingSync = useSyncStatus((state) => state.pending)

  return (
    <Page title="Órdenes" subtitle="El estado de todo lo que está en el taller.">
      <div className={styles.filters}>
        <div className={styles.tabs}>
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(styles.tab, tab === item.key && styles.tabActive)}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {tab === item.key && list.length > 0 && (
                <span className={styles.count} data-numeric>
                  {list.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.search}>
          <Input
            placeholder="Buscar folio…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar por folio"
          />
        </div>
      </div>

      <div className={styles.dates}>
        <div className={styles.tabs}>
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(styles.tab, range === item.key && styles.tabActive)}
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Input
          className={styles.dateField}
          type="date"
          label="Desde"
          value={fromText}
          max={toText || undefined}
          onChange={(event) => {
            setFromText(event.target.value)
            setRange('custom')
          }}
        />
        <Input
          className={styles.dateField}
          type="date"
          label="Hasta"
          value={toText}
          min={fromText || undefined}
          onChange={(event) => {
            setToText(event.target.value)
            setRange('custom')
          }}
        />
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden>
            ⬗
          </span>
          <p>
            {search
              ? `Ninguna orden coincide con «${search}».`
              : dated
                ? 'No hay órdenes en este rango de fechas.'
                : 'No hay órdenes en este estado.'}
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {list.map((order) => {
            // Solo cuenta como vencida si SIGUE en el taller. Una orden entregada
            // tarde ya no es un problema pendiente: pintarla en rojo sería ruido.
            const late =
              isOverdue(order.promisedAt) &&
              order.status !== 'entregado' &&
              order.status !== 'cancelado'
            const syncStatus = statusForOrder(order.id, pendingSync)

            return (
              <button
                key={order.id}
                type="button"
                className={cn(styles.card, late && styles.overdue)}
                onClick={() => navigate(`/ordenes/${order.id}`)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.folio} data-numeric>
                    {order.folio}
                  </span>
                  <div className={styles.cardBadges}>
                    {syncStatus && <SyncBadge status={syncStatus} />}
                    <StatusBadge status={order.status} />
                  </div>
                </div>

                <div className={styles.customer}>
                  {order.customerName ?? <span className={styles.anon}>Sin cliente</span>}
                </div>

                <div className={styles.meta}>
                  <span>{formatRelative(order.receivedAt)}</span>
                  {late && <span className={styles.overdueLabel}>Vencida</span>}
                </div>

                <div className={styles.cardBottom}>
                  <div className={styles.amounts}>
                    <span className={styles.total} data-numeric>
                      {formatCents(order.total)}
                    </span>
                    {order.status === 'cancelado' ? (
                      // En una cancelada "Debe" / "Pagado" no aplican: lo que importa
                      // es si quedó dinero cobrado pegado a una orden que no se hizo.
                      <span className={order.paid > 0 ? styles.balance : styles.paid}>
                        {order.paid > 0 ? `Cobrado ${formatCents(order.paid)}` : 'Sin cobro'}
                      </span>
                    ) : order.balance > 0 ? (
                      <span className={styles.balance}>Debe {formatCents(order.balance)}</span>
                    ) : (
                      <span className={styles.paid}>Pagado</span>
                    )}
                  </div>

                  <span className={styles.items}>
                    {order.itemCount} {order.itemCount === 1 ? 'par' : 'pares'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Page>
  )
}
