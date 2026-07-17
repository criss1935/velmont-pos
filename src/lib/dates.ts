const dateTimeFormat = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const dateFormat = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

const timeFormat = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

/**
 * Tiempo relativo corto: "hace 2 h", "ayer", "hace 3 d".
 *
 * En el tablero de órdenes importa más "cuánto lleva esperando" que la fecha
 * exacta: es lo que le dice al operador qué está a punto de retrasarse.
 */
export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)

  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  return `hace ${days} d`
}

/** Fecha de entrega prometida a partir de los días estimados del servicio. */
export function promisedDate(estimatedDays: number, from = new Date()): Date {
  const date = new Date(from)
  date.setDate(date.getDate() + estimatedDays)
  // Se promete a las 6 de la tarde: es la hora a la que cierra el mostrador, no
  // la hora exacta en que se recibió el par.
  date.setHours(18, 0, 0, 0)
  return date
}

/** Inicio del día local, para los filtros de reportes. */
export function startOfDay(date = new Date()): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

export function endOfDay(date = new Date()): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

export function daysAgo(days: number): Date {
  const result = new Date()
  result.setDate(result.getDate() - days)
  return startOfDay(result)
}

/** La orden ya pasó su fecha prometida y aún no se ha entregado. */
export function isOverdue(promisedAt: string | null): boolean {
  if (!promisedAt) return false
  return new Date(promisedAt).getTime() < Date.now()
}
