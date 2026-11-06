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
  /** Cobrado por día (hora CDMX), con todos los días del periodo aunque sean 0. */
  byDay: Array<{ day: string; revenue: Cents; expenses: Cents }>
  /** Cobrado por hora del día (hora CDMX). */
  byHour: Array<{ hour: number; total: Cents }>
  /** Gastos del periodo: gastos históricos con fecha en el periodo + gastos de caja chica. */
  expenses: Cents
  expensesByCategory: Array<{ name: string; total: Cents }>
  /** Cada pago del periodo (para el detalle del Excel), del más reciente al más viejo. */
  payments: Array<{ at: string; folio: string; method: PaymentMethod; amount: Cents }>
}

const TZ = 'America/Mexico_City'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })

/** Fecha de operación en CDMX: "2026-11-05". */
const mxDay = (d: Date) => dayFmt.format(d)
const mxHour = (d: Date) => Number(hourFmt.format(d)) % 24

const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  equipo: 'Equipo y maquinaria',
  obra: 'Obra y acabados',
  instalaciones: 'Instalaciones',
  renta: 'Renta',
  servicios: 'Servicios',
  legal: 'Legal y permisos',
  sistema: 'Sistema',
  otros: 'Otros',
}

/** Todos los días entre dos fechas YYYY-MM-DD (tope 400 para no colgar la UI). */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cur <= end && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
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
  const fromDay = mxDay(from)
  const toDay = mxDay(to)

  const [payments, items, orders, businessExpenses, pettyExpenses] = await Promise.all([
    // Un pago de una orden cancelada no es ingreso: la orden no se hizo. Sin
    // este filtro, cancelar una orden ya cobrada (o una venta de prueba) dejaba
    // el dinero inflando "Cobrado" para siempre.
    supabase
      .from('payments')
      .select('method, amount_cents, created_at, orders!inner(status, folio)')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .neq('orders.status', 'cancelado')
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

    // Gastos históricos del local (solo admin por RLS; Reportes ya es solo admin).
    // Los que no tienen fecha no caen en ningún periodo: viven en la pestaña Gastos.
    supabase
      .from('business_expenses')
      .select('category, amount_cents, expense_date')
      .gte('expense_date', fromDay)
      .lte('expense_date', toDay)
      .retry(false),

    supabase
      .from('petty_cash_movements')
      .select('amount_cents, created_at')
      .eq('type', 'gasto')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .retry(false),
  ])

  const paymentRows = unwrap(payments)
  const itemRows = unwrap(items)
  const orderRows = unwrap(orders)
  const businessRows = unwrap(businessExpenses)
  const pettyRows = unwrap(pettyExpenses)

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

  const days = new Map(daysBetween(fromDay, toDay).map((d) => [d, { revenue: 0, expenses: 0 }]))
  const hours = new Map<number, number>()
  for (const row of paymentRows) {
    const at = new Date(row.created_at)
    const bucket = days.get(mxDay(at))
    if (bucket) bucket.revenue += row.amount_cents
    const h = mxHour(at)
    hours.set(h, (hours.get(h) ?? 0) + row.amount_cents)
  }

  const expenseCats = new Map<string, number>()
  for (const row of businessRows) {
    const name = EXPENSE_CATEGORY_LABEL[row.category] ?? row.category
    expenseCats.set(name, (expenseCats.get(name) ?? 0) + row.amount_cents)
    const bucket = row.expense_date ? days.get(row.expense_date) : undefined
    if (bucket) bucket.expenses += row.amount_cents
  }
  for (const row of pettyRows) {
    expenseCats.set('Caja chica', (expenseCats.get('Caja chica') ?? 0) + row.amount_cents)
    const bucket = days.get(mxDay(new Date(row.created_at)))
    if (bucket) bucket.expenses += row.amount_cents
  }
  const expenses = addCents(...[...expenseCats.values()].map((v) => cents(v)))

  return {
    revenue,
    expenses,
    byDay: [...days.entries()].map(([day, v]) => ({ day, revenue: cents(v.revenue), expenses: cents(v.expenses) })),
    byHour: [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, total]) => ({ hour, total: cents(total) })),
    payments: paymentRows
      .map((row) => ({ at: row.created_at, folio: row.orders.folio, method: row.method, amount: cents(row.amount_cents) }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    expensesByCategory: [...expenseCats.entries()]
      .map(([name, total]) => ({ name, total: cents(total) }))
      .sort((a, b) => b.total - a.total),
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
