/**
 * POST /api/send-order-email
 *
 * Manda al cliente un correo de su orden. Dos tipos (`kind`):
 *  - `reception` (default): el comprobante de recepción completo — datos de la
 *    orden, cada artículo con su estado, servicios e importes, totales, anticipo,
 *    términos — más las fotos de evidencia. Sale al cerrar la recepción.
 *  - `receipt`: el ticket de un cobro — artículos, total, pagos y saldo.
 *
 * Seguridad (esta función corre en el servidor, pero NO usa la service_role):
 *  - Exige la sesión de Supabase del empleado en `x-supabase-token`. No viaja en
 *    `Authorization` porque ese header ya lo ocupa el Basic Auth de middleware.ts.
 *  - Valida el token contra Supabase Auth y lee la orden CON ese token, así que
 *    RLS decide qué puede ver — igual que si lo pidiera la app.
 *  - El contenido del correo sale de la base, nunca del cuerpo de la petición:
 *    el cliente solo manda `orderId`, `kind`, `paymentId` y un mensaje opcional.
 *  - El destinatario es el correo guardado en el cliente de la orden. No se
 *    acepta un destinatario arbitrario.
 *
 * No duplica: si ese correo ya salió (bitácora `order_emails`) responde 409 con
 * `alreadySent`, salvo que la petición traiga `force` (reenvío manual). Además
 * manda una Idempotency-Key a Resend para cubrir el doble clic simultáneo.
 *
 * Variables de entorno (Vercel → Settings → Environment Variables):
 *  - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (las mismas del build)
 *  - RESEND_API_KEY   clave de Resend (https://resend.com)
 *  - EMAIL_FROM       remitente con dominio verificado, ej. "Velmont Sneakers <velmontclean@velmontsneakers.com>"
 *  - EMAIL_REPLY_TO   opcional, a dónde llegan las respuestas del cliente
 */

const BUCKET = 'order-media'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_MESSAGE = 1000

interface CustomerRow {
  full_name: string
  email: string | null
  phone: string | null
}

interface OrderItemRow {
  article_id: string | null
  service_name: string
  item_label: string | null
  item_notes: string | null
  quantity: number
  line_total_cents: number | null
}

interface OrderRow {
  folio: string
  notes: string | null
  received_at: string
  promised_at: string | null
  reception_closed_at: string | null
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  customers: CustomerRow | null
  order_items: OrderItemRow[] | null
}

interface PaymentRow {
  id: string
  method: string
  amount_cents: number
  created_at: string
}

interface SentRow {
  id: string
  to_email: string
}

type Kind = 'reception' | 'receipt'

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

interface MarkRow {
  article_id: string
  idx: number
  mark_type: string
  description: string | null
}

interface BusinessRow {
  name: string
  phone: string
  address: string
  reception_terms: string
}

class HttpError extends Error {
  readonly status: number
  readonly extra: Record<string, unknown>

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.extra = extra
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
  marks: MarkRow[]
  payments: PaymentRow[]
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

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

function money(cents: number): string {
  return MXN.format(cents / 100)
}

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(iso))
}

/** Marco común de los correos: nombre del negocio, folio, contenido y pie. */
function layout(business: BusinessRow, folio: string, inner: string): string {
  const footer = [business.phone, business.address].filter(Boolean).map(escapeHtml).join(' · ')

  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:24px">
      <tr><td>
        <h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(business.name)}</h2>
        <p style="margin:0 0 16px;font-size:13px;color:#6b6b6b">Orden ${escapeHtml(folio)}</p>
        ${inner}
        <p style="margin:24px 0 0;font-size:12px;color:#6b6b6b;border-top:1px solid #e4e4e4;padding-top:12px">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

/** Renglones de servicio de un artículo (o los sueltos de órdenes del flujo viejo). */
function renderServiceRows(items: OrderItemRow[]): string {
  return items
    .map((item) => {
      const label = item.item_label
        ? `<div style="font-size:12px;color:#6b6b6b">${escapeHtml(item.item_label)}</div>`
        : ''
      const notes = item.item_notes
        ? `<div style="font-size:12px;color:#6b6b6b">Notas previas: ${multiline(item.item_notes)}</div>`
        : ''
      return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #eee;font-size:14px">${item.quantity} × ${escapeHtml(item.service_name)}${label}${notes}</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid #eee;font-size:14px;white-space:nowrap;vertical-align:top">${money(item.line_total_cents ?? 0)}</td>
      </tr>`
    })
    .join('')
}

function infoRow(label: string, value: string): string {
  return `<tr><td style="padding:2px 0;font-size:14px;color:#6b6b6b;width:38%">${label}</td><td style="padding:2px 0;font-size:14px">${value}</td></tr>`
}

function totalsRow(label: string, value: string, bold = false): string {
  const weight = bold ? 'font-weight:bold' : ''
  return `<tr><td style="padding:4px 0;font-size:14px;${weight}">${label}</td><td align="right" style="padding:4px 0;font-size:14px;${weight}">${value}</td></tr>`
}

/**
 * Correo de recepción = lo mismo que el papel que se imprime (comprobante +
 * nota de remisión): datos de la orden, cada artículo con su estado, servicios
 * e importes, totales, anticipo, términos — más las fotos de evidencia.
 */
function renderReceptionHtml(input: EmailInput): string {
  const { business, order, customerName, articles, photos, marks, payments, message, mediaBase } = input

  const items = order.order_items ?? []
  const generalPhotos = photos.filter((photo) => photo.article_id === null)
  const knownIds = new Set(articles.map((article) => article.id))
  const looseItems = items.filter((item) => !item.article_id || !knownIds.has(item.article_id))

  const articleBlocks = articles
    .map((article, index) => {
      const own = photos.filter((photo) => photo.article_id === article.id)
      const ownItems = items.filter((item) => item.article_id === article.id)
      const ownMarks = marks.filter((mark) => mark.article_id === article.id)

      const tags = (article.condition_tags ?? []).length
        ? `<p style="margin:6px 0;font-size:14px"><strong>Condición:</strong> ${(article.condition_tags ?? []).map(escapeHtml).join(', ')}</p>`
        : ''
      const notes = article.condition_notes
        ? `<p style="margin:6px 0;font-size:14px"><strong>Notas:</strong> ${multiline(article.condition_notes)}</p>`
        : ''
      const markList = ownMarks.length
        ? `<p style="margin:6px 0;font-size:14px"><strong>Observaciones:</strong></p><ul style="margin:0 0 6px;padding-left:20px;font-size:14px">${ownMarks
            .map((mark) => `<li>${escapeHtml(mark.mark_type)}${mark.description ? `: ${escapeHtml(mark.description)}` : ''}</li>`)
            .join('')}</ul>`
        : ''
      const services = ownItems.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${renderServiceRows(ownItems)}</table>`
        : ''

      const heading = articles.length > 1 ? `Artículo ${index + 1} — ${escapeHtml(articleTitle(article))}` : escapeHtml(articleTitle(article))

      return `<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e4e4e4">
        <h3 style="margin:0 0 6px;font-size:16px">${heading}</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${infoRow('Marca', escapeHtml(article.brand ?? '—'))}${infoRow('Modelo', escapeHtml(article.model ?? '—'))}${infoRow('Color', escapeHtml(article.color ?? '—'))}
        </table>
        ${tags}${notes}${markList}${services}${renderPhotos(own, mediaBase)}
      </div>`
    })
    .join('')

  const looseBlock = looseItems.length
    ? `<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e4e4e4">
        <h3 style="margin:0 0 4px;font-size:16px">Servicios</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderServiceRows(looseItems)}</table>
      </div>`
    : ''

  const generalBlock = generalPhotos.length
    ? `<div style="margin:20px 0;padding-top:16px;border-top:1px solid #e4e4e4">
        <h3 style="margin:0 0 4px;font-size:16px">Fotos de la orden</h3>${renderPhotos(generalPhotos, mediaBase)}
      </div>`
    : ''

  const orderNotes = order.notes
    ? `<p style="margin:12px 0;font-size:14px"><strong>Notas de la orden:</strong><br>${multiline(order.notes)}</p>`
    : ''

  const extra = message ? `<p style="margin:12px 0;font-size:15px">${multiline(message)}</p>` : ''

  const paid = payments.reduce((total, payment) => total + payment.amount_cents, 0)
  const balance = Math.max(order.total_cents - paid, 0)

  const data = [
    infoRow('Folio', `<strong>${escapeHtml(order.folio)}</strong>`),
    infoRow('Recibido', escapeHtml(formatDateTime(order.received_at))),
    order.promised_at ? infoRow('Entrega estimada', escapeHtml(formatPromised(order.promised_at))) : '',
    infoRow('Cliente', escapeHtml(customerName)),
    order.customers?.phone ? infoRow('Teléfono', escapeHtml(order.customers.phone)) : '',
  ].join('')

  const totals = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #e4e4e4">
      ${totalsRow('Subtotal', money(order.subtotal_cents))}
      ${order.discount_cents > 0 ? totalsRow('Descuento', `− ${money(order.discount_cents)}`) : ''}
      ${totalsRow('Total', money(order.total_cents), true)}
      ${paid > 0 ? totalsRow('Anticipo / pagado', money(paid)) : ''}
      ${paid > 0 ? totalsRow('Por pagar', money(balance), true) : ''}
    </table>`

  const terms = business.reception_terms
    ? `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e4e4e4">
        <p style="margin:0 0 4px;font-size:13px;font-weight:bold">Términos y condiciones</p>
        <p style="margin:0;font-size:12px;color:#4a4a4a">${multiline(business.reception_terms)}</p>
      </div>`
    : ''

  return layout(
    business,
    order.folio,
    `<p style="margin:0 0 12px;font-size:15px">Hola ${escapeHtml(customerName)}, recibimos tu calzado. Este es tu comprobante de recepción, con las fotos y notas de cómo llegó a nuestras manos.</p>
        ${extra}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${data}</table>
        ${orderNotes}${articleBlocks}${looseBlock}${generalBlock}${totals}${terms}
        <p style="margin:16px 0 0;font-size:13px;color:#6b6b6b">Conserva este correo o tu comprobante impreso: es indispensable para recoger tu calzado. ¡Gracias por confiar en ${escapeHtml(business.name)}!</p>`,
  )
}

function renderReceptionText(input: EmailInput): string {
  const { business, order, customerName, articles, marks, payments, message } = input
  const items = order.order_items ?? []
  const lines = [
    `${business.name} — Comprobante de recepción`,
    '',
    `Hola ${customerName}, recibimos tu calzado.`,
  ]
  if (message) lines.push('', message)
  lines.push('', `Folio: ${order.folio}`, `Recibido: ${formatDateTime(order.received_at)}`)
  if (order.promised_at) lines.push(`Entrega estimada: ${formatPromised(order.promised_at)}`)
  lines.push(`Cliente: ${customerName}`)
  if (order.customers?.phone) lines.push(`Teléfono: ${order.customers.phone}`)
  if (order.notes) lines.push('', `Notas de la orden: ${order.notes}`)

  const knownIds = new Set(articles.map((article) => article.id))
  const money1 = (item: OrderItemRow) => `${item.quantity} × ${item.service_name}  ${money(item.line_total_cents ?? 0)}`

  for (const article of articles) {
    lines.push('', articleTitle(article))
    if ((article.condition_tags ?? []).length) lines.push(`Condición: ${(article.condition_tags ?? []).join(', ')}`)
    if (article.condition_notes) lines.push(`Notas: ${article.condition_notes}`)
    for (const mark of marks.filter((m) => m.article_id === article.id)) {
      lines.push(`Obs. ${mark.idx}: ${mark.mark_type}${mark.description ? ` — ${mark.description}` : ''}`)
    }
    for (const item of items.filter((i) => i.article_id === article.id)) lines.push(money1(item))
  }
  const loose = items.filter((item) => !item.article_id || !knownIds.has(item.article_id))
  if (loose.length) {
    lines.push('')
    for (const item of loose) lines.push(money1(item))
  }

  const paid = payments.reduce((total, payment) => total + payment.amount_cents, 0)
  lines.push('', `Subtotal: ${money(order.subtotal_cents)}`)
  if (order.discount_cents > 0) lines.push(`Descuento: -${money(order.discount_cents)}`)
  lines.push(`Total: ${money(order.total_cents)}`)
  if (paid > 0) lines.push(`Anticipo / pagado: ${money(paid)}`, `Por pagar: ${money(Math.max(order.total_cents - paid, 0))}`)
  if (business.reception_terms) lines.push('', 'Términos y condiciones:', business.reception_terms)
  lines.push('', 'Las fotos van en la versión HTML de este correo.', '', [business.phone, business.address].filter(Boolean).join(' · '))
  return lines.join('\n')
}

interface ReceiptInput {
  business: BusinessRow
  order: OrderRow
  customerName: string
  payments: PaymentRow[]
  highlightPaymentId: string
  message: string
}

function receiptTotals(input: ReceiptInput) {
  const paid = input.payments.reduce((total, payment) => total + payment.amount_cents, 0)
  return { paid, balance: input.order.total_cents - paid }
}

function renderReceiptHtml(input: ReceiptInput): string {
  const { business, order, customerName, payments, highlightPaymentId, message } = input
  const { paid, balance } = receiptTotals(input)
  const items = order.order_items ?? []

  const rows = items
    .map((item) => {
      const label = item.item_label
        ? `<div style="font-size:12px;color:#6b6b6b">${escapeHtml(item.item_label)}</div>`
        : ''
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px">${item.quantity} × ${escapeHtml(item.service_name)}${label}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;white-space:nowrap">${money(item.line_total_cents ?? 0)}</td>
      </tr>`
    })
    .join('')

  const totalRow = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;${bold ? 'font-weight:bold' : ''}">${label}</td><td align="right" style="padding:4px 0;font-size:14px;${bold ? 'font-weight:bold' : ''}">${value}</td></tr>`

  const paymentRows = payments
    .map((payment) => {
      const mine = payment.id === highlightPaymentId
      return `<tr><td style="padding:4px 0;font-size:13px;${mine ? 'font-weight:bold' : 'color:#4a4a4a'}">${escapeHtml(METHOD_LABEL[payment.method] ?? payment.method)} · ${escapeHtml(formatDateTime(payment.created_at))}</td>
        <td align="right" style="padding:4px 0;font-size:13px;${mine ? 'font-weight:bold' : 'color:#4a4a4a'}">${money(payment.amount_cents)}</td></tr>`
    })
    .join('')

  const intro =
    balance <= 0
      ? 'Gracias por tu pago. Tu orden quedó liquidada; aquí está tu ticket.'
      : 'Gracias por tu pago. Aquí está tu ticket; el saldo pendiente se cubre al recoger tu calzado.'

  const extra = message ? `<p style="margin:12px 0;font-size:15px">${multiline(message)}</p>` : ''

  return layout(
    business,
    order.folio,
    `<p style="margin:0 0 12px;font-size:15px">Hola ${escapeHtml(customerName)}. ${intro}</p>
        ${extra}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${rows}</table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
          ${totalRow('Subtotal', money(order.subtotal_cents))}
          ${order.discount_cents > 0 ? totalRow('Descuento', `− ${money(order.discount_cents)}`) : ''}
          ${totalRow('Total', money(order.total_cents), true)}
        </table>
        ${payments.length ? `<p style="margin:16px 0 4px;font-size:13px;color:#6b6b6b">Pagos</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${paymentRows}</table>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #e4e4e4">
          ${totalRow('Pagado', money(paid))}
          ${totalRow('Saldo', money(Math.max(balance, 0)), true)}
        </table>`,
  )
}

function renderReceiptText(input: ReceiptInput): string {
  const { business, order, customerName, payments, message } = input
  const { paid, balance } = receiptTotals(input)

  const lines = [`${business.name} — Ticket de la orden ${order.folio}`, '', `Hola ${customerName}.`]
  if (message) lines.push('', message)
  lines.push('')
  for (const item of order.order_items ?? []) {
    lines.push(`${item.quantity} × ${item.service_name}${item.item_label ? ` (${item.item_label})` : ''}  ${money(item.line_total_cents ?? 0)}`)
  }
  lines.push('', `Subtotal: ${money(order.subtotal_cents)}`)
  if (order.discount_cents > 0) lines.push(`Descuento: -${money(order.discount_cents)}`)
  lines.push(`Total: ${money(order.total_cents)}`)
  for (const payment of payments) {
    lines.push(`Pago ${METHOD_LABEL[payment.method] ?? payment.method} (${formatDateTime(payment.created_at)}): ${money(payment.amount_cents)}`)
  }
  lines.push(`Pagado: ${money(paid)}`, `Saldo: ${money(Math.max(balance, 0))}`, '', [business.phone, business.address].filter(Boolean).join(' · '))
  return lines.join('\n')
}

async function recordEmail(
  env: Env,
  token: string,
  row: {
    order_id: string
    kind: Kind
    payment_id: string | null
    to_email: string
    status: 'sent' | 'failed'
    provider_id: string | null
    error: string | null
  },
): Promise<void> {
  // Mejor esfuerzo: que la bitácora falle no debe tumbar un correo que ya salió.
  try {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/order_emails`, {
      method: 'POST',
      headers: {
        apikey: env.anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!response.ok) console.error('send-order-email: no se pudo registrar en la bitácora', response.status)
  } catch (error) {
    console.error('send-order-email: bitácora fallida', error)
  }
}

async function handle(request: Request): Promise<Response> {
  const env = readEnv()

  const token = request.headers.get('x-supabase-token')
  if (!token) throw new HttpError(401, 'Falta la sesión.')

  let body: { orderId?: unknown; kind?: unknown; paymentId?: unknown; message?: unknown; force?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    throw new HttpError(400, 'Petición inválida.')
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId : ''
  if (!UUID.test(orderId)) throw new HttpError(400, 'Orden inválida.')

  const kind: Kind = body.kind === 'receipt' ? 'receipt' : 'reception'
  const force = body.force === true

  const paymentId = typeof body.paymentId === 'string' && UUID.test(body.paymentId) ? body.paymentId : null
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : ''

  await verifySession(env, token)

  const sentFilter =
    `order_emails?order_id=eq.${orderId}&kind=eq.${kind}&status=eq.sent` +
    (kind === 'receipt' && paymentId ? `&payment_id=eq.${paymentId}` : '') +
    '&select=id,to_email&limit=1'

  const [orders, articles, photos, marks, businesses, payments, alreadySent] = await Promise.all([
    query<OrderRow>(
      env,
      token,
      `orders?id=eq.${orderId}&select=folio,notes,received_at,promised_at,reception_closed_at,subtotal_cents,discount_cents,total_cents,customers(full_name,email,phone),order_items(article_id,service_name,item_label,item_notes,quantity,line_total_cents)`,
    ),
    kind === 'reception'
      ? query<ArticleRow>(
          env,
          token,
          `order_articles?order_id=eq.${orderId}&select=id,item_type,brand,model,color,condition_tags,condition_notes&order=sort_order`,
        )
      : Promise.resolve<ArticleRow[]>([]),
    kind === 'reception'
      ? query<PhotoRow>(
          env,
          token,
          `order_photos?order_id=eq.${orderId}&select=article_id,storage_path,classification&order=sort_order`,
        )
      : Promise.resolve<PhotoRow[]>([]),
    kind === 'reception'
      ? query<MarkRow>(env, token, `order_diagram_marks?order_id=eq.${orderId}&select=article_id,idx,mark_type,description&order=idx`)
      : Promise.resolve<MarkRow[]>([]),
    query<BusinessRow>(env, token, 'business_settings?id=eq.1&select=name,phone,address,reception_terms'),
    query<PaymentRow>(env, token, `payments?order_id=eq.${orderId}&select=id,method,amount_cents,created_at&order=created_at`),
    force ? Promise.resolve<SentRow[]>([]) : query<SentRow>(env, token, sentFilter),
  ])

  const order = orders[0]
  if (!order) throw new HttpError(404, 'Esa orden no existe.')

  const to = order.customers?.email?.trim() ?? ''
  if (!order.customers || !EMAIL.test(to)) {
    throw new HttpError(422, 'El cliente de esta orden no tiene un correo válido. Agrégalo en Clientes.')
  }

  if (alreadySent[0]) {
    throw new HttpError(409, 'Ese correo ya se envió.', { alreadySent: true, to: alreadySent[0].to_email })
  }

  if (kind === 'reception' && !force) {
    // El envío automático solo sale con la recepción cerrada y con evidencia:
    // sin esto, saldría un correo vacío (o sin fotos) y no se podría "deshacer".
    if (!order.reception_closed_at) throw new HttpError(409, 'La recepción todavía no está cerrada.')
    if (photos.length === 0) throw new HttpError(422, 'La orden no tiene fotos que enviar.')
  }

  if (kind === 'receipt' && payments.length === 0) {
    throw new HttpError(422, 'La orden todavía no tiene cobros que enviar.')
  }

  const business: BusinessRow = businesses[0] ?? { name: 'Velmont', phone: '', address: '', reception_terms: '' }

  // Un cobro que todavía no sincroniza (cola offline) no existe en la base: se
  // manda el ticket sin resaltarlo y sin ligarlo, para no romper la bitácora.
  const knownPaymentId = payments.find((payment) => payment.id === paymentId)?.id ?? null

  let subject: string
  let html: string
  let text: string

  if (kind === 'reception') {
    const input: EmailInput = {
      business,
      order,
      customerName: order.customers.full_name,
      articles,
      photos,
      marks,
      payments,
      message,
      mediaBase: `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}`,
    }
    subject = `${business.name} · Recepción de tu calzado, orden ${order.folio}`
    html = renderReceptionHtml(input)
    text = renderReceptionText(input)
  } else {
    const input: ReceiptInput = {
      business,
      order,
      customerName: order.customers.full_name,
      payments,
      highlightPaymentId: knownPaymentId ?? payments[payments.length - 1]?.id ?? '',
      message,
    }
    subject = `${business.name} · Tu ticket, orden ${order.folio}`
    html = renderReceiptHtml(input)
    text = renderReceiptText(input)
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resendKey}`,
      'content-type': 'application/json',
      // Cubre el doble clic simultáneo: la bitácora de arriba no lo ve todavía. La
      // llave cambia cada minuto para que un reintento tras corregir la
      // configuración no reciba de vuelta el error cacheado del intento anterior.
      ...(force ? {} : { 'idempotency-key': `${kind}-${orderId}-${paymentId ?? 'orden'}-${Math.floor(Date.now() / 60_000)}` }),
    },
    body: JSON.stringify({
      from: env.from,
      to: [to],
      subject,
      html,
      text,
      ...(env.replyTo ? { reply_to: env.replyTo } : {}),
    }),
  })

  const providerBody = await response.text()

  if (response.status === 409 && !force) {
    // Resend ya tiene esa misma petición en curso o terminada.
    throw new HttpError(409, 'Ese correo ya se envió.', { alreadySent: true, to })
  }

  if (!response.ok) {
    console.error('send-order-email: Resend rechazó el envío', response.status, providerBody)
    await recordEmail(env, token, {
      order_id: orderId,
      kind,
      payment_id: kind === 'receipt' ? knownPaymentId : null,
      to_email: to,
      status: 'failed',
      provider_id: null,
      error: providerBody.slice(0, 500),
    })
    throw new HttpError(502, 'El proveedor de correo rechazó el envío. Revisa la configuración del remitente.')
  }

  let providerId: string | null = null
  try {
    providerId = (JSON.parse(providerBody) as { id?: string }).id ?? null
  } catch {
    providerId = null
  }

  await recordEmail(env, token, {
    order_id: orderId,
    kind,
    payment_id: kind === 'receipt' ? knownPaymentId : null,
    to_email: to,
    status: 'sent',
    provider_id: providerId,
    error: null,
  })

  return json(200, { ok: true, to, kind })
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request)
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message, ...error.extra })
    console.error('send-order-email: error inesperado', error)
    return json(500, { error: 'No se pudo enviar el correo.' })
  }
}
