import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js'

/**
 * Error de dominio. Los repositorios nunca dejan escapar un PostgrestError
 * crudo: la UI no debería tener que saber qué es un código 23505.
 */
export class DataError extends Error {
  constructor(
    message: string,
    readonly cause?: PostgrestError,
  ) {
    super(message)
    this.name = 'DataError'
  }
}

/**
 * Traduce los errores de Postgres que el operador puede provocar de verdad en
 * mostrador, a frases que le digan qué hacer. Todo lo demás cae al mensaje
 * genérico: no vale la pena adivinar.
 */
function humanize(error: PostgrestError): string {
  // Violación de unicidad.
  if (error.code === '23505') {
    if (error.message.includes('customers_phone_key')) {
      return 'Ya existe un cliente con ese teléfono.'
    }
    if (error.message.includes('cash_sessions_single_open')) {
      return 'Ya hay una caja abierta. Ciérrala antes de abrir otra.'
    }
    return 'Ese registro ya existe.'
  }

  // Violación de llave foránea.
  if (error.code === '23503') {
    return 'No se puede borrar: hay otros registros que dependen de esto.'
  }

  // Violación de check.
  if (error.code === '23514') {
    if (error.message.includes('discount_within_subtotal')) {
      return 'El descuento no puede ser mayor que el subtotal.'
    }
    if (error.message.includes('tendered_covers_amount')) {
      return 'Lo recibido no puede ser menor que el importe a cobrar.'
    }
    if (error.message.includes('cash_needs_session')) {
      return 'No se puede cobrar en efectivo sin una caja abierta.'
    }
    return 'Los datos no cumplen una regla del sistema.'
  }

  // RLS rechazó la operación.
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'No tienes permiso para hacer esto.'
  }

  // Las excepciones que lanzan nuestros triggers ya vienen redactadas en
  // español y dirigidas al operador: se pasan tal cual.
  if (error.code === 'P0001') {
    return error.message
  }

  return error.message || 'Error al comunicarse con la base de datos.'
}

/**
 * Desenvuelve una respuesta de Supabase o lanza un DataError legible.
 *
 * El parámetro se tipa como `PostgrestSingleResponse<T>` y no como
 * `{ data: T | null; error: E | null }`, aunque en tiempo de ejecución sean lo
 * mismo. Supabase declara la respuesta como una unión DISCRIMINADA
 * (`{ data: T; error: null } | { data: null; error: PostgrestError }`), y al
 * inferir `T` contra la forma laxa TypeScript lo colapsa a `never`: cada acceso
 * a una columna del resultado se vuelve un error.
 *
 * Sirve igual para listas: `PostgrestResponse<Row>` es, por definición,
 * `PostgrestSingleResponse<Row[]>`.
 */
export function unwrap<T>(response: PostgrestSingleResponse<T>): NonNullable<T> {
  if (response.error) {
    throw new DataError(humanize(response.error), response.error)
  }
  if (response.data === null || response.data === undefined) {
    throw new DataError('La consulta no devolvió datos.')
  }
  return response.data as NonNullable<T>
}

/**
 * Igual que `unwrap`, pero para `.maybeSingle()`: la ausencia de resultado es un
 * desenlace válido (el cliente no existe), no un error.
 */
export function unwrapMaybe<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) {
    throw new DataError(humanize(response.error), response.error)
  }
  return response.data
}
