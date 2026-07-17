-- =============================================================================
-- Recepción offline: ids explícitos y reintento idempotente.
--
-- La cola offline necesita saber el order_id/article_id/etc. ANTES de que
-- exista la fila (para poder referenciarlo, p. ej. una foto que apunta a un
-- artículo que todavía no se ha sincronizado) — así que el cliente ahora
-- genera esos ids con crypto.randomUUID() y los manda explícitos.
--
-- Eso exige que ambas RPC sean idempotentes frente a un reintento con el
-- mismo `p_order_id`: si la respuesta del primer intento nunca llegó (se cayó
-- el WiFi a mitad de la respuesta) pero la transacción sí se comprometió del
-- lado del servidor, un reintento no debe reinsertar nada — debe devolver el
-- resultado que ya existe. Postgres nunca deja un commit a medias (un corte
-- de proceso hace rollback completo), así que basta verificar "¿ya existe la
-- orden?" al principio: si existe, se reconstruye la respuesta y se sale sin
-- tocar ninguna fila hija. No hace falta (ni conviene) un `on conflict do
-- nothing` en cada insert hijo: si el conflicto se disparara ahí, el
-- `returning ... into` de esa fila devolvería NULL, y las filas siguientes
-- (order_items, order_diagram_marks) quedarían con un article_id nulo.
-- =============================================================================

create or replace function create_order(
  p_customer_id uuid,
  p_items       jsonb,
  p_notes       text default null,
  p_promised_at timestamptz default null,
  p_discount    integer default 0,
  p_order_id    uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Una orden no puede ir vacía: agrega al menos un servicio.';
  end if;

  if p_order_id is not null then
    select id into v_order_id from orders where id = p_order_id;
    if found then
      return v_order_id;
    end if;
  end if;

  insert into orders (id, customer_id, notes, promised_at, created_by)
  values (
    coalesce(p_order_id, gen_random_uuid()),
    p_customer_id,
    nullif(btrim(p_notes), ''),
    p_promised_at,
    auth.uid()
  )
  returning id into v_order_id;

  -- El precio NO se toma del catálogo aquí: se toma de lo que traiga el
  -- cliente, que es lo que se le mostró y cotizó al comprador.
  insert into order_items (
    id, order_id, service_id, service_name, unit_price_cents, quantity, item_label, item_notes
  )
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
    v_order_id,
    (item ->> 'service_id')::uuid,
    item ->> 'service_name',
    (item ->> 'unit_price_cents')::integer,
    coalesce((item ->> 'quantity')::integer, 1),
    nullif(btrim(item ->> 'item_label'), ''),
    nullif(btrim(item ->> 'item_notes'), '')
  from jsonb_array_elements(p_items) as item;

  if p_discount > 0 then
    update orders set discount_cents = p_discount where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;

revoke all on function create_order(uuid, jsonb, text, timestamptz, integer, uuid) from public;
grant execute on function create_order(uuid, jsonb, text, timestamptz, integer, uuid) to authenticated;

-- -----------------------------------------------------------------------------

create or replace function create_reception(
  p_customer_id    uuid,
  p_articles       jsonb,
  p_notes          text        default null,
  p_promised_at    timestamptz default null,
  p_discount       integer     default 0,
  p_signature_path text        default null,
  p_responsiva     boolean     default false,
  p_payment        jsonb       default null,
  p_order_id       uuid        default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order_id    uuid;
  v_article_id  uuid;
  v_article_ids uuid[] := '{}';
  v_article     jsonb;
  v_mark        jsonb;
  v_amount      integer;
  v_tendered    integer;
  v_change      integer;
  v_method      payment_method;
begin
  if p_articles is null or jsonb_array_length(p_articles) = 0 then
    raise exception 'Una recepción necesita al menos un artículo.';
  end if;

  -- Reintento idempotente: la orden ya existe, así que ya se guardó en un
  -- intento anterior. Se reconstruye la respuesta desde los ids que el propio
  -- cliente mandó (los mismos con los que ya llamó la primera vez) sin tocar
  -- ninguna fila hija.
  if p_order_id is not null and exists (select 1 from orders where id = p_order_id) then
    select array_agg(nullif(value->>'id', '')::uuid order by ord)
      into v_article_ids
      from jsonb_array_elements(p_articles) with ordinality as t(value, ord);

    return jsonb_build_object('order_id', p_order_id, 'article_ids', to_jsonb(v_article_ids));
  end if;

  insert into orders (
    id, customer_id, notes, promised_at, created_by,
    signature_path, responsiva_accepted, responsiva_accepted_at
  )
  values (
    coalesce(p_order_id, gen_random_uuid()),
    p_customer_id,
    nullif(btrim(p_notes), ''),
    p_promised_at,
    auth.uid(),
    nullif(btrim(p_signature_path), ''),
    coalesce(p_responsiva, false),
    case when p_responsiva then now() else null end
  )
  returning id into v_order_id;

  -- Cada artículo, en el orden en que llegó (la ordinalidad conserva el orden
  -- para que las fotos que suba el cliente después casen con su artículo).
  for v_article in
    select value from jsonb_array_elements(p_articles) with ordinality as t(value, ord) order by ord
  loop
    if v_article->'items' is null or jsonb_array_length(v_article->'items') = 0 then
      raise exception 'Cada artículo necesita al menos un servicio.';
    end if;

    insert into order_articles (
      id, order_id, item_type, brand, model, color,
      declared_value_cents, condition_tags, condition_notes, sort_order
    )
    values (
      coalesce(nullif(v_article->>'id', '')::uuid, gen_random_uuid()),
      v_order_id,
      v_article->>'item_type',
      nullif(btrim(v_article->>'brand'), ''),
      nullif(btrim(v_article->>'model'), ''),
      nullif(btrim(v_article->>'color'), ''),
      nullif(v_article->>'declared_value_cents', '')::integer,
      coalesce(
        (select array_agg(tag) from jsonb_array_elements_text(coalesce(v_article->'condition_tags', '[]'::jsonb)) as tag),
        '{}'
      ),
      nullif(btrim(v_article->>'condition_notes'), ''),
      coalesce(array_length(v_article_ids, 1), 0)   -- sort_order = posición
    )
    returning id into v_article_id;

    v_article_ids := v_article_ids || v_article_id;

    -- Servicios del artículo. El precio se congela desde lo cotizado, igual
    -- que en create_order: si el catálogo cambió, manda lo que se le mostró
    -- al cliente.
    insert into order_items (
      id, order_id, article_id, service_id, service_name, unit_price_cents, quantity
    )
    select
      coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
      v_order_id,
      v_article_id,
      nullif(item->>'service_id', '')::uuid,
      item->>'service_name',
      (item->>'unit_price_cents')::integer,
      coalesce((item->>'quantity')::integer, 1)
    from jsonb_array_elements(v_article->'items') as item;

    -- Marcadores del diagrama (si los hay).
    if v_article->'diagram_marks' is not null then
      insert into order_diagram_marks (
        id, order_id, article_id, idx, x_rel, y_rel, mark_type, description
      )
      select
        coalesce(nullif(mark->>'id', '')::uuid, gen_random_uuid()),
        v_order_id,
        v_article_id,
        (mark->>'idx')::integer,
        (mark->>'x_rel')::numeric,
        (mark->>'y_rel')::numeric,
        mark->>'mark_type',
        nullif(btrim(mark->>'description'), '')
      from jsonb_array_elements(v_article->'diagram_marks') as mark;
    end if;
  end loop;

  -- El descuento va después de las líneas: el trigger de totales ya calculó
  -- el subtotal y el check `discount <= subtotal` puede evaluarse de verdad.
  if coalesce(p_discount, 0) > 0 then
    update orders set discount_cents = p_discount where id = v_order_id;
  end if;

  -- Anticipo opcional en el momento de recibir. La validación de "efectivo
  -- exige caja abierta" la imponen el check de payments y su política RLS.
  if p_payment is not null and coalesce((p_payment->>'amount_cents')::integer, 0) > 0 then
    v_method   := (p_payment->>'method')::payment_method;
    v_amount   := (p_payment->>'amount_cents')::integer;
    v_tendered := nullif(p_payment->>'tendered_cents', '')::integer;
    v_change   := case
                    when v_method = 'efectivo' and v_tendered is not null
                    then v_tendered - v_amount
                    else null
                  end;

    insert into payments (
      id, order_id, cash_session_id, method, amount_cents,
      tendered_cents, change_cents, reference, created_by
    )
    values (
      coalesce(nullif(p_payment->>'id', '')::uuid, gen_random_uuid()),
      v_order_id,
      case when v_method = 'efectivo'
        then nullif(p_payment->>'cash_session_id', '')::uuid
        else null
      end,
      v_method,
      v_amount,
      case when v_method = 'efectivo' then v_tendered else null end,
      v_change,
      nullif(btrim(p_payment->>'reference'), ''),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'order_id',    v_order_id,
    'article_ids', to_jsonb(v_article_ids)
  );
end;
$$;

revoke all on function create_reception(uuid, jsonb, text, timestamptz, integer, text, boolean, jsonb, uuid) from public;
grant execute on function create_reception(uuid, jsonb, text, timestamptz, integer, text, boolean, jsonb, uuid) to authenticated;

-- Las firmas anteriores (8 args, sin p_order_id) quedan huérfanas: todo el
-- código ahora pasa por las nuevas (9/6 args). Se eliminan para no dejar dos
-- overloads del mismo nombre con distinto comportamiento de idempotencia.
drop function if exists create_order(uuid, jsonb, text, timestamptz, integer);
drop function if exists create_reception(uuid, jsonb, text, timestamptz, integer, text, boolean, jsonb);
