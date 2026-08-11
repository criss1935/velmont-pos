-- =============================================================================
-- Evidencia fotográfica y diagrama de observaciones
--
--   * order_photos       — referencias a los archivos en Storage. NUNCA base64;
--     solo la ruta dentro del bucket público `order-media` (ver 0010).
--   * order_diagram_marks — marcadores que el empleado toca sobre la silueta del
--     sneaker. Se guardan coordenadas RELATIVAS (0..1) para que caigan en el
--     mismo punto en cualquier resolución o tamaño de pantalla.
--
-- Ambas cuelgan del artículo; se guarda también order_id para RLS y consultas.
-- =============================================================================

create table order_photos (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders on delete cascade,
  article_id    uuid references order_articles on delete cascade,
  -- Ruta dentro del bucket: orders/{order_id}/{article_id}/{uuid}.jpg
  storage_path  text not null,
  -- Clasificación opcional: Frontal, Lateral izquierdo, Suela, Detalle de daño…
  classification text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index order_photos_order_idx   on order_photos (order_id);
create index order_photos_article_idx on order_photos (article_id);

create table order_diagram_marks (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders on delete cascade,
  article_id  uuid not null references order_articles on delete cascade,
  -- Número visible del marcador sobre el diagrama (1, 2, 3…).
  idx         integer not null check (idx > 0),
  -- Coordenadas relativas al recuadro del diagrama, 0..1.
  x_rel       numeric(6, 5) not null check (x_rel >= 0 and x_rel <= 1),
  y_rel       numeric(6, 5) not null check (y_rel >= 0 and y_rel <= 1),
  -- Tipo de observación: Rayón, Mancha, Desgaste, Rotura, Despegado, Otro.
  mark_type   text not null,
  description text,
  created_at  timestamptz not null default now()
);

create index order_diagram_marks_order_idx   on order_diagram_marks (order_id);
create index order_diagram_marks_article_idx on order_diagram_marks (article_id);

-- -----------------------------------------------------------------------------
-- RLS — leer: personal. Escribir: personal mientras la orden siga abierta.
-- -----------------------------------------------------------------------------

alter table order_photos        enable row level security;
alter table order_diagram_marks enable row level security;

create policy order_photos_read on order_photos
  for select to authenticated using (is_staff());

create policy order_photos_write on order_photos
  for insert to authenticated
  with check (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

create policy order_photos_delete on order_photos
  for delete to authenticated
  using (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

create policy order_diagram_marks_read on order_diagram_marks
  for select to authenticated using (is_staff());

create policy order_diagram_marks_write on order_diagram_marks
  for insert to authenticated
  with check (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

create policy order_diagram_marks_delete on order_diagram_marks
  for delete to authenticated
  using (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );
