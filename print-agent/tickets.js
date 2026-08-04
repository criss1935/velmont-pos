/**
 * Templates de ticket.
 *
 * Cada builder devuelve un Buffer ESC/POS completo, del init al corte. No tocan
 * la red ni el disco: reciben un payload y devuelven bytes, así que se pueden
 * probar sin impresora (ver test/tickets.test.js).
 */

import {
  CMD,
  CMD_CODEPAGE,
  feed,
  line,
  text,
  imageToEscPosRaster,
} from './escpos.js'

/**
 * Caracteres por línea.
 *
 * OJO: 32 es el ancho de una 58mm. Una 80mm con Font A entra a 48 caracteres.
 * Se deja en 32 porque así se especificó, y el resultado es legible (queda un
 * margen derecho ancho), pero si quieres aprovechar el papel, subir a 48 aquí
 * es el único cambio necesario — todo el wrap y los separadores lo leen.
 */
export const COLS = Number(process.env.TICKET_COLS ?? 32)

const DIVIDER = '-'.repeat(COLS)

/**
 * Word wrap a COLS columnas.
 *
 * Sin esto, la impresora corta la palabra a media letra al llegar al borde: el
 * texto legal saldría mutilado, que es justo lo que no puede pasar en el
 * documento que el cliente firma. Respeta los saltos de párrafo del original y
 * parte a lo bruto solo las palabras que por sí solas no caben (una URL, un
 * modelo tipo "AIR-JORDAN-1-RETRO-HIGH-OG").
 */
export function wrap(str, cols = COLS) {
  const out = []

  for (const paragraph of String(str ?? '').split('\n')) {
    if (paragraph.trim() === '') {
      out.push('')
      continue
    }

    let current = ''
    for (const word of paragraph.trim().split(/\s+/)) {
      if (word.length > cols) {
        if (current) {
          out.push(current)
          current = ''
        }
        let rest = word
        while (rest.length > cols) {
          out.push(rest.slice(0, cols))
          rest = rest.slice(cols)
        }
        current = rest
        continue
      }

      if (current === '') {
        current = word
      } else if (current.length + 1 + word.length <= cols) {
        current += ` ${word}`
      } else {
        out.push(current)
        current = word
      }
    }
    if (current) out.push(current)
  }

  return out
}

/** Etiqueta a la izquierda, valor pegado al margen derecho. */
export function row(label, value, cols = COLS) {
  const v = String(value ?? '')
  const gap = cols - label.length - v.length
  if (gap < 1) return [...wrap(label, cols), ...wrap(v, cols).map((l) => l.padStart(cols))]
  return [label + ' '.repeat(gap) + v]
}

/** Bloques de líneas → Buffer. */
function lines(arr) {
  return Buffer.concat(arr.map((l) => line(l)))
}

/**
 * TEXTO LEGAL DE LA RESPONSIVA.
 *
 * Aprobado por el negocio. NO parafrasear, NO "mejorar" la redacción: es lo que
 * el cliente firma y lo que sostiene al negocio si hay una reclamación. Si el
 * negocio quiere cambiarlo, se cambia aquí a propósito, no de pasada.
 */
export const TERMINOS_LEGALES = `El negocio no se hace responsable por fallas ocultas, desgastes previos o daños causados por materiales que no hayan sido reportados por el cliente al momento de la entrega.

Para tenis con un valor comercial elevado, el cliente deberá presentar el ticket de compra o las especificaciones del calzado al momento de la entrega, con el fin de establecer el valor real y las responsabilidades correspondientes.

Se requiere un anticipo del 50% del costo del servicio al dejar el trabajo, y el 50% restante al finalizar y entregar el producto.`

/**
 * Cabecera de marca: logo + nombre + claim + datos del negocio.
 *
 * El logo se omite (sin romper la impresión) si el PNG no existe todavía: vale
 * más un ticket sin logo que una recepción que no se puede documentar.
 */
async function brandHeader({ logoPath, address, phone }) {
  const parts = [CMD.init, CMD_CODEPAGE, CMD.alignCenter]

  if (logoPath) {
    try {
      parts.push(await imageToEscPosRaster(logoPath), feed(1))
    } catch (err) {
      console.warn(`[ticket] sin logo: ${err.message}`)
    }
  }

  parts.push(
    CMD.boldOn,
    CMD.sizeDouble,
    line('VELMONT'),
    CMD.sizeNormal,
    line('LUXURY SHOE CARE'),
    CMD.boldOff,
    line('El lujo tambien se cuida'),
  )

  if (address) parts.push(...wrap(address).map((l) => line(l)))
  if (phone) parts.push(line(`Tel. ${phone}`))

  parts.push(CMD.alignLeft)
  return Buffer.concat(parts)
}

/**
 * NOTA DE REMISIÓN — el papel que firma el cliente al dejar el calzado.
 *
 * No es un recibo de pago: es la constancia de qué se recibió, en qué estado, y
 * bajo qué términos. La firma y el estado previo son la razón de ser del
 * documento; sin ellos el negocio no tiene con qué defenderse de un "así no lo
 * dejé".
 *
 * @param {{
 *   folio: string,
 *   fecha: string,
 *   cliente: { nombre: string, telefono: string },
 *   calzado: { marca: string, modelo: string, color: string, notas: string },
 * }} payload
 * @param {{ logoPath?: string, address?: string, phone?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function buildRemisionTicket(payload, options = {}) {
  const {
    logoPath = process.env.LOGO_PATH,
    address = process.env.BUSINESS_ADDRESS,
    phone = process.env.BUSINESS_PHONE,
  } = options

  const cliente = payload?.cliente ?? {}
  const calzado = payload?.calzado ?? {}

  const parts = [await brandHeader({ logoPath, address, phone })]

  parts.push(
    lines([DIVIDER]),
    CMD.alignCenter,
    CMD.boldOn,
    lines(wrap(`NOTA DE REMISION No. ${payload?.folio ?? '-'}`)),
    CMD.boldOff,
    CMD.alignLeft,
    lines([`Fecha: ${payload?.fecha ?? '-'}`]),
  )

  parts.push(
    lines([DIVIDER]),
    CMD.boldOn,
    lines(['DATOS DEL CLIENTE']),
    CMD.boldOff,
    lines([
      ...row('Nombre:', ''),
      ...wrap(cliente.nombre || '-'),
      ...row('Telefono:', ''),
      ...wrap(cliente.telefono || '-'),
    ]),
  )

  parts.push(
    lines([DIVIDER]),
    CMD.boldOn,
    lines(['DESCRIPCION DEL CALZADO']),
    CMD.boldOff,
    lines([
      'Marca:',
      ...wrap(calzado.marca || '-'),
      'Modelo:',
      ...wrap(calzado.modelo || '-'),
      'Color:',
      ...wrap(calzado.color || '-'),
      'Detalles / Notas previas:',
      ...wrap(calzado.notas || 'Sin observaciones.'),
    ]),
  )

  parts.push(
    lines([DIVIDER]),
    CMD.alignCenter,
    CMD.boldOn,
    lines(['TERMINOS Y CONDICIONES']),
    CMD.boldOff,
    CMD.alignLeft,
    lines(wrap(TERMINOS_LEGALES)),
  )

  parts.push(
    lines([DIVIDER]),
    lines(['Firma del Cliente', '(acepta terminos):']),
    feed(4),
    lines(['_'.repeat(COLS)]),
    CMD.alignCenter,
    lines([cliente.nombre || '']),
    CMD.alignLeft,
  )

  parts.push(feed(4), CMD.cutPartial)

  return Buffer.concat(parts)
}

/**
 * Ticket de venta.
 *
 * Existía como `buildTicket` en la especificación del agente; aquí queda la
 * implementación mínima equivalente para que el agente pueda despachar los dos
 * tipos de job sin ramas especiales.
 */
export async function buildTicket(payload, options = {}) {
  const {
    logoPath = process.env.LOGO_PATH,
    address = process.env.BUSINESS_ADDRESS,
    phone = process.env.BUSINESS_PHONE,
  } = options

  const parts = [await brandHeader({ logoPath, address, phone })]

  parts.push(
    lines([DIVIDER]),
    CMD.alignCenter,
    CMD.boldOn,
    lines([`TICKET ${payload?.folio ?? ''}`.trim()]),
    CMD.boldOff,
    CMD.alignLeft,
    lines([`Fecha: ${payload?.fecha ?? '-'}`, DIVIDER]),
  )

  for (const item of payload?.items ?? []) {
    parts.push(
      lines([
        ...wrap(`${item.cantidad ?? 1} x ${item.descripcion ?? ''}`.trim()),
        ...row('', item.importe ?? ''),
      ]),
    )
  }

  parts.push(
    lines([DIVIDER]),
    CMD.boldOn,
    lines(row('TOTAL', payload?.total ?? '')),
    CMD.boldOff,
    feed(3),
    CMD.cutPartial,
  )

  return Buffer.concat(parts)
}
