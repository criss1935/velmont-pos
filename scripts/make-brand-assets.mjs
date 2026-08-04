/**
 * Extrae los assets de marca del archivo oficial.
 *
 *     node scripts/make-brand-assets.mjs
 *
 * Genera en public/brand/:
 *   emblem.png     el emblema circular (monograma + destello), fondo transparente
 *   emblem@2x.png  el mismo a doble resolución, para pantallas retina
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE PARTE DEL JPG Y NO DEL PDF
 *
 * El original es `LOGO VELMONT.pdf` (Illustrator, vectorial), que sería la
 * fuente ideal. Pero sharp no decodifica PDF — el libvips que se instala por
 * npm viene compilado sin poppler — y esta máquina no tiene ningún rasterizador
 * (`gs`, `pdftoppm`, `magick`, `mutool`: ninguno instalado). Así que se trabaja
 * sobre el export a JPG, que a 7323x4252 tiene resolución de sobra para el
 * tamaño al que se usa el emblema (52px, 104px en retina).
 *
 * Lo correcto a futuro sigue siendo un SVG exportado desde Illustrator: escala
 * infinito y pesa una fracción. Cuando exista, este script sobra.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE QUITA EL FONDO
 *
 * El arte es dorado y blanco sobre carbón casi puro. En vez de recortar a mano
 * o hacer croma, se usa la LUMINANCIA como canal alfa: lo oscuro se vuelve
 * transparente y lo claro opaco, conservando el color original del degradado
 * dorado. Es exacto porque el fondo es lo único oscuro de la imagen.
 *
 * La luminancia se estira antes ([LO, HI] -> [0, 255]) para que el dorado
 * quede totalmente opaco en vez de traslúcido: sin ese estiramiento el
 * monograma sale lavado sobre el sidebar negro, que es justo donde se usa.
 */

import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(HERE, '../LOGO VELMONT_page-0001.jpg')
const OUT_DIR = resolve(HERE, '../public/brand')

/** Alto del emblema en CSS pixels. El @2x sale al doble. */
const EMBLEM_HEIGHT = 128

/** Umbrales de luminancia para el alfa. Por debajo de LO: transparente. */
const LO = 18
const HI = 85

/**
 * Localiza las bandas horizontales del logo midiendo tinta por fila.
 *
 * El arte apila cinco bloques separados por franjas de fondo negro: emblema,
 * "VELMONT", "LUXURY SHOE CARE", "EL LUJO TAMBIÉN SE CUIDA" y el tenis. En vez
 * de codificar coordenadas a ojo — que fallan al primer reexport del JPG y que
 * ya me cortaron el arco del círculo dos veces — se detectan contando por fila
 * cuántos píxeles superan el umbral de fondo. Las filas sin tinta son las
 * separaciones; los tramos con tinta, los bloques.
 */
function findBands(gray, width, height) {
  const INK = 40 // luminancia por encima de la cual un píxel cuenta como arte

  // La separación entre la punta del monograma y la "V" de VELMONT es mínima —
  // apenas medio punto porcentual del alto. Un umbral más generoso funde los
  // dos bloques en uno y el emblema sale con el wordmark pegado debajo.
  const MIN_GAP = Math.max(2, Math.round(height * 0.004))

  const rowHasInk = new Array(height)
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > INK) n++
    }
    // Un puñado de píxeles es ruido de compresión del JPG, no arte.
    rowHasInk[y] = n > width * 0.002
  }

  const bands = []
  let start = null
  let gap = 0

  for (let y = 0; y < height; y++) {
    if (rowHasInk[y]) {
      if (start === null) start = y
      gap = 0
    } else if (start !== null) {
      gap++
      if (gap >= MIN_GAP) {
        bands.push({ top: start, bottom: y - gap })
        start = null
        gap = 0
      }
    }
  }
  if (start !== null) bands.push({ top: start, bottom: height - 1 })

  return bands
}

async function main() {
  const meta = await sharp(SOURCE).metadata()
  console.log(`origen  : ${SOURCE} (${meta.width}x${meta.height})`)

  // Se analiza a escala reducida: detectar bandas no necesita 7323px de ancho y
  // así el barrido es instantáneo.
  const SCAN_W = 900
  const { data: scan, info: scanInfo } = await sharp(SOURCE)
    .resize({ width: SCAN_W })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const bands = findBands(scan, scanInfo.width, scanInfo.height)
  const k = meta.height / scanInfo.height

  console.log(`bandas  : ${bands.length} bloques detectados`)
  bands.forEach((b, i) => {
    console.log(`          ${i}: y ${Math.round(b.top * k)}–${Math.round(b.bottom * k)}`)
  })

  const emblem = bands[0]
  if (!emblem) throw new Error('No detecté ningún bloque de arte en la imagen.')

  // Un respiro alrededor para no rozar el antialiasing del borde, pero SIN
  // invadir la banda siguiente: el wordmark empieza a ~30px del emblema, y un
  // margen ciego se llevaba una tira de las letras. Esa tira, al ocupar todo el
  // ancho del lienzo, además impedía que `.trim()` recortara los lados y el
  // emblema salía centrado en una imagen enorme y vacía.
  const pad = Math.round((emblem.bottom - emblem.top) * k * 0.04)
  const nextTop = bands[1] ? Math.round(bands[1].top * k) : meta.height
  const top = Math.max(0, Math.round(emblem.top * k) - pad)
  const bottom = Math.min(nextTop - 1, Math.round(emblem.bottom * k) + pad)

  const region = { left: 0, top, width: meta.width, height: bottom - top }

  const cropped = await sharp(SOURCE).extract(region).toBuffer()

  // El color se conserva tal cual del original; solo se calcula el alfa.
  const { data: rgb, info } = await sharp(cropped)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rgba = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    const lum = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]
    const a = Math.round(Math.min(1, Math.max(0, (lum - LO) / (HI - LO))) * 255)
    rgba[j] = rgb[i]
    rgba[j + 1] = rgb[i + 1]
    rgba[j + 2] = rgb[i + 2]
    rgba[j + 3] = a
  }

  await mkdir(OUT_DIR, { recursive: true })

  for (const scale of [1, 2]) {
    const suffix = scale === 1 ? '' : `@${scale}x`
    const out = resolve(OUT_DIR, `emblem${suffix}.png`)

    // Se recorta al contenido y DESPUÉS se devuelve un margen proporcional.
    // `.trim()` deja el arte a ras del borde, y un logo pegado al filo de su
    // propia caja se ve apretado en cuanto se le pone un fondo al lado.
    const trimmed = await sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .trim({ threshold: 1 })
      // A PNG y no a raw: el buffer se vuelve a abrir con sharp más abajo, y un
      // raw sin metadatos de formato no se puede reabrir.
      .png()
      .toBuffer({ resolveWithObject: true })

    const margin = Math.round(trimmed.info.height * 0.06)

    // Dos pasadas a propósito: sharp aplica `extend` DESPUÉS de `resize` dentro
    // de un mismo pipeline, sin importar el orden en que se encadenen. En una
    // sola pasada el margen se añadía al tamaño ya reducido y la imagen salía
    // con el doble de aire y el emblema diminuto.
    const padded = await sharp(trimmed.data)
      .extend({
        top: margin,
        bottom: margin,
        left: margin,
        right: margin,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()

    const info2 = await sharp(padded)
      .resize({ height: EMBLEM_HEIGHT * scale })
      .png({ compressionLevel: 9 })
      .toFile(out)

    console.log(`salida  : ${out} (${info2.width}x${info2.height}, ${(info2.size / 1024).toFixed(1)} KB)`)
  }

  // --- Iconos de app y favicon --------------------------------------------
  //
  // Estos SÍ llevan el fondo negro de marca, al revés que el emblema suelto.
  // Un PNG transparente de trazo dorado desaparece contra la pestaña clara de
  // Chrome y contra el fondo del lanzador de Android; el cuadro negro es
  // además lo que hace reconocible el icono en la pantalla de inicio.
  const ICONS = [
    { name: 'favicon-32.png', size: 32, pad: 0.06 },
    { name: 'apple-touch-icon.png', size: 180, pad: 0.14 },
    { name: 'icon-192.png', size: 192, pad: 0.14 },
    { name: 'icon-512.png', size: 512, pad: 0.14 },
  ]

  for (const icon of ICONS) {
    const inner = Math.round(icon.size * (1 - icon.pad * 2))
    const art = await sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .trim({ threshold: 1 })
      .resize({ width: inner, height: inner, fit: 'inside' })
      .png()
      .toBuffer()

    const out = resolve(OUT_DIR, icon.name)
    const written = await sharp({
      create: {
        width: icon.size,
        height: icon.size,
        channels: 4,
        background: { r: 0x0a, g: 0x0a, b: 0x0a, alpha: 1 },
      },
    })
      .composite([{ input: art, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(out)

    console.log(`icono   : ${out} (${written.width}x${written.height}, ${(written.size / 1024).toFixed(1)} KB)`)
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`)
  process.exit(1)
})
