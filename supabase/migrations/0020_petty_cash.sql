-- =============================================================================
-- CAJA CHICA (fondo fijo para gastos menores)
-- =============================================================================
--
-- Qué es y por qué es una tabla aparte
-- ------------------------------------
-- La "caja chica" es un fondo pequeño de efectivo, separado del cajón de la
-- venta, destinado a gastos menores e imprevistos del día (shampoo, cintas,
-- taxi, papelería). Se maneja como FONDO FIJO: se le asigna un monto, se gasta
-- contra comprobantes, y cada tanto se repone hasta volver al monto original.
--
-- No cabe dentro de `cash_movements` porque ese ledger vive colgado de UNA
-- sesión de caja (`cash_session_id not null`) y muere con el turno. La caja
-- chica es lo contrario: persiste entre turnos y entre días. Si se modelara
-- como movimientos de caja, al cerrar el turno el fondo desaparecería del
-- sistema aunque el dinero siga físicamente en el sobre.
--
-- Cómo se relacionan los dos botes
-- --------------------------------
--   FONDEO  el dinero sale del cajón y entra al sobre de caja chica.
--           Son DOS asientos y tienen que ocurrir juntos o no ocurrir: una
--           `salida` en cash_movements (para que el corte del turno cuadre) y
--           un `fondeo` aquí. De ahí la RPC `fund_petty_cash` — ver regla 3 de
--           CLAUDE.md: lo que debe ser atómico es una función, no dos inserts
--           desde el cliente.
--
--   GASTO   el dinero sale del sobre. NO toca el cajón (ya había salido al
--           fondear), así que es un solo asiento y un insert normal basta.
--
-- El saldo lo calcula la vista `petty_cash_balance`, no el cliente: dos tablets
-- no pueden discrepar porque ninguna suma por su cuenta.
-- =============================================================================

create type petty_cash_movement_type as enum ('fondeo', 'gasto');

create table petty_cash_movements (
  id              uuid primary key default gen_random_uuid(),
  type            petty_cash_movement_type not null,
  amount_cents    integer not null check (amount_cents > 0),
  reason          text not null,

  -- Solo en los fondeos: de qué turno salió el dinero. Sirve para auditar el
  -- corte ("esta salida de $500 fue para reponer la caja chica"). Un gasto lo
  -- deja en null porque el dinero ya no estaba en ningún cajón.
  cash_session_id uuid references cash_sessions on delete set null,

  created_by      uuid references profiles on delete set null,
  created_at      timestamptz not null default now(),

  constraint petty_cash_gasto_sin_sesion
    check (type = 'fondeo' or cash_session_id is null)
);

create index petty_cash_movements_created_idx on petty_cash_movements (created_at desc);

-- -----------------------------------------------------------------------------
-- Saldo del fondo
--
-- Una sola fila. Se consulta con `.maybeSingle()` y, si la tabla está vacía,
-- `coalesce` devuelve 0 en lugar de null: la pantalla nunca tiene que decidir
-- qué significa "sin saldo".
-- -----------------------------------------------------------------------------

create view petty_cash_balance
with (security_invoker = true)
as
select
  coalesce(sum(amount_cents) filter (where type = 'fondeo'), 0)::integer  as funded_cents,
  coalesce(sum(amount_cents) filter (where type = 'gasto'), 0)::integer   as spent_cents,
  (
    coalesce(sum(amount_cents) filter (where type = 'fondeo'), 0)
    - coalesce(sum(amount_cents) filter (where type = 'gasto'), 0)
  )::integer as balance_cents
from petty_cash_movements;

-- -----------------------------------------------------------------------------
-- RLS
--
-- Mismo criterio que `cash_movements`: el staff lee y agrega; nadie edita ni
-- borra. Un movimiento de caja chica es un hecho contable — si se registró de
-- más, se compensa con otro movimiento, no se corrige el original.
-- -----------------------------------------------------------------------------

alter table petty_cash_movements enable row level security;

create policy petty_cash_read on petty_cash_movements
  for select to authenticated using (is_staff());

create policy petty_cash_write on petty_cash_movements
  for insert to authenticated
  with check (
    is_staff()
    -- Un fondeo tiene que salir de una caja ABIERTA: es la contrapartida de una
    -- salida real del cajón. Un gasto no depende de ningún turno.
    and (
      type <> 'fondeo'
      or exists (
        select 1 from cash_sessions s
         where s.id = cash_session_id
           and s.closed_at is null
      )
    )
  );

-- -----------------------------------------------------------------------------
-- fund_petty_cash — pasar dinero del cajón al fondo, en una sola transacción.
--
-- `security invoker` (el default de plpgsql) a propósito: así los dos inserts
-- pasan por las políticas RLS de arriba en lugar de saltárselas. La atomicidad
-- es lo único que aporta la función; los permisos siguen siendo los de RLS.
--
-- Los ids los genera el cliente y llegan como parámetro, igual que en
-- `create_reception` (migración 0014): eso hace la llamada idempotente frente a
-- un reintento — si la primera pasó y la respuesta se perdió, la segunda no
-- duplica el dinero.
-- -----------------------------------------------------------------------------

create or replace function fund_petty_cash(
  p_movement_id      uuid,
  p_cash_movement_id uuid,
  p_session_id       uuid,
  p_amount           integer,
  p_reason           text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto para la caja chica debe ser mayor que cero.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribe para qué es el dinero de la caja chica.';
  end if;

  -- Asiento 1: sale del cajón del turno.
  insert into cash_movements (id, cash_session_id, type, amount_cents, reason, created_by)
  values (
    p_cash_movement_id, p_session_id, 'salida', p_amount,
    -- Prefijo explícito: quien lea el corte del turno tiene que poder ver de un
    -- vistazo que esa salida no fue un gasto, sino un traspaso al otro bote.
    'Caja chica — ' || btrim(p_reason),
    auth.uid()
  )
  on conflict (id) do nothing;

  -- Asiento 2: entra al fondo.
  insert into petty_cash_movements (id, type, amount_cents, reason, cash_session_id, created_by)
  values (p_movement_id, 'fondeo', p_amount, btrim(p_reason), p_session_id, auth.uid())
  on conflict (id) do nothing;
end;
$$;

revoke execute on function public.fund_petty_cash(uuid, uuid, uuid, integer, text) from anon;
grant execute on function public.fund_petty_cash(uuid, uuid, uuid, integer, text) to authenticated;
