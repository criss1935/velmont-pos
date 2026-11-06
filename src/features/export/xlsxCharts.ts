/**
 * Gráficos NATIVOS de Excel (DrawingML) dentro de un .xlsx generado con exceljs
 * (portado del POS de Tori Hana). exceljs no escribe gráficos: aquí se agregan
 * las partes OOXML que Excel espera (xl/charts/chartN.xml, xl/drawings/drawingN.xml
 * con sus .rels, la relación desde la hoja y los Override de [Content_Types].xml).
 *
 * Los gráficos apuntan a rangos de celdas de la hoja (se recalculan si el
 * usuario edita) y llevan caché de valores para visores que no recalculan.
 */
import JSZip from 'jszip'

export type ChartKind = 'col' | 'bar' | 'doughnut' | 'line'
export interface ChartSeries {
  name: string
  ref: string
  values: number[]
  color?: string
}
export interface ChartSpec {
  kind: ChartKind
  title: string
  stacked?: boolean
  /** Formato del eje de valores. Default: pesos sin decimales. */
  numFmt?: string
  /** Celdas (0-based) donde se ancla: esquina superior izquierda e inferior derecha. */
  from: { col: number; row: number }
  to: { col: number; row: number }
  categories: { ref: string; values: string[] }
  series: ChartSeries[]
}

/** Paleta Velmont (misma que las gráficas de pantalla). */
export const PALETTE = ['C9A15A', '1F1F1F', 'D98A3D', '3B82A0', '7A8B6B', '8B6BB1', 'A04D36', '9A9A9A']
const colorAt = (i: number) => PALETTE[i % PALETTE.length] ?? 'C9A15A'

export const MONEY_AXIS = '"$"#,##0'
export const COUNT_AXIS = '#,##0'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const C =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** Referencia absoluta a un rango de una columna: ref('Análisis', 'B', 5, 20) → 'Análisis'!$B$5:$B$20. */
export function ref(sheet: string, col: string, r1: number, r2: number) {
  return `'${sheet.replace(/'/g, "''")}'!$${col}$${r1}:$${col}$${r2}`
}

const fill = (hex: string) => `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>`
const strCache = (vals: string[]) =>
  `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`
const numCache = (vals: number[]) =>
  `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join('')}</c:numCache>`
const title = (t: string) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-MX" sz="1200" b="1"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`

function seriesXml(spec: ChartSpec, s: ChartSeries, i: number) {
  const color = s.color ?? colorAt(i)
  const pts =
    spec.kind === 'doughnut'
      ? spec.categories.values.map((_, j) => `<c:dPt><c:idx val="${j}"/><c:bubble3D val="0"/>${fill(colorAt(j))}</c:dPt>`).join('')
      : ''
  const sp =
    spec.kind === 'doughnut'
      ? ''
      : spec.kind === 'line'
        ? `<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
        : fill(color)
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${sp}${spec.kind === 'col' || spec.kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}${pts}` +
    `<c:cat><c:strRef><c:f>${esc(spec.categories.ref)}</c:f>${strCache(spec.categories.values)}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f>${numCache(s.values)}</c:numRef></c:val>${spec.kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`
  )
}

export function chartXml(spec: ChartSpec): string {
  const sers = spec.series.map((s, i) => seriesXml(spec, s, i)).join('')
  const axes = '<c:axId val="111"/><c:axId val="222"/>'
  const numFmt = esc(spec.numFmt ?? MONEY_AXIS)
  // Barras siempre desde 0: un eje que arranca en 120k exagera diferencias pequeñas.
  const minZero = spec.series.some((s) => s.values.some((v) => v < 0)) ? '' : '<c:min val="0"/>'
  let plot: string
  if (spec.kind === 'doughnut') {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`
  } else {
    const isBar = spec.kind !== 'line'
    const chart = isBar
      ? `<c:barChart><c:barDir val="${spec.kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${spec.stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="60"/>${spec.stacked ? '<c:overlap val="100"/>' : ''}${axes}</c:barChart>`
      : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${axes}</c:lineChart>`
    const catPos = spec.kind === 'bar' ? 'l' : 'b'
    const valPos = spec.kind === 'bar' ? 'b' : 'l'
    plot =
      chart +
      `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="${spec.kind === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/>${minZero}</c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${numFmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="${spec.kind === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
  }
  const legend =
    spec.series.length > 1 || spec.kind === 'doughnut'
      ? `<c:legend><c:legendPos val="${spec.kind === 'doughnut' ? 'r' : 'b'}"/><c:overlay val="0"/></c:legend>`
      : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${C}><c:roundedCorners val="0"/><c:chart>${title(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="es-MX"/></a:p></c:txPr></c:chartSpace>`
}

function drawingXml(specs: ChartSpec[], firstRid: number) {
  const anchors = specs
    .map(
      (s, i) =>
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${s.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${s.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${firstRid + i}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const T_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const T_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

async function text(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`Falta ${path} en el .xlsx`)
  return file.async('string')
}

/** Ruta del XML de la hoja `sheetName` dentro del paquete (vía workbook.xml y sus relaciones). */
async function sheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const wb = await text(zip, 'xl/workbook.xml')
  const rels = await text(zip, 'xl/_rels/workbook.xml.rels')
  const tag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(`name="${esc(sheetName)}"`))
  if (!tag) throw new Error(`Hoja ${sheetName} no encontrada`)
  const rid = /r:id="([^"]+)"/.exec(tag)?.[1]
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(`Id="${rid}"`))
  const target = rel ? /Target="([^"]+)"/.exec(rel)?.[1] : undefined
  if (!target) throw new Error(`Relación de la hoja ${sheetName} no encontrada`)
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

/** Agrega `specs` como gráficos nativos a la hoja `sheetName` de un .xlsx (buffer) y devuelve el nuevo buffer. */
export async function addNativeCharts(
  xlsx: ArrayBuffer | Uint8Array,
  sheetName: string,
  specs: ChartSpec[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(xlsx)
  if (!specs.length) return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  const sheet = await sheetPath(zip, sheetName)
  const sheetFile = sheet.split('/').pop() ?? ''
  const sheetRelsPath = sheet.replace(sheetFile, `_rels/${sheetFile}.rels`)
  const existingDrawings = Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f)).length
  const existingCharts = Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f)).length
  const dn = existingDrawings + 1
  let sheetXml = await text(zip, sheet)
  if (/<drawing\b/.test(sheetXml)) throw new Error('La hoja ya tiene un dibujo; no se pueden combinar.')

  const chartRels: string[] = []
  specs.forEach((s, i) => {
    const n = existingCharts + i + 1
    zip.file(`xl/charts/chart${n}.xml`, chartXml(s))
    chartRels.push(`<Relationship Id="rId${i + 1}" Type="${T_CHART}" Target="../charts/chart${n}.xml"/>`)
  })
  zip.file(`xl/drawings/drawing${dn}.xml`, drawingXml(specs, 1))
  zip.file(
    `xl/drawings/_rels/drawing${dn}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${chartRels.join('')}</Relationships>`,
  )

  // Relación hoja → dibujo (se respeta un .rels existente).
  let rels = zip.file(sheetRelsPath)
    ? await text(zip, sheetRelsPath)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`
  const rid = 'rIdVmDrawing'
  rels = rels.replace(
    '</Relationships>',
    `<Relationship Id="${rid}" Type="${T_DRAWING}" Target="../drawings/drawing${dn}.xml"/></Relationships>`,
  )
  zip.file(sheetRelsPath, rels)

  // <drawing> va después de pageMargins/pageSetup/headerFooter/rowBreaks/colBreaks y antes de legacyDrawing/tableParts/extLst.
  const head = sheetXml.slice(0, sheetXml.indexOf('>', sheetXml.indexOf('<worksheet')))
  if (!/xmlns:r=/.test(head)) {
    sheetXml = sheetXml.replace(
      '<worksheet',
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    )
  }
  const tag = `<drawing r:id="${rid}"/>`
  const before = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(sheetXml)
  sheetXml = before
    ? sheetXml.slice(0, before.index) + tag + sheetXml.slice(before.index)
    : sheetXml.replace('</worksheet>', `${tag}</worksheet>`)
  zip.file(sheet, sheetXml)

  let ct = await text(zip, '[Content_Types].xml')
  const add = (part: string, type: string) => {
    if (!ct.includes(`PartName="${part}"`)) ct = ct.replace('</Types>', `<Override PartName="${part}" ContentType="${type}"/></Types>`)
  }
  add(`/xl/drawings/drawing${dn}.xml`, 'application/vnd.openxmlformats-officedocument.drawing+xml')
  specs.forEach((_, i) =>
    add(`/xl/charts/chart${existingCharts + i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'),
  )
  zip.file('[Content_Types].xml', ct)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
