import type { Block, TicketDocument } from './types'

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'title':
      return `<div class="t-title">${escape(block.text)}</div>`

    case 'text': {
      const classes = [
        't-text',
        `align-${block.align ?? 'left'}`,
        block.emphasis ? 'em' : '',
        block.small ? 'sm' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return `<div class="${classes}">${escape(block.text)}</div>`
    }

    case 'row':
      return `<div class="t-row${block.emphasis ? ' em' : ''}">
        <span>${escape(block.label)}</span>
        <span class="t-value">${escape(block.value)}</span>
      </div>`

    case 'line':
      return `<div class="t-line">
        <span class="t-qty">${block.quantity}×</span>
        <span class="t-desc">
          ${escape(block.description)}
          ${block.note ? `<em>${escape(block.note)}</em>` : ''}
        </span>
        <span class="t-amount">${escape(block.amount)}</span>
      </div>`

    case 'divider':
      return '<div class="t-divider"></div>'

    case 'space':
      return `<div class="t-space" style="height:${(block.lines ?? 1) * 10}px"></div>`

    case 'qr':
      // Sin librería de QR: el folio impreso en grande y en mono es igual de
      // escaneable por un humano, que es quien lo va a leer al entregar. Cuando
      // haya lector físico se cambia este bloque por un QR de verdad.
      return `<div class="t-folio">${escape(block.data)}</div>`

    case 'signature':
      return `<div class="t-sign">
        <div class="t-sign-line"></div>
        <div class="t-sign-label">${escape(block.label)}</div>
      </div>`
  }
}

/**
 * Renderiza el ticket a una página HTML lista para el diálogo de impresión.
 *
 * El alto de página NO se puede declarar como `size: 80mm auto`: en la
 * gramática de CSS Paged Media `auto` no es combinable con una longitud, así
 * que Chrome descarta la declaración entera y cae al papel del driver
 * (verificado con `Page.printToPDF` + `preferCSSPageSize`: salía hoja carta).
 * De ahí las hojas kilométricas o cortadas al imprimir en rollo continuo.
 *
 * Por eso el documento se mide a sí mismo: el `<script>` al final del body
 * corre tras el layout (el iframe de `printers.ts` imprime en `onload`, que
 * dispara después) e inyecta un `@page` con el alto real del contenido en mm.
 * El `@page` estático de arriba queda de respaldo por si el script no corre.
 * `html`/`body` van sin alto fijo ni `min-height` para que esa medición sea
 * la del contenido y no la de un viewport.
 */
export function renderTicketHtml(doc: TicketDocument): string {
  const body = doc.blocks.map(renderBlock).join('\n')

  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<title>${escape(doc.title)}</title>
<style>
  @page {
    size: ${doc.width}mm 297mm;
    margin: 0;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    width: ${doc.width}mm;
    height: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
  }

  body {
    padding: 4mm;
    /* Mono en todo el ticket: es lo que hace que las columnas de importes
       queden alineadas en una térmica, que imprime a paso fijo. */
    font-family: 'Roboto Mono', ui-monospace, 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.45;
    color: #000;
    background: #fff;
  }

  .t-title {
    font-size: 19px;
    font-weight: 700;
    text-align: center;
    letter-spacing: 3px;
    margin-bottom: 2px;
  }

  .t-text { white-space: pre-wrap; word-break: break-word; }
  .t-text.sm { font-size: 9.5px; }
  .t-text.em { font-weight: 700; }
  .align-center { text-align: center; }
  .align-right  { text-align: right; }

  .t-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .t-row.em { font-weight: 700; font-size: 13px; }
  .t-value { text-align: right; white-space: nowrap; }

  .t-line {
    display: flex;
    gap: 6px;
    margin: 3px 0;
  }
  .t-qty    { flex: none; width: 26px; }
  .t-desc   { flex: 1; word-break: break-word; }
  .t-desc em { display: block; font-style: normal; font-size: 9.5px; }
  .t-amount { flex: none; text-align: right; white-space: nowrap; }

  .t-divider {
    border-top: 1px dashed #000;
    margin: 5px 0;
  }

  /* El folio se imprime grande: es el número que el cliente lee por teléfono y
     el que el operador busca al entregar. */
  .t-folio {
    margin: 6px 0;
    padding: 6px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 4px;
    text-align: center;
    border: 2px solid #000;
  }

  .t-sign { margin-top: 18px; }
  .t-sign-line { border-top: 1px solid #000; margin: 0 8mm; }
  .t-sign-label {
    margin-top: 3px;
    font-size: 9.5px;
    text-align: center;
  }
</style>
</head>
<body>
${body}
<script>
  (function () {
    // 1 px CSS = 1/96 in exacto; +2mm de colchón contra redondeos que
    // empujarían la última línea a una segunda página.
    var mm = Math.ceil(document.documentElement.scrollHeight * 25.4 / 96) + 2
    if (mm < 30) return // medición absurda: mejor el @page de respaldo
    var style = document.createElement('style')
    style.textContent = '@page { size: ${doc.width}mm ' + mm + 'mm; margin: 0; }'
    document.head.appendChild(style)
  })()
</script>
</body>
</html>`
}
