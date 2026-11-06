-- =============================================================================
-- GASTOS HISTÓRICOS (inversión y gastos de arranque del local)
-- =============================================================================
--
-- Registro de lo que ha costado poner y sostener el local: equipo (inversión),
-- obra, instalaciones, renta, servicios, permisos, etc. No es caja ni caja
-- chica: no mueve dinero del cajón, es un histórico para que el dueño sepa
-- cuánto lleva metido en el negocio.
--
-- - `kind` separa INVERSIÓN (activo: máquinas) de GASTO.
-- - `amount_pending` marca importes provisionales ("monto por confirmar"):
--   cuentan en el total pero la pantalla los señala.
-- - `valid_until` es la vigencia de permisos, pólizas, licencias o extintores.
--
-- Solo admin: son números del dueño, no del mostrador.
-- Los totales los calcula la vista (regla 3).
-- =============================================================================

create type business_expense_kind as enum ('inversion', 'gasto');

create table business_expenses (
  id             uuid primary key default gen_random_uuid(),
  kind           business_expense_kind not null default 'gasto',
  category       text not null check (category in (
                   'equipo', 'obra', 'instalaciones', 'renta', 'servicios',
                   'legal', 'sistema', 'otros'
                 )),
  concept        text not null check (btrim(concept) <> ''),
  amount_cents   integer not null check (amount_cents >= 0),
  amount_pending boolean not null default false,
  expense_date   date,
  valid_until    date,
  paid_to        text,
  notes          text,

  created_by     uuid references profiles on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index business_expenses_category_idx on business_expenses (category, expense_date);

create trigger business_expenses_touch
  before update on business_expenses
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- Totales: una fila global y una por categoría.
-- -----------------------------------------------------------------------------

create view business_expense_summary
with (security_invoker = true)
as
select
  coalesce(sum(amount_cents), 0)::bigint                                     as total_cents,
  coalesce(sum(amount_cents) filter (where kind = 'inversion'), 0)::bigint    as inversion_cents,
  coalesce(sum(amount_cents) filter (where kind = 'gasto'), 0)::bigint        as gasto_cents,
  count(*) filter (where amount_pending)::integer                             as pending_count
from business_expenses;

create view business_expense_category_totals
with (security_invoker = true)
as
select
  category,
  sum(amount_cents)::bigint as total_cents,
  count(*)::integer         as items
from business_expenses
group by category;

-- -----------------------------------------------------------------------------
-- RLS: solo admin, lectura y escritura. Es un histórico editable (el dueño
-- corrige montos conforme confirma), y el trigger de auditoría guarda el antes
-- y el después de cada cambio.
-- -----------------------------------------------------------------------------

alter table business_expenses enable row level security;

create policy business_expenses_admin on business_expenses
  for all to authenticated using (is_admin()) with check (is_admin());

revoke all on business_expenses from anon;
revoke all on business_expense_summary from anon;
revoke all on business_expense_category_totals from anon;

create trigger business_expenses_audit
  after insert or update or delete on public.business_expenses
  for each row execute function public.audit_row_change();
