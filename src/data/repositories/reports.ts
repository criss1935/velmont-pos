import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { addCents, cents, type Cents } from '@/lib/money'
import { isNetworkError } from '../offline/network'
import type { OrderStatus, PaymentMethod } from '../types'

export interface SalesReport {
  /** Cobrado de verdad en el período (pagos, no órdenes creadas). */
  revenue: Cents
  paymentCount: number
  byMethod: Array<{ method: PaymentMethod; total: Cents; count: number }>
  byService: Array<{ serviceName: string; total: Cents; quantity: number }>
  ordersByStatus: Array<{ status: OrderStatus; count: number }>
  ordersReceived: number
}

/**
 * Reporte de un período.
 *
 * El ingreso se mide sobre PAGOS, no sobre órdenes. Una orden creada hoy que se
 * cobra la semana que viene es ingreso de la semana que viene: si se contara al
 * crearla, el reporte diría que entró dinero que todavía no está en la caja.
 */
export async function getSalesReport(from: Date, to: Date): Promise<SalesReport> {
  try {
    return await fetchSalesReport(from, to)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('Reportes requiere conexión. Vuelve a intentarlo cuando haya señal.')
    }
    throw cause
  }
}

async function fetchSalesReport(from: Date, to: Date): Promise<SalesReport> {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  // `.retry(false)`: sin red, que falle a la primera — Reportes no tiene
  // caché (a propósito, ver getSalesReport arriba), así que no hay nada que
  // ganar esperando los reintentos internos de postgrest-js.
  const [payments, items, orders] = await Promise.all([
    supabase
      .from('payments')
      .select('method, amount_cents')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .retry(false),

    // Las líneas se atribuyen al período en que se RECIBIÓ la orden: es lo que
    // dice qué servicios se están vendiendo, independientemente de cuándo pagaron.
    supabase
      .from('order_items')
      .select('service_name, quantity, line_total_cents, orders!inner(received_at, status)')
      .gte('orders.received_at', fromIso)
      .lte('orders.received_at', toIso)
      .neq('orders.status', 'cancelado')
      .retry(false),

    supabase
      .from('orders')
      .select('status')
      .gte('received_at', fromIso)
      .lte('received_at', toIso)
      .retry(false),
  ])

  const paymentRows = unwrap(payments)
  const itemRows = unwrap(items)
  const orderRows = unwrap(orders)

  const revenue = addCents(...paymentRows.map((row) => cents(row.amount_cents)))

  const methodMap = new Map<PaymentMethod, { total: Cents; count: number }>()
  for (const row of paymentRows) {
    const current = methodMap.get(row.method) ?? { total: cents(0), count: 0 }
    methodMap.set(row.method, {
      total: addCents(current.total, cents(row.amount_cents)),
      count: current.count + 1,
    })
  }

  const serviceMap = new Map<string, { total: Cents; quantity: number }>()
  for (const row of itemRows) {
    const current = serviceMap.get(row.service_name) ?? { total: cents(0), quantity: 0 }
    serviceMap.set(row.service_name, {
      total: addCents(current.total, cents(row.line_total_cents ?? 0)),
      quantity: current.quantity + row.quantity,
    })
  }

  const statusMap = new Map<OrderStatus, number>()
  for (const row of orderRows) {
    statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + 1)
  }

  return {
    revenue,
    paymentCount: paymentRows.length,

    byMethod: [...methodMap.entries()]
      .map(([method, value]) => ({ method, ...value }))
      .sort((a, b) => b.total - a.total),

    byService: [...serviceMap.entries()]
      .map(([serviceName, value]) => ({ serviceName, ...value }))
      .sort((a, b) => b.total - a.total),

    ordersByStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),

    ordersReceived: orderRows.length,
  }
}
