import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { isOfflineEnabled } from '../offline/flag'
import { isNetworkError } from '../offline/network'
import { enqueue } from '../offline/queue'
import * as photosRepo from './photos'
import type { Cents } from '@/lib/money'
import type { DiagramMark, PaymentMethod } from '../types'

/** Un servicio aplicado a un artículo, tal como se cotizó al recibir. */
export interface ReceptionServiceInput {
  serviceId: string
  serviceName: string
  unitPrice: Cents
  quantity: number
}

/** Fotos aún en memoria (File), se suben tras crear la orden. */
export interface ReceptionPhotoInput {
  file: File
  classification?: string | null
}

export interface ReceptionArticleInput {
  itemType: string
  brand?: string | null
  model?: string | null
  color?: string | null
  declaredValue?: Cents | null
  conditionTags: string[]
  conditionNotes?: string | null
  items: ReceptionServiceInput[]
  diagramMarks: DiagramMark[]
  photos: ReceptionPhotoInput[]
}

export interface ReceptionPaymentInput {
  method: PaymentMethod
  amount: Cents
  tendered?: Cents | null
  reference?: string | null
  cashSessionId?: string | null
}

export interface ReceptionInput {
  customerId: string | null
  articles: ReceptionArticleInput[]
  notes?: string | null
  promisedAt?: Date | null
  discount?: Cents
  /** Ruta de la firma ya subida a Storage (signatures/…). */
  signaturePath?: string | null
  responsiva: boolean
  payment?: ReceptionPaymentInput | null
}

/**
 * Forma "wire" de una recepción completa — con TODOS los ids ya asignados en
 * el cliente. Es el mismo payload tanto si se manda directo al RPC como si se
 * encola: encolar no es más que persistir esto y reintentarlo después.
 */
export interface ReceptionRpcPayload {
  order_id: string
  customer_id: string | null
  articles: Array<{
    id: string
    item_type: string
    brand: string | null
    model: string | null
    color: string | null
    declared_value_cents: number | null
    condition_tags: string[]
    condition_notes: string | null
    items: Array<{
      id: string
      service_id: string
      service_name: string
      unit_price_cents: number
      quantity: number
    }>
    diagram_marks: Array<{
      id: string
      idx: number
      x_rel: number
      y_rel: number
      mark_type: string
      description: string | null
    }>
  }>
  notes: string | null
  promised_at: string | null
  discount: number
  signature_path: string | null
  responsiva: boolean
  payment: {
    id: string
    method: PaymentMethod
    amount_cents: number
    tendered_cents: number | null
    reference: string | null
    cash_session_id: string | null
  } | null
}

/**
 * Aplica la recepción contra Supabase. Es la MISMA función que usa la ruta
 * feliz (abajo) y el motor de sync al drenar la cola. Idempotente frente a
 * reintento: ver la migración 0014 (`create_reception` con `p_order_id`).
 */
export async function applyCreateReception(payload: ReceptionRpcPayload): Promise<void> {
  unwrap(
    await supabase.rpc('create_reception', {
      p_order_id: payload.order_id,
      p_customer_id: payload.customer_id as string,
      p_articles: payload.articles,
      p_discount: payload.discount,
      p_responsiva: payload.responsiva,
      ...(payload.notes ? { p_notes: payload.notes } : {}),
      ...(payload.promised_at ? { p_promised_at: payload.promised_at } : {}),
      ...(payload.signature_path ? { p_signature_path: payload.signature_path } : {}),
      ...(payload.payment ? { p_payment: payload.payment } : {}),
    }),
  )
}

/**
 * Crea una recepción completa.
 *
 * Todos los ids (orden, artículo, servicio, marca de diagrama, pago) se
 * generan aquí, en el cliente, ANTES de llamar al RPC — un solo camino de
 * código sirve tanto si hay red como si no: si el RPC falla por red, se
 * encola exactamente el mismo payload que se hubiera mandado, y el motor de
 * sync lo reintenta con esos mismos ids (idempotente).
 *
 * Fase 2, aparte: las fotos. Storage no participa de la transacción de
 * Postgres, así que se suben (o se encolan, cada una por su cuenta) después,
 * ya con el article_id que se generó arriba — no hace falta esperar la
 * respuesta del RPC para saberlo.
 */
export async function createReception(input: ReceptionInput): Promise<string> {
  if (input.articles.length === 0) {
    throw new DataError('Agrega al menos un artículo antes de finalizar la recepción.')
  }

  const orderId = crypto.randomUUID()
  const articleIds = input.articles.map(() => crypto.randomUUID())
  const paymentId = input.payment ? crypto.randomUUID() : null

  const payload: ReceptionRpcPayload = {
    order_id: orderId,
    customer_id: input.customerId,
    articles: input.articles.map((article, i) => ({
      id: articleIds[i]!,
      item_type: article.itemType,
      brand: article.brand ?? null,
      model: article.model ?? null,
      color: article.color ?? null,
      declared_value_cents: article.declaredValue ?? null,
      condition_tags: article.conditionTags,
      condition_notes: article.conditionNotes ?? null,
      items: article.items.map((item) => ({
        id: crypto.randomUUID(),
        service_id: item.serviceId,
        service_name: item.serviceName,
        unit_price_cents: item.unitPrice,
        quantity: item.quantity,
      })),
      diagram_marks: article.diagramMarks.map((mark) => ({
        id: crypto.randomUUID(),
        idx: mark.idx,
        x_rel: mark.xRel,
        y_rel: mark.yRel,
        mark_type: mark.type,
        description: mark.description ?? null,
      })),
    })),
    notes: input.notes ?? null,
    promised_at: input.promisedAt ? input.promisedAt.toISOString() : null,
    discount: input.discount ?? 0,
    signature_path: input.signaturePath ?? null,
    responsiva: input.responsiva,
    payment:
      input.payment && paymentId
        ? {
            id: paymentId,
            method: input.payment.method,
            amount_cents: input.payment.amount,
            tendered_cents: input.payment.tendered ?? null,
            reference: input.payment.reference ?? null,
            cash_session_id: input.payment.cashSessionId ?? null,
          }
        : null,
  }

  let receptionMutationId: string | null = null

  try {
    await applyCreateReception(payload)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    const mutation = await enqueue({
      type: 'reception.create',
      entityId: orderId,
      payload: payload as unknown as Record<string, unknown>,
    })
    receptionMutationId = mutation.id
  }

  // Fase 2: fotos. article_ids[i] ya se conoce — no depende de lo que haya
  // devuelto (o no) el RPC.
  for (let i = 0; i < input.articles.length; i++) {
    const article = input.articles[i]!
    const articleId = articleIds[i]!

    for (let p = 0; p < article.photos.length; p++) {
      const photo = article.photos[p]!
      await photosRepo.uploadReceptionPhoto({
        orderId,
        articleId,
        file: photo.file,
        classification: photo.classification ?? null,
        sortOrder: p,
        dependsOn: receptionMutationId ? [receptionMutationId] : [],
      })
    }
  }

  return orderId
}
