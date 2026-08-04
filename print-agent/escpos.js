/**
 * Primitivas ESC/POS.
 *
 * Todo lo que sale de aquí son Buffers crudos listos para concatenar y escribir
 * al socket TCP 9100. Nada de este módulo sabe qué es una nota de remisión ni un
 * ticket de venta — eso vive en tickets.js. La separación importa: cuando el
 * cliente cambie de impresora, lo que se ajusta son estas constantes, no los
 * templates.
 */

import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

/** Ancho imprimible en dots de una 80mm a 203 DPI. 576 = 72 bytes por fila. */
export const PRINTABLE_DOTS = 576

// --- Comandos crudos --------------------------------------------------------

const ESC = 0x1b
const GS = 0x1d

export const CMD = {
  /** ESC @ — reset. Limpia estilos que dejó el job anterior. */
  init: Buffer.from([ESC, 0x40]),

  alignLeft: Buffer.from([ESC, 0x61, 0]),
  alignCenter: Buffer.from([ESC, 0x61, 1]),
  alignRight: Buffer.from([ESC, 0x61, 2]),

  boldOn: Buffer.from([ESC, 0x45, 1]),
  boldOff: Buffer.from([ESC, 0x45, 0]),

  /** GS ! n — n=0x11 dobla ancho y alto; 0x00 vuelve a normal. */
  sizeDouble: Buffer.from([GS, 0x21, 0x11]),
  sizeNormal: Buffer.from([GS, 0x21, 0x00]),

  /** GS V 1 — corte parcial (deja un puente de papel; el cliente lo arranca). */
  cutPartial: Buffer.from([GS, 0x56, 1]),
}

/** Avanza n líneas. */
export function feed(lines = 1) {
  return Buffer.from([ESC, 0x64, Math.max(0, Math.min(255, lines))])
}

/**
 * Texto → bytes.
 *
 * CP437 es lo que trae por defecto la POS-8360. Los acentos del español (á, é,
 * ñ, ¿) NO están en ASCII, así que hay que mapearlos a la página de códigos o
 * salen como basura. Se selecciona CP437 con ESC t 0 al inicializar.
 */
const CP437 = {
  'Ç': 128, 'ü': 129, 'é': 130, 'â': 131, 'ä': 132, 'à': 133, 'å': 134, 'ç': 135,
  'ê': 136, 'ë': 137, 'è': 138, 'ï': 139, 'î': 140, 'ì': 141, 'Ä': 142, 'Å': 143,
  'É': 144, 'æ': 145, 'Æ': 146, 'ô': 147, 'ö': 148, 'ò': 149, 'û': 150, 'ù': 151,
  'ÿ': 152, 'Ö': 153, 'Ü': 154, '¢': 155, '£': 156, '¥': 157, '₧': 158, 'ƒ': 159,
  'á': 160, 'í': 161, 'ó': 162, 'ú': 163, 'ñ': 164, 'Ñ': 165, 'ª': 166, 'º': 167,
  '¿': 168, '¬': 170, '½': 171, '¼': 172, '¡': 173, '«': 174, '»': 175,
  '░': 176, '▒': 177, '▓': 178, '│': 179, '┤': 180, '╡': 181,
  'α': 224, 'ß': 225, 'µ': 230, 'Ω': 234, '°': 248, '·': 250, '²': 253, '■': 254,
}

export function text(str) {
  const out = Buffer.alloc(str.length)
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    const code = ch.charCodeAt(0)
    if (code < 128) {
      out[i] = code
    } else if (CP437[ch] !== undefined) {
      out[i] = CP437[ch]
    } else {
      out[i] = 0x3f // '?' — mejor un signo visible que un byte al azar
    }
  }
  return out
}

/** Texto + salto de línea. */
export function line(str = '') {
  return Buffer.concat([text(str), Buffer.from([0x0a])])
}

/** Selecciona CP437. Va junto al init, antes de cualquier texto acentuado. */
export const CMD_CODEPAGE = Buffer.from([ESC, 0x74, 0])

// --- Rasterización de imagen (GS v 0) ---------------------------------------

/**
 * Caché en memoria del logo rasterizado.
 *
 * El logo no cambia entre tickets: convertirlo en cada job sería leer el PNG,
 * decodificarlo y empaquetar bits ~30 veces al día para obtener siempre el mismo
 * Buffer. Se calcula la primera vez y se reusa mientras viva el proceso.
 */
const rasterCache = new Map()

/**
 * PNG monocromo → comando GS v 0 listo para concatenar.
 *
 * Formato: GS v 0 m xL xH yL yH [data]
 *   m  = 0 (modo normal, sin escalar)
 *   xL/xH = ancho en BYTES (width / 8), little-endian
 *   yL/yH = alto en DOTS, little-endian
 *   data  = filas de arriba a abajo; en cada byte el bit más significativo es
 *           el dot más a la izquierda. Bit en 1 = punto NEGRO (el cabezal
 *           quema). Ojo: es al revés que la intuición del PNG, donde 0 = negro.
 *
 * @param {string} pngPath Ruta al PNG ya preparado (ancho múltiplo de 8).
 * @returns {Promise<Buffer>}
 */
export async function imageToEscPosRaster(pngPath) {
  const cached = rasterCache.get(pngPath)
  if (cached) return cached

  const source = await readFile(pngPath)
  const { data, info } = await sharp(source)
    .flatten({ background: '#ffffff' }) // aplana transparencia: alfa → blanco, no negro
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info

  if (width % 8 !== 0) {
    throw new Error(
      `El ancho del logo debe ser múltiplo de 8 para empaquetar bits sin relleno; ${pngPath} mide ${width}px. ` +
        'Regenéralo con `npm run make-logo`.',
    )
  }
  if (width > PRINTABLE_DOTS) {
    throw new Error(
      `El logo mide ${width}px y el área imprimible son ${PRINTABLE_DOTS} dots. Se saldría del papel.`,
    )
  }

  const bytesPerRow = width / 8
  const raster = Buffer.alloc(bytesPerRow * height, 0)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // El PNG ya viene ditherizado a 0/255; el <128 solo es defensa por si
      // alguien mete un gris a mano.
      if (data[y * width + x] < 128) {
        raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }

  const header = Buffer.from([
    GS, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ])

  const result = Buffer.concat([header, raster])
  rasterCache.set(pngPath, result)
  return result
}

/** Solo para pruebas: olvida lo cacheado. */
export function clearRasterCache() {
  rasterCache.clear()
}
