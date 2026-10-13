-- =============================================================================
-- Correos al cliente: cierre de recepción + bitácora de envíos
--
-- `orders.reception_closed_at` marca el momento en que el personal terminó la
-- recepción (orden creada en la computadora, fotos subidas desde el celular).
-- Es la señal que dispara el correo de recepción: antes de eso la orden está
-- "abierta" y no se manda nada, porque saldría sin las fotos de evidencia.
--
-- `order_emails` es la bitácora de lo que se mandó (o intentó mandar), para
-- mostrar "Enviado / Falló" en la orden y no duplicar correos. La escribe la
-- función serverless `api/send-order-email.ts` con la sesión del empleado, así
-- que RLS aplica igual que en el resto de la app.
-- =============================================================================

alter table orders
  add column reception_closed_at timestamptz;

comment on column orders.reception_closed_at is
  'Cuándo el personal cerró la recepción (fotos completas). Null = recepción abierta.';

create table order_emails (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders on delete cascade,

  -- reception = fotos y notas de cómo se recibió. receipt = ticket de un cobro.
  kind        text not null check (kind in ('reception', 'receipt')),
  payment_id  uuid references payments on delete set null,

  to_email    text not null,
  status      text not null check (status in ('sent', 'failed')),
  provider_id text,
  error       text,

  sent_by     uuid references profiles on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index order_emails_order_idx on order_emails (order_id, created_at desc);

alter table order_emails enable row level security;

-- Se lee y se inserta; no se corrige ni se borra: es historia.
create policy order_emails_read on order_emails
  for select to authenticated using (is_staff());

create policy order_emails_insert on order_emails
  for insert to authenticated with check (is_staff());

-- Auditoría: toda tabla de negocio nueva cuelga del trigger genérico.
create trigger order_emails_audit
  after insert or update or delete on public.order_emails
  for each row execute function public.audit_row_change();
