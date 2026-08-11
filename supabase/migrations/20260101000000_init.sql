-- =============================================================================
-- Velmont POS — esquema inicial
--
-- Decisiones que atraviesan todo el esquema:
--
--   * El dinero vive en `integer` de centavos. Nunca float, nunca numeric con
--     decimales para importes: en una caja el error de redondeo deja de ser
--     teórico y se vuelve un corte descuadrado.
--
--   * Las líneas de una orden guardan una FOTO del servicio (nombre y precio al
--     momento de recibir el calzado). Si mañana sube el precio del catálogo, las
--     órdenes viejas no pueden cambiar de total — eso es reescribir la historia.
--
--   * Los totales de la orden los calcula la base con triggers, no el cliente.
--     Dos tablets sumando por su cuenta es la forma más fácil de descuadrar.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type order_status as enum (
  'recibido',
  'en_proceso',
  'listo',
  'entregado',
  'cancelado'
);

create type payment_method as enum ('efectivo', 'tarjeta', 'transferencia');

create type cash_movement_type as enum ('entrada', 'salida');

create type supply_movement_type as enum ('compra', 'consumo', 'ajuste', 'merma');

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Empleados
-- -----------------------------------------------------------------------------

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null,
  role       text not null default 'operador' check (role in ('operador', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch
  before update on profiles
  for each row execute function touch_updated_at();

-- Al darse de alta un usuario en auth, se le crea su perfil solo.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------

create table customers (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_touch
  before update on customers
  for each row execute function touch_updated_at();

-- El teléfono es la llave real con la que el mostrador busca a un cliente:
-- único cuando existe, pero se permite cliente sin teléfono (venta de paso).
create unique index customers_phone_key
  on customers (phone)
  where phone is not null;

-- Búsqueda por nombre sin acentos ni mayúsculas.
create index customers_name_search
  on customers using gin (to_tsvector('spanish', full_name));

-- -----------------------------------------------------------------------------
-- Catálogo de servicios
-- -----------------------------------------------------------------------------

create table service_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 0
);

create table services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid references service_categories on delete set null,
  name           text not null,
  description    text,
  price_cents    integer not null check (price_cents >= 0),
  estimated_days integer not null default 2 check (estimated_days >= 0),
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger services_touch
  before update on services
  for each row execute function touch_updated_at();

create index services_category_idx on services (category_id) where active;

-- -----------------------------------------------------------------------------
-- Caja
--
-- Toda venta cae dentro de una sesión de caja abierta. Sin sesión abierta no se
-- cobra: es lo que hace posible cuadrar al cierre.
-- -----------------------------------------------------------------------------

create table cash_sessions (
  id                uuid primary key default gen_random_uuid(),
  opened_at         timestamptz not null default now(),
  opened_by         uuid references profiles on delete set null,
  opening_cents     integer not null default 0 check (opening_cents >= 0),

  closed_at         timestamptz,
  closed_by         uuid references profiles on delete set null,
  -- Lo que el operador contó a mano.
  counted_cents     integer check (counted_cents >= 0),
  -- Lo que el sistema dice que debería haber.
  expected_cents    integer,
  -- counted - expected. Negativo = falta dinero. Se guarda calculado para que
  -- el corte quede congelado tal como se firmó, aunque después se corrija algo.
  difference_cents  integer,
  notes             text
);

-- Solo puede haber UNA sesión abierta a la vez. El índice parcial sobre una
-- constante es lo que lo garantiza a nivel de base: dos tablets no pueden
-- abrir caja a la vez ni por carrera.
create unique index cash_sessions_single_open
  on cash_sessions ((true))
  where closed_at is null;

create table cash_movements (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references cash_sessions on delete cascade,
  type            cash_movement_type not null,
  amount_cents    integer not null check (amount_cents > 0),
  reason          text not null,
  created_by      uuid references profiles on delete set null,
  created_at      timestamptz not null default now()
);

create index cash_movements_session_idx on cash_movements (cash_session_id);

-- -----------------------------------------------------------------------------
-- Órdenes de servicio
-- -----------------------------------------------------------------------------

create sequence order_folio_seq start 1;

create table orders (
  id              uuid primary key default gen_random_uuid(),
  -- Folio corto y legible en voz alta por teléfono: "su orden es la V-00042".
  folio           text not null unique
                    default 'V-' || lpad(nextval('order_folio_seq')::text, 5, '0'),

  customer_id     uuid references customers on delete restrict,
  status          order_status not null default 'recibido',

  received_at     timestamptz not null default now(),
  promised_at     timestamptz,
  delivered_at    timestamptz,

  -- Mantenidos por trigger desde order_items. El cliente no los escribe.
  subtotal_cents  integer not null default 0 check (subtotal_cents >= 0),
  discount_cents  integer not null default 0 check (discount_cents >= 0),
  total_cents     integer not null default 0 check (total_cents >= 0),

  notes           text,
  created_by      uuid references profiles on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Un descuento no puede superar al subtotal.
  constraint orders_discount_within_subtotal check (discount_cents <= subtotal_cents),
  -- Entregado exige fecha de entrega, y viceversa. La base no deja que el
  -- tablero mienta sobre lo que ya salió por la puerta.
  constraint orders_delivered_consistency check (
    (status = 'entregado') = (delivered_at is not null)
  )
);

create trigger orders_touch
  before update on orders
  for each row execute function touch_updated_at();

create index orders_status_idx on orders (status, received_at desc);
create index orders_customer_idx on orders (customer_id);
create index orders_received_idx on orders (received_at desc);

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders on delete cascade,

  -- El servicio del catálogo, para reportes. Puede quedar en null si algún día
  -- se retira del catálogo: la línea sobrevive gracias a la foto de abajo.
  service_id        uuid references services on delete set null,

  -- FOTO del catálogo al momento de recibir. Es lo que se imprime y lo que se
  -- cobra; el catálogo puede cambiar mañana sin alterar esta orden.
  service_name      text not null,
  unit_price_cents  integer not null check (unit_price_cents >= 0),

  quantity          integer not null default 1 check (quantity > 0),

  -- El par concreto que entró: "Nike Air Force 1 blancos".
  item_label        text,
  -- Estado con el que llegó: "mancha en el talón derecho, agujeta rota".
  -- Es la defensa del negocio en una disputa, así que se imprime en el recibo.
  item_notes        text,
  photo_urls        text[] not null default '{}',

  line_total_cents  integer generated always as (unit_price_cents * quantity) stored,

  created_at        timestamptz not null default now()
);

create index order_items_order_idx on order_items (order_id);

-- Recalcula los totales de la orden desde sus líneas. Única fuente de verdad.
create or replace function recalc_order_totals()
returns trigger
language plpgsql
as $$
declare
  target_order uuid := coalesce(new.order_id, old.order_id);
  new_subtotal integer;
begin
  select coalesce(sum(line_total_cents), 0)
    into new_subtotal
    from order_items
   where order_id = target_order;

  update orders
     set subtotal_cents = new_subtotal,
         -- Si el descuento ya no cabe en el subtotal (se quitó una línea), se
         -- recorta en vez de violar el check y tumbar la operación en mostrador.
         discount_cents = least(discount_cents, new_subtotal),
         total_cents    = new_subtotal - least(discount_cents, new_subtotal)
   where id = target_order;

  return null;
end;
$$;

create trigger order_items_recalc
  after insert or update or delete on order_items
  for each row execute function recalc_order_totals();

-- Al cambiar el descuento a mano, el total tiene que seguirlo.
create or replace function apply_order_discount()
returns trigger
language plpgsql
as $$
begin
  new.total_cents := new.subtotal_cents - new.discount_cents;
  return new;
end;
$$;

create trigger orders_apply_discount
  before insert or update of subtotal_cents, discount_cents on orders
  for each row execute function apply_order_discount();

-- Bitácora de estados: quién movió la orden, cuándo y de dónde a dónde.
create table order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  changed_by  uuid references profiles on delete set null,
  changed_at  timestamptz not null default now(),
  note        text
);

create index order_status_history_order_idx on order_status_history (order_id, changed_at);

create or replace function log_order_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, new.created_by);
  elsif new.status is distinct from old.status then
    insert into order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;

  return null;
end;
$$;

create trigger orders_log_status
  after insert or update of status on orders
  for each row execute function log_order_status_change();

-- -----------------------------------------------------------------------------
-- Pagos
--
-- Una orden puede pagarse en varias exhibiciones (anticipo al recibir, resto al
-- entregar), por eso pagos es una tabla y no columnas dentro de orders.
-- -----------------------------------------------------------------------------

create table payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders on delete cascade,

  -- El efectivo debe caer en una sesión de caja; tarjeta y transferencia no
  -- tocan el cajón, y se validan abajo.
  cash_session_id uuid references cash_sessions on delete restrict,

  method          payment_method not null,
  amount_cents    integer not null check (amount_cents > 0),

  -- Solo efectivo: con cuánto pagó y cuánto se le devolvió.
  tendered_cents  integer check (tendered_cents >= 0),
  change_cents    integer check (change_cents >= 0),

  -- Tarjeta: autorización. Transferencia: folio.
  reference       text,

  created_by      uuid references profiles on delete set null,
  created_at      timestamptz not null default now(),

  -- Todo pago en efectivo pertenece a una sesión de caja. Sin esto el corte no
  -- cuadra jamás y nadie sabe por qué.
  constraint payments_cash_needs_session check (
    method <> 'efectivo' or cash_session_id is not null
  ),
  -- Lo recibido nunca puede ser menor a lo cobrado.
  constraint payments_tendered_covers_amount check (
    tendered_cents is null or tendered_cents >= amount_cents
  )
);

create index payments_order_idx on payments (order_id);
create index payments_session_idx on payments (cash_session_id);
create index payments_created_idx on payments (created_at desc);

-- -----------------------------------------------------------------------------
-- Inventario de insumos
-- -----------------------------------------------------------------------------

create table supplies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  unit       text not null default 'pieza',
  -- numeric, no integer: los insumos se miden en ml y fracciones.
  stock      numeric(12, 3) not null default 0,
  min_stock  numeric(12, 3) not null default 0 check (min_stock >= 0),
  cost_cents integer check (cost_cents >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger supplies_touch
  before update on supplies
  for each row execute function touch_updated_at();

create table supply_movements (
  id         uuid primary key default gen_random_uuid(),
  supply_id  uuid not null references supplies on delete cascade,
  type       supply_movement_type not null,
  -- Siempre positivo: el signo lo decide `type`, no el que captura. Así nadie
  -- suma stock por error escribiendo un negativo en una merma.
  quantity   numeric(12, 3) not null check (quantity > 0),
  -- Si el consumo vino de una orden concreta, queda ligado.
  order_id   uuid references orders on delete set null,
  note       text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index supply_movements_supply_idx on supply_movements (supply_id, created_at desc);

-- El stock es el resultado de los movimientos, no un número que alguien teclea.
create or replace function apply_supply_movement()
returns trigger
language plpgsql
as $$
begin
  update supplies
     set stock = stock + case new.type
                           when 'compra'  then new.quantity
                           when 'ajuste'  then new.quantity
                           when 'consumo' then -new.quantity
                           when 'merma'   then -new.quantity
                         end
   where id = new.supply_id;

  return null;
end;
$$;

create trigger supply_movements_apply
  after insert on supply_movements
  for each row execute function apply_supply_movement();

-- -----------------------------------------------------------------------------
-- Vistas de apoyo
-- -----------------------------------------------------------------------------

-- `security_invoker`: la vista se evalúa con los permisos de QUIEN la consulta,
-- no de quien la creó. Sin esto una vista es una puerta trasera que rodea RLS.
--
-- Saldo pendiente por orden. Lo que el mostrador necesita saber al entregar:
-- "¿este cliente ya pagó, o debe algo?"
create view order_balances
  with (security_invoker = true)
as
select
  o.id                                              as order_id,
  o.folio,
  o.total_cents,
  coalesce(sum(p.amount_cents), 0)::integer         as paid_cents,
  (o.total_cents - coalesce(sum(p.amount_cents), 0))::integer as balance_cents
from orders o
left join payments p on p.order_id = o.id
where o.status <> 'cancelado'
group by o.id;

-- Efectivo que el sistema espera en el cajón de una sesión.
-- fondo inicial + cobros en efectivo + entradas - salidas.
create view cash_session_expected
  with (security_invoker = true)
as
select
  s.id as cash_session_id,
  (
    s.opening_cents
    + coalesce((
        select sum(p.amount_cents)
          from payments p
         where p.cash_session_id = s.id
           and p.method = 'efectivo'
      ), 0)
    + coalesce((
        select sum(m.amount_cents)
          from cash_movements m
         where m.cash_session_id = s.id
           and m.type = 'entrada'
      ), 0)
    - coalesce((
        select sum(m.amount_cents)
          from cash_movements m
         where m.cash_session_id = s.id
           and m.type = 'salida'
      ), 0)
  )::integer as expected_cents
from cash_sessions s;
