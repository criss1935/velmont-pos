import { supabase } from '../client'
import { DataError } from '../errors'

/**
 * Manda al cliente de la orden el correo de recepción (notas + fotos).
 *
 * El envío lo hace `api/send-order-email.ts` en el servidor: ahí vive la clave
 * del proveedor de correo y ahí se arma el contenido leyendo la orden de la
 * base. Desde aquí solo viaja el id de la orden, un mensaje opcional y la
 * sesión del empleado. Online-only: un correo no se encola.
 *
 * La sesión va en `x-supabase-token` y no en `Authorization`, porque ese header
 * ya lo usa el Basic Auth que middleware.ts pone delante de la app.
 */
export async function sendOrderEmail(input: { orderId: string; message?: string }): Promise<{ to: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new DataError('Tu sesión expiró. Vuelve a iniciar sesión.')

  let response: Response
  try {
    response = await fetch('/api/send-order-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-supabase-token': token },
      body: JSON.stringify({ orderId: input.orderId, message: input.message?.trim() || undefined }),
    })
  } catch {
    throw new DataError('Sin conexión: no se pudo enviar el correo. Inténtalo de nuevo con señal.')
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; to?: string; error?: string } | null

  if (response.status === 404 && !payload) {
    throw new DataError('El envío de correo solo funciona en la versión publicada (Vercel), no en `npm run dev`.')
  }

  if (!response.ok || !payload?.ok) {
    throw new DataError(payload?.error ?? 'No se pudo enviar el correo.')
  }

  return { to: payload.to ?? '' }
}
