import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { cents, type Cents } from '@/lib/money'
import { readThrough } from '../offline/cache'
import { isNetworkError } from '../offline/network'
import type { Service, ServiceCategory } from '../types'

const SERVICE_COLUMNS =
  'id, category_id, name, description, price_cents, estimated_days, active, sort_order, service_categories(name)'

function toService(row: {
  id: string
  category_id: string | null
  name: string
  description: string | null
  price_cents: number
  estimated_days: number
  active: boolean
  sort_order: number
  service_categories: { name: string } | null
}): Service {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.service_categories?.name ?? null,
    name: row.name,
    description: row.description,
    price: cents(row.price_cents),
    estimatedDays: row.estimated_days,
    active: row.active,
    sortOrder: row.sort_order,
  }
}

export async function listCategories(): Promise<ServiceCategory[]> {
  const { value } = await readThrough('catalog:categories', async () => {
    const rows = unwrap(
      await supabase.from('service_categories').select('id, name, sort_order').order('sort_order').retry(false),
    )

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
    }))
  })

  return value
}

/** Catálogo activo, en el orden en que debe pintarse en la rejilla de venta. */
export async function listServices(): Promise<Service[]> {
  const { value } = await readThrough('catalog:services', async () => {
    const rows = unwrap(
      await supabase.from('services').select(SERVICE_COLUMNS).eq('active', true).order('sort_order').retry(false),
    )

    return rows.map(toService)
  })

  return value
}

/**
 * Catálogo completo (activo e inactivo) para la pantalla de administración.
 * Sin caché: a diferencia de la rejilla de venta, aquí siempre hace falta el
 * dato vivo (precio y estatus reales al momento de editar).
 */
export async function listAllServices(): Promise<Service[]> {
  const rows = unwrap(await supabase.from('services').select(SERVICE_COLUMNS).order('sort_order'))
  return rows.map(toService)
}

/**
 * Alta/edición de catálogo — deliberadamente online-only, mismo criterio que
 * Inventario: solo admin, baja frecuencia, y una orden ya congela
 * `service_name`/`unit_price_cents` al venderse, así que nunca depende de
 * que el catálogo siga intacto para no romper historia.
 */
export async function createService(input: {
  categoryId: string | null
  name: string
  description?: string | null
  price: Cents
  estimatedDays: number
  sortOrder?: number
}): Promise<Service> {
  try {
    const row = unwrap(
      await supabase
        .from('services')
        .insert({
          category_id: input.categoryId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          price_cents: input.price,
          estimated_days: input.estimatedDays,
          sort_order: input.sortOrder ?? 0,
        })
        .select(SERVICE_COLUMNS)
        .single(),
    )
    return toService(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo crear el servicio: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

export async function updateService(
  id: string,
  input: {
    categoryId: string | null
    name: string
    description?: string | null
    price: Cents
    estimatedDays: number
    active: boolean
    sortOrder?: number
  },
): Promise<Service> {
  try {
    const row = unwrap(
      await supabase
        .from('services')
        .update({
          category_id: input.categoryId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          price_cents: input.price,
          estimated_days: input.estimatedDays,
          active: input.active,
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        })
        .eq('id', id)
        .select(SERVICE_COLUMNS)
        .single(),
    )
    return toService(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar el servicio: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

export async function createCategory(input: { name: string; sortOrder?: number }): Promise<ServiceCategory> {
  try {
    const row = unwrap(
      await supabase
        .from('service_categories')
        .insert({ name: input.name.trim(), sort_order: input.sortOrder ?? 0 })
        .select('id, name, sort_order')
        .single(),
    )
    return { id: row.id, name: row.name, sortOrder: row.sort_order }
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo crear la categoría: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

export async function updateCategory(
  id: string,
  input: { name: string; sortOrder?: number },
): Promise<ServiceCategory> {
  try {
    const row = unwrap(
      await supabase
        .from('service_categories')
        .update({
          name: input.name.trim(),
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        })
        .eq('id', id)
        .select('id, name, sort_order')
        .single(),
    )
    return { id: row.id, name: row.name, sortOrder: row.sort_order }
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar la categoría: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

/**
 * Sin servicios asociados solamente: `services.category_id` queda en null si
 * se borra la categoría (`on delete set null`), lo cual no rompe nada, pero
 * sí deja servicios huérfanos sin agrupar en la rejilla de venta — se
 * bloquea aquí en vez de dejar que el on delete set null lo resuelva solo.
 */
export async function deleteCategory(id: string): Promise<void> {
  try {
    const { count } = await supabase
      .from('services')
      .select('id', { head: true, count: 'exact' })
      .eq('category_id', id)

    if ((count ?? 0) > 0) {
      throw new DataError('No se puede borrar: hay servicios asignados a esta categoría.')
    }

    unwrap(await supabase.from('service_categories').delete().eq('id', id).select('id').single())
  } catch (cause) {
    if (cause instanceof DataError) throw cause
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo borrar la categoría: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}
