/**
 * Excel de «Ventas y rentabilidad»: hoja «Análisis» con resumen + tablas y sus
 * gráficos nativos (mismas series que la pantalla, ver reports/series.ts), y
 * hojas de detalle: Pagos, Servicios, Balance diario, Gastos por categoría.
 */
import ExcelJS from 'exceljs'
import { PAYMENT_METHOD_LABEL } from '@/data'
import type { SalesReport } from '@/data/repositories/reports'
import { periodLabel, type PeriodRange } from '@/lib/period'
import { buildReportSeries, toPesos } from '@/features/reports/series'
import { addNativeCharts, type ChartSpec } from './xlsxCharts'
import { ANALISIS, downloadXlsx, MONEY_FMT, periodSlug, styleHeader, writeBlock, writeKpis, writeTitle } from './book'

const mxDateTime = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export async function buildReportWorkbook(report: SalesReport, range: PeriodRange): Promise<Uint8Array> {
  const s = buildReportSeries(report)
  const book = new ExcelJS.Workbook()
  book.creator = 'Velmont POS'
  book.created = new Date()

  // --- Análisis ---------------------------------------------------------------
  const sheet = book.addWorksheet(ANALISIS, { views: [{ showGridLines: false }] })
  const specs: ChartSpec[] = []
  let row = writeTitle(sheet, 'Velmont — Ventas y rentabilidad', periodLabel(range))

  const revenue = toPesos(report.revenue)
  const expenses = toPesos(report.expenses)
  row = writeKpis(sheet, row, [
    { label: 'Cobrado', value: revenue, kind: 'money', hint: `${report.paymentCount} pagos` },
    { label: 'Órdenes recibidas', value: report.ordersReceived, kind: 'count' },
    {
      label: 'Ticket promedio',
      value: report.paymentCount ? Math.round((report.revenue / report.paymentCount)) / 100 : revenue,
      kind: 'money',
      hint: 'Por pago',
    },
    { label: 'Gastos', value: expenses, kind: 'money', hint: 'Gastos con fecha en el periodo + caja chica' },
    { label: 'Ganancia', value: toPesos(report.revenue - report.expenses), kind: 'money', hint: 'Cobrado − gastos' },
  ])

  row = writeBlock(
    sheet,
    row,
    {
      title: 'Ventas por día',
      headers: ['Día', 'Cobrado'],
      kinds: ['text', 'money'],
      rows: s.daily.map((r) => [r.name, r.value]),
      chart: { kind: 'col' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Ventas acumuladas',
      headers: ['Día', 'Acumulado'],
      kinds: ['text', 'money'],
      rows: s.cumulative.map((r) => [r.name, r.value]),
      chart: { kind: 'line' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: s.peakHour ? `Ventas por hora del día (pico ${s.peakHour.name})` : 'Ventas por hora del día',
      headers: ['Hora', 'Cobrado', 'Franja'],
      kinds: ['text', 'money', 'text'],
      rows: s.hours.map((r) => [r.name, r.value, r.franja]),
      chart: { kind: 'col', title: 'Ventas por hora del día' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: s.peakWeekday ? `Venta promedio por día de la semana (mejor: ${s.peakWeekday.name})` : 'Venta promedio por día de la semana',
      headers: ['Día', 'Promedio'],
      kinds: ['text', 'money'],
      rows: s.weekdays.map((r) => [r.name, r.value]),
      chart: { kind: 'col', title: 'Venta promedio por día de la semana' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Ventas por medio de pago',
      headers: ['Medio', 'Cobrado', 'Pagos'],
      kinds: ['text', 'money', 'count'],
      rows: s.methods.map((r) => [r.name, r.value, r.count]),
      chart: { kind: 'doughnut' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Top 10 servicios por importe',
      headers: ['Servicio', 'Importe'],
      kinds: ['text', 'money'],
      rows: s.servicesByAmount.map((r) => [r.name, r.value]),
      chart: { kind: 'bar' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Cantidad vendida por servicio',
      headers: ['Servicio', 'Cantidad'],
      kinds: ['text', 'count'],
      rows: s.servicesByQty.map((r) => [r.name, r.value]),
      chart: { kind: 'bar' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Gastos por categoría',
      headers: ['Categoría', 'Total'],
      kinds: ['text', 'money'],
      rows: s.expensesByCategory.map((r) => [r.name, r.value]),
      chart: { kind: 'doughnut' },
    },
    specs,
  )
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Órdenes por estado',
      headers: ['Estado', 'Órdenes'],
      kinds: ['text', 'count'],
      rows: s.ordersByStatus.map((r) => [r.name, r.value]),
      chart: { kind: 'col' },
    },
    specs,
  )
  writeBlock(
    sheet,
    row,
    {
      title: 'Balance diario: ingresos, egresos y ganancia',
      headers: ['Día', 'Ingresos', 'Egresos', 'Ganancia'],
      kinds: ['text', 'money', 'money', 'money'],
      rows: s.balance.map((r) => [r.name, r.ingresos, r.egresos, r.ganancia]),
      chart: { kind: 'col', series: [1, 2, 3], colors: ['C9A15A', 'A04D36', '3B82A0'] },
    },
    specs,
  )

  // --- Pagos -------------------------------------------------------------------
  const pagos = book.addWorksheet('Pagos')
  pagos.columns = [
    { header: 'Fecha y hora (CDMX)', key: 'at', width: 22 },
    { header: 'Folio', key: 'folio', width: 14 },
    { header: 'Medio', key: 'method', width: 16 },
    { header: 'Importe', key: 'amount', width: 16 },
  ]
  for (const p of report.payments) {
    pagos.addRow({ at: mxDateTime.format(new Date(p.at)), folio: p.folio, method: PAYMENT_METHOD_LABEL[p.method], amount: toPesos(p.amount) })
  }
  pagos.getColumn('amount').numFmt = MONEY_FMT
  styleHeader(pagos, 4)
  totalRow(pagos, report.payments.length, 'D', 'Total')

  // --- Servicios ---------------------------------------------------------------
  const servicios = book.addWorksheet('Servicios')
  servicios.columns = [
    { header: 'Servicio', key: 'name', width: 34 },
    { header: 'Cantidad', key: 'qty', width: 12 },
    { header: 'Importe', key: 'total', width: 16 },
  ]
  for (const r of report.byService) servicios.addRow({ name: r.serviceName, qty: r.quantity, total: toPesos(r.total) })
  servicios.getColumn('total').numFmt = MONEY_FMT
  styleHeader(servicios, 3)
  totalRow(servicios, report.byService.length, 'C', 'Total', 'B')

  // --- Balance diario ------------------------------------------------------------
  const balance = book.addWorksheet('Balance diario')
  balance.columns = [
    { header: 'Fecha', key: 'day', width: 14 },
    { header: 'Ingresos', key: 'ingresos', width: 16 },
    { header: 'Egresos', key: 'egresos', width: 16 },
    { header: 'Ganancia', key: 'ganancia', width: 16 },
  ]
  for (const r of s.balance) balance.addRow({ day: r.day, ingresos: r.ingresos, egresos: r.egresos, ganancia: r.ganancia })
  for (const k of ['ingresos', 'egresos', 'ganancia']) balance.getColumn(k).numFmt = MONEY_FMT
  styleHeader(balance, 4)
  totalRow(balance, s.balance.length, 'B', 'Total', 'C', 'D')

  const raw = await book.xlsx.writeBuffer()
  return addNativeCharts(raw, ANALISIS, specs)
}

/** Fila de totales con fórmulas SUM (se recalculan si editan el detalle). */
function totalRow(sheet: ExcelJS.Worksheet, count: number, ...cols: [string, string, ...string[]]) {
  if (!count) return
  const [first, label, ...rest] = cols
  const r = count + 2
  const sumCols = [first, ...rest]
  sheet.getCell(`A${r}`).value = label
  sheet.getCell(`A${r}`).font = { bold: true }
  for (const c of sumCols) {
    const cell = sheet.getCell(`${c}${r}`)
    cell.value = { formula: `SUM(${c}2:${c}${count + 1})` }
    cell.font = { bold: true }
    cell.numFmt = sheet.getColumn(c).numFmt ?? '#,##0'
  }
}

export async function downloadReportExcel(report: SalesReport, range: PeriodRange) {
  const bytes = await buildReportWorkbook(report, range)
  downloadXlsx(bytes, `velmont-reporte-${periodSlug(range)}.xlsx`)
}
