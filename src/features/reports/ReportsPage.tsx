import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Card, Input } from '@/components/ui'
import {
  BarsCard,
  chartGridClass,
  COLOR_EGRESOS,
  COLOR_GANANCIA,
  COLOR_HIGHLIGHT,
  COLOR_VENTAS,
  DonutCard,
  MultiBarsCard,
  TrendCard,
} from '@/components/charts'
import type { SalesReport } from '@/data/repositories/reports'
import { DataError, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, reports } from '@/data'
import { cn } from '@/lib/cn'
import { cents, formatCents, subtractCents } from '@/lib/money'
import { daysAgo, endOfDay, fromDateInput, startOfDay } from '@/lib/dates'
import styles from './ReportsPage.module.css'

const RANGES = [
  { key: 'hoy', label: 'Hoy', from: () => startOfDay() },
  { key: '7d', label: '7 días', from: () => daysAgo(7) },
  { key: '15d', label: '15 días', from: () => daysAgo(15) },
  { key: '30d', label: '30 días', from: () => daysAgo(30) },
  { key: '90d', label: '90 días', from: () => daysAgo(90) },
] as const

export function ReportsPage() {
  const [range, setRange] = useState<string>('7d')
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')

  // Con fechas propias, "Hasta" vacío significa hasta hoy. Sin "Desde" no hay
  // período que medir: el reporte espera a que se elija.
  const custom = range === 'custom'
  const active = RANGES.find((item) => item.key === range) ?? RANGES[0]
  const from = custom ? fromDateInput(fromText, 'start') : active.from()
  const to = custom ? (fromDateInput(toText, 'end') ?? endOfDay()) : endOfDay()

  const query = useQuery({
    // Fechas como texto ISO en la llave: un Date nuevo por render repetiría la consulta.
    queryKey: ['report', range, from?.toISOString() ?? null, to.toISOString()],
    queryFn: () => reports.getSalesReport(from as Date, to),
    enabled: from !== null,
  })

  const report = query.data

  return (
    <Page
      title="Ventas y rentabilidad"
      subtitle="Fechas y horas de Ciudad de México. El ingreso se mide sobre lo cobrado, no sobre lo facturado."
    >
      <div className={styles.ranges}>
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(styles.range, range === item.key && styles.rangeActive)}
            onClick={() => setRange(item.key)}
          >
            {item.label}
          </button>
        ))}

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

      {from === null ? (
        <p className={styles.loading}>Elige la fecha «Desde» para ver el reporte.</p>
      ) : query.isError ? (
        <p className={styles.loading}>
          {query.error instanceof DataError ? query.error.message : 'No se pudo cargar el reporte.'}
        </p>
      ) : !report ? (
        <p className={styles.loading}>Cargando…</p>
      ) : (
        <ReportBody report={report} />
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Cuerpo del reporte (gráficas al estilo del POS de Tori Hana)
// ---------------------------------------------------------------------------

const toPesos = (v: number) => Math.round(v) / 100

/** Franjas del día para leer la hora pico de un vistazo. */
const FRANJAS = [
  { label: 'Mañana', desde: 0, hasta: 11, color: '#3b82a0' },
  { label: 'Mediodía', desde: 12, hasta: 15, color: '#d98a3d' },
  { label: 'Tarde', desde: 16, hasta: 23, color: '#c9a15a' },
] as const
const franjaDe = (h: number) => FRANJAS.find((f) => h >= f.desde && h <= f.hasta) ?? FRANJAS[2]

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0] // getUTCDay: 0 = domingo
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

function ReportBody({ report }: { report: SalesReport }) {
  const profit = subtractCents(report.revenue, report.expenses)
  const avgTicket = report.paymentCount > 0 ? cents(report.revenue / report.paymentCount) : report.revenue

  const daily = useMemo(
    () => report.byDay.map((r) => ({ name: dayLabel(r.day), Ventas: toPesos(r.revenue) })),
    [report.byDay],
  )

  const cumulative = useMemo(() => {
    let run = 0
    return report.byDay.map((r) => {
      run += r.revenue
      return { name: dayLabel(r.day), value: toPesos(run) }
    })
  }, [report.byDay])

  const hourRows = useMemo(() => {
    if (!report.byHour.length) return []
    const map = new Map(report.byHour.map((r) => [r.hour, r.total]))
    const hours = report.byHour.map((r) => r.hour)
    const out = []
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
      const f = franjaDe(h)
      out.push({ name: `${String(h).padStart(2, '0')}:00`, value: toPesos(map.get(h) ?? 0), color: f.color, franja: f.label })
    }
    return out
  }, [report.byHour])
  const peakHour = hourRows.reduce<(typeof hourRows)[number] | undefined>(
    (m, r) => (r.value > 0 && (!m || r.value > m.value) ? r : m),
    undefined,
  )

  const weekdayRows = useMemo(() => {
    const acc = new Map<number, { total: number; dias: number }>()
    for (const r of report.byDay) {
      if (r.revenue <= 0) continue
      const wd = new Date(`${r.day}T12:00:00Z`).getUTCDay()
      const a = acc.get(wd) ?? { total: 0, dias: 0 }
      a.total += r.revenue
      a.dias += 1
      acc.set(wd, a)
    }
    return ORDEN_DIAS.map((wd, i) => {
      const a = acc.get(wd)
      return { name: DIAS[i] ?? '', value: a ? toPesos(a.total / a.dias) : 0 }
    })
  }, [report.byDay])
  const peakWeekday = weekdayRows.reduce<(typeof weekdayRows)[number] | undefined>(
    (m, r) => (r.value > 0 && (!m || r.value > m.value) ? r : m),
    undefined,
  )

  const balance = report.byDay.map((r) => ({
    name: dayLabel(r.day),
    Ingresos: toPesos(r.revenue),
    Egresos: toPesos(r.expenses),
    Ganancia: toPesos(r.revenue - r.expenses),
  }))

  return (
    <>
      <div className={styles.stats}>
        <Card accent>
          <div className={styles.statLabel}>Cobrado</div>
          <div className={styles.statValue} data-numeric>
            {formatCents(report.revenue)}
          </div>
          <div className={styles.statHint}>
            {report.paymentCount} {report.paymentCount === 1 ? 'pago' : 'pagos'}
          </div>
        </Card>
        <Card>
          <div className={styles.statLabel}>Órdenes recibidas</div>
          <div className={styles.statValue} data-numeric>
            {report.ordersReceived}
          </div>
          <div className={styles.statHint}>En el periodo</div>
        </Card>
        <Card>
          <div className={styles.statLabel}>Ticket promedio</div>
          <div className={styles.statValue} data-numeric>
            {formatCents(avgTicket)}
          </div>
          <div className={styles.statHint}>Por pago</div>
        </Card>
        <Card>
          <div className={styles.statLabel}>Gastos</div>
          <div className={styles.statValue} data-numeric>
            {formatCents(report.expenses)}
          </div>
          <div className={styles.statHint}>Gastos con fecha en el periodo + caja chica</div>
        </Card>
        <Card>
          <div className={styles.statLabel}>Ganancia</div>
          <div className={styles.statValue} data-numeric>
            {formatCents(profit)}
          </div>
          <div className={styles.statHint}>Cobrado − gastos</div>
        </Card>
      </div>

      <div className={styles.section}>
        <MultiBarsCard
          title="Ventas por día"
          hint="Cuánto se cobró cada día del periodo."
          data={daily}
          series={[{ key: 'Ventas', label: 'Cobrado', color: COLOR_VENTAS }]}
          catLabel="Día"
          valLabel="Ventas ($)"
        />
      </div>

      <div className={chartGridClass}>
        <TrendCard
          title="Ventas acumuladas"
          hint="Suma de cobros día tras día: la pendiente muestra el ritmo del periodo."
          data={cumulative}
          series={[{ key: 'value', label: 'Ventas acumuladas', color: COLOR_VENTAS }]}
          catLabel="Día"
          valLabel="Acumulado ($)"
        />
        <BarsCard
          title="Ventas por hora del día"
          hint={
            peakHour
              ? `Hora pico: ${peakHour.name} (${formatCents(cents(peakHour.value * 100))}). Cada color es una franja del día.`
              : 'Cuánto se cobra en cada hora (hora CDMX).'
          }
          data={hourRows}
          legend={FRANJAS.filter((f) => hourRows.some((r) => r.franja === f.label)).map((f) => ({
            label: f.label,
            color: f.color,
          }))}
          catLabel="Hora del día"
          valLabel="Ventas ($)"
        />
        <BarsCard
          title="Venta promedio por día de la semana"
          hint={
            peakWeekday
              ? `Mejor día: ${peakWeekday.name} (promedio ${formatCents(cents(peakWeekday.value * 100))}). Solo cuenta días con venta.`
              : 'Promedio de cobro por día de la semana.'
          }
          data={weekdayRows.map((r) => ({
            ...r,
            color: r.name === peakWeekday?.name ? COLOR_HIGHLIGHT : COLOR_VENTAS,
          }))}
          catLabel="Día de la semana"
          valLabel="Promedio ($)"
        />
        <DonutCard
          title="Ventas por medio de pago"
          hint="Qué parte del dinero entra por cada forma de pago."
          data={report.byMethod.map((r) => ({ name: PAYMENT_METHOD_LABEL[r.method], value: toPesos(r.total) }))}
        />
        <BarsCard
          title="Top 10 servicios por importe"
          hint="Los servicios que más dinero dejaron (por fecha de recepción)."
          horizontal
          colorful
          data={report.byService.slice(0, 10).map((r) => ({ name: r.serviceName, value: toPesos(r.total) }))}
          catLabel="Servicio"
          valLabel="Importe ($)"
        />
        <DonutCard
          title="Gastos por categoría"
          hint="En qué se va el gasto del periodo."
          data={report.expensesByCategory.map((r) => ({ name: r.name, value: toPesos(r.total) }))}
        />
        <BarsCard
          title="Órdenes por estado"
          hint="Cómo están las órdenes recibidas en el periodo."
          colorful
          count
          format={(v) => `${Number(v)} órdenes`}
          data={report.ordersByStatus.map((r) => ({ name: ORDER_STATUS_LABEL[r.status], value: r.count }))}
          valLabel="Órdenes"
        />
        <BarsCard
          title="Cantidad vendida por servicio"
          hint="Piezas o servicios vendidos (top 10)."
          horizontal
          colorful
          count
          format={(v) => `${Number(v)} pzas`}
          data={[...report.byService]
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10)
            .map((r) => ({ name: r.serviceName, value: r.quantity }))}
          catLabel="Servicio"
          valLabel="Cantidad"
        />
      </div>

      <div className={styles.section}>
        <MultiBarsCard
          title="Balance diario: ingresos, egresos y ganancia"
          hint="Barras: dinero que entró (dorado) y salió (rojo). Línea azul: ganancia del día (ingresos − egresos)."
          data={balance}
          series={[
            { key: 'Ingresos', label: 'Ingresos', color: COLOR_VENTAS },
            { key: 'Egresos', label: 'Egresos', color: COLOR_EGRESOS },
          ]}
          line={{ key: 'Ganancia', label: 'Ganancia', color: COLOR_GANANCIA }}
          catLabel="Día"
          valLabel="Pesos ($)"
        />
      </div>

      <div className={styles.columns}>
        <Card title="Servicios más vendidos">
          {report.byService.length === 0 ? (
            <p className={styles.empty}>Sin órdenes en el periodo.</p>
          ) : (
            report.byService.map((row) => (
              <div key={row.serviceName} className={styles.row}>
                <span className={styles.rowName}>{row.serviceName}</span>
                <span className={styles.rowQty} data-numeric>
                  ×{row.quantity}
                </span>
                <span className={styles.rowTotal} data-numeric>
                  {formatCents(row.total)}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card title="Por método de pago">
          {report.byMethod.length === 0 ? (
            <p className={styles.empty}>Sin cobros en el periodo.</p>
          ) : (
            report.byMethod.map((row) => (
              <div key={row.method} className={styles.row}>
                <span className={styles.rowName}>{PAYMENT_METHOD_LABEL[row.method]}</span>
                <span className={styles.rowQty} data-numeric>
                  {row.count} {row.count === 1 ? 'pago' : 'pagos'}
                </span>
                <span className={styles.rowTotal} data-numeric>
                  {formatCents(row.total)}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card title="Gastos por categoría">
          {report.expensesByCategory.length === 0 ? (
            <p className={styles.empty}>Sin gastos en el periodo.</p>
          ) : (
            report.expensesByCategory.map((row) => (
              <div key={row.name} className={styles.row}>
                <span className={styles.rowName}>{row.name}</span>
                <span className={styles.rowTotal} data-numeric>
                  {formatCents(row.total)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card title="Balance diario (ingresos, egresos, ganancia)" flush className={styles.section}>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th className={styles.num}>Ingresos</th>
                <th className={styles.num}>Egresos</th>
                <th className={styles.num}>Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {[...report.byDay].reverse().map((r) => (
                <tr key={r.day}>
                  <td>{dayLabel(r.day)}/{r.day.slice(0, 4)}</td>
                  <td className={styles.num}>{formatCents(r.revenue)}</td>
                  <td className={styles.num}>{formatCents(r.expenses)}</td>
                  <td className={styles.num}>{formatCents(subtractCents(r.revenue, r.expenses))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
