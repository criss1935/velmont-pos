-- =============================================================================
-- create_order — alta de una orden con sus líneas, en una sola transacción.
--
-- Por qué una función y no dos inserts desde el cliente: si el insert de la
-- orden pasa y el de las líneas falla (se cayó el WiFi a media operación), queda
-- una orden fantasma de $0 en el tablero, con folio quemado y sin nada dentro.
-- Aquí, o entra todo o no entra nada.
--
-- SECURITY INVOKER (el default): corre con los permisos de quien la llama, así
-- que las políticas RLS de orders y order_items siguen aplicando. Esta función
-- da atomicidad, no privilegios.
-- =============================================================================

create or replace function create_order(
  p_customer_id uuid,
  p_items       jsonb,
  p_notes       text default null,
  p_promised_at timestamptz default null,
  p_discount    integer default 0
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

  insert into orders (customer_id, notes, promised_at, created_by)
  values (p_customer_id, nullif(btrim(p_notes), ''), p_promised_at, auth.uid())
  returning id into v_order_id;

  -- El precio NO se toma del catálogo aquí: se toma de lo que traiga el cliente,
  -- que es lo que se le mostró y cotizó al comprador. Si el catálogo cambió entre
  -- que se armó el carrito y se confirmó, manda lo cotizado.
  insert into order_items (
    order_id, service_id, service_name, unit_price_cents, quantity, item_label, item_notes
  )
  select
    v_order_id,
    (item ->> 'service_id')::uuid,
    item ->> 'service_name',
    (item ->> 'unit_price_cents')::integer,
    coalesce((item ->> 'quantity')::integer, 1),
    nullif(btrim(item ->> 'item_label'), ''),
    nullif(btrim(item ->> 'item_notes'), '')
  from jsonb_array_elements(p_items) as item;

  -- El descuento va después de las líneas: el trigger de totales ya calculó el
  -- subtotal, y el check `discount <= subtotal` puede evaluarse de verdad.
  if p_discount > 0 then
    update orders set discount_cents = p_discount where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;

revoke all on function create_order(uuid, jsonb, text, timestamptz, integer) from public;
grant execute on function create_order(uuid, jsonb, text, timestamptz, integer) to authenticated;
