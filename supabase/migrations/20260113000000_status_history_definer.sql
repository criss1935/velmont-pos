-- =============================================================================
-- log_order_status_change → SECURITY DEFINER
--
-- La bitácora order_status_history se llena SOLO por este trigger; por eso no
-- tiene política de INSERT (0002: "se lee, no se escribe a mano"). Pero el
-- trigger corría como invoker, así que al crear una orden el insert a la bitácora
-- chocaba con RLS ("new row violates row-level security policy"). Nunca se notó
-- porque hasta ahora no se había creado ninguna orden.
--
-- La corrección correcta —la misma que usa handle_new_user— es que el trigger
-- corra como su dueño (SECURITY DEFINER): es una escritura del sistema, no del
-- usuario, y así puede llenar la bitácora sin abrirle a nadie el permiso de
-- escribirla a mano. auth.uid() sigue disponible para registrar quién movió.
-- =============================================================================

create or replace function log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
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

revoke all on function log_order_status_change() from public;
