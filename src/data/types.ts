/**
 * Tipos de dominio.
 *
 * No son los tipos de la base: son los que usa la app. La diferencia importante
 * es que aquí los importes son `Cents` (tipo marcado), no `number` suelto. Los
 * repositorios traducen en la frontera, y a partir de ahí el compilador impide
 * sumar un precio con una cantidad o pasar pesos donde van centavos.
 */

import type { Cents } from '@/lib/money'
import type { Enums } from './database.types'

export type OrderStatus = Enums<'order_status'>
export type PaymentMethod = Enums<'payment_method'>
export type CashMovementType = Enums<'cash_movement_type'>
export type SupplyMovementType = Enums<'supply_movement_type'>

/** Orden en la que avanza el trabajo. `cancelado` vive fuera del flujo. */
export const ORDER_FLOW: readonly OrderStatus[] = [
  'recibido',
  'en_proceso',
  'listo',
  'entregado',
] as const

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  recibido: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

/**
 * Siguiente estado natural. Devuelve null si la orden ya terminó su recorrido
 * (entregada o cancelada): el tablero usa esto para saber si dibuja el botón de
 * avanzar o no.
 */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const index = ORDER_FLOW.indexOf(status)
  if (index === -1 || index === ORDER_FLOW.length - 1) return null
  return ORDER_FLOW[index + 1] ?? null
}

export interface Profile {
  id: string
  fullName: string
  role: 'operador' | 'admin'
  active: boolean
}

export interface Customer {
  id: string
  fullName: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
}

export interface ServiceCategory {
  id: string
  name: string
  sortOrder: number
}

export interface Service {
  id: string
  categoryId: string | null
  categoryName: string | null
  name: string
  description: string | null
  price: Cents
  estimatedDays: number
  active: boolean
  sortOrder: number
}

export interface OrderItem {
  id: string
  orderId: string
  /** Artículo al que pertenece el servicio (recepción multi-artículo). */
  articleId: string | null
  serviceId: string | null
  /** Nombre y precio congelados al recibir — no siguen al catálogo. */
  serviceName: string
  unitPrice: Cents
  quantity: number
  /** El par concreto: "Nike Air Force 1 blancos". */
  itemLabel: string | null
  /** Estado con el que llegó. Se imprime: es la defensa ante una disputa. */
  itemNotes: string | null
  photoUrls: string[]
  lineTotal: Cents
}

// -----------------------------------------------------------------------------
// Recepción — catálogos y configuración
// -----------------------------------------------------------------------------

export interface ItemType {
  id: string
  name: string
  /** Solo los tipos con silueta (Tenis) muestran el diagrama de observaciones. */
  hasDiagram: boolean
  active: boolean
  sortOrder: number
}

export interface ConditionOption {
  id: string
  label: string
  active: boolean
  sortOrder: number
}

export interface BusinessSettings {
  /** A partir de este valor declarado, un artículo dispara el aviso de alto valor. */
  highValueThreshold: Cents
  /** Texto de la responsiva que firma el cliente. */
  receptionTerms: string
}

/** Tipos de observación que se marcan sobre el diagrama del sneaker. */
export const DIAGRAM_MARK_TYPES = [
  'Rayón',
  'Mancha',
  'Desgaste',
  'Rotura',
  'Despegado',
  'Otro',
] as const
export type DiagramMarkType = (typeof DIAGRAM_MARK_TYPES)[number]

export interface DiagramMark {
  /** id de la base cuando ya está persistido; ausente mientras se captura. */
  id?: string
  /** Número visible del marcador (1, 2, 3…). */
  idx: number
  /** Coordenadas relativas al recuadro del diagrama, 0..1. */
  xRel: number
  yRel: number
  type: DiagramMarkType
  description: string | null
}

export interface ReceptionPhoto {
  id: string
  /** Ruta dentro del bucket `order-media`. */
  storagePath: string
  /** URL pública lista para <img>. */
  url: string
  /** Frontal, Lateral izquierdo, Suela, Detalle de daño… */
  classification: string | null
}

/** Un artículo recibido, con todo lo que se documentó de él. */
export interface Article {
  id: string
  orderId: string
  itemType: string
  brand: string | null
  model: string | null
  color: string | null
  declaredValue: Cents | null
  conditionTags: string[]
  conditionNotes: string | null
  sortOrder: number
  items: OrderItem[]
  photos: ReceptionPhoto[]
  diagramMarks: DiagramMark[]
}

export interface Order {
  id: string
  folio: string
  customerId: string | null
  customer: Customer | null
  status: OrderStatus
  receivedAt: string
  promisedAt: string | null
  deliveredAt: string | null
  subtotal: Cents
  discount: Cents
  total: Cents
  notes: string | null
  /** Todas las líneas de servicio, aplanadas (compatibilidad con vistas previas). */
  items: OrderItem[]
  /** Artículos recibidos, cada uno con sus servicios, fotos y diagrama. */
  articles: Article[]
  /** Ruta de la firma del cliente en Storage, si se capturó. */
  signaturePath: string | null
  /** URL pública de la firma, lista para <img>. */
  signatureUrl: string | null
  /** El cliente aceptó la responsiva al recibir. */
  responsivaAccepted: boolean
  /** Cuándo se aceptó, si se aceptó. */
  responsivaAcceptedAt: string | null
  /** Cobrado hasta ahora. Una orden puede llevar anticipo. */
  paid: Cents
  /** total - paid. Cero significa que ya no debe nada. */
  balance: Cents
}

/** Vista ligera para el tablero: sin líneas, para no traer media base. */
export interface OrderSummary {
  id: string
  folio: string
  customerName: string | null
  customerPhone: string | null
  status: OrderStatus
  receivedAt: string
  promisedAt: string | null
  total: Cents
  paid: Cents
  balance: Cents
  itemCount: number
}

export interface Payment {
  id: string
  orderId: string
  method: PaymentMethod
  amount: Cents
  tendered: Cents | null
  change: Cents | null
  reference: string | null
  createdAt: string
}

export interface CashSession {
  id: string
  openedAt: string
  openedBy: string | null
  opening: Cents
  closedAt: string | null
  closedBy: string | null
  counted: Cents | null
  /** Lo que la base calcula que debería haber en el cajón ahora mismo. */
  expected: Cents
  /** counted - expected. Negativo = falta dinero. */
  difference: Cents | null
  notes: string | null
  /** `expected` se recalculó localmente (hay movimientos/pagos sin sincronizar
   * de esta sesión, o no hay red): no es el valor autoritativo del servidor. */
  estimated?: boolean
  /** Hay mutaciones de ESTA sesión todavía en la cola offline — cerrar caja
   * calcularía un "esperado" incompleto, así que la UI debe bloquearlo. */
  hasPendingSync?: boolean
}

export interface CashMovement {
  id: string
  type: CashMovementType
  amount: Cents
  reason: string
  createdAt: string
}

export interface Supply {
  id: string
  name: string
  description: string | null
  unit: string
  stock: number
  minStock: number
  cost: Cents | null
  active: boolean
  /** Derivado: el inventario está por debajo del mínimo. */
  low: boolean
}

export interface SupplyMovement {
  id: string
  supplyId: string
  type: SupplyMovementType
  quantity: number
  orderId: string | null
  note: string | null
  reference: string | null
  stockBefore: number
  stockAfter: number
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

/** Una línea del carrito, antes de que exista la orden en la base. */
export interface CartLine {
  /** Id local, solo para React. No es el id de la base. */
  key: string
  serviceId: string
  serviceName: string
  unitPrice: Cents
  quantity: number
  itemLabel: string
  itemNotes: string
  estimatedDays: number
}
