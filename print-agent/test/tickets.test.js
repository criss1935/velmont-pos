/**
 * Pruebas del agente sin impresora.
 *
 * Todo lo que se puede romper en silencio se prueba aquí: si el wrap deja pasar
 * una línea de 40 caracteres, la impresora la corta y el cliente firma un texto
 * legal mutilado. Eso no se ve en una revisión visual del ticket en pantalla.
 *
 *   npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { imageToEscPosRaster, clearRasterCache, text } from '../escpos.js'
import { wrap, buildRemisionTicket, TERMINOS_LEGALES, COLS } from '../tickets.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOGO = resolve(HERE, '../assets/logo-thermal-80mm.png')

/**
 * Separa el texto imprimible de los comandos.
 *
 * Filtrar bytes de control a lo bruto no sirve: `ESC a 0` (alinear a la
 * izquierda) es 0x1B 0x61 0x00, y al quitar solo los no imprimibles queda una
 * "a" suelta pegada a la línea siguiente. Hay que consumir cada secuencia
 * completa según su largo, que es justo lo que hace la impresora.
 */
function printableLines(buf) {
  const out = []
  let current = ''
  let i = 0

  while (i < buf.length) {
    const b = buf[i]

    if (b === 0x1b) {
      // ESC @ son 2 bytes; ESC a/E/d/t son 3.
      i += buf[i + 1] === 0x40 ? 2 : 3
      continue
    }

    if (b === 0x1d) {
      if (buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
        // GS v 0 m xL xH yL yH + (xL|xH<<8)*(yL|yH<<8) bytes de imagen
        const bytesPerRow = buf[i + 4] | (buf[i + 5] << 8)
        const height = buf[i + 6] | (buf[i + 7] << 8)
        i += 8 + bytesPerRow * height
      } else {
        i += 3 // GS ! n, GS V n
      }
      continue
    }

    if (b === 0x0a) {
      out.push(current)
      current = ''
      i++
      continue
    }

    current += String.fromCharCode(b)
    i++
  }

  if (current) out.push(current)
  return out
}

const PAYLOAD = {
  folio: 'V-00012',
  fecha: '04/08/2026 09:11',
  cliente: { nombre: 'Juan Pérez', telefono: '55 1234 5678' },
  calzado: {
    marca: 'Nike',
    modelo: 'Air Jordan 1 Retro High OG Chicago',
    color: 'Rojo/Blanco/Negro',
    notas: 'Raspón en la punta derecha, suela despegada en el talón izquierdo, agujetas manchadas.',
  },
}

// --- wrap -------------------------------------------------------------------

test('wrap nunca deja una línea más larga que el ancho', () => {
  const sources = [
    TERMINOS_LEGALES,
    PAYLOAD.calzado.notas,
    PAYLOAD.calzado.modelo,
    'AIR-JORDAN-1-RETRO-HIGH-OG-CHICAGO-LOST-AND-FOUND-2022',
    'a'.repeat(200),
  ]

  for (const src of sources) {
    for (const l of wrap(src)) {
      assert.ok(l.length <= COLS, `línea de ${l.length} > ${COLS}: ${JSON.stringify(l)}`)
    }
  }
})

test('wrap no pierde ni inventa palabras', () => {
  const original = TERMINOS_LEGALES.split(/\s+/).filter(Boolean)
  const wrapped = wrap(TERMINOS_LEGALES).join(' ').split(/\s+/).filter(Boolean)
  assert.deepEqual(wrapped, original)
})

test('wrap respeta los párrafos del texto legal', () => {
  // Tres párrafos → dos líneas en blanco de separación.
  const blanks = wrap(TERMINOS_LEGALES).filter((l) => l === '').length
  assert.equal(blanks, 2)
})

test('wrap tolera vacío, null y undefined', () => {
  assert.deepEqual(wrap(''), [''])
  assert.deepEqual(wrap(null), [''])
  assert.deepEqual(wrap(undefined), [''])
})

// --- Texto legal ------------------------------------------------------------

test('el texto legal está literal, sin parafrasear', () => {
  assert.ok(TERMINOS_LEGALES.includes('no se hace responsable por fallas ocultas'))
  assert.ok(TERMINOS_LEGALES.includes('valor comercial elevado'))
  assert.ok(TERMINOS_LEGALES.includes('anticipo del 50% del costo del servicio'))
  assert.ok(TERMINOS_LEGALES.includes('50% restante al finalizar y entregar el producto'))
})

// --- Rasterizado ------------------------------------------------------------

test('GS v 0: cabecera y tamaño de datos correctos', async () => {
  clearRasterCache()
  const raster = await imageToEscPosRaster(LOGO)

  // GS v 0 m
  assert.deepEqual([...raster.subarray(0, 4)], [0x1d, 0x76, 0x30, 0x00])

  const bytesPerRow = raster[4] | (raster[5] << 8)
  const height = raster[6] | (raster[7] << 8)

  assert.equal(bytesPerRow, 48, '384 dots / 8 = 48 bytes por fila')
  assert.ok(height > 0)
  assert.equal(
    raster.length,
    8 + bytesPerRow * height,
    'los datos deben ser exactamente ancho×alto, sin relleno',
  )
})

test('el raster se cachea: la segunda llamada devuelve el mismo Buffer', async () => {
  clearRasterCache()
  const a = await imageToEscPosRaster(LOGO)
  const b = await imageToEscPosRaster(LOGO)
  assert.equal(a, b, 'debe ser la MISMA referencia, no una copia equivalente')
})

test('el logo no satura el cabezal', async () => {
  clearRasterCache()
  const raster = await imageToEscPosRaster(LOGO)
  let bits = 0
  for (const byte of raster.subarray(8)) {
    for (let i = 0; i < 8; i++) if (byte & (1 << i)) bits++
  }
  const coverage = bits / ((raster.length - 8) * 8)
  assert.ok(coverage < 0.45, `cobertura de tinta ${(coverage * 100).toFixed(1)}% — demasiado negro`)
})

// --- Codificación -----------------------------------------------------------

test('los acentos se mapean a CP437, no se van como basura', () => {
  const bytes = text('Pérez ñ ó ¿')
  assert.ok(!bytes.includes(0x3f), 'ningún carácter debió caer en "?"')
  assert.equal(text('é')[0], 130)
  assert.equal(text('ñ')[0], 164)
  assert.equal(text('¿')[0], 168)
})

// --- Nota de remisión -------------------------------------------------------

test('la nota de remisión trae todo lo que el negocio necesita', async () => {
  const buf = await buildRemisionTicket(PAYLOAD, {
    logoPath: LOGO,
    address: 'Av. Siempre Viva 742, CDMX',
    phone: '55 0000 1111',
  })
  const printed = buf.toString('latin1')

  assert.ok(printed.includes('VELMONT'), 'falta la marca')
  assert.ok(printed.includes('NOTA DE REMISION No. V-00012'), 'falta el folio')
  assert.ok(printed.includes('DATOS DEL CLIENTE'))
  assert.ok(printed.includes('DESCRIPCION DEL CALZADO'))
  assert.ok(printed.includes('TERMINOS Y CONDICIONES'))
  assert.ok(printed.includes('Firma del Cliente'))
  assert.ok(printed.includes('Av. Siempre Viva'), 'falta la dirección del negocio')

  // Corte parcial al final
  assert.deepEqual([...buf.subarray(-3)], [0x1d, 0x56, 0x01])

  // Logo incrustado
  assert.ok(buf.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00])), 'falta el raster del logo')
})

test('la nota se imprime aunque falten datos del cliente', async () => {
  const buf = await buildRemisionTicket(
    { folio: 'V-00001', fecha: '04/08/2026', cliente: {}, calzado: {} },
    { logoPath: LOGO },
  )
  assert.ok(buf.length > 0)
  assert.ok(buf.toString('latin1').includes('NOTA DE REMISION No. V-00001'))
})

test('la nota se imprime aunque el logo no exista todavía', async () => {
  const buf = await buildRemisionTicket(PAYLOAD, { logoPath: '/no/existe/logo.png' })
  assert.ok(buf.toString('latin1').includes('NOTA DE REMISION'), 'sin logo, pero con nota')
})

test('ninguna línea de texto del ticket excede el ancho del papel', async () => {
  const buf = await buildRemisionTicket(PAYLOAD, {
    logoPath: LOGO,
    address: 'Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, CDMX',
    phone: '55 0000 1111',
  })

  for (const line of printableLines(buf)) {
    assert.ok(line.length <= COLS, `línea de ${line.length}: ${JSON.stringify(line)}`)
  }
})

test('el texto legal sale completo en el ticket, no truncado', async () => {
  const buf = await buildRemisionTicket(PAYLOAD, { logoPath: LOGO })
  // Sin normalizar espacios: en CP437 'á' es el byte 160, que como carácter
  // Latin-1 es un espacio duro — y `\s` en JavaScript lo trata como espacio.
  // Un replace(/\s+/g,' ') aquí borraría justo los acentos que se quieren
  // verificar, y el test pasaría a mentir en ambos sentidos.
  const printed = printableLines(buf).join(' ')

  // La comparación va sobre bytes CP437, no sobre Unicode: en el papel "daños"
  // son los bytes de la página de códigos de la impresora. Comparar contra la
  // cadena de JavaScript daría un falso negativo en cada palabra acentuada.
  for (const word of TERMINOS_LEGALES.split(/\s+/)) {
    const encoded = text(word).toString('latin1')
    assert.ok(printed.includes(encoded), `falta "${word}" del texto legal`)
  }
})
