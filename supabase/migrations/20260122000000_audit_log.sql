-- =============================================================================
-- Bitácora de auditoría
--
-- Cada INSERT / UPDATE / DELETE sobre las tablas de negocio queda registrado en
-- `audit_log`: quién, cuándo, qué tabla, qué fila y qué cambió. Lo escriben
-- triggers en la base — no el cliente — así que no hay forma de "olvidar"
-- auditar una pantalla nueva ni de saltarse el registro desde la API.
--
-- Los eventos que no son cambios de fila (inicio y cierre de sesión) entran por
-- la RPC `log_audit_event`, con una lista cerrada de acciones permitidas.
--
-- Inmutable: authenticated solo puede LEER (y solo admin, vía RLS). Nadie
-- inserta, edita ni borra filas directamente; el trigger es SECURITY DEFINER.
-- =============================================================================

create table audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_name      text,
  -- insert | update | delete | login | logout
  action          text not null,
  table_name      text not null,
  record_id       text,
  order_id        uuid,
  order_folio     text,
  -- Solo las columnas que cambiaron (update) o la fila completa (insert/delete).
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[]
);

create index audit_log_occurred_idx on audit_log (occurred_at desc, id desc);
create index audit_log_table_idx    on audit_log (table_name, occurred_at desc);
create index audit_log_order_idx    on audit_log (order_id) where order_id is not null;
create index audit_log_actor_idx    on audit_log (actor_id, occurred_at desc);

alter table audit_log enable row level security;

create policy audit_log_read on audit_log
  for select to authenticated using (is_admin());

-- Solo lectura desde la API. El default de 0012 concede escritura a todas las
-- tablas nuevas; aquí se retira explícitamente.
revoke insert, update, delete, truncate on audit_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Actor actual: id + nombre (snapshot, por si el perfil cambia de nombre luego).
-- -----------------------------------------------------------------------------

create or replace function audit_actor_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select full_name from profiles where id = p_uid),
    (select email from auth.users where id = p_uid)
  );
$$;

revoke execute on function public.audit_actor_name(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Trigger genérico
-- -----------------------------------------------------------------------------

create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_row      jsonb;
  v_order_id uuid;
  v_folio    text;
  v_key      text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    -- Solo las columnas que de verdad cambiaron; updated_at no cuenta.
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where n.key <> 'updated_at'
       and (v_old -> n.key) is distinct from n.value;

    if v_changed is null then
      return null;  -- update sin cambios reales: no se registra
    end if;

    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_old, v_new
      from unnest(v_changed) k;
  end if;

  v_row := coalesce(to_jsonb(new), to_jsonb(old));

  if tg_table_name = 'orders' then
    v_order_id := (v_row ->> 'id')::uuid;
    v_folio    := v_row ->> 'folio';
  elsif v_row ? 'order_id' and v_row ->> 'order_id' is not null then
    v_order_id := (v_row ->> 'order_id')::uuid;
    select folio into v_folio from orders where id = v_order_id;
  end if;

  v_key := coalesce(v_row ->> 'id', v_row ->> 'order_id');

  insert into audit_log (
    actor_id, actor_name, action, table_name, record_id,
    order_id, order_folio, old_data, new_data, changed_fields
  ) values (
    v_uid,
    case when v_uid is null then 'Sistema' else audit_actor_name(v_uid) end,
    lower(tg_op),
    tg_table_name,
    v_key,
    v_order_id,
    v_folio,
    v_old,
    v_new,
    v_changed
  );

  return null;  -- AFTER trigger: el valor de retorno se ignora
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- Todas las tablas de negocio. `order_status_history` se omite a propósito:
-- ya es en sí una bitácora, y cada cambio de estado queda registrado aquí como
-- un update de `orders`.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'customers', 'service_categories', 'services',
    'cash_sessions', 'cash_movements', 'orders', 'order_items', 'payments',
    'supplies', 'supply_movements', 'business_settings', 'item_types',
    'condition_options', 'order_articles', 'order_photos',
    'order_diagram_marks', 'petty_cash_movements'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Eventos que no son cambios de fila (inicio/cierre de sesión).
-- -----------------------------------------------------------------------------

create or replace function log_audit_event(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;

  if p_action not in ('login', 'logout') then
    raise exception 'Acción de auditoría no permitida: %', p_action using errcode = '22023';
  end if;

  insert into audit_log (actor_id, actor_name, action, table_name, record_id)
  values (v_uid, audit_actor_name(v_uid), p_action, 'session', v_uid::text);
end;
$$;

revoke execute on function public.log_audit_event(text) from public, anon;
grant execute on function public.log_audit_event(text) to authenticated;
