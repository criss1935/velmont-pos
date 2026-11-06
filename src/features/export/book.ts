/**
 * Utilidades comunes de los Excel de Velmont: estilos, bloques de la hoja
 * «Análisis» (tabla + su gráfico nativo al lado) y la descarga en el navegador.
 */
import type ExcelJS from 'exceljs'
import { ref, type ChartKind, type ChartSpec, COUNT_AXIS, MONEY_AXIS, PALETTE } from './xlsxCharts'

export const ANALISIS = 'Análisis'
export const MONEY_FMT = '"$"#,##0.00'
const GOLD = 'FFC9A15A'
const INK = 'FF1F1F1F'
const COLS = ['A', 'B', 'C', 'D'] as const

export type CellKind = 'text' | 'money' | 'count'

/** Encabezado de una hoja de detalle: negro con letra dorada, congelado y con filtro. */
export function styleHeader(sheet: ExcelJS.Worksheet, columns: number) {
  const row = sheet.getRow(1)
  row.font = { bold: true, color: { argb: GOLD } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }
  row.alignment = { vertical: 'middle' }
  row.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } }
}

/** Título, periodo y fecha de generación en las primeras filas de «Análisis». */
export function writeTitle(sheet: ExcelJS.Worksheet, title: string, period: string): number {
  sheet.getColumn(1).width = 30
  for (const c of [2, 3, 4]) sheet.getColumn(c).width = 16
  sheet.getCell('A1').value = title
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: INK } }
  sheet.getCell('A2').value = period
  sheet.getCell('A2').font = { color: { argb: 'FF6B6B6B' } }
  sheet.getCell('A3').value = `Generado el ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} (hora CDMX)`
  sheet.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF9A9A9A' } }
  return 5
}

/** Tarjetas de resumen como pares etiqueta / valor. Devuelve la siguiente fila libre. */
export function writeKpis(
  sheet: ExcelJS.Worksheet,
  row: number,
  kpis: { label: string; value: number; kind: CellKind; hint?: string }[],
): number {
  sheet.getCell(row, 1).value = 'Resumen'
  sheet.getCell(row, 1).font = { bold: true, size: 12 }
  let r = row + 1
  for (const k of kpis) {
    const label = sheet.getCell(r, 1)
    label.value = k.label
    label.font = { color: { argb: 'FF6B6B6B' } }
    const value = sheet.getCell(r, 2)
    value.value = k.value
    value.font = { bold: true }
    value.numFmt = k.kind === 'money' ? MONEY_FMT : '#,##0'
    if (k.hint) {
      sheet.getCell(r, 3).value = k.hint
      sheet.getCell(r, 3).font = { size: 9, color: { argb: 'FF9A9A9A' } }
    }
    r++
  }
  return r + 1
}

interface BlockChart {
  kind: ChartKind
  title?: string
  stacked?: boolean
  /** Índices (desde 1) de las columnas de valores que se grafican. Default: [1]. */
  series?: number[]
  colors?: string[]
}

/**
 * Bloque de «Análisis»: título, encabezados y filas en A:D, y su gráfico nativo
 * anclado a la derecha (columnas F:N) apuntando a esas mismas celdas.
 */
export function writeBlock(
  sheet: ExcelJS.Worksheet,
  row: number,
  block: {
    title: string
    headers: string[]
    kinds: CellKind[]
    rows: (string | number)[][]
    chart?: BlockChart
  },
  specs: ChartSpec[],
): number {
  const titleCell = sheet.getCell(row, 1)
  titleCell.value = block.title
  titleCell.font = { bold: true, size: 12 }

  const header = sheet.getRow(row + 1)
  block.headers.forEach((h, i) => {
    const cell = header.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: GOLD } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }
  })

  const first = row + 2
  block.rows.forEach((values, i) => {
    const r = sheet.getRow(first + i)
    values.forEach((v, j) => {
      const cell = r.getCell(j + 1)
      cell.value = v
      const kind = block.kinds[j]
      if (kind === 'money') cell.numFmt = MONEY_FMT
      if (kind === 'count') cell.numFmt = '#,##0'
    })
  })

  if (!block.rows.length) {
    sheet.getCell(first, 1).value = 'Sin datos en el periodo.'
    sheet.getCell(first, 1).font = { italic: true, color: { argb: 'FF9A9A9A' } }
  }

  const last = first + Math.max(block.rows.length, 1) - 1
  const height = Math.max(block.rows.length + 3, 18)

  if (block.chart && block.rows.length) {
    const seriesCols = block.chart.series ?? [1]
    const valueKind = block.kinds[seriesCols[0] ?? 1]
    specs.push({
      kind: block.chart.kind,
      title: block.chart.title ?? block.title,
      ...(block.chart.stacked ? { stacked: true } : {}),
      numFmt: valueKind === 'count' ? COUNT_AXIS : MONEY_AXIS,
      from: { col: 5, row: row - 1 },
      to: { col: 14, row: row - 1 + height },
      categories: { ref: ref(ANALISIS, 'A', first, last), values: block.rows.map((r) => String(r[0] ?? '')) },
      series: seriesCols.map((col, i) => {
        const color = block.chart?.colors?.[i]
        return {
          name: block.headers[col] ?? block.title,
          ref: ref(ANALISIS, COLS[col] ?? 'B', first, last),
          values: block.rows.map((r) => Number(r[col] ?? 0)),
          ...(color ? { color } : {}),
        }
      }),
    })
  }

  return row + height + 2
}

export { PALETTE }

/** Descarga los bytes como .xlsx desde el navegador (tablet, celular o compu). */
export function downloadXlsx(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

/** Fragmento de nombre de archivo para el periodo: "2026-10-30-al-2026-11-05" o "historico". */
export function periodSlug(range: { from: string | null; to: string | null }): string {
  if (!range.from && !range.to) return 'historico'
  return `${range.from ?? 'inicio'}-al-${range.to ?? 'hoy'}`
}
