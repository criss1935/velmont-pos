-- =============================================================================
-- Endurecimiento de funciones
--
-- Dos huecos reales que el linter de Supabase detecta:
--
--  1. search_path mutable. Una función sin search_path fijo resuelve los nombres
--     de tabla con el search_path de quien la llama. Un rol capaz de crear un
--     esquema propio puede plantar ahí su tabla `profiles` y hacer que el
--     chequeo de admin lea la suya. Se fija a `public` en todas.
--
--  2. Funciones internas publicadas como RPC. PostgREST expone TODA función del
--     esquema `public` en /rest/v1/rpc/<nombre>. Las funciones de trigger no son
--     API: solo las invocan los triggers, que corren como dueño de la tabla y no
--     necesitan EXECUTE de nadie.
--
-- Ojo con el rol al que se revoca: Postgres concede EXECUTE a PUBLIC en toda
-- función nueva, y `anon`/`authenticated` heredan de ahí. Revocarles a ellos
-- directamente no hace nada mientras la concesión a PUBLIC siga viva — hay que
-- quitársela a PUBLIC y después devolver solo lo mínimo.
--
-- `is_staff` e `is_admin` conservan EXECUTE para `authenticated`: las políticas
-- RLS las evalúan con el rol de quien consulta, así que sin ese permiso la base
-- entera se volvería inaccesible. Quedan expuestas como RPC, y es aceptable:
-- solo devuelven un booleano sobre el propio llamador, no revelan datos.
-- =============================================================================

alter function touch_updated_at()        set search_path = public;
alter function recalc_order_totals()     set search_path = public;
alter function apply_order_discount()    set search_path = public;
alter function log_order_status_change() set search_path = public;
alter function guard_supply_stock()      set search_path = public;
alter function apply_supply_movement()   set search_path = public;

revoke all on function touch_updated_at()         from public;
revoke all on function recalc_order_totals()      from public;
revoke all on function apply_order_discount()     from public;
revoke all on function log_order_status_change()  from public;
revoke all on function guard_supply_stock()       from public;
revoke all on function apply_supply_movement()    from public;
revoke all on function handle_new_user()          from public;
revoke all on function guard_profile_privileges() from public;
revoke all on function is_staff()                 from public;
revoke all on function is_admin()                 from public;

grant execute on function is_staff() to authenticated;
grant execute on function is_admin() to authenticated;
