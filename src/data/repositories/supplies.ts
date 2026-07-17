import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { cents, type Cents } from '@/lib/money'
import { isOfflineEnabled } from '../offline/flag'
import { isNetworkError } from '../offline/network'
import { enqueue } from '../offline/queue'
import { currentUserId } from './auth'
import type { Supply, SupplyMovement, SupplyMovementType } from '../types'

function toSupply(row: {
  id: string
  name: string
  description: string | null
  unit: string
  stock: number
  min_stock: number
  cost_cents: number | null
  active: boolean
}): Supply {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    unit: row.unit,
    stock: row.stock,
    minStock: row.min_stock,
    cost: row.cost_cents === null ? null : cents(row.cost_cents),
    active: row.active,
    low: row.stock <= row.min_stock,
  }
}

const SUPPLY_COLUMNS = 'id, name, description, unit, stock, min_stock, cost_cents, active'

/** Todo el inventario, activo e inactivo: la pantalla filtra en pantalla. */
export async function listSupplies(): Promise<Supply[]> {
  const rows = unwrap(await supabase.from('supplies').select(SUPPLY_COLUMNS).order('name'))
  return rows.map(toSupply)
}

/**
 * Alta de insumo. A propósito NO pasa por la cola offline: `name` tiene un
 * `unique` real en la base, y solo admin la usa desde el mostrador de gestión,
 * no en la operación diaria — el riesgo de una alta duplicada al reconciliar
 * dos altas offline del "mismo" insumo con nombres parecidos no vale la pena
 * frente a simplemente pedir señal. Ver plan de Inventario, sección "Offline".
 */
export async function createSupply(input: {
  name: string
  description?: string | null
  unit: string
  minStock: number
  cost: Cents | null
}): Promise<Supply> {
  try {
    const row = unwrap(
      await supabase
        .from('supplies')
        .insert({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          unit: input.unit.trim(),
          min_stock: input.minStock,
          cost_cents: input.cost,
        })
        .select(SUPPLY_COLUMNS)
        .single(),
    )
    return toSupply(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo crear el insumo: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

/** Edita datos maestros. El `stock` no es un campo editable aquí — ver `recordSupplyMovement`. */
export async function updateSupply(
  id: string,
  input: {
    name: string
    description?: string | null
    unit: string
    minStock: number
    cost: Cents | null
    active: boolean
  },
): Promise<Supply> {
  try {
    const row = unwrap(
      await supabase
        .from('supplies')
        .update({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          unit: input.unit.trim(),
          min_stock: input.minStock,
          cost_cents: input.cost,
          active: input.active,
        })
        .eq('id', id)
        .select(SUPPLY_COLUMNS)
        .single(),
    )
    return toSupply(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar el insumo: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

/**
 * Aplica un movimiento contra Supabase. El stock NO se escribe aquí: lo mueve
 * el trigger `apply_supply_movement` a partir del tipo, y rechaza la
 * operación entera si dejaría el stock negativo (ver 0015) — ese rechazo
 * llega como un `DataError` de negocio normal, nunca como fallo de red.
 */
export async function applyRecordSupplyMovement(payload: {
  id: string
  supply_id: string
  type: SupplyMovementType
  quantity: number
  order_id: string | null
  note: string | null
  reference: string | null
  created_by: string | null
}): Promise<void> {
  unwrap(await supabase.from('supply_movements').insert(payload).select('id').single())
}

/**
 * Registra un movimiento (entrada, salida o ajuste). Se encola offline igual
 * que `cash.addMovement`: es la operación del día a día, no puede depender de
 * señal. Si al reconectar el servidor lo rechaza por dejar el stock negativo,
 * `isNetworkError()` ya lo distingue de un fallo de red — cae en `failed`
 * dentro del panel de sincronización para que un admin lo resuelva a mano, en
 * vez de perderse o aplicarse solo con un resultado que nadie autorizó.
 */
export async function recordSupplyMovement(input: {
  supplyId: string
  type: SupplyMovementType
  /** Siempre positivo. El signo lo decide `type`. */
  quantity: number
  orderId?: string | null
  note?: string
  reference?: string
}): Promise<void> {
  const payload = {
    id: crypto.randomUUID(),
    supply_id: input.supplyId,
    type: input.type,
    quantity: input.quantity,
    order_id: input.orderId ?? null,
    note: input.note?.trim() || null,
    reference: input.reference?.trim() || null,
    created_by: await currentUserId(),
  }

  try {
    await applyRecordSupplyMovement(payload)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    await enqueue({
      type: 'supplies.recordMovement',
      entityId: payload.id,
      payload: payload as unknown as Record<string, unknown>,
    })
  }
}

export async function listSupplyMovements(supplyId: string, limit = 50): Promise<SupplyMovement[]> {
  const rows = unwrap(
    await supabase
      .from('supply_movements')
      .select(
        'id, supply_id, type, quantity, order_id, note, reference, stock_before, stock_after, created_by, created_at, profiles(full_name)',
      )
      .eq('supply_id', supplyId)
      .order('created_at', { ascending: false })
      .limit(limit),
  )

  return rows.map((row) => ({
    id: row.id,
    supplyId: row.supply_id,
    type: row.type,
    quantity: row.quantity,
    orderId: row.order_id,
    note: row.note,
    reference: row.reference,
    stockBefore: row.stock_before,
    stockAfter: row.stock_after,
    createdBy: row.created_by,
    createdByName: row.profiles?.full_name ?? null,
    createdAt: row.created_at,
  }))
}
