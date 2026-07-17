import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { unwrap } from '../errors'

/**
 * Como `unwrap`, pero un conflicto de PK sobre el id que mandó el cliente
 * (23505, sobre la constraint `_pkey`) se trata como éxito idempotente: es un
 * reintento de la MISMA fila — ya se guardó en un intento anterior cuya
 * respuesta nunca llegó — no una fila nueva. Un conflicto de índice único de
 * negocio (ej. `customers_phone_key`) sigue siendo un error real: `unwrap` lo
 * deja pasar tal cual, sin confundirlo con idempotencia.
 */
export async function insertIdempotent<T>(
  attempt: () => PromiseLike<PostgrestSingleResponse<T>>,
  reselect: () => PromiseLike<PostgrestSingleResponse<T>>,
): Promise<NonNullable<T>> {
  const response = await attempt()

  if (response.error?.code === '23505' && response.error.message.includes('_pkey')) {
    return unwrap(await reselect())
  }

  return unwrap(response)
}
