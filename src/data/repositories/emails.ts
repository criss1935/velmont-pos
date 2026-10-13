import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import type { OrderEmail, OrderEmailKind } from '../types'

/**
 * Correos al cliente de una orden.
 *
 * El envío lo hace `api/send-order-email.ts` en el servidor: ahí vive la clave
 * del proveedor de correo y ahí se arma el contenido leyendo la orden de la
 * base. Desde aquí solo viaja el id de la orden, qué correo es, un mensaje
 * opcional y la sesión del empleado. Online-only: un correo no se encola.
 *
 * Dos tipos:
 *  - `reception`: notas, estado de cada artículo y fotos. Sale al cerrar la
 *    recepción (ya con todas las fotos).
 *  - `receipt`: el ticket de un cobro (artículos, total, pagos, saldo).
 *
 * La sesión va en `x-supabase-token` y no en `Authorization`, porque ese header
 * ya lo usa el Basic Auth que middleware.ts pone delante de la app.
 */
export interface SendOrderEmailInput {
  orderId: string
  kind?: OrderEmailKind
  /** Cobro del que sale el ticket (solo `receipt`). */
  paymentId?: string
  message?: string
  /**
   * Reenvío manual: ignora si ese correo ya salió antes. Sin esto, el servidor
   * no duplica un correo ya enviado (doble clic, reintento).
   */
  force?: boolean
}

export interface SendOrderEmailResult {
  to: string
  /** El servidor ya había mandado este correo y no lo repitió. */
  alreadySent: boolean
}

export async function sendOrderEmail(input: SendOrderEmailInput): Promise<SendOrderEmailResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new DataError('Tu sesión expiró. Vuelve a iniciar sesión.')

  let response: Response
  try {
    response = await fetch('/api/send-order-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-supabase-token': token },
      body: JSON.stringify({
        orderId: input.orderId,
        kind: input.kind ?? 'reception',
        paymentId: input.paymentId,
        message: input.message?.trim() || undefined,
        force: input.force === true ? true : undefined,
      }),
    })
  } catch {
    throw new DataError('Sin conexión: no se pudo enviar el correo. Inténtalo de nuevo con señal.')
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    to?: string
    error?: string
    alreadySent?: boolean
  } | null

  if (response.status === 404 && !payload) {
    throw new DataError('El envío de correo solo funciona en la versión publicada (Vercel), no en `npm run dev`.')
  }

  if (response.status === 409 && payload?.alreadySent) {
    return { to: payload.to ?? '', alreadySent: true }
  }

  if (!response.ok || !payload?.ok) {
    throw new DataError(payload?.error ?? 'No se pudo enviar el correo.')
  }

  return { to: payload.to ?? '', alreadySent: false }
}

/** Historial de correos de una orden, el más reciente primero. */
export async function listOrderEmails(orderId: string): Promise<OrderEmail[]> {
  const rows = unwrap(
    await supabase
      .from('order_emails')
      .select('id, order_id, kind, to_email, status, error, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .retry(false),
  )

  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    kind: row.kind === 'receipt' ? 'receipt' : 'reception',
    to: row.to_email,
    status: row.status === 'sent' ? 'sent' : 'failed',
    error: row.error,
    createdAt: row.created_at,
  }))
}
