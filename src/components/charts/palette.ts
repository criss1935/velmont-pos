/** Paleta Velmont: dorado primero, luego tonos que contrastan sobre claro. */
export const CHART_COLORS = ['#c9a15a', '#1f1f1f', '#d98a3d', '#3b82a0', '#7a8b6b', '#8b6bb1', '#a04d36', '#9a9a9a']

/** Color i de la paleta (cíclico). */
export const colorAt = (i: number): string => CHART_COLORS[i % CHART_COLORS.length] ?? '#c9a15a'

export const COLOR_VENTAS = '#c9a15a'
export const COLOR_EGRESOS = '#a04d36'
export const COLOR_GANANCIA = '#3b82a0'
export const COLOR_HIGHLIGHT = '#d98a3d'

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })

/** Pesos (ya convertidos de centavos) → "$1,250.00". Solo para gráficas. */
export const money = (v: number) => moneyFmt.format(v)

/** Porcentaje entero de `n` sobre `total` (0 si no hay total). */
export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
