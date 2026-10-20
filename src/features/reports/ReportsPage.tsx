import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { Card, Input } from '@/components/ui'
import { DataError, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, reports } from '@/data'
import { cn } from '@/lib/cn'
import { formatCents } from '@/lib/money'
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
  const [range, setRange] = useState<string>('hoy')
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
      title="Reportes"
      subtitle="El ingreso se mide sobre lo cobrado, no sobre lo facturado."
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
              <div className={styles.statHint}>En el período</div>
            </Card>

            <Card>
              <div className={styles.statLabel}>Ticket promedio</div>
              <div className={styles.statValue} data-numeric>
                {report.paymentCount > 0
                  ? formatCents(
                      Math.round(report.revenue / report.paymentCount) as typeof report.revenue,
                    )
                  : formatCents(report.revenue)}
              </div>
              <div className={styles.statHint}>Por pago</div>
            </Card>
          </div>

          <div className={styles.columns}>
            <Card title="Por método de pago">
              {report.byMethod.length === 0 ? (
                <p className={styles.empty}>Sin cobros en el período.</p>
              ) : (
                report.byMethod.map((row) => {
                  const share = report.revenue > 0 ? (row.total / report.revenue) * 100 : 0

                  return (
                    <div key={row.method} className={styles.bar}>
                      <div className={styles.barTop}>
                        <span>{PAYMENT_METHOD_LABEL[row.method]}</span>
                        <span data-numeric>{formatCents(row.total)}</span>
                      </div>
                      {/* La barra hace comparable de un vistazo lo que la cifra
                          sola no: cuánto pesa cada método sobre el total. */}
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: `${share}%` }} />
                      </div>
                      <div className={styles.barMeta}>
                        {row.count} {row.count === 1 ? 'pago' : 'pagos'} ·{' '}
                        {share.toFixed(0)}%
                      </div>
                    </div>
                  )
                })
              )}
            </Card>

            <Card title="Servicios más vendidos">
              {report.byService.length === 0 ? (
                <p className={styles.empty}>Sin órdenes en el período.</p>
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

            <Card title="Órdenes por estado">
              {report.ordersByStatus.length === 0 ? (
                <p className={styles.empty}>Sin órdenes en el período.</p>
              ) : (
                report.ordersByStatus.map((row) => (
                  <div key={row.status} className={styles.row}>
                    <span className={styles.rowName}>{ORDER_STATUS_LABEL[row.status]}</span>
                    <span className={styles.rowTotal} data-numeric>
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  )
}
