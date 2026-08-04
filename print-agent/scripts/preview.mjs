/**
 * Vista previa en consola de un ticket, sin impresora.
 *
 *     node scripts/preview.mjs
 *
 * Decodifica los bytes que se le mandarían a la POS-8360 y los pinta dentro de
 * un marco del ancho del papel. Sirve para revisar el layout y el wrap del
 * texto legal sin gastar rollo — que es donde se ven los errores de verdad.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRemisionTicket, COLS } from '../tickets.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const CP437_REVERSE = {
  128: 'Ç', 129: 'ü', 130: 'é', 131: 'â', 132: 'ä', 133: 'à', 134: 'å', 135: 'ç',
  136: 'ê', 137: 'ë', 138: 'è', 139: 'ï', 140: 'î', 141: 'ì', 142: 'Ä', 143: 'Å',
  144: 'É', 145: 'æ', 146: 'Æ', 147: 'ô', 148: 'ö', 149: 'ò', 150: 'û', 151: 'ù',
  152: 'ÿ', 153: 'Ö', 154: 'Ü', 160: 'á', 161: 'í', 162: 'ó', 163: 'ú', 164: 'ñ',
  165: 'Ñ', 166: 'ª', 167: 'º', 168: '¿', 173: '¡', 174: '«', 175: '»', 248: '°',
}

function decode(buf) {
  const lines = []
  let current = ''
  let bold = false
  let double = false
  let align = 'left'
  let i = 0

  const flush = () => {
    let content = current
    if (double) content = content.toUpperCase()
    if (align === 'center') content = content.padStart(Math.floor((COLS + content.length) / 2))
    lines.push({ text: content, bold, double })
    current = ''
  }

  while (i < buf.length) {
    const b = buf[i]

    if (b === 0x1b) {
      const cmd = buf[i + 1]
      if (cmd === 0x40) { i += 2; continue }
      if (cmd === 0x61) { align = ['left', 'center', 'right'][buf[i + 2]] ?? 'left'; i += 3; continue }
      if (cmd === 0x45) { bold = buf[i + 2] === 1; i += 3; continue }
      if (cmd === 0x64) { for (let n = 0; n < buf[i + 2]; n++) lines.push({ text: '' }); i += 3; continue }
      i += 3
      continue
    }

    if (b === 0x1d) {
      if (buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
        const bytesPerRow = buf[i + 4] | (buf[i + 5] << 8)
        const height = buf[i + 6] | (buf[i + 7] << 8)
        lines.push({ text: `[ LOGO ${bytesPerRow * 8}x${height} dots ]`, logo: true })
        i += 8 + bytesPerRow * height
        continue
      }
      if (buf[i + 1] === 0x21) { double = buf[i + 2] !== 0; i += 3; continue }
      if (buf[i + 1] === 0x56) { lines.push({ text: '', cut: true }); i += 3; continue }
      i += 3
      continue
    }

    if (b === 0x0a) { flush(); i++; continue }

    current += CP437_REVERSE[b] ?? String.fromCharCode(b)
    i++
  }

  if (current) flush()
  return lines
}

const payload = {
  folio: 'V-00012',
  fecha: '04/08/2026 09:11',
  cliente: { nombre: 'Juan Pérez Hernández', telefono: '55 1234 5678' },
  calzado: {
    marca: 'Nike',
    modelo: 'Air Jordan 1 Retro High OG Chicago',
    color: 'Rojo / Blanco / Negro',
    notas:
      'Raspón en la punta derecha, suela despegada en el talón izquierdo, agujetas manchadas y ojillo flojo.',
  },
}

const buf = await buildRemisionTicket(payload, {
  logoPath: resolve(HERE, '../assets/logo-thermal-80mm.png'),
  address: 'Av. Insurgentes Sur 1234, Del Valle, CDMX',
  phone: '55 0000 1111',
})

console.log(`\n  ┌${'─'.repeat(COLS + 2)}┐`)
for (const l of decode(buf)) {
  if (l.cut) {
    console.log(`  ├${'╌'.repeat(COLS + 2)}┤   ✂ corte`)
    continue
  }
  const centered = l.logo ? l.text.padStart(Math.floor((COLS + l.text.length) / 2)) : l.text
  console.log(`  │ ${centered.padEnd(COLS)} │`)
}
console.log(`  └${'─'.repeat(COLS + 2)}┘`)
console.log(`\n  ${buf.length} bytes · ${COLS} columnas\n`)
