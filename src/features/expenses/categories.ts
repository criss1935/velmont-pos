import type { BusinessExpenseCategory, BusinessExpenseKind } from '@/data'

/** Orden fijo en pantalla: primero la inversión, luego lo recurrente. */
export const CATEGORIES: { value: BusinessExpenseCategory; label: string }[] = [
  { value: 'equipo', label: 'Equipo y maquinaria' },
  { value: 'obra', label: 'Obra y acabados' },
  { value: 'instalaciones', label: 'Instalaciones' },
  { value: 'renta', label: 'Renta' },
  { value: 'servicios', label: 'Servicios (luz, agua, CFE)' },
  { value: 'legal', label: 'Legal, permisos y licencias' },
  { value: 'sistema', label: 'Sistema' },
  { value: 'otros', label: 'Otros' },
]

export const KINDS: { value: BusinessExpenseKind; label: string }[] = [
  { value: 'gasto', label: 'Gasto' },
  { value: 'inversion', label: 'Inversión' },
]

export function categoryLabel(value: BusinessExpenseCategory): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value
}

function parsePlainDate(value: string): Date {
  const [y = 1970, m = 1, d = 1] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const dateFormat = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })

/** "2026-06-01" → "01 jun 2026", sin corrimiento de zona horaria. */
export function formatPlainDate(value: string): string {
  return dateFormat.format(parsePlainDate(value))
}

/** Días que faltan para una fecha YYYY-MM-DD (negativo = ya pasó). */
export function daysUntil(value: string): number {
  const target = parsePlainDate(value).getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86_400_000)
}
