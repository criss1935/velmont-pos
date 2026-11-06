/**
 * Series del reporte de ventas: lógica pura (sin React, sin recharts) que usan
 * tanto la pantalla como el Excel, para que las dos muestren las mismas cifras.
 * Los importes salen en PESOS (número) porque son para graficar/exportar.
 */
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from '@/data'
import type { SalesReport } from '@/data/repositories/reports'

export const toPesos = (v: number) => Math.round(v) / 100

/** Franjas del día para leer la hora pico de un vistazo. */
export const FRANJAS = [
  { label: 'Mañana', desde: 0, hasta: 11, color: '#3b82a0' },
  { label: 'Mediodía', desde: 12, hasta: 15, color: '#d98a3d' },
  { label: 'Tarde', desde: 16, hasta: 23, color: '#c9a15a' },
] as const
export const franjaDe = (h: number) => FRANJAS.find((f) => h >= f.desde && h <= f.hasta) ?? FRANJAS[2]

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0] // getUTCDay: 0 = domingo

/** "2026-11-03" → "03/11". */
export const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export interface Row {
  name: string
  value: number
}

function peak<T extends Row>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((m, r) => (r.value > 0 && (!m || r.value > m.value) ? r : m), undefined)
}

export function buildReportSeries(report: SalesReport) {
  const daily = report.byDay.map((r) => ({ name: dayLabel(r.day), value: toPesos(r.revenue) }))

  let run = 0
  const cumulative = report.byDay.map((r) => {
    run += r.revenue
    return { name: dayLabel(r.day), value: toPesos(run) }
  })

  // Rellena con 0 las horas sin cobro entre la primera y la última: el eje del
  // tiempo queda continuo y no engaña.
  const hours: (Row & { color: string; franja: string })[] = []
  if (report.byHour.length) {
    const map = new Map(report.byHour.map((r) => [r.hour, r.total]))
    const hs = report.byHour.map((r) => r.hour)
    for (let h = Math.min(...hs); h <= Math.max(...hs); h++) {
      const f = franjaDe(h)
      hours.push({ name: `${String(h).padStart(2, '0')}:00`, value: toPesos(map.get(h) ?? 0), color: f.color, franja: f.label })
    }
  }

  // Promedio por día de la semana: solo cuenta los días con venta.
  const acc = new Map<number, { total: number; dias: number }>()
  for (const r of report.byDay) {
    if (r.revenue <= 0) continue
    const wd = new Date(`${r.day}T12:00:00Z`).getUTCDay()
    const a = acc.get(wd) ?? { total: 0, dias: 0 }
    a.total += r.revenue
    a.dias += 1
    acc.set(wd, a)
  }
  const weekdays = ORDEN_DIAS.map((wd, i) => {
    const a = acc.get(wd)
    return { name: DIAS[i] ?? '', value: a ? toPesos(a.total / a.dias) : 0 }
  })

  const balance = report.byDay.map((r) => ({
    day: r.day,
    name: dayLabel(r.day),
    ingresos: toPesos(r.revenue),
    egresos: toPesos(r.expenses),
    ganancia: toPesos(r.revenue - r.expenses),
  }))

  return {
    daily,
    cumulative,
    hours,
    peakHour: peak(hours),
    weekdays,
    peakWeekday: peak(weekdays),
    methods: report.byMethod.map((r) => ({ name: PAYMENT_METHOD_LABEL[r.method], value: toPesos(r.total), count: r.count })),
    servicesByAmount: report.byService.slice(0, 10).map((r) => ({ name: r.serviceName, value: toPesos(r.total) })),
    servicesByQty: [...report.byService]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)
      .map((r) => ({ name: r.serviceName, value: r.quantity })),
    expensesByCategory: report.expensesByCategory.map((r) => ({ name: r.name, value: toPesos(r.total) })),
    ordersByStatus: report.ordersByStatus.map((r) => ({ name: ORDER_STATUS_LABEL[r.status], value: r.count })),
    balance,
  }
}

export type ReportSeries = ReturnType<typeof buildReportSeries>
