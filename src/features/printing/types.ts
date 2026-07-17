/**
 * Modelo del ticket.
 *
 * La decisión central: un ticket NO es HTML. Es una lista de bloques con
 * semántica. Un ticket-como-HTML solo sabe imprimirse en un navegador; este
 * modelo lo puede pintar cualquiera — la vista previa en pantalla, una impresora
 * ESC/POS por Bluetooth, RawBT, o una impresora de red — sin reescribir nada del
 * contenido.
 *
 * Es lo que permite que hoy, sin saber qué impresora comprará el cliente, el
 * sistema esté igualmente terminado: falta un driver, no falta el ticket.
 */

export type Align = 'left' | 'center' | 'right'

export type Block =
  /** Texto suelto. `emphasis` lo pone en negrita/doble alto según el driver. */
  | { kind: 'text'; text: string; align?: Align; emphasis?: boolean; small?: boolean }
  /** Título grande y centrado (la marca en la cabecera). */
  | { kind: 'title'; text: string }
  /** Fila etiqueta–valor, con el valor pegado al margen derecho. */
  | { kind: 'row'; label: string; value: string; emphasis?: boolean }
  /** Línea de concepto: cantidad, descripción e importe. */
  | { kind: 'line'; quantity: number; description: string; amount: string; note?: string }
  /** Separador horizontal. */
  | { kind: 'divider' }
  /** Espacio en blanco de n líneas. */
  | { kind: 'space'; lines?: number }
  /** Código de barras / QR con el folio, para escanear al entregar. */
  | { kind: 'qr'; data: string }
  /** Línea para que el cliente firme (comprobante de recepción). */
  | { kind: 'signature'; label: string }

export interface TicketDocument {
  /** Sale en el título de la vista previa y en el log; no se imprime. */
  title: string
  /** Ancho del papel. Determina cuántos caracteres caben por línea. */
  width: 58 | 80
  blocks: Block[]
}

/**
 * Un destino de impresión.
 *
 * Implementaciones previstas:
 *   - PreviewPrinter    (ya): vista previa en pantalla + diálogo de impresión
 *                             del navegador. Sirve para operar desde el día uno.
 *   - RawBtPrinter      (pendiente): intent de Android hacia la app RawBT.
 *   - EscPosBluetooth   (pendiente): Web Bluetooth, bytes ESC/POS crudos.
 *   - NetworkPrinter    (pendiente): TCP al puerto 9100 de la impresora.
 *
 * Ninguna pantalla conoce estos nombres: piden `getPrinter()` y llaman a print().
 */
export interface Printer {
  readonly id: string
  readonly name: string
  /** false si el entorno no la soporta (ej. Web Bluetooth en un iPad). */
  isAvailable(): boolean
  print(document: TicketDocument): Promise<void>
}
