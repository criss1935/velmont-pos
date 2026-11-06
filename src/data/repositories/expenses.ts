import { supabase } from '../client'
import { DataError, unwrap, unwrapMaybe } from '../errors'
import { isNetworkError } from '../offline/network'
import { cents } from '@/lib/money'
import type {
  BusinessExpense,
  BusinessExpenseCategory,
  BusinessExpenseInput,
  BusinessExpenseSummary,
} from '../types'

/**
 * GASTOS HISTÓRICOS — inversión y gastos de arranque/operación del local.
 * Ver `supabase/migrations/20260124000000_business_expenses.sql`.
 *
 * Solo admin (RLS). Online-only: es consulta del dueño, no ruta del mostrador.
 * Los totales salen de las vistas, no se suman aquí (regla 3).
 */

const COLUMNS =
  'id, kind, category, concept, amount_cents, amount_pending, expense_date, valid_until, paid_to, notes'

function offlineGuard(cause: unknown): never {
  if (isNetworkError(cause)) {
    throw new DataError('Los gastos históricos necesitan conexión a internet.')
  }
  throw cause
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function toRow(input: BusinessExpenseInput) {
  if (input.concept.trim() === '') throw new DataError('Escribe el concepto del gasto.')
  if (input.amount < 0) throw new DataError('El monto no puede ser negativo.')

  return {
    kind: input.kind,
    category: input.category,
    concept: input.concept.trim(),
    amount_cents: input.amount,
    amount_pending: input.amountPending,
    expense_date: input.expenseDate || null,
    valid_until: input.validUntil || null,
    paid_to: clean(input.paidTo),
    notes: clean(input.notes),
  }
}

export async function list(): Promise<BusinessExpense[]> {
  try {
    const rows = unwrap(
      await supabase
        .from('business_expenses')
        .select(COLUMNS)
        .order('expense_date', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .retry(false),
    )

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      category: row.category as BusinessExpenseCategory,
      concept: row.concept,
      amount: cents(row.amount_cents),
      amountPending: row.amount_pending,
      expenseDate: row.expense_date,
      validUntil: row.valid_until,
      paidTo: row.paid_to,
      notes: row.notes,
    }))
  } catch (cause) {
    return offlineGuard(cause)
  }
}

export async function summary(): Promise<BusinessExpenseSummary> {
  try {
    const [totals, categories] = await Promise.all([
      supabase
        .from('business_expense_summary')
        .select('total_cents, inversion_cents, gasto_cents, pending_count')
        .retry(false)
        .maybeSingle(),
      supabase
        .from('business_expense_category_totals')
        .select('category, total_cents, items')
        .retry(false),
    ])

    const row = unwrapMaybe(totals)
    const byCategory: BusinessExpenseSummary['byCategory'] = {}
    for (const c of unwrap(categories)) {
      if (!c.category) continue
      byCategory[c.category as BusinessExpenseCategory] = {
        total: cents(c.total_cents ?? 0),
        items: c.items ?? 0,
      }
    }

    return {
      total: cents(row?.total_cents ?? 0),
      inversion: cents(row?.inversion_cents ?? 0),
      gasto: cents(row?.gasto_cents ?? 0),
      pendingCount: row?.pending_count ?? 0,
      byCategory,
    }
  } catch (cause) {
    return offlineGuard(cause)
  }
}

export async function create(input: BusinessExpenseInput): Promise<void> {
  const row = toRow(input)
  try {
    unwrap(await supabase.from('business_expenses').insert(row).select('id').single())
  } catch (cause) {
    return offlineGuard(cause)
  }
}

export async function update(id: string, input: BusinessExpenseInput): Promise<void> {
  const row = toRow(input)
  try {
    unwrap(await supabase.from('business_expenses').update(row).eq('id', id).select('id').single())
  } catch (cause) {
    return offlineGuard(cause)
  }
}

export async function remove(id: string): Promise<void> {
  try {
    const rows = unwrap(await supabase.from('business_expenses').delete().eq('id', id).select('id'))
    if (rows.length === 0) throw new DataError('No se pudo borrar el gasto.')
  } catch (cause) {
    return offlineGuard(cause)
  }
}
