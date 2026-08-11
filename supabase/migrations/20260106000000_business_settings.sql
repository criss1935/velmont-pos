-- =============================================================================
-- Configuración del negocio + catálogos de recepción
--
-- Tres cosas que la recepción necesita leer y que NO deben quedar hardcodeadas
-- en el frontend:
--
--   * business_settings — una sola fila. Umbral de "artículo de alto valor" y el
--     texto de la responsiva. Editable por admin sin tocar código.
--   * item_types        — tipos de artículo (Tenis, Bolsa, Gorra). `has_diagram`
--     marca cuáles muestran el diagrama táctil del sneaker.
--   * condition_options — catálogo de condiciones ("Rayones", "Manchas", …) que
--     se ofrecen como chips al recibir.
--
-- Mismas reglas RLS que el catálogo de servicios: lo lee todo el personal, solo
-- admin lo edita.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- business_settings — fila única (id = 1)
-- -----------------------------------------------------------------------------

create table business_settings (
  id                        integer primary key default 1 check (id = 1),
  -- A partir de este valor declarado, el artículo dispara el aviso de alto valor.
  high_value_threshold_cents integer not null default 300000 check (high_value_threshold_cents >= 0),
  -- Texto que firma el cliente en la responsiva. Editable sin tocar código.
  reception_terms           text not null default
    'El cliente confirma que el estado del artículo, las observaciones y las evidencias registradas corresponden a las condiciones en que el artículo fue entregado al establecimiento.',
  updated_at                timestamptz not null default now()
);

create trigger business_settings_touch
  before update on business_settings
  for each row execute function touch_updated_at();

insert into business_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- item_types — tipos de artículo
-- -----------------------------------------------------------------------------

create table item_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  -- Solo los tipos con silueta (el tenis) muestran el diagrama de observaciones.
  has_diagram boolean not null default false,
  active      boolean not null default true,
  sort_order  integer not null default 0
);

insert into item_types (name, has_diagram, sort_order) values
  ('Tenis', true,  1),
  ('Bolsa', false, 2),
  ('Gorra', false, 3)
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- condition_options — condiciones ofrecidas al recibir
-- -----------------------------------------------------------------------------

create table condition_options (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0
);

insert into condition_options (label, sort_order) values
  ('Rayones',          1),
  ('Manchas',          2),
  ('Suela desgastada', 3),
  ('Costura abierta',  4),
  ('Decoloración',     5),
  ('Material delicado',6),
  ('Despegado',        7),
  ('Rotura',           8)
on conflict (label) do nothing;

-- -----------------------------------------------------------------------------
-- RLS — leer: personal; escribir: admin.
-- -----------------------------------------------------------------------------

alter table business_settings enable row level security;
alter table item_types        enable row level security;
alter table condition_options enable row level security;

create policy business_settings_read on business_settings
  for select to authenticated using (is_staff());
create policy business_settings_admin on business_settings
  for all to authenticated using (is_admin()) with check (is_admin());

create policy item_types_read on item_types
  for select to authenticated using (is_staff());
create policy item_types_admin on item_types
  for all to authenticated using (is_admin()) with check (is_admin());

create policy condition_options_read on condition_options
  for select to authenticated using (is_staff());
create policy condition_options_admin on condition_options
  for all to authenticated using (is_admin()) with check (is_admin());
