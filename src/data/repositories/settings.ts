import { supabase } from '../client'
import { DataError, unwrap } from '../errors'
import { cents, type Cents } from '@/lib/money'
import { readThrough } from '../offline/cache'
import { isNetworkError } from '../offline/network'
import type { BusinessSettings, ConditionOption, ItemType } from '../types'

/**
 * Configuración del negocio (fila única). El umbral de alto valor y el texto de
 * la responsiva viven en la base, no hardcodeados: el admin los cambia sin tocar
 * código.
 */
const BUSINESS_SETTINGS_COLUMNS = 'high_value_threshold_cents, reception_terms, name, phone, address, logo_url'

function toBusinessSettings(row: {
  high_value_threshold_cents: number
  reception_terms: string
  name: string
  phone: string
  address: string
  logo_url: string | null
}): BusinessSettings {
  return {
    highValueThreshold: cents(row.high_value_threshold_cents),
    receptionTerms: row.reception_terms,
    name: row.name,
    phone: row.phone,
    address: row.address,
    logoUrl: row.logo_url,
  }
}

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const { value } = await readThrough('settings:business', async () => {
    const row = unwrap(
      await supabase.from('business_settings').select(BUSINESS_SETTINGS_COLUMNS).eq('id', 1).retry(false).single(),
    )
    return toBusinessSettings(row)
  })

  return value
}

/**
 * Edita la configuración del negocio — fila única, online-only (mismo
 * criterio que Inventario/Catálogo: admin, baja frecuencia). El cache de
 * `getBusinessSettings` se refresca solo en la próxima lectura online
 * exitosa (`readThrough` siempre intenta red primero), no hace falta
 * invalidarlo a mano aquí.
 */
export async function updateBusinessSettings(input: {
  highValueThreshold: Cents
  receptionTerms: string
  name: string
  phone: string
  address: string
}): Promise<BusinessSettings> {
  try {
    const row = unwrap(
      await supabase
        .from('business_settings')
        .update({
          high_value_threshold_cents: input.highValueThreshold,
          reception_terms: input.receptionTerms.trim(),
          name: input.name.trim(),
          phone: input.phone.trim(),
          address: input.address.trim(),
        })
        .eq('id', 1)
        .select(BUSINESS_SETTINGS_COLUMNS)
        .single(),
    )
    return toBusinessSettings(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar la configuración: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

const ITEM_TYPE_COLUMNS = 'id, name, has_diagram, active, sort_order'

function toItemType(row: {
  id: string
  name: string
  has_diagram: boolean
  active: boolean
  sort_order: number
}): ItemType {
  return {
    id: row.id,
    name: row.name,
    hasDiagram: row.has_diagram,
    active: row.active,
    sortOrder: row.sort_order,
  }
}

/** Tipos de artículo activos (Tenis, Bolsa, Gorra…), en orden de captura. */
export async function listItemTypes(): Promise<ItemType[]> {
  const { value } = await readThrough('settings:item-types', async () => {
    const rows = unwrap(
      await supabase.from('item_types').select(ITEM_TYPE_COLUMNS).eq('active', true).order('sort_order').retry(false),
    )
    return rows.map(toItemType)
  })

  return value
}

/** Activos e inactivos, para la pantalla de administración — sin caché, siempre vivo. */
export async function listAllItemTypes(): Promise<ItemType[]> {
  const rows = unwrap(await supabase.from('item_types').select(ITEM_TYPE_COLUMNS).order('sort_order'))
  return rows.map(toItemType)
}

/**
 * Alta/edición — online-only, mismo criterio que Inventario/Catálogo: solo
 * admin, baja frecuencia. `item_type` en `order_articles` guarda el NOMBRE
 * como texto congelado (ver plan de catálogos de recepción) — renombrar o
 * desactivar un tipo aquí nunca cambia una recepción ya guardada.
 */
export async function createItemType(input: {
  name: string
  hasDiagram: boolean
  sortOrder?: number
}): Promise<ItemType> {
  try {
    const row = unwrap(
      await supabase
        .from('item_types')
        .insert({ name: input.name.trim(), has_diagram: input.hasDiagram, sort_order: input.sortOrder ?? 0 })
        .select(ITEM_TYPE_COLUMNS)
        .single(),
    )
    return toItemType(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo crear el tipo de artículo: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

export async function updateItemType(
  id: string,
  input: { name: string; hasDiagram: boolean; active: boolean; sortOrder?: number },
): Promise<ItemType> {
  try {
    const row = unwrap(
      await supabase
        .from('item_types')
        .update({
          name: input.name.trim(),
          has_diagram: input.hasDiagram,
          active: input.active,
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        })
        .eq('id', id)
        .select(ITEM_TYPE_COLUMNS)
        .single(),
    )
    return toItemType(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar el tipo de artículo: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

/**
 * Solo permite borrar un tipo que NUNCA se usó. La comprobación es por texto
 * (`order_articles.item_type`), no por FK — ahí es donde vive el snapshot.
 * Si ya se usó, hay que desactivarlo en vez de borrarlo.
 */
export async function deleteItemType(id: string, name: string): Promise<void> {
  try {
    const { count } = await supabase
      .from('order_articles')
      .select('id', { head: true, count: 'exact' })
      .eq('item_type', name)

    if ((count ?? 0) > 0) {
      throw new DataError('No se puede borrar: ya se usó en al menos una recepción. Desactívalo en su lugar.')
    }

    unwrap(await supabase.from('item_types').delete().eq('id', id).select('id').single())
  } catch (cause) {
    if (cause instanceof DataError) throw cause
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo borrar el tipo de artículo: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

const CONDITION_OPTION_COLUMNS = 'id, label, active, sort_order'

function toConditionOption(row: { id: string; label: string; active: boolean; sort_order: number }): ConditionOption {
  return {
    id: row.id,
    label: row.label,
    active: row.active,
    sortOrder: row.sort_order,
  }
}

/** Condiciones ofrecidas como chips al recibir ("Rayones", "Manchas"…). */
export async function listConditionOptions(): Promise<ConditionOption[]> {
  const { value } = await readThrough('settings:condition-options', async () => {
    const rows = unwrap(
      await supabase
        .from('condition_options')
        .select(CONDITION_OPTION_COLUMNS)
        .eq('active', true)
        .order('sort_order')
        .retry(false),
    )
    return rows.map(toConditionOption)
  })

  return value
}

/** Activas e inactivas, para la pantalla de administración — sin caché, siempre vivo. */
export async function listAllConditionOptions(): Promise<ConditionOption[]> {
  const rows = unwrap(await supabase.from('condition_options').select(CONDITION_OPTION_COLUMNS).order('sort_order'))
  return rows.map(toConditionOption)
}

export async function createConditionOption(input: { label: string; sortOrder?: number }): Promise<ConditionOption> {
  try {
    const row = unwrap(
      await supabase
        .from('condition_options')
        .insert({ label: input.label.trim(), sort_order: input.sortOrder ?? 0 })
        .select(CONDITION_OPTION_COLUMNS)
        .single(),
    )
    return toConditionOption(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo crear la condición: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

export async function updateConditionOption(
  id: string,
  input: { label: string; active: boolean; sortOrder?: number },
): Promise<ConditionOption> {
  try {
    const row = unwrap(
      await supabase
        .from('condition_options')
        .update({
          label: input.label.trim(),
          active: input.active,
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        })
        .eq('id', id)
        .select(CONDITION_OPTION_COLUMNS)
        .single(),
    )
    return toConditionOption(row)
  } catch (cause) {
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo guardar la condición: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}

/**
 * Solo permite borrar una condición que NUNCA se usó. La comprobación es por
 * texto (`condition_tags` contiene la etiqueta), no por FK. Si ya se usó,
 * hay que desactivarla en vez de borrarla.
 */
export async function deleteConditionOption(id: string, label: string): Promise<void> {
  try {
    const { count } = await supabase
      .from('order_articles')
      .select('id', { head: true, count: 'exact' })
      .contains('condition_tags', [label])

    if ((count ?? 0) > 0) {
      throw new DataError('No se puede borrar: ya se usó en al menos una recepción. Desactívala en su lugar.')
    }

    unwrap(await supabase.from('condition_options').delete().eq('id', id).select('id').single())
  } catch (cause) {
    if (cause instanceof DataError) throw cause
    if (isNetworkError(cause)) {
      throw new DataError('No se pudo borrar la condición: sin conexión. Intenta de nuevo con señal.')
    }
    throw cause
  }
}
