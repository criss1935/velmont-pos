/**
 * Logo de marca → PNG monocromo listo para el cabezal térmico.
 *
 * Se corre UNA vez (o cuando cambie el logo), no en cada impresión:
 *
 *     npm run make-logo -- "../LOGO VELMONT.png"
 *
 * El resultado se commitea en print-agent/assets/. El agente solo lo lee.
 *
 * Por qué no partimos del PDF: sharp no decodifica PDF (libvips se compila sin
 * soporte de poppler en el binario que se instala por npm). Hay que exportar el
 * PDF a PNG/JPG antes — desde Illustrator, a 1000px de ancho o más, fondo blanco.
 * Exportar en grande y reducir aquí da mejor resultado que exportar ya a 384px:
 * el resampleo de sharp promedia, y el dithering trabaja sobre esos grises.
 */

import sharp from 'sharp'
import { mkdir, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../assets/logo-thermal-80mm.png')

/**
 * 384 dots = la mitad del ancho imprimible (576) de una 80mm a 203 DPI.
 *
 * Es deliberado que no ocupe el ancho completo: un logo de 576 dots de ancho
 * y mucha tinta hace que el cabezal caliente de más, el papel salga gris y la
 * impresión se ralentice. 384 centrado se ve nítido y no satura.
 */
const TARGET_WIDTH = 384

/** Candidatos por si no pasas ruta explícita. */
const GUESSES = [
  '../../LOGO VELMONT_page-0001.jpg',
  '../../LOGO VELMONT.png',
  '../../LOGO VELMONT.jpg',
  '../../LOGO VELMONT.jpeg',
  '../../logo-velmont.png',
  '../../assets/logo-velmont.png',
]

async function findSource() {
  const fromArg = process.argv[2]
  if (fromArg) {
    const p = resolve(process.cwd(), fromArg)
    await access(p) // que truene con la ruta que el usuario escribió
    return p
  }

  for (const guess of GUESSES) {
    const p = resolve(HERE, guess)
    try {
      await access(p)
      return p
    } catch {
      /* siguiente */
    }
  }

  throw new Error(
    'No encontré el logo. Exporta el PDF a PNG (fondo blanco, ~1000px de ancho) y:\n' +
      '  npm run make-logo -- "ruta/al/logo.png"',
  )
}

/**
 * Ajuste de niveles con recorte, previo al dithering.
 *
 * Sin esto el resultado es ilegible, y la razón no es obvia: tras invertir, el
 * fondo carbón (#040606) no queda en blanco puro sino en ~250, y el JPEG le
 * mete ruido de compresión encima. Floyd–Steinberg es honesto y ditheriza esa
 * diferencia de 5/255 — el fondo entero sale rayado en diagonal y el logo se
 * pierde dentro del ruido.
 *
 * Recortando por arriba, todo lo que "casi es fondo" se vuelve fondo y deja de
 * gastar puntos. Recortando por abajo, el dorado (que en gris cae a media
 * escala, ~127) se vuelve negro sólido en vez de una trama al 50% que en papel
 * térmico se lee como una mancha gris.
 *
 * El dithering sigue haciendo su trabajo donde importa: en el degradado del
 * monograma y en los bordes de las letras, que es donde un threshold pelón
 * produce escalones.
 */
function levels(gray, blackPoint, whitePoint) {
  const out = Buffer.alloc(gray.length)
  const span = Math.max(1, whitePoint - blackPoint)
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] - blackPoint) / span
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
  }
  return out
}

/**
 * Floyd–Steinberg sobre escala de grises.
 *
 * El threshold binario simple (todo <128 negro) destruye los degradados del
 * logo: el "V+" dorado queda como una mancha sólida y el texto fino desaparece.
 * El dithering reparte el error de cuantización a los vecinos, así que las
 * zonas intermedias salen como tramas de puntos y el ojo las lee como gris.
 * En papel térmico eso es la diferencia entre un logo legible y un borrón.
 *
 * Difusión del error (x=pixel actual, en orden de lectura):
 *
 *        x    7/16
 *   3/16 5/16 1/16
 */
function floydSteinberg(gray, width, height) {
  // Float: el error acumulado es fraccionario y se sale del rango 0-255.
  const buf = Float32Array.from(gray)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = buf[i]
      const next = old < 128 ? 0 : 255
      buf[i] = next
      const err = old - next

      if (x + 1 < width) buf[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16
        buf[i + width] += (err * 5) / 16
        if (x + 1 < width) buf[i + width + 1] += (err * 1) / 16
      }
    }
  }

  const out = Buffer.alloc(gray.length)
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 128 ? 0 : 255
  return out
}

/**
 * ¿El logo viene claro sobre fondo oscuro?
 *
 * La identidad de Velmont es dorado y blanco sobre carbón (#040606). Eso en una
 * térmica es catastrófico: el cabezal solo sabe quemar, así que "fondo negro"
 * significa quemar los 384x~220 dots enteros — sale una plancha negra, tarda,
 * gasta papel y el logo aparece en blanco calado. Hay que invertir.
 *
 * La heurística es el brillo medio: si la mayor parte de la imagen es oscura,
 * el fondo es oscuro. Se puede forzar con --invert / --no-invert.
 */
function shouldInvert(gray) {
  const flag = process.argv.find((a) => a === '--invert' || a === '--no-invert')
  if (flag === '--invert') return true
  if (flag === '--no-invert') return false

  let sum = 0
  for (const v of gray) sum += v
  return sum / gray.length < 128
}

async function main() {
  const source = await findSource()
  console.log(`origen : ${source}`)

  const { data, info } = await sharp(source)
    .flatten({ background: '#ffffff' }) // transparencia → blanco, nunca a negro
    .resize({ width: TARGET_WIDTH, fit: 'inside', withoutEnlargement: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.width !== TARGET_WIDTH) {
    throw new Error(`Esperaba ${TARGET_WIDTH}px de ancho y salieron ${info.width}px.`)
  }

  const invert = shouldInvert(data)
  console.log(`invertir: ${invert ? 'sí (logo claro sobre fondo oscuro)' : 'no'}`)

  // Se invierte ANTES de normalizar: así el histograma se estira sobre la imagen
  // que de verdad se va a imprimir, y el dorado (que en gris queda a media
  // escala) gana separación contra el fondo blanco en vez de perderse.
  let gray = data
  if (invert) {
    gray = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) gray[i] = 255 - data[i]
  }

  const flagValue = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`${name}=`))
    return hit ? Number(hit.split('=')[1]) : fallback
  }

  // Ajustables por si cambia el arte: --black=170 --white=235
  const blackPoint = flagValue('--black', 170)
  const whitePoint = flagValue('--white', 235)
  console.log(`niveles : negro<=${blackPoint}  blanco>=${whitePoint}`)

  const adjusted = levels(gray, blackPoint, whitePoint)
  const dithered = floydSteinberg(adjusted, info.width, info.height)

  await mkdir(dirname(OUT), { recursive: true })
  await sharp(dithered, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .png({ colours: 2, compressionLevel: 9 }) // paleta de 2 → PNG realmente monocromo
    .toFile(OUT)

  const black = dithered.reduce((n, v) => (v === 0 ? n + 1 : n), 0)
  const coverage = ((black / dithered.length) * 100).toFixed(1)

  console.log(`salida : ${OUT}`)
  console.log(`tamaño : ${info.width}x${info.height} dots`)
  console.log(`tinta  : ${coverage}% de puntos negros`)

  if (Number(coverage) > 45) {
    console.warn(
      '\n⚠  Más del 45% del logo es negro. En papel térmico eso calienta mucho el\n' +
        '   cabezal: la impresión sale lenta y grisácea. Considera exportar el logo\n' +
        '   en versión "line art" (trazo oscuro sobre fondo blanco) en vez de blanco\n' +
        '   sobre fondo negro.',
    )
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`)
  process.exit(1)
})
