import { supabase } from '../client'
import { unwrap } from '../errors'
import type { AuditAction, AuditEntry } from '../types'

export const AUDIT_PAGE_SIZE = 50

/**
 * Bitácora de movimientos (solo admin — RLS). Paginada por cursor sobre `id`
 * (monótono creciente = orden de inserción), más estable que offset cuando
 * entran movimientos nuevos mientras alguien revisa la lista.
 *
 * Online-only a propósito: es una consulta de revisión, no de operación, y una
 * copia vieja de una bitácora es justo lo que NO se quiere mostrar.
 */
export async function listAuditLog(filter: {
  beforeId?: number | null
  tableName?: string | null
  actorId?: string | null
  folio?: string | null
  limit?: number
}): Promise<AuditEntry[]> {
  let query = supabase
    .from('audit_log')
    .select(
      'id, occurred_at, actor_id, actor_name, action, table_name, record_id, order_id, order_folio, old_data, new_data, changed_fields',
    )
    .order('id', { ascending: false })
    .limit(filter.limit ?? AUDIT_PAGE_SIZE)

  if (filter.beforeId) query = query.lt('id', filter.beforeId)
  if (filter.tableName) query = query.eq('table_name', filter.tableName)
  if (filter.actorId) query = query.eq('actor_id', filter.actorId)

  const folio = filter.folio?.trim()
  if (folio) query = query.ilike('order_folio', `%${folio.replace(/[%_]/g, '')}%`)

  const rows = unwrap(await query)

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action as AuditAction,
    tableName: row.table_name,
    recordId: row.record_id,
    orderId: row.order_id,
    orderFolio: row.order_folio,
    oldData: (row.old_data as Record<string, unknown> | null) ?? null,
    newData: (row.new_data as Record<string, unknown> | null) ?? null,
    changedFields: row.changed_fields ?? [],
  }))
}

/** Empleados que aparecen en la bitácora, para el filtro por usuario. */
export async function listAuditActors(): Promise<{ id: string; name: string }[]> {
  const rows = unwrap(await supabase.from('profiles').select('id, full_name').order('full_name'))
  return rows.map((row) => ({ id: row.id, name: row.full_name }))
}

/**
 * Registra inicio/cierre de sesión. Best-effort: si falla (sin red), no debe
 * impedir entrar ni salir de la app.
 */
export async function logSessionEvent(action: 'login' | 'logout'): Promise<void> {
  try {
    await supabase.rpc('log_audit_event', { p_action: action })
  } catch {
    // ignorado a propósito
  }
}
