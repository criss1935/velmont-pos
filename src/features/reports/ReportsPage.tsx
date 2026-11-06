import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Button, Card } from '@/components/ui'
import { PeriodPicker } from '@/components/PeriodPicker'
import { usePeriod } from '@/components/usePeriod'
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
import { DataError, PAYMENT_METHOD_LABEL, reports } from '@/data'
import { cents, formatCents, subtractCents } from '@/lib/money'
import { endOfDay, fromDateInput } from '@/lib/dates'
import { buildReportSeries, dayLabel, FRANJAS } from './series'
import styles from './ReportsPage.module.css'

export function ReportsPage() {
  const period = usePeriod('7d')
  const { from: fromDay, to: toDay } = period.range
  const from = fromDay ? fromDateInput(fromDay, 'start') : null
  const to = (toDay ? fromDateInput(toDay, 'end') : null) ?? endOfDay()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['report', fromDay, toDay],
    queryFn: () => reports.getSalesReport(from as Date, to),
    enabled: from !== null,
  })

  const report = query.data

  return (
    <Page
      title="Ventas y rentabilidad"
      subtitle="Fechas y horas de Ciudad de México. El ingreso se mide sobre lo cobrado, no sobre lo facturado."
      actions={
        <Button
          disabled={!report || exporting}
          loading={exporting}
          onClick={() => {
            if (!report) return
            setExporting(true)
            setExportError(null)
            // El generador (exceljs) se descarga solo al exportar.
            import('@/features/export/reportExcel')
              .then((m) => m.downloadReportExcel(report, period.range))
              .catch(() => setExportError('No se pudo generar el Excel. Intenta de nuevo.'))
              .finally(() => setExporting(false))
          }}
        >
          Exportar Excel
        </Button>
      }
    >
      <PeriodPicker period={period} />
      {exportError && <p className={styles.error}>{exportError}</p>}

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

function ReportBody({ report }: { report: SalesReport }) {
  const profit = subtractCents(report.revenue, report.expenses)
  const avgTicket = report.paymentCount > 0 ? cents(report.revenue / report.paymentCount) : report.revenue

  const series = useMemo(() => buildReportSeries(report), [report])
  const { peakHour, peakWeekday } = series
  const hourRows = series.hours
  const daily = series.daily.map((r) => ({ name: r.name, Ventas: r.value }))
  const balance = series.balance.map((r) => ({ name: r.name, Ingresos: r.ingresos, Egresos: r.egresos, Ganancia: r.ganancia }))

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
          data={series.cumulative}
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
          data={series.weekdays.map((r) => ({
            ...r,
            color: r.name === peakWeekday?.name ? COLOR_HIGHLIGHT : COLOR_VENTAS,
          }))}
          catLabel="Día de la semana"
          valLabel="Promedio ($)"
        />
        <DonutCard
          title="Ventas por medio de pago"
          hint="Qué parte del dinero entra por cada forma de pago."
          data={series.methods}
        />
        <BarsCard
          title="Top 10 servicios por importe"
          hint="Los servicios que más dinero dejaron (por fecha de recepción)."
          horizontal
          colorful
          data={series.servicesByAmount}
          catLabel="Servicio"
          valLabel="Importe ($)"
        />
        <DonutCard
          title="Gastos por categoría"
          hint="En qué se va el gasto del periodo."
          data={series.expensesByCategory}
        />
        <BarsCard
          title="Órdenes por estado"
          hint="Cómo están las órdenes recibidas en el periodo."
          colorful
          count
          format={(v) => `${Number(v)} órdenes`}
          data={series.ordersByStatus}
          valLabel="Órdenes"
        />
        <BarsCard
          title="Cantidad vendida por servicio"
          hint="Piezas o servicios vendidos (top 10)."
          horizontal
          colorful
          count
          format={(v) => `${Number(v)} pzas`}
          data={series.servicesByQty}
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
