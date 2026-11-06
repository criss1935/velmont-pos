import { toDateInput } from './dates'

/**
 * Periodos de los filtros de Reportes y Gastos. Fechas locales `YYYY-MM-DD`
 * (la tablet vive en CDMX), ambos extremos incluidos. `from`/`to` en null =
 * sin límite (solo el preset «Todo»).
 */
export type PeriodPreset = 'todo' | 'hoy' | '7d' | '15d' | '30d' | 'mes' | '3m' | '6m' | 'anio' | 'custom'

export interface PeriodRange {
  from: string | null
  to: string | null
}

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '15d', label: '15 días' },
  { id: '30d', label: 'Último mes' },
  { id: 'mes', label: 'Este mes' },
  { id: '3m', label: '3 meses' },
  { id: '6m', label: '6 meses' },
  { id: 'anio', label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
]

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function shiftMonths(base: Date, months: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + months)
  return d
}

/** Rango de un preset. «7 días» = hoy y los 6 anteriores (7 días naturales). */
export function presetRange(preset: PeriodPreset, custom: PeriodRange, now = new Date()): PeriodRange {
  const today = toDateInput(now)
  switch (preset) {
    case 'todo':
      return { from: null, to: null }
    case 'hoy':
      return { from: today, to: today }
    case '7d':
      return { from: toDateInput(shiftDays(now, -6)), to: today }
    case '15d':
      return { from: toDateInput(shiftDays(now, -14)), to: today }
    case '30d':
      return { from: toDateInput(shiftDays(shiftMonths(now, -1), 1)), to: today }
    case 'mes':
      return { from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
    case '3m':
      return { from: toDateInput(shiftDays(shiftMonths(now, -3), 1)), to: today }
    case '6m':
      return { from: toDateInput(shiftDays(shiftMonths(now, -6), 1)), to: today }
    case 'anio':
      return { from: `${now.getFullYear()}-01-01`, to: today }
    case 'custom': {
      // «Hasta» vacío = hasta hoy. Fechas al revés se acomodan solas.
      const from = custom.from || null
      const to = custom.to || today
      if (from && from > to) return { from: to, to: from }
      return { from, to }
    }
  }
}

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** "Del 30/10/2026 al 05/11/2026" — para la pantalla y el Excel. */
export function periodLabel(range: PeriodRange): string {
  if (!range.from && !range.to) return 'Todo el histórico'
  if (range.from && range.from === range.to) return `Del día ${fmt(range.from)}`
  if (!range.from) return `Hasta el ${fmt(range.to ?? '')}`
  return `Del ${fmt(range.from)} al ${fmt(range.to ?? range.from)}`
}
