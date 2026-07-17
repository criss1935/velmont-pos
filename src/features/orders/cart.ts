import { create } from 'zustand'
import { addCents, cents, multiplyCents, subtractCents, type Cents } from '@/lib/money'
import type { CartLine, Customer, Service } from '@/data'

interface CartState {
  customer: Customer | null
  lines: CartLine[]
  discount: Cents
  notes: string

  setCustomer: (customer: Customer | null) => void
  addService: (service: Service) => void
  updateLine: (key: string, patch: Partial<Omit<CartLine, 'key'>>) => void
  removeLine: (key: string) => void
  setDiscount: (discount: Cents) => void
  setNotes: (notes: string) => void
  clear: () => void
}

let counter = 0
function nextKey(): string {
  counter += 1
  return `line-${counter}`
}

export const useCart = create<CartState>((set) => ({
  customer: null,
  lines: [],
  discount: cents(0),
  notes: '',

  setCustomer: (customer) => set({ customer }),

  /**
   * Cada toque en el catálogo agrega una línea NUEVA, no incrementa la cantidad
   * de una existente.
   *
   * Es deliberado y va contra el instinto de "carrito de e-commerce": aquí cada
   * línea es un PAR concreto, con su propia descripción y su propio estado de
   * llegada ("los blancos traen una mancha", "los negros traen la agujeta rota").
   * Agruparlos en `cantidad: 2` haría imposible anotar eso, que es justamente lo
   * que protege al negocio en una disputa.
   */
  addService: (service) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          key: nextKey(),
          serviceId: service.id,
          serviceName: service.name,
          unitPrice: service.price,
          quantity: 1,
          itemLabel: '',
          itemNotes: '',
          estimatedDays: service.estimatedDays,
        },
      ],
    })),

  updateLine: (key, patch) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    })),

  removeLine: (key) =>
    set((state) => {
      const lines = state.lines.filter((line) => line.key !== key)
      // Si al quitar líneas el descuento ya no cabe en el subtotal, se recorta.
      // La base tiene un check que lo rechazaría, y descubrirlo al confirmar la
      // orden, con el cliente enfrente, sería la peor forma de enterarse.
      const subtotal = subtotalOf(lines)
      return { lines, discount: state.discount > subtotal ? subtotal : state.discount }
    }),

  setDiscount: (discount) => set({ discount }),
  setNotes: (notes) => set({ notes }),

  clear: () => set({ customer: null, lines: [], discount: cents(0), notes: '' }),
}))

export function subtotalOf(lines: CartLine[]): Cents {
  return addCents(...lines.map((line) => multiplyCents(line.unitPrice, line.quantity)))
}

export function totalOf(lines: CartLine[], discount: Cents): Cents {
  const subtotal = subtotalOf(lines)
  return subtractCents(subtotal, discount > subtotal ? subtotal : discount)
}

/**
 * Días de entrega de la orden = el servicio más lento que lleve.
 * El cliente se lleva TODO junto, así que la promesa la marca el par que más tarda.
 */
export function estimatedDaysOf(lines: CartLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.estimatedDays), 0)
}
