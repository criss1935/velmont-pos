import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Badge, Button, Card } from '@/components/ui'
import { expenses as expensesRepo, type BusinessExpense } from '@/data'
import { formatCents } from '@/lib/money'
import { CATEGORIES, daysUntil, formatPlainDate } from './categories'
import { ExpenseFormModal } from './ExpenseFormModal'
import styles from './ExpensesPage.module.css'

const NO_EXPENSES: BusinessExpense[] = []

function Validity({ value }: { value: string }) {
  const days = daysUntil(value)
  if (days < 0) return <Badge tone="danger">Vencido {formatPlainDate(value)}</Badge>
  if (days <= 30) return <Badge tone="warning">Vence {formatPlainDate(value)}</Badge>
  return <Badge tone="neutral">Vigente al {formatPlainDate(value)}</Badge>
}

export function ExpensesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<BusinessExpense | null>(null)
  const [creating, setCreating] = useState(false)

  const listQuery = useQuery({ queryKey: ['business-expenses'], queryFn: expensesRepo.list })
  const summaryQuery = useQuery({ queryKey: ['business-expenses-summary'], queryFn: expensesRepo.summary })

  const items = listQuery.data ?? NO_EXPENSES
  const summary = summaryQuery.data

  const groups = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        items: items.filter((e) => e.category === category.value),
      })).filter((g) => g.items.length > 0),
    [items],
  )

  function close() {
    setEditing(null)
    setCreating(false)
  }

  function saved() {
    close()
    void queryClient.invalidateQueries({ queryKey: ['business-expenses'] })
    void queryClient.invalidateQueries({ queryKey: ['business-expenses-summary'] })
  }

  const error = listQuery.error ?? summaryQuery.error

  return (
    <Page
      title="Gastos históricos"
      subtitle="Inversión y gastos del local desde la apertura."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nuevo gasto
        </Button>
      }
    >
      {error && <div className={styles.error}>{error.message}</div>}

      {summary && (
        <div className={styles.summary}>
          <Card accent>
            <div className={styles.kpiLabel}>Total acumulado</div>
            <div className={styles.kpiValue} data-numeric>
              {formatCents(summary.total)}
            </div>
          </Card>
          <Card>
            <div className={styles.kpiLabel}>Inversión</div>
            <div className={styles.kpiValueSm} data-numeric>
              {formatCents(summary.inversion)}
            </div>
          </Card>
          <Card>
            <div className={styles.kpiLabel}>Gastos</div>
            <div className={styles.kpiValueSm} data-numeric>
              {formatCents(summary.gasto)}
            </div>
          </Card>
        </div>
      )}

      {summary && summary.pendingCount > 0 && (
        <div className={styles.notice}>
          {summary.pendingCount === 1
            ? 'Hay 1 monto por confirmar incluido en el total.'
            : `Hay ${summary.pendingCount} montos por confirmar incluidos en el total.`}
        </div>
      )}

      {listQuery.isLoading ? (
        <p className={styles.empty}>Cargando…</p>
      ) : groups.length === 0 ? (
        <p className={styles.empty}>Todavía no hay gastos registrados.</p>
      ) : (
        <div className={styles.groups}>
          {groups.map(({ category, items: rows }) => {
            const subtotal = summary?.byCategory[category.value]
            return (
              <Card
                key={category.value}
                flush
                title={category.label}
                actions={
                  subtotal && (
                    <span className={styles.subtotal} data-numeric>
                      {formatCents(subtotal.total)}
                    </span>
                  )
                }
              >
                <ul className={styles.list}>
                  {rows.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={styles.item} onClick={() => setEditing(e)}>
                        <div className={styles.itemMain}>
                          <span className={styles.concept}>{e.concept}</span>
                          <span className={styles.meta}>
                            {[e.expenseDate && formatPlainDate(e.expenseDate), e.paidTo, e.notes]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          <span className={styles.badges}>
                            {e.kind === 'inversion' && <Badge tone="gold">Inversión</Badge>}
                            {e.amountPending && <Badge tone="warning">Por confirmar</Badge>}
                            {e.validUntil && <Validity value={e.validUntil} />}
                          </span>
                        </div>
                        <span className={styles.amount} data-numeric>
                          {formatCents(e.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <ExpenseFormModal expense={editing} onClose={close} onSaved={saved} />
      )}
    </Page>
  )
}
