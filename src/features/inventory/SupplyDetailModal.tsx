import { useQuery } from '@tanstack/react-query'
import { Badge, Modal } from '@/components/ui'
import { supplies as suppliesRepo, type Supply, type SupplyMovementType } from '@/data'
import { formatCents } from '@/lib/money'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import styles from './SupplyDetailModal.module.css'

const TYPE_LABEL: Record<SupplyMovementType, string> = {
  compra: 'Compra',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
  merma: 'Merma',
}

/** Entradas suman al stock; salidas restan. Es lo que decide el signo mostrado. */
const IS_ENTRY: Record<SupplyMovementType, boolean> = {
  compra: true,
  ajuste: true,
  consumo: false,
  merma: false,
}

/** Ficha del insumo + su bitácora completa de movimientos, en modo lectura. */
export function SupplyDetailModal({ supply, onClose }: { supply: Supply; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['supplyMovements', supply.id],
    queryFn: () => suppliesRepo.listSupplyMovements(supply.id),
  })

  const movements = query.data ?? []

  return (
    <Modal open onClose={onClose} title={supply.name} wide>
      <div className={styles.wrap}>
        <section className={styles.summary}>
          {supply.description && <p className={styles.description}>{supply.description}</p>}

          <div className={styles.facts}>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Existencia</span>
              <span className={styles.factValue} data-numeric>
                {supply.stock} {supply.unit}
              </span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Mínimo</span>
              <span className={styles.factValue} data-numeric>
                {supply.minStock} {supply.unit}
              </span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Costo unitario</span>
              <span className={styles.factValue} data-numeric>
                {supply.cost !== null ? formatCents(supply.cost) : '—'}
              </span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Estatus</span>
              <span>
                {supply.active ? (
                  <Badge tone="success">Activo</Badge>
                ) : (
                  <Badge tone="neutral">Inactivo</Badge>
                )}
                {supply.active && supply.low && (
                  <Badge tone="danger" className={cn(styles.lowBadge)}>
                    Bajo
                  </Badge>
                )}
              </span>
            </div>
          </div>
        </section>

        <section className={styles.history}>
          <h3 className={styles.historyTitle}>Historial de movimientos</h3>

          {query.isLoading ? (
            <p className={styles.empty}>Cargando…</p>
          ) : movements.length === 0 ? (
            <p className={styles.empty}>Este insumo todavía no tiene movimientos registrados.</p>
          ) : (
            <ul className={styles.list}>
              {movements.map((movement) => (
                <li key={movement.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowType}>{TYPE_LABEL[movement.type]}</span>
                    <span
                      className={cn(styles.rowQuantity, IS_ENTRY[movement.type] && styles.rowEntry)}
                      data-numeric
                    >
                      {IS_ENTRY[movement.type] ? '+' : '−'}
                      {movement.quantity} {supply.unit}
                    </span>
                  </div>

                  <div className={styles.rowMeta}>
                    <span>{formatDateTime(movement.createdAt)}</span>
                    {movement.createdByName && <span> · {movement.createdByName}</span>}
                  </div>

                  <div className={styles.rowStock} data-numeric>
                    {movement.stockBefore} → {movement.stockAfter} {supply.unit}
                  </div>

                  {movement.note && <p className={styles.rowNote}>{movement.note}</p>}
                  {movement.reference && (
                    <p className={styles.rowReference}>Referencia: {movement.reference}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}
