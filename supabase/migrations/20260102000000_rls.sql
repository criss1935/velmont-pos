-- =============================================================================
-- Row Level Security
--
-- La clave `anon` viaja dentro del bundle de la tablet: cualquiera que abra las
-- DevTools la tiene. Lo único que separa la base de datos de internet son estas
-- políticas. Sin RLS, el POS es una base de datos pública.
--
-- Modelo: un solo negocio. Todo empleado autenticado y activo ve y opera la
-- tienda entera. Lo que se restringe a admin es lo que borra o reescribe
-- historia: cancelar, borrar, cerrar caja, tocar el catálogo.
-- =============================================================================

alter table profiles              enable row level security;
alter table customers             enable row level security;
alter table service_categories    enable row level security;
alter table services              enable row level security;
alter table cash_sessions         enable row level security;
alter table cash_movements        enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table order_status_history  enable row level security;
alter table payments              enable row level security;
alter table supplies              enable row level security;
alter table supply_movements      enable row level security;

-- -----------------------------------------------------------------------------
-- Predicados
--
-- `security definer` + search_path fijo: si no, un rol con permisos de creación
-- podría plantar una tabla `profiles` en su propio esquema y suplantar el
-- chequeo de admin.
-- -----------------------------------------------------------------------------

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and active
  );
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and active
       and role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- Perfiles
-- -----------------------------------------------------------------------------

create policy profiles_read on profiles
  for select to authenticated
  using (is_staff());

-- Cada quien edita su propio perfil; el admin edita el de cualquiera.
-- No se pone `with check` sobre `role` aquí, así que el escalado a admin se
-- bloquea abajo con un trigger (una política no puede comparar old vs new).
create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- Un operador no puede ascenderse a admin ni reactivarse solo.
create or replace function guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Solo un administrador puede cambiar el rol.';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Solo un administrador puede activar o desactivar a un empleado.';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on profiles
  for each row execute function guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- Clientes — todo el personal opera; solo admin borra.
-- -----------------------------------------------------------------------------

create policy customers_read on customers
  for select to authenticated using (is_staff());

create policy customers_write on customers
  for insert to authenticated with check (is_staff());

create policy customers_update on customers
  for update to authenticated using (is_staff()) with check (is_staff());

create policy customers_delete on customers
  for delete to authenticated using (is_admin());

-- -----------------------------------------------------------------------------
-- Catálogo — lo lee cualquiera; solo admin le pone precio.
-- -----------------------------------------------------------------------------

create policy categories_read on service_categories
  for select to authenticated using (is_staff());

create policy categories_admin on service_categories
  for all to authenticated using (is_admin()) with check (is_admin());

create policy services_read on services
  for select to authenticated using (is_staff());

create policy services_admin on services
  for all to authenticated using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- Caja
-- -----------------------------------------------------------------------------

create policy cash_sessions_read on cash_sessions
  for select to authenticated using (is_staff());

create policy cash_sessions_open on cash_sessions
  for insert to authenticated with check (is_staff());

-- Cerrar caja es el momento en que se firma un número. Solo admin.
create policy cash_sessions_close on cash_sessions
  for update to authenticated using (is_admin()) with check (is_admin());

create policy cash_movements_read on cash_movements
  for select to authenticated using (is_staff());

-- Solo se puede mover dinero de una caja que sigue abierta.
create policy cash_movements_write on cash_movements
  for insert to authenticated
  with check (
    is_staff()
    and exists (
      select 1 from cash_sessions s
       where s.id = cash_session_id
         and s.closed_at is null
    )
  );

-- Un movimiento de caja es un hecho contable: no se edita, se compensa con otro.
-- Por eso no hay política de update ni de delete.

-- -----------------------------------------------------------------------------
-- Órdenes
-- -----------------------------------------------------------------------------

create policy orders_read on orders
  for select to authenticated using (is_staff());

create policy orders_write on orders
  for insert to authenticated with check (is_staff());

create policy orders_update on orders
  for update to authenticated using (is_staff()) with check (is_staff());

-- Una orden no se borra: se cancela. El histórico es el activo del negocio.
create policy orders_delete on orders
  for delete to authenticated using (is_admin());

create policy order_items_read on order_items
  for select to authenticated using (is_staff());

-- Las líneas solo se tocan mientras la orden no se haya entregado ni cancelado.
-- Es lo que impide reescribir el total de algo que ya salió por la puerta.
create policy order_items_write on order_items
  for insert to authenticated
  with check (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

create policy order_items_update on order_items
  for update to authenticated
  using (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  )
  with check (is_staff());

create policy order_items_delete on order_items
  for delete to authenticated
  using (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

-- La bitácora se lee, no se escribe a mano: la llena el trigger.
create policy order_status_history_read on order_status_history
  for select to authenticated using (is_staff());

-- -----------------------------------------------------------------------------
-- Pagos — inmutables por diseño.
-- -----------------------------------------------------------------------------

create policy payments_read on payments
  for select to authenticated using (is_staff());

create policy payments_write on payments
  for insert to authenticated
  with check (
    is_staff()
    -- Un cobro en efectivo solo entra si su caja sigue abierta. Sin esto se
    -- pueden colar cobros en una sesión ya cortada y firmada.
    and (
      method <> 'efectivo'
      or exists (
        select 1 from cash_sessions s
         where s.id = cash_session_id
           and s.closed_at is null
      )
    )
  );

-- Un pago no se edita ni se borra. Si se cobró de más, se registra una salida de
-- caja por la devolución: así queda el rastro de las dos cosas.

-- -----------------------------------------------------------------------------
-- Inventario
-- -----------------------------------------------------------------------------

create policy supplies_read on supplies
  for select to authenticated using (is_staff());

-- Alta de insumos y cambio de mínimos: admin. Pero el `stock` no lo escribe
-- nadie a mano — es el resultado de los movimientos (ver trigger más abajo).
create policy supplies_admin on supplies
  for all to authenticated using (is_admin()) with check (is_admin());

create policy supply_movements_read on supply_movements
  for select to authenticated using (is_staff());

-- Cualquier operador registra consumo y merma (es lo que pasa en el día a día).
-- Comprar y ajustar stock mueve el valor del inventario: eso es de admin.
create policy supply_movements_write on supply_movements
  for insert to authenticated
  with check (
    is_staff()
    and (type in ('consumo', 'merma') or is_admin())
  );

-- El stock es derivado. Si alguien lo escribiera a mano quedaría en desacuerdo
-- con sus propios movimientos y el inventario dejaría de ser auditable.
create or replace function guard_supply_stock()
returns trigger
language plpgsql
as $$
begin
  if new.stock is distinct from old.stock
     and current_setting('velmont.applying_movement', true) is distinct from 'on'
  then
    raise exception
      'El stock no se edita directamente: registra un movimiento (compra, consumo, ajuste o merma).';
  end if;

  return new;
end;
$$;

create trigger supplies_guard_stock
  before update on supplies
  for each row execute function guard_supply_stock();

-- El trigger que sí tiene permiso de mover el stock se identifica con una
-- bandera de sesión, para que el guardia de arriba lo deje pasar.
create or replace function apply_supply_movement()
returns trigger
language plpgsql
as $$
begin
  perform set_config('velmont.applying_movement', 'on', true);

  update supplies
     set stock = stock + case new.type
                           when 'compra'  then new.quantity
                           when 'ajuste'  then new.quantity
                           when 'consumo' then -new.quantity
                           when 'merma'   then -new.quantity
                         end
   where id = new.supply_id;

  perform set_config('velmont.applying_movement', 'off', true);

  return null;
end;
$$;
