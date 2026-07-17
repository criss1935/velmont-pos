import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Input } from '@/components/ui'
import { orders as ordersRepo, ORDER_STATUS_LABEL, statusForOrder, useSyncStatus, type OrderStatus } from '@/data'
import { SyncBadge } from '@/features/sync/SyncBadge'
import { cn } from '@/lib/cn'
import { formatCents } from '@/lib/money'
import { formatRelative, isOverdue } from '@/lib/dates'
import { StatusBadge } from './StatusBadge'
import styles from './OrdersPage.module.css'

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
  { key: 'todas', label: 'Todas', statuses: [] },
]

export function OrdersPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('activas')
  const [search, setSearch] = useState('')

  const active = TABS.find((item) => item.key === tab) ?? TABS[0]!

  const query = useQuery({
    queryKey: ['orders', active.key, search],
    queryFn: () =>
      ordersRepo.listOrders({
        status: active.statuses,
        search,
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

      {list.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden>
            ⬗
          </span>
          <p>
            {search
              ? `Ninguna orden coincide con «${search}».`
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
                    {order.balance > 0 ? (
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
