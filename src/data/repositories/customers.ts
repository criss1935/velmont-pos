import { supabase } from '../client'
import { unwrap, unwrapMaybe } from '../errors'
import { readThrough } from '../offline/cache'
import { offlineDb } from '../offline/db'
import { isOfflineEnabled } from '../offline/flag'
import { insertIdempotent } from '../offline/idempotent'
import { isNetworkError } from '../offline/network'
import { enqueue } from '../offline/queue'
import type { Customer } from '../types'

const COLUMNS = 'id, full_name, phone, email, notes, created_at'

type Row = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string
}

/** Forma "wire" de una alta de cliente — es lo que viaja en la cola offline. */
export interface CustomerDraft {
  id: string
  fullName: string
  phone: string | null
  email: string | null
  notes: string | null
}

function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

const RECENT_KEY = 'customers:recent'
const RECENT_LIMIT = 300

/**
 * Copia acotada de los últimos clientes vistos o creados — el fallback de
 * `searchCustomers` cuando no hay red y el término buscado no tiene una
 * respuesta cacheada exacta. Se actualiza en cada búsqueda/alta/lectura
 * exitosa; nunca se consulta directo por su cuenta.
 */
async function rememberRecent(found: Customer[]): Promise<void> {
  if (!isOfflineEnabled() || found.length === 0) return

  const existing = ((await offlineDb.cache.get(RECENT_KEY))?.value as Customer[] | undefined) ?? []
  const byId = new Map(existing.map((customer) => [customer.id, customer]))
  for (const customer of found) byId.set(customer.id, customer)

  await offlineDb.cache.put({
    key: RECENT_KEY,
    value: [...byId.values()].slice(0, RECENT_LIMIT),
    fetchedAt: new Date().toISOString(),
  })
}

/**
 * Búsqueda de mostrador: el operador teclea un nombre o un teléfono en el mismo
 * campo, sin decidir cuál es. Se busca en los dos a la vez.
 *
 * Sin red: si este término exacto ya se buscó antes, se sirve esa respuesta.
 * Si no, se degrada a filtrar en memoria la copia de "clientes recientes" —
 * peor que una búsqueda real, pero mejor que dejar al operador sin nada.
 */
export async function searchCustomers(query: string, limit = 20): Promise<Customer[]> {
  const term = query.trim()
  if (term === '') return []

  // `,` dentro de or() separa condiciones; un término con coma rompería el
  // filtro de PostgREST, así que se elimina.
  const safe = term.replace(/[,()]/g, ' ')
  const key = `customers:search:${term.toLowerCase()}:${limit}`

  try {
    const rows = unwrap(
      await supabase
        .from('customers')
        .select(COLUMNS)
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('full_name')
        .limit(limit)
        .retry(false),
    )
    const customers = rows.map(toCustomer)

    if (isOfflineEnabled()) {
      await offlineDb.cache.put({ key, value: customers, fetchedAt: new Date().toISOString() })
      await rememberRecent(customers)
    }

    return customers
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    const cached = await offlineDb.cache.get(key)
    if (cached) return cached.value as Customer[]

    const recent = ((await offlineDb.cache.get(RECENT_KEY))?.value as Customer[] | undefined) ?? []
    const needle = term.toLowerCase()
    return recent
      .filter((customer) => customer.fullName.toLowerCase().includes(needle) || (customer.phone ?? '').includes(term))
      .slice(0, limit)
  }
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { value } = await readThrough(`customers:byId:${id}`, async () => {
    const row = unwrapMaybe(await supabase.from('customers').select(COLUMNS).eq('id', id).retry(false).maybeSingle())
    return row ? toCustomer(row) : null
  })

  if (value) await rememberRecent([value])

  return value
}

export interface NewCustomer {
  fullName: string
  phone?: string | undefined
  email?: string | undefined
  notes?: string | undefined
}

/**
 * Aplica el alta contra Supabase. Es la MISMA función que usa la ruta feliz
 * (abajo) y el motor de sync al drenar la cola — no hay dos implementaciones
 * de "cómo se manda esto" que puedan divergir. Idempotente: un reintento con
 * el mismo `id` (la respuesta del primer intento nunca llegó, pero el insert sí
 * se comprometió del lado del servidor) devuelve la fila ya existente en vez
 * de fallar o duplicar.
 */
export async function applyCreateCustomer(draft: CustomerDraft): Promise<Customer> {
  const row = await insertIdempotent<Row>(
    () =>
      supabase
        .from('customers')
        .insert({
          id: draft.id,
          full_name: draft.fullName,
          // Cadena vacía → null. Si no, el índice único de teléfono trataría
          // cada "" como un valor real y el segundo cliente sin teléfono chocaría.
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        })
        .select(COLUMNS)
        .single(),
    () => supabase.from('customers').select(COLUMNS).eq('id', draft.id).single(),
  )

  return toCustomer(row)
}

export async function createCustomer(input: NewCustomer): Promise<Customer> {
  const draft: CustomerDraft = {
    id: crypto.randomUUID(),
    fullName: input.fullName.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
  }

  try {
    const customer = await applyCreateCustomer(draft)
    await rememberRecent([customer])
    return customer
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    // Sin red: se encola y se devuelve un eco optimista — la pantalla sigue su
    // flujo (seleccionar el cliente recién creado) igual que si hubiera red.
    await enqueue({
      type: 'customers.create',
      entityId: draft.id,
      payload: draft as unknown as Record<string, unknown>,
    })
    const optimistic: Customer = { ...draft, createdAt: new Date().toISOString() }
    await rememberRecent([optimistic])
    return optimistic
  }
}

export async function updateCustomer(id: string, input: NewCustomer): Promise<Customer> {
  const row = unwrap(
    await supabase
      .from('customers')
      .update({
        full_name: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .eq('id', id)
      .select(COLUMNS)
      .single(),
  )

  return toCustomer(row)
}
