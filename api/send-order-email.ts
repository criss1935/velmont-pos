/**
 * POST /api/send-order-email
 *
 * Manda al cliente un correo con el resumen de su recepción: las notas de la
 * orden, el estado en que se recibió cada artículo y las fotos de evidencia.
 *
 * Seguridad (esta función corre en el servidor, pero NO usa la service_role):
 *  - Exige la sesión de Supabase del empleado en `x-supabase-token`. No viaja en
 *    `Authorization` porque ese header ya lo ocupa el Basic Auth de middleware.ts.
 *  - Valida el token contra Supabase Auth y lee la orden CON ese token, así que
 *    RLS decide qué puede ver — igual que si lo pidiera la app.
 *  - El contenido del correo sale de la base, nunca del cuerpo de la petición:
 *    el cliente solo manda `orderId` y un mensaje opcional.
 *  - El destinatario es el correo guardado en el cliente de la orden. No se
 *    acepta un destinatario arbitrario.
 *
 * Variables de entorno (Vercel → Settings → Environment Variables):
 *  - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (las mismas del build)
 *  - RESEND_API_KEY   clave de Resend (https://resend.com)
 *  - EMAIL_FROM       remitente con dominio verificado, ej. "Velmont <ordenes@velmontsneakers.com>"
 *  - EMAIL_REPLY_TO   opcional, a dónde llegan las respuestas del cliente
 */

const BUCKET = 'order-media'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_MESSAGE = 1000

interface CustomerRow {
  full_name: string
  email: string | null
}

interface OrderRow {
  folio: string
  notes: string | null
  promised_at: string | null
  customers: CustomerRow | null
}

interface ArticleRow {
  id: string
  item_type: string
  brand: string | null
  model: string | null
  color: string | null
  condition_tags: string[] | null
  condition_notes: string | null
}

interface PhotoRow {
  article_id: string | null
  storage_path: string
  classification: string | null
}

interface BusinessRow {
  name: string
  phone: string
  address: string
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function readEnv() {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
  const resendKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.EMAIL_FROM ?? ''
  const replyTo = process.env.EMAIL_REPLY_TO ?? ''

  if (!supabaseUrl || !anonKey) throw new HttpError(500, 'Falta configurar Supabase en el servidor.')
  if (!resendKey || !from) {
    throw new HttpError(500, 'El envío de correo no está configurado todavía (RESEND_API_KEY / EMAIL_FROM).')
  }

  return { supabaseUrl, anonKey, resendKey, from, replyTo }
}

type Env = ReturnType<typeof readEnv>

async function verifySession(env: Env, token: string): Promise<void> {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.')
}

async function query<T>(env: Env, token: string, path: string): Promise<T[]> {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!response.ok) {
    console.error('send-order-email: consulta fallida', path, response.status)
    throw new HttpError(502, 'No se pudo leer la orden.')
  }
  return (await response.json()) as T[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Texto libre del empleado: se escapa y conserva los saltos de línea. */
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function articleTitle(article: ArticleRow): string {
  return [article.item_type, article.brand, article.model, article.color].filter(Boolean).join(' · ')
}

function formatPromised(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(new Date(iso))
}

interface EmailInput {
  business: BusinessRow
  order: OrderRow
  customerName: string
  articles: ArticleRow[]
  photos: PhotoRow[]
  message: string
  mediaBase: string
}

function renderPhotos(photos: PhotoRow[], mediaBase: string): string {
  if (photos.length === 0) return ''

  const cells = photos
    .map((photo) => {
      const url = `${mediaBase}/${photo.storage_path.split('/').map(encodeURIComponent).join('/')}`
      const label = photo.classification
        ? `<div style="font-size:12px;color:#6b6b6b;margin-top:4px">${escapeHtml(photo.classification)}</div>`
        : ''
      return `<td style="width:50%;padding:4px;vertical-align:top">
        <a href="${url}"><img src="${url}" alt="${escapeHtml(photo.classification ?? 'Foto del calzado')}" width="260" style="display:block;width:100%;max-width:260px;height:auto;border-radius:6px;border:1px solid #e4e4e4"></a>${label}
      </td>`
    })
    .reduce<string[]>((rows, cell, index) => {
      if (index % 2 === 0) rows.push(cell)
      else rows[rows.length - 1] += cell
      return rows
    }, [])
    .map((row) => `<tr>${row}</tr>`)
    .join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${cells}</table>`
}

function renderHtml(input: EmailInput): string {
  const { business, order, customerName, articles, photos, message, mediaBase } = input

  const generalPhotos = photos.filter((photo) => photo.article_id === null)

  const articleBlocks = articles
    .map((article) => {
      const own = photos.filter((photo) => photo.article_id === article.id)
      const tags = (article.condition_tags ?? []).length
        ? `<p style="margin:6px 0;font-size:14px"><strong>Condición:</strong> ${(article.condition_tags ?? []).map(escapeHtml).join(', ')}</p>`
        : ''
      const notes = article.condition_notes
        ? `<p style="margin:6px 0;font-size:14px"><strong>Notas:</strong> ${multiline(article.condition_notes)}</p>`
        : ''
      return `<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e4e4e4">
        <h3 style="margin:0 0 4px;font-size:16px">${escapeHtml(articleTitle(article))}</h3>
        ${tags}${notes}${renderPhotos(own, mediaBase)}
      </div>`
    })
    .join('')

  const generalBlock = generalPhotos.length
    ? `<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e4e4e4">
        <h3 style="margin:0 0 4px;font-size:16px">Fotos de la orden</h3>${renderPhotos(generalPhotos, mediaBase)}
      </div>`
    : ''

  const orderNotes = order.notes
    ? `<p style="margin:12px 0;font-size:14px"><strong>Notas de la orden:</strong><br>${multiline(order.notes)}</p>`
    : ''

  const extra = message ? `<p style="margin:12px 0;font-size:15px">${multiline(message)}</p>` : ''

  const promised = order.promised_at
    ? `<p style="margin:12px 0;font-size:14px"><strong>Fecha de entrega estimada:</strong> ${escapeHtml(formatPromised(order.promised_at))}</p>`
    : ''

  const footer = [business.phone, business.address].filter(Boolean).map(escapeHtml).join(' · ')

  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:24px">
      <tr><td>
        <h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(business.name)}</h2>
        <p style="margin:0 0 16px;font-size:13px;color:#6b6b6b">Orden ${escapeHtml(order.folio)}</p>
        <p style="margin:0 0 12px;font-size:15px">Hola ${escapeHtml(customerName)}, recibimos tu calzado. Estas son las fotos y notas de cómo llegó a nuestras manos.</p>
        ${extra}${promised}${orderNotes}${articleBlocks}${generalBlock}
        <p style="margin:24px 0 0;font-size:12px;color:#6b6b6b;border-top:1px solid #e4e4e4;padding-top:12px">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

function renderText(input: EmailInput): string {
  const { business, order, customerName, articles, message } = input
  const lines = [
    `${business.name} — Orden ${order.folio}`,
    '',
    `Hola ${customerName}, recibimos tu calzado.`,
  ]
  if (message) lines.push('', message)
  if (order.promised_at) lines.push('', `Entrega estimada: ${formatPromised(order.promised_at)}`)
  if (order.notes) lines.push('', `Notas de la orden: ${order.notes}`)
  for (const article of articles) {
    lines.push('', articleTitle(article))
    if ((article.condition_tags ?? []).length) lines.push(`Condición: ${(article.condition_tags ?? []).join(', ')}`)
    if (article.condition_notes) lines.push(`Notas: ${article.condition_notes}`)
  }
  lines.push('', 'Las fotos van en la versión HTML de este correo.', '', [business.phone, business.address].filter(Boolean).join(' · '))
  return lines.join('\n')
}

async function handle(request: Request): Promise<Response> {
  const env = readEnv()

  const token = request.headers.get('x-supabase-token')
  if (!token) throw new HttpError(401, 'Falta la sesión.')

  let body: { orderId?: unknown; message?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    throw new HttpError(400, 'Petición inválida.')
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId : ''
  if (!UUID.test(orderId)) throw new HttpError(400, 'Orden inválida.')

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : ''

  await verifySession(env, token)

  const [orders, articles, photos, businesses] = await Promise.all([
    query<OrderRow>(env, token, `orders?id=eq.${orderId}&select=folio,notes,promised_at,customers(full_name,email)`),
    query<ArticleRow>(
      env,
      token,
      `order_articles?order_id=eq.${orderId}&select=id,item_type,brand,model,color,condition_tags,condition_notes&order=sort_order`,
    ),
    query<PhotoRow>(
      env,
      token,
      `order_photos?order_id=eq.${orderId}&select=article_id,storage_path,classification&order=sort_order`,
    ),
    query<BusinessRow>(env, token, 'business_settings?id=eq.1&select=name,phone,address'),
  ])

  const order = orders[0]
  if (!order) throw new HttpError(404, 'Esa orden no existe.')

  const to = order.customers?.email?.trim() ?? ''
  if (!order.customers || !EMAIL.test(to)) {
    throw new HttpError(422, 'El cliente de esta orden no tiene un correo válido. Agrégalo en Clientes.')
  }

  const business: BusinessRow = businesses[0] ?? { name: 'Velmont', phone: '', address: '' }

  const input: EmailInput = {
    business,
    order,
    customerName: order.customers.full_name,
    articles,
    photos,
    message,
    mediaBase: `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}`,
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.from,
      to: [to],
      subject: `${business.name} · Recepción de tu calzado, orden ${order.folio}`,
      html: renderHtml(input),
      text: renderText(input),
      ...(env.replyTo ? { reply_to: env.replyTo } : {}),
    }),
  })

  if (!response.ok) {
    console.error('send-order-email: Resend rechazó el envío', response.status, await response.text())
    throw new HttpError(502, 'El proveedor de correo rechazó el envío. Revisa la configuración del remitente.')
  }

  return json(200, { ok: true, to })
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request)
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message })
    console.error('send-order-email: error inesperado', error)
    return json(500, { error: 'No se pudo enviar el correo.' })
  }
}
