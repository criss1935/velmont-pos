import { supabase } from '../client'
import { DataError, unwrap, unwrapMaybe } from '../errors'
import { readThrough } from '../offline/cache'
import { publicUrl } from './photos'
import { cents, subtractCents, type Cents } from '@/lib/money'
import type {
  Article,
  CartLine,
  DiagramMark,
  DiagramMarkType,
  Order,
  OrderItem,
  OrderStatus,
  OrderSummary,
  ReceptionPhoto,
} from '../types'

/**
 * Alta de la orden. Una sola llamada RPC: o entra la orden con todas sus
 * líneas, o no entra nada. Ver supabase/migrations/0004.
 */
export async function createOrder(input: {
  customerId: string | null
  lines: CartLine[]
  notes?: string
  promisedAt?: Date | null
  discount?: Cents
}): Promise<string> {
  if (input.lines.length === 0) {
    throw new DataError('Agrega al menos un servicio antes de crear la orden.')
  }

  const items = input.lines.map((line) => ({
    service_id: line.serviceId,
    service_name: line.serviceName,
    unit_price_cents: line.unitPrice,
    quantity: line.quantity,
    item_label: line.itemLabel,
    item_notes: line.itemNotes,
  }))

  const promisedAt = input.promisedAt?.toISOString()

  return unwrap(
    await supabase.rpc('create_order', {
      // Postgres no expresa la nulabilidad de los parámetros de una función, así
      // que el tipo generado dice `string` aunque la columna `customer_id` sí
      // acepta null (una venta de paso, sin cliente registrado).
      p_customer_id: input.customerId as string,
      p_items: items,
      p_discount: input.discount ?? 0,
      // Los parámetros con default se OMITEN cuando no hay valor. Pasarlos como
      // `undefined` explícito no vale: `exactOptionalPropertyTypes` distingue
      // entre "ausente" (usa el default de Postgres) y "presente y undefined".
      ...(input.notes ? { p_notes: input.notes } : {}),
      ...(promisedAt ? { p_promised_at: promisedAt } : {}),
    }),
  )
}

/**
 * Tablero de órdenes. Trae el saldo desde la vista `order_balances` en el mismo
 * viaje: al mostrador le sirve de poco ver una orden sin saber si ya está pagada.
 *
 * `order_balances` es una vista (calcula, no almacena) sin llave foránea real
 * hacia `orders` — PostgREST no puede anidarla en el select de `orders` (error
 * PGRST200, "no se encontró relación"). Se trae aparte, en un solo viaje extra
 * para todas las filas de la página (no una consulta por fila), y se combina
 * en memoria.
 */
export async function listOrders(filter?: {
  status?: OrderStatus[]
  search?: string
  limit?: number
}): Promise<OrderSummary[]> {
  const key = `orders:list:${JSON.stringify({
    status: filter?.status ?? null,
    search: filter?.search?.trim() ?? null,
    limit: filter?.limit ?? 100,
  })}`

  const { value } = await readThrough(key, async () => {
    let query = supabase
      .from('orders')
      .select(
        `id, folio, status, received_at, promised_at, total_cents,
         customers ( full_name, phone ),
         order_items ( id )`,
      )
      .order('received_at', { ascending: false })
      .limit(filter?.limit ?? 100)

    if (filter?.status && filter.status.length > 0) {
      query = query.in('status', filter.status)
    }

    const term = filter?.search?.trim()
    if (term) {
      // El operador teclea el folio que trae el cliente en el papel, o su nombre.
      const safe = term.replace(/[,()]/g, ' ')
      query = query.or(`folio.ilike.%${safe}%`)
    }

    const rows = unwrap(await query.retry(false))

    const ids = rows.map((row) => row.id)
    const balances =
      ids.length > 0
        ? unwrap(
            await supabase.from('order_balances').select('order_id, paid_cents').in('order_id', ids).retry(false),
          )
        : []
    const paidByOrder = new Map(balances.map((b) => [b.order_id, b.paid_cents]))

    return rows.map((row) => {
      const paid = cents(paidByOrder.get(row.id) ?? 0)
      const total = cents(row.total_cents)

      return {
        id: row.id,
        folio: row.folio,
        customerName: row.customers?.full_name ?? null,
        customerPhone: row.customers?.phone ?? null,
        status: row.status,
        receivedAt: row.received_at,
        promisedAt: row.promised_at,
        total,
        paid,
        balance: subtractCents(total, paid),
        itemCount: row.order_items?.length ?? 0,
      }
    })
  })

  return value
}

export async function getOrder(id: string): Promise<Order | null> {
  const { value } = await readThrough(`orders:detail:${id}`, () => fetchOrder(id))
  return value
}

async function fetchOrder(id: string): Promise<Order | null> {
  const row = unwrapMaybe(
    await supabase
      .from('orders')
      .select(
        `id, folio, customer_id, status, received_at, promised_at, delivered_at,
         subtotal_cents, discount_cents, total_cents, notes,
         signature_path, responsiva_accepted, responsiva_accepted_at,
         customers ( id, full_name, phone, email, notes, created_at ),
         order_items ( id, order_id, article_id, service_id, service_name, unit_price_cents,
                       quantity, item_label, item_notes, photo_urls, line_total_cents )`,
      )
      .eq('id', id)
      .retry(false)
      .maybeSingle(),
  )

  if (!row) return null

  // `order_balances` no tiene llave foránea real hacia `orders` (es una
  // vista) — mismo motivo que en `listOrders`, se consulta aparte.
  const balanceRow = unwrapMaybe(
    await supabase.from('order_balances').select('paid_cents').eq('order_id', id).retry(false).maybeSingle(),
  )
  const paid = cents(balanceRow?.paid_cents ?? 0)
  const total = cents(row.total_cents)

  const items: OrderItem[] = (row.order_items ?? []).map((item) => ({
    id: item.id,
    orderId: item.order_id,
    articleId: item.article_id,
    serviceId: item.service_id,
    serviceName: item.service_name,
    unitPrice: cents(item.unit_price_cents),
    quantity: item.quantity,
    itemLabel: item.item_label,
    itemNotes: item.item_notes,
    photoUrls: item.photo_urls,
    lineTotal: cents(item.line_total_cents ?? 0),
  }))

  // Los artículos, con sus fotos y su diagrama. Los servicios de cada artículo se
  // agrupan desde `items` por article_id — así no hay embeds ambiguos de
  // order_items (que se relaciona con orders y con order_articles a la vez).
  const articleRows = unwrap(
    await supabase
      .from('order_articles')
      .select(
        `id, order_id, item_type, brand, model, color, declared_value_cents,
         condition_tags, condition_notes, sort_order,
         order_photos ( id, storage_path, classification, sort_order ),
         order_diagram_marks ( id, idx, x_rel, y_rel, mark_type, description )`,
      )
      .eq('order_id', id)
      .order('sort_order')
      .retry(false),
  )

  const articles: Article[] = articleRows.map((article) => {
    const photos: ReceptionPhoto[] = [...(article.order_photos ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((photo) => ({
        id: photo.id,
        storagePath: photo.storage_path,
        url: publicUrl(photo.storage_path),
        classification: photo.classification,
      }))

    const diagramMarks: DiagramMark[] = [...(article.order_diagram_marks ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map((mark) => ({
        id: mark.id,
        idx: mark.idx,
        xRel: Number(mark.x_rel),
        yRel: Number(mark.y_rel),
        type: mark.mark_type as DiagramMarkType,
        description: mark.description,
      }))

    return {
      id: article.id,
      orderId: article.order_id,
      itemType: article.item_type,
      brand: article.brand,
      model: article.model,
      color: article.color,
      declaredValue: article.declared_value_cents === null ? null : cents(article.declared_value_cents),
      conditionTags: article.condition_tags ?? [],
      conditionNotes: article.condition_notes,
      sortOrder: article.sort_order,
      items: items.filter((item) => item.articleId === article.id),
      photos,
      diagramMarks,
    }
  })

  return {
    id: row.id,
    folio: row.folio,
    customerId: row.customer_id,
    customer: row.customers
      ? {
          id: row.customers.id,
          fullName: row.customers.full_name,
          phone: row.customers.phone,
          email: row.customers.email,
          notes: row.customers.notes,
          createdAt: row.customers.created_at,
        }
      : null,
    status: row.status,
    receivedAt: row.received_at,
    promisedAt: row.promised_at,
    deliveredAt: row.delivered_at,
    subtotal: cents(row.subtotal_cents),
    discount: cents(row.discount_cents),
    total,
    notes: row.notes,
    items,
    articles,
    signaturePath: row.signature_path,
    signatureUrl: row.signature_path ? publicUrl(row.signature_path) : null,
    responsivaAccepted: row.responsiva_accepted,
    responsivaAcceptedAt: row.responsiva_accepted_at,
    paid,
    balance: subtractCents(total, paid),
  }
}

/**
 * Cambia el estado de la orden.
 *
 * `entregado` arrastra `delivered_at`: la base tiene un check que exige que las
 * dos cosas vayan juntas, así que aquí se mandan juntas o la operación se cae.
 */
export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const patch: { status: OrderStatus; delivered_at?: string | null } = { status }

  if (status === 'entregado') {
    patch.delivered_at = new Date().toISOString()
  } else {
    // Volver atrás desde 'entregado' (una entrega mal marcada) tiene que limpiar
    // la fecha, o el check de consistencia rechaza el update.
    patch.delivered_at = null
  }

  unwrap(await supabase.from('orders').update(patch).eq('id', id).select('id').single())
}

/**
 * Cancela la orden. No la borra: el histórico es el activo del negocio, y una
 * cancelación es un hecho que hay que poder auditar.
 */
export async function cancelOrder(id: string, reason?: string): Promise<void> {
  unwrap(
    await supabase
      .from('orders')
      .update({ status: 'cancelado', delivered_at: null, notes: reason ?? null })
      .eq('id', id)
      .select('id')
      .single(),
  )
}

export async function setOrderDiscount(id: string, discount: Cents): Promise<void> {
  unwrap(
    await supabase
      .from('orders')
      .update({ discount_cents: discount })
      .eq('id', id)
      .select('id')
      .single(),
  )
}
