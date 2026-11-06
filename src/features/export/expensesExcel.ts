/**
 * Excel de «Gastos»: hoja «Análisis» con resumen + tablas y sus gráficos nativos
 * (por categoría, por mes, conceptos más grandes, inversión vs gastos) y la hoja
 * «Gastos» con el detalle filtrable y total con fórmula.
 */
import ExcelJS from 'exceljs'
import type { BusinessExpense, BusinessExpenseSummary } from '@/data'
import { periodLabel, type PeriodRange } from '@/lib/period'
import { CATEGORIES, categoryLabel } from '@/features/expenses/categories'
import { addNativeCharts, type ChartSpec } from './xlsxCharts'
import { ANALISIS, downloadXlsx, MONEY_FMT, periodSlug, styleHeader, writeBlock, writeKpis, writeTitle } from './book'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const pesos = (c: number) => Math.round(c) / 100

export async function buildExpensesWorkbook(
  items: BusinessExpense[],
  summary: BusinessExpenseSummary,
  range: PeriodRange,
): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  book.creator = 'Velmont POS'
  book.created = new Date()

  // --- Análisis ---------------------------------------------------------------
  const sheet = book.addWorksheet(ANALISIS, { views: [{ showGridLines: false }] })
  const specs: ChartSpec[] = []
  let row = writeTitle(sheet, 'Velmont — Gastos e inversión del local', periodLabel(range))

  row = writeKpis(sheet, row, [
    { label: 'Total', value: pesos(summary.total), kind: 'money', hint: `${summary.items} registros` },
    { label: 'Inversión', value: pesos(summary.inversion), kind: 'money', hint: 'Equipo y activos' },
    { label: 'Gastos', value: pesos(summary.gasto), kind: 'money', hint: 'Obra, renta, servicios y demás' },
    {
      label: 'Montos por confirmar',
      value: summary.pendingCount,
      kind: 'count',
      hint: summary.pendingCount ? 'Provisionales, incluidos en el total' : 'Todo confirmado',
    },
  ])

  const byCategory = CATEGORIES.flatMap((c) => {
    const t = summary.byCategory[c.value]
    return t && t.items > 0 ? [[c.label, pesos(t.total), t.items] as (string | number)[]] : []
  })
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Gastos por categoría',
      headers: ['Categoría', 'Total', 'Registros'],
      kinds: ['text', 'money', 'count'],
      rows: byCategory,
      chart: { kind: 'doughnut' },
    },
    specs,
  )

  const months = new Map<string, number>()
  for (const e of items) {
    if (!e.expenseDate) continue
    const key = e.expenseDate.slice(0, 7)
    months.set(key, (months.get(key) ?? 0) + e.amount)
  }
  const byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => [`${MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`, pesos(total)])
  const undated = items.filter((e) => !e.expenseDate).length
  row = writeBlock(
    sheet,
    row,
    {
      title: undated ? `Gasto por mes (sin contar ${undated} registros sin fecha)` : 'Gasto por mes',
      headers: ['Mes', 'Total'],
      kinds: ['text', 'money'],
      rows: byMonth,
      chart: { kind: 'col', title: 'Gasto por mes' },
    },
    specs,
  )

  const top = [...items]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((e) => [e.concept, pesos(e.amount), e.kind === 'inversion' ? 'Inversión' : 'Gasto'])
  row = writeBlock(
    sheet,
    row,
    {
      title: 'Conceptos más grandes (top 10)',
      headers: ['Concepto', 'Monto', 'Tipo'],
      kinds: ['text', 'money', 'text'],
      rows: top,
      chart: { kind: 'bar', title: 'Conceptos más grandes' },
    },
    specs,
  )

  writeBlock(
    sheet,
    row,
    {
      title: 'Inversión vs gastos',
      headers: ['Tipo', 'Total'],
      kinds: ['text', 'money'],
      rows: [
        ['Inversión', pesos(summary.inversion)],
        ['Gastos', pesos(summary.gasto)],
      ],
      chart: { kind: 'col' },
    },
    specs,
  )

  // --- Detalle -------------------------------------------------------------------
  const detail = book.addWorksheet('Gastos')
  detail.columns = [
    { header: 'Fecha', key: 'date', width: 13 },
    { header: 'Categoría', key: 'category', width: 26 },
    { header: 'Concepto', key: 'concept', width: 34 },
    { header: 'Pagado a', key: 'paidTo', width: 18 },
    { header: 'Tipo', key: 'kind', width: 12 },
    { header: 'Monto', key: 'amount', width: 16 },
    { header: 'Estado', key: 'status', width: 15 },
    { header: 'Vigencia hasta', key: 'validUntil', width: 15 },
    { header: 'Notas', key: 'notes', width: 40 },
  ]
  for (const e of items) {
    detail.addRow({
      date: e.expenseDate ?? '',
      category: categoryLabel(e.category),
      concept: e.concept,
      paidTo: e.paidTo ?? '',
      kind: e.kind === 'inversion' ? 'Inversión' : 'Gasto',
      amount: pesos(e.amount),
      status: e.amountPending ? 'Por confirmar' : 'Confirmado',
      validUntil: e.validUntil ?? '',
      notes: e.notes ?? '',
    })
  }
  detail.getColumn('amount').numFmt = MONEY_FMT
  styleHeader(detail, 9)
  if (items.length) {
    const r = items.length + 2
    detail.getCell(`E${r}`).value = 'Total'
    detail.getCell(`E${r}`).font = { bold: true }
    const total = detail.getCell(`F${r}`)
    total.value = { formula: `SUBTOTAL(9,F2:F${items.length + 1})` }
    total.numFmt = MONEY_FMT
    total.font = { bold: true }
  }

  const raw = await book.xlsx.writeBuffer()
  return addNativeCharts(raw, ANALISIS, specs)
}

export async function downloadExpensesExcel(items: BusinessExpense[], summary: BusinessExpenseSummary, range: PeriodRange) {
  const bytes = await buildExpensesWorkbook(items, summary, range)
  downloadXlsx(bytes, `velmont-gastos-${periodSlug(range)}.xlsx`)
}
