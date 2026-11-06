import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { PeriodPicker } from '@/components/PeriodPicker'
import { usePeriod } from '@/components/usePeriod'
import { Badge, Button, Card } from '@/components/ui'
import { BarsCard, chartGridClass, DonutCard, COLOR_HIGHLIGHT, COLOR_VENTAS } from '@/components/charts'
import { expenses as expensesRepo, type BusinessExpense, type BusinessExpenseCategory } from '@/data'
import { cn } from '@/lib/cn'
import { cents, centsToPesos, formatCents } from '@/lib/money'
import { CATEGORIES, categoryLabel, daysUntil, formatPlainDate } from './categories'
import { ExpenseFormModal } from './ExpenseFormModal'
import styles from './ExpensesPage.module.css'

const NO_EXPENSES: BusinessExpense[] = []
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function Validity({ value }: { value: string }) {
  const days = daysUntil(value)
  if (days < 0) return <Badge tone="danger">Vencido {formatPlainDate(value)}</Badge>
  if (days <= 30) return <Badge tone="warning">Vence {formatPlainDate(value)}</Badge>
  return <Badge tone="success">Vigente al {formatPlainDate(value)}</Badge>
}

export function ExpensesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<BusinessExpense | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<BusinessExpenseCategory | 'todos'>('todos')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Gastos es un histórico: por defecto se ve TODO (incluidos los registros sin fecha).
  const period = usePeriod('todo')
  const { from, to } = period.range

  const listQuery = useQuery({ queryKey: ['business-expenses'], queryFn: expensesRepo.list })
  const summaryQuery = useQuery({
    queryKey: ['business-expenses-summary', from, to],
    queryFn: () => expensesRepo.summary({ from, to }),
  })

  const all = listQuery.data ?? NO_EXPENSES
  const summary = summaryQuery.data
  const bounded = from !== null || to !== null

  // Mismo criterio que la base: con periodo, los registros sin fecha quedan fuera.
  const items = useMemo(
    () =>
      bounded
        ? all.filter(
            (e) => e.expenseDate !== null && (!from || e.expenseDate >= from) && (!to || e.expenseDate <= to),
          )
        : all,
    [all, bounded, from, to],
  )
  const undatedOut = bounded ? all.filter((e) => e.expenseDate === null).length : 0

  const usedCategories = useMemo(
    () => CATEGORIES.filter((c) => (summary?.byCategory[c.value]?.items ?? 0) > 0),
    [summary],
  )

  const shown = useMemo(
    () => (filter === 'todos' ? items : items.filter((e) => e.category === filter)),
    [items, filter],
  )

  // Series para las gráficas: solo conversión centavos → pesos para pintar.
  const byCategory = usedCategories.map((c) => ({
    name: c.label,
    value: centsToPesos(summary?.byCategory[c.value]?.total ?? cents(0)),
  }))

  const byMonth = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of items) {
      if (!e.expenseDate) continue
      const key = e.expenseDate.slice(0, 7)
      map.set(key, (map.get(key) ?? 0) + e.amount)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => ({
        name: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`,
        value: total / 100,
      }))
  }, [items])
  const undated = items.filter((e) => !e.expenseDate).length

  const topConcepts = useMemo(
    () =>
      [...items]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10)
        .map((e) => ({
          name: e.concept,
          value: e.amount / 100,
          color: e.kind === 'inversion' ? COLOR_HIGHLIGHT : COLOR_VENTAS,
        })),
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
      title="Gastos"
      subtitle="Histórico de inversión y gastos del local: equipo, obra, renta, servicios, permisos y demás."
      actions={
        <>
          <Button
            disabled={!summary || exporting}
            loading={exporting}
            onClick={() => {
              if (!summary) return
              setExporting(true)
              setExportError(null)
              // El generador (exceljs) se descarga solo al exportar.
              import('@/features/export/expensesExcel')
                .then((m) => m.downloadExpensesExcel(items, summary, period.range))
                .catch(() => setExportError('No se pudo generar el Excel. Intenta de nuevo.'))
                .finally(() => setExporting(false))
            }}
          >
            Exportar Excel
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Nuevo gasto
          </Button>
        </>
      }
    >
      <PeriodPicker period={period} allowAll />
      {undatedOut > 0 && (
        <p className={styles.notice}>
          {undatedOut} {undatedOut === 1 ? 'registro sin fecha no entra' : 'registros sin fecha no entran'} en este
          periodo (como Máquinas u Obra). Elige «Todo» para verlos, o ponles fecha para que caigan en su mes.
        </p>
      )}
      {error && <div className={styles.error}>{error.message}</div>}
      {exportError && <div className={styles.error}>{exportError}</div>}

      {summary && (
        <div className={styles.metrics}>
          <Card accent>
            <div className={styles.kpiLabel}>Total acumulado</div>
            <div className={styles.kpiValue} data-numeric>
              {formatCents(summary.total)}
            </div>
            <small className={styles.kpiHint}>
              {summary.items} {summary.items === 1 ? 'registro' : 'registros'}
            </small>
          </Card>
          <Card>
            <div className={styles.kpiLabel}>Inversión</div>
            <div className={styles.kpiValue} data-numeric>
              {formatCents(summary.inversion)}
            </div>
            <small className={styles.kpiHint}>Equipo y activos</small>
          </Card>
          <Card>
            <div className={styles.kpiLabel}>Gastos</div>
            <div className={styles.kpiValue} data-numeric>
              {formatCents(summary.gasto)}
            </div>
            <small className={styles.kpiHint}>Obra, renta, servicios y demás</small>
          </Card>
          <Card>
            <div className={styles.kpiLabel}>Por confirmar</div>
            <div className={styles.kpiValue} data-numeric>
              {summary.pendingCount}
            </div>
            <small className={styles.kpiHint}>
              {summary.pendingCount === 0 ? 'Todo confirmado' : 'Montos provisionales en el total'}
            </small>
          </Card>
        </div>
      )}

      {summary && usedCategories.length > 0 && (
        <div className={styles.catMetrics}>
          {usedCategories.map((c) => {
            const t = summary.byCategory[c.value]
            const selected = filter === c.value
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={selected}
                className={cn(styles.catBtn, selected && styles.catBtnActive)}
                onClick={() => setFilter(selected ? 'todos' : c.value)}
              >
                <span className={styles.catName}>{c.label}</span>
                <strong data-numeric>{formatCents(t?.total ?? cents(0))}</strong>
                <small>
                  {t?.items ?? 0} {t?.items === 1 ? 'registro' : 'registros'}
                </small>
              </button>
            )
          })}
        </div>
      )}

      <div className={styles.chips} role="tablist" aria-label="Categoría">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'todos'}
          className={cn(styles.chip, filter === 'todos' && styles.chipActive)}
          onClick={() => setFilter('todos')}
        >
          Todos
        </button>
        {usedCategories.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={filter === c.value}
            className={cn(styles.chip, filter === c.value && styles.chipActive)}
            onClick={() => setFilter(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Card flush>
        {listQuery.isLoading ? (
          <p className={styles.empty}>Cargando…</p>
        ) : shown.length === 0 ? (
          <p className={styles.empty}>
            {filter === 'todos'
              ? bounded
                ? 'No hay gastos con fecha en este periodo.'
                : 'Todavía no hay gastos registrados.'
              : `No hay gastos de ${categoryLabel(filter).toLowerCase()}.`}
          </p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categoría</th>
                  <th>Concepto</th>
                  <th>Pagado a</th>
                  <th>Tipo</th>
                  <th className={styles.num}>Total</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className={styles.nowrap}>{e.expenseDate ? formatPlainDate(e.expenseDate) : '—'}</td>
                    <td className={styles.nowrap}>{categoryLabel(e.category)}</td>
                    <td>
                      <b>{e.concept}</b>
                      {e.notes && <small className={styles.notes}>{e.notes}</small>}
                    </td>
                    <td>{e.paidTo ?? '—'}</td>
                    <td>
                      <Badge tone={e.kind === 'inversion' ? 'gold' : 'neutral'}>
                        {e.kind === 'inversion' ? 'Inversión' : 'Gasto'}
                      </Badge>
                    </td>
                    <td className={cn(styles.num, styles.nowrap)} data-numeric>
                      {formatCents(e.amount)}
                    </td>
                    <td>
                      <div className={styles.badges}>
                        {e.amountPending ? (
                          <Badge tone="warning">Por confirmar</Badge>
                        ) : (
                          <Badge tone="success">Confirmado</Badge>
                        )}
                        {e.validUntil && <Validity value={e.validUntil} />}
                      </div>
                    </td>
                    <td>
                      <button type="button" className={styles.link} onClick={() => setEditing(e)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <b>{filter === 'todos' ? 'Total' : `Total ${categoryLabel(filter).toLowerCase()}`}</b>
                  </td>
                  <td className={cn(styles.num, styles.nowrap)} data-numeric>
                    <b>
                      {formatCents(
                        filter === 'todos'
                          ? (summary?.total ?? cents(0))
                          : (summary?.byCategory[filter]?.total ?? cents(0)),
                      )}
                    </b>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {items.length > 0 && (
        <div className={cn(chartGridClass, styles.charts)}>
          <DonutCard title="Gastos por categoría" hint="En qué se ha ido el dinero del local." data={byCategory} />
          <BarsCard
            title="Gasto por mes"
            hint={
              undated > 0
                ? `Solo registros con fecha (${undated} sin fecha no aparecen aquí, pero sí en el total).`
                : 'Cuánto se pagó cada mes.'
            }
            data={byMonth}
            catLabel="Mes"
            valLabel="Pesos ($)"
          />
          <BarsCard
            title="Conceptos más grandes"
            hint="Los 10 registros de mayor monto. Naranja = inversión."
            horizontal
            data={topConcepts}
            catLabel="Concepto"
            valLabel="Pesos ($)"
          />
          <BarsCard
            title="Inversión vs gastos"
            data={
              summary
                ? [
                    { name: 'Inversión', value: summary.inversion / 100, color: COLOR_HIGHLIGHT },
                    { name: 'Gastos', value: summary.gasto / 100, color: COLOR_VENTAS },
                  ]
                : []
            }
            valLabel="Pesos ($)"
          />
        </div>
      )}

      {(creating || editing) && <ExpenseFormModal expense={editing} onClose={close} onSaved={saved} />}
    </Page>
  )
}
