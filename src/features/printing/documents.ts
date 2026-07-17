import { formatCents, formatCentsPlain, type Cents } from '@/lib/money'
import { formatDateTime, formatDate } from '@/lib/dates'
import { PAYMENT_METHOD_LABEL, type Order, type Payment } from '@/data'
import type { Block, TicketDocument } from './types'

const BUSINESS = {
  name: import.meta.env.VITE_BUSINESS_NAME || 'Velmont',
  phone: import.meta.env.VITE_BUSINESS_PHONE || '',
  address: import.meta.env.VITE_BUSINESS_ADDRESS || '',
}

function header(): Block[] {
  const blocks: Block[] = [
    { kind: 'title', text: BUSINESS.name.toUpperCase() },
    { kind: 'text', text: 'CUIDADO DE CALZADO', align: 'center', small: true },
  ]

  if (BUSINESS.address) {
    blocks.push({ kind: 'text', text: BUSINESS.address, align: 'center', small: true })
  }
  if (BUSINESS.phone) {
    blocks.push({ kind: 'text', text: `Tel. ${BUSINESS.phone}`, align: 'center', small: true })
  }

  blocks.push({ kind: 'divider' })
  return blocks
}

function itemLines(order: Order): Block[] {
  return order.items.flatMap((item): Block[] => {
    const line: Block = {
      kind: 'line',
      quantity: item.quantity,
      description: item.serviceName,
      amount: formatCentsPlain(item.lineTotal),
      ...(item.itemLabel ? { note: item.itemLabel } : {}),
    }

    // El estado con el que llegó el par se imprime SIEMPRE que exista. Es la
    // constancia de que el rayón ya venía: sin esto, en una discusión sobre un
    // daño, el negocio no tiene con qué defenderse.
    if (item.itemNotes) {
      return [line, { kind: 'text', text: `  Estado: ${item.itemNotes}`, small: true }]
    }

    return [line]
  })
}

/**
 * Recepción multi-artículo (ver migraciones 0007-0011): el estado, las
 * condiciones y el diagrama viven en `order_articles`/`order_diagram_marks`,
 * no en `item.itemNotes` (que es del flujo viejo, `create_order`). Sin esto,
 * el comprobante impreso de una recepción por el wizard nunca mostraba el
 * estado con el que llegó el calzado — la razón de ser de la nota.
 */
function articleLines(order: Order): Block[] {
  return order.articles.flatMap((article): Block[] => {
    const header = [article.itemType, article.brand, article.model, article.color]
      .filter(Boolean)
      .join(' ')

    const blocks: Block[] = [{ kind: 'text', text: header || 'Artículo', emphasis: true }]

    blocks.push(
      ...order.items
        .filter((item) => item.articleId === article.id)
        .map(
          (item): Block => ({
            kind: 'line',
            quantity: item.quantity,
            description: item.serviceName,
            amount: formatCentsPlain(item.lineTotal),
          }),
        ),
    )

    if (article.conditionTags.length > 0 || article.conditionNotes) {
      const conditionText = [article.conditionTags.join(', '), article.conditionNotes]
        .filter(Boolean)
        .join(' — ')
      blocks.push({ kind: 'text', text: `  Estado: ${conditionText}`, small: true })
    }

    for (const mark of article.diagramMarks) {
      const description = mark.description ? `${mark.type}: ${mark.description}` : mark.type
      blocks.push({ kind: 'text', text: `  Obs. ${mark.idx} — ${description}`, small: true })
    }

    return blocks
  })
}

/** Por artículo si la recepción es enriquecida; la lista plana para órdenes viejas. */
function orderLines(order: Order): Block[] {
  return order.articles.length > 0 ? articleLines(order) : itemLines(order)
}

/**
 * COMPROBANTE DE RECEPCIÓN — el papel que se lleva el cliente al dejar el calzado.
 *
 * No es un recibo de pago: es la prueba de qué se entregó, en qué estado, y
 * cuándo se promete de vuelta. Por eso lleva firma y el estado de cada par.
 */
export function receiptDocument(order: Order): TicketDocument {
  const blocks: Block[] = [
    ...header(),

    { kind: 'text', text: 'COMPROBANTE DE RECEPCIÓN', align: 'center', emphasis: true },
    { kind: 'space' },

    { kind: 'row', label: 'Folio', value: order.folio, emphasis: true },
    { kind: 'row', label: 'Recibido', value: formatDateTime(order.receivedAt) },
  ]

  if (order.promisedAt) {
    blocks.push({ kind: 'row', label: 'Entrega', value: formatDate(order.promisedAt) })
  }

  if (order.customer) {
    blocks.push({ kind: 'row', label: 'Cliente', value: order.customer.fullName })
    if (order.customer.phone) {
      blocks.push({ kind: 'row', label: 'Teléfono', value: order.customer.phone })
    }
  }

  blocks.push({ kind: 'divider' }, ...orderLines(order), { kind: 'divider' })

  blocks.push({ kind: 'row', label: 'Subtotal', value: formatCentsPlain(order.subtotal) })

  if (order.discount > 0) {
    blocks.push({ kind: 'row', label: 'Descuento', value: `-${formatCentsPlain(order.discount)}` })
  }

  blocks.push({ kind: 'row', label: 'TOTAL', value: formatCentsPlain(order.total), emphasis: true })

  if (order.paid > 0) {
    blocks.push(
      { kind: 'row', label: 'Anticipo', value: formatCentsPlain(order.paid) },
      { kind: 'row', label: 'Por pagar', value: formatCentsPlain(order.balance), emphasis: true },
    )
  }

  if (order.notes) {
    blocks.push({ kind: 'divider' }, { kind: 'text', text: order.notes, small: true })
  }

  blocks.push(
    { kind: 'space' },
    { kind: 'qr', data: order.folio },
    { kind: 'space' },
    { kind: 'signature', label: 'Firma del cliente' },
    { kind: 'space' },
    {
      kind: 'text',
      text: 'Conserve este comprobante. Es indispensable para recoger su calzado.',
      align: 'center',
      small: true,
    },
    { kind: 'text', text: `¡Gracias por confiar en ${BUSINESS.name}!`, align: 'center' },
    { kind: 'space', lines: 2 },
  )

  return {
    title: `Comprobante ${order.folio}`,
    width: 80,
    blocks,
  }
}

/**
 * TICKET DE COBRO — se imprime al recibir dinero.
 *
 * Refleja UN pago, no la orden entera: si el cliente dio anticipo y liquida
 * después, hay dos tickets, cada uno con lo que se cobró en ese momento.
 */
export function paymentDocument(order: Order, payment: Payment): TicketDocument {
  const blocks: Block[] = [
    ...header(),

    { kind: 'text', text: 'TICKET DE PAGO', align: 'center', emphasis: true },
    { kind: 'space' },

    { kind: 'row', label: 'Folio', value: order.folio, emphasis: true },
    { kind: 'row', label: 'Fecha', value: formatDateTime(payment.createdAt) },
  ]

  if (order.customer) {
    blocks.push({ kind: 'row', label: 'Cliente', value: order.customer.fullName })
  }

  blocks.push({ kind: 'divider' }, ...orderLines(order), { kind: 'divider' })

  blocks.push({ kind: 'row', label: 'Total de la orden', value: formatCentsPlain(order.total) })

  blocks.push(
    { kind: 'divider' },
    {
      kind: 'row',
      label: `Pago (${PAYMENT_METHOD_LABEL[payment.method]})`,
      value: formatCentsPlain(payment.amount),
      emphasis: true,
    },
  )

  if (payment.method === 'efectivo' && payment.tendered !== null) {
    blocks.push(
      { kind: 'row', label: 'Recibido', value: formatCentsPlain(payment.tendered) },
      { kind: 'row', label: 'Cambio', value: formatCentsPlain(payment.change ?? (0 as Cents)) },
    )
  }

  if (payment.reference) {
    blocks.push({ kind: 'row', label: 'Referencia', value: payment.reference })
  }

  // El saldo se calcula sobre la orden YA actualizada por el llamador. Si queda
  // saldo, se imprime: el cliente debe irse sabiendo cuánto debe.
  if (order.balance > 0) {
    blocks.push(
      { kind: 'divider' },
      { kind: 'row', label: 'SALDO PENDIENTE', value: formatCentsPlain(order.balance), emphasis: true },
    )
  } else {
    blocks.push({ kind: 'divider' }, { kind: 'text', text: 'PAGADO', align: 'center', emphasis: true })
  }

  blocks.push(
    { kind: 'space' },
    { kind: 'qr', data: order.folio },
    { kind: 'space' },
    { kind: 'text', text: `¡Gracias por confiar en ${BUSINESS.name}!`, align: 'center' },
    { kind: 'space', lines: 2 },
  )

  return {
    title: `Pago ${order.folio}`,
    width: 80,
    blocks,
  }
}

/** Corte de caja — lo que firma quien cierra el turno. */
export function cashCloseDocument(input: {
  openedAt: string
  closedAt: string
  opening: Cents
  expected: Cents
  counted: Cents
  difference: Cents
  operator: string
}): TicketDocument {
  const blocks: Block[] = [
    ...header(),

    { kind: 'text', text: 'CORTE DE CAJA', align: 'center', emphasis: true },
    { kind: 'space' },

    { kind: 'row', label: 'Apertura', value: formatDateTime(input.openedAt) },
    { kind: 'row', label: 'Cierre', value: formatDateTime(input.closedAt) },
    { kind: 'row', label: 'Operador', value: input.operator },

    { kind: 'divider' },

    { kind: 'row', label: 'Fondo inicial', value: formatCentsPlain(input.opening) },
    { kind: 'row', label: 'Esperado en caja', value: formatCentsPlain(input.expected), emphasis: true },
    { kind: 'row', label: 'Contado', value: formatCentsPlain(input.counted), emphasis: true },

    { kind: 'divider' },

    {
      kind: 'row',
      label: input.difference < 0 ? 'FALTANTE' : input.difference > 0 ? 'SOBRANTE' : 'DIFERENCIA',
      value: formatCents(input.difference),
      emphasis: true,
    },

    { kind: 'space', lines: 2 },
    { kind: 'signature', label: 'Firma del responsable' },
    { kind: 'space', lines: 2 },
  ]

  return { title: 'Corte de caja', width: 80, blocks }
}
