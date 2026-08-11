-- =============================================================================
-- Artículos de la orden  (recepción multi-artículo)
--
-- Una recepción puede documentar VARIOS artículos (un cliente deja dos pares, o
-- un par + una gorra). Cada artículo tiene su identidad física, su valor
-- declarado, su condición de entrada, sus fotos y su diagrama. Los servicios
-- (order_items) pasan a colgar del artículo al que se aplican.
--
-- Los TOTALES de la orden siguen calculándose desde order_items por order_id
-- (trigger recalc_order_totals de 0001): agregar article_id no cambia el dinero.
-- =============================================================================

create table order_articles (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders on delete cascade,

  -- Nombre del tipo (Tenis/Bolsa/Gorra). Se guarda el texto, no un FK: si el
  -- catálogo cambia mañana, la orden vieja conserva lo que se recibió.
  item_type            text not null,
  brand                text,
  model                text,
  color                text,
  -- Valor declarado por el cliente. Dispara el aviso de alto valor si supera el
  -- umbral de business_settings.
  declared_value_cents integer check (declared_value_cents >= 0),

  -- Condiciones marcadas (chips) + descripción libre del estado.
  condition_tags       text[] not null default '{}',
  condition_notes      text,

  sort_order           integer not null default 0,
  created_at           timestamptz not null default now()
);

create index order_articles_order_idx on order_articles (order_id);

-- Cada servicio pertenece a un artículo. Nullable por compatibilidad con las
-- órdenes creadas por el flujo viejo (create_order), que no tenían artículos.
alter table order_items
  add column article_id uuid references order_articles on delete cascade;

create index order_items_article_idx on order_items (article_id);

-- -----------------------------------------------------------------------------
-- RLS — mismo criterio que order_items: se toca mientras la orden siga abierta.
-- -----------------------------------------------------------------------------

alter table order_articles enable row level security;

create policy order_articles_read on order_articles
  for select to authenticated using (is_staff());

create policy order_articles_write on order_articles
  for insert to authenticated
  with check (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );

create policy order_articles_update on order_articles
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

create policy order_articles_delete on order_articles
  for delete to authenticated
  using (
    is_staff()
    and exists (
      select 1 from orders o
       where o.id = order_id
         and o.status not in ('entregado', 'cancelado')
    )
  );
