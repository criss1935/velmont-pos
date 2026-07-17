/**
 * Dinero — siempre centavos enteros (MXN).
 *
 * Nunca se guarda ni se suma un importe como float. `0.1 + 0.2 !== 0.3`, y en
 * una caja ese error deja de ser teórico: se convierte en un corte descuadrado.
 * El tipo `Cents` existe para que el compilador impida mezclar pesos y centavos.
 */

export type Cents = number & { readonly __brand: 'Cents' }

export function cents(value: number): Cents {
  return Math.round(value) as Cents
}

/** Pesos → centavos. Único punto de entrada desde lo que teclea el operador. */
export function pesosToCents(pesos: number): Cents {
  return Math.round(pesos * 100) as Cents
}

export function centsToPesos(value: Cents): number {
  return value / 100
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce<number>((total, value) => total + value, 0) as Cents
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return (a - b) as Cents
}

export function multiplyCents(value: Cents, quantity: number): Cents {
  return Math.round(value * quantity) as Cents
}

/**
 * Porcentaje sobre un importe (descuentos). Se redondea al centavo — el
 * redondeo pasa una sola vez, al final, no en cada paso intermedio.
 */
export function percentOfCents(value: Cents, percent: number): Cents {
  return Math.round((value * percent) / 100) as Cents
}

const formatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
})

/** Formato para pantalla: "$1,250.00". */
export function formatCents(value: Cents): string {
  return formatter.format(centsToPesos(value))
}

/**
 * Formato para el ticket térmico: sin símbolo, para poder alinear la columna
 * de importes a la derecha con ancho fijo de caracteres.
 */
export function formatCentsPlain(value: Cents): string {
  return centsToPesos(value).toFixed(2)
}

/**
 * Parsea lo que teclea el operador ("1,250.50", "$1250.5", "1250") a centavos.
 * Devuelve null si no es un importe válido — el llamador decide qué hacer.
 */
export function parseAmount(input: string): Cents | null {
  const cleaned = input.replace(/[^0-9.]/g, '')
  if (cleaned === '' || cleaned === '.') return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  return pesosToCents(value)
}

/** Denominaciones de MXN en circulación — para los botones de pago rápido. */
export const MXN_DENOMINATIONS: Cents[] = [
  pesosToCents(20),
  pesosToCents(50),
  pesosToCents(100),
  pesosToCents(200),
  pesosToCents(500),
  pesosToCents(1000),
]
