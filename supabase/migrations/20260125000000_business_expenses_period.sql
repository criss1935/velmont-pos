-- =============================================================================
-- Totales de gastos históricos por periodo
-- =============================================================================
--
-- La pestaña Gastos ahora filtra por fechas (7 días, mes, 3 meses, personalizado).
-- Los totales del periodo los calcula la base (regla 3), igual que las vistas
-- `business_expense_summary` / `business_expense_category_totals` lo hacen para
-- todo el histórico.
--
-- p_from / p_to en null = sin límite (todo el histórico, incluidos los registros
-- sin fecha). Con cualquier límite, los registros sin `expense_date` quedan fuera:
-- no pertenecen a ningún periodo.
--
-- `security invoker`: RLS de business_expenses (solo admin) aplica igual.
-- =============================================================================

create or replace function business_expense_period_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with rows as (
    select kind, category, amount_cents, amount_pending
      from business_expenses
     where (p_from is null and p_to is null)
        or (
          expense_date is not null
          and (p_from is null or expense_date >= p_from)
          and (p_to   is null or expense_date <= p_to)
        )
  ),
  cats as (
    select category, sum(amount_cents)::bigint as total, count(*)::integer as items
      from rows
     group by category
  )
  select jsonb_build_object(
    'total_cents',     coalesce((select sum(amount_cents) from rows), 0)::bigint,
    'inversion_cents', coalesce((select sum(amount_cents) from rows where kind = 'inversion'), 0)::bigint,
    'gasto_cents',     coalesce((select sum(amount_cents) from rows where kind = 'gasto'), 0)::bigint,
    'pending_count',   (select count(*) from rows where amount_pending)::integer,
    'items',           (select count(*) from rows)::integer,
    'by_category',     coalesce(
                         (select jsonb_object_agg(category, jsonb_build_object('total_cents', total, 'items', items)) from cats),
                         '{}'::jsonb
                       )
  );
$$;

revoke execute on function public.business_expense_period_summary(date, date) from public, anon;
grant execute on function public.business_expense_period_summary(date, date) to authenticated;
