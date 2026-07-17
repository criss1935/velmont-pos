import { renderTicketHtml } from './renderHtml'
import type { Printer, TicketDocument } from './types'

/**
 * Vista previa + diálogo de impresión del navegador.
 *
 * Es el driver que permite operar HOY, sin saber todavía qué impresora comprará
 * el cliente. Sobre Android, el diálogo de impresión ya sabe hablar con cualquier
 * impresora instalada en el sistema (incluidas térmicas por USB o Bluetooth con
 * su driver puesto), así que no es un apaño: es una ruta de impresión legítima.
 *
 * Se usa un iframe oculto y no window.open porque los bloqueadores de ventanas
 * emergentes matan el popup — y perder un ticket porque el navegador decidió que
 * era publicidad no es aceptable en un mostrador.
 */
class PreviewPrinter implements Printer {
  readonly id = 'preview'
  readonly name = 'Vista previa / impresora del sistema'

  isAvailable(): boolean {
    return typeof window !== 'undefined'
  }

  print(document_: TicketDocument): Promise<void> {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'

      // Se limpia siempre, haya salido bien o mal: un iframe huérfano por ticket
      // acabaría comiéndose la memoria de la tablet a lo largo del día.
      const cleanup = () => {
        window.setTimeout(() => frame.remove(), 1000)
      }

      frame.onload = () => {
        try {
          const view = frame.contentWindow
          if (!view) throw new Error('No se pudo preparar el ticket para impresión.')

          view.focus()
          view.print()
          cleanup()
          resolve()
        } catch (cause) {
          cleanup()
          reject(cause instanceof Error ? cause : new Error('Falló la impresión.'))
        }
      }

      document.body.appendChild(frame)

      const doc = frame.contentDocument
      if (!doc) {
        frame.remove()
        reject(new Error('No se pudo preparar el ticket para impresión.'))
        return
      }

      doc.open()
      doc.write(renderTicketHtml(document_))
      doc.close()
    })
  }
}

/**
 * Registro de impresoras.
 *
 * Cuando se defina el modelo, el driver nuevo (RawBT, ESC/POS por Bluetooth o
 * red) se registra aquí y `getPrinter()` empieza a devolverlo. Ninguna pantalla
 * cambia: todas piden `getPrinter()` y llaman a `print()`.
 */
const printers: Printer[] = [new PreviewPrinter()]

export function getPrinter(): Printer {
  const available = printers.find((printer) => printer.isAvailable())
  if (!available) {
    throw new Error('No hay ninguna impresora disponible en este dispositivo.')
  }
  return available
}

export function listPrinters(): Printer[] {
  return printers.filter((printer) => printer.isAvailable())
}

/**
 * Imprime, y si algo falla no tumba la operación.
 *
 * Que la impresora esté sin papel NO puede impedir que la venta quede
 * registrada: el dinero ya se cobró. Se devuelve el error para que la pantalla
 * lo enseñe y ofrezca reimprimir, pero la orden y el pago ya están guardados.
 */
export async function tryPrint(document_: TicketDocument): Promise<Error | null> {
  try {
    await getPrinter().print(document_)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause : new Error('No se pudo imprimir.')
  }
}
