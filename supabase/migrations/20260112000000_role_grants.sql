-- =============================================================================
-- Privilegios de tabla para anon / authenticated
--
-- Supabase Cloud otorga por defecto SELECT/INSERT/UPDATE/DELETE sobre las tablas
-- de `public` a los roles anon y authenticated, y deja que RLS sea la puerta que
-- decide QUÉ filas se ven. En el stack local esos GRANT no se aplican a las
-- tablas creadas por migraciones, así que Postgres corta por falta de privilegio
-- de tabla ANTES de evaluar RLS (error 42501 "permission denied").
--
-- Esta migración replica ese default. Es idempotente: en Cloud los privilegios
-- ya existen y volver a otorgarlos no cambia nada. NO se toca EXECUTE de las
-- funciones — las de trigger siguen revocadas como las dejó 0003; los RPC
-- (create_order, create_reception, close_cash_session, is_staff, is_admin)
-- conservan su grant explícito.
--
-- La seguridad la sigue dando RLS: todas las tablas de public la tienen activada
-- y sus políticas son `to authenticated` con is_staff()/is_admin(); anon no tiene
-- ninguna política, así que RLS lo bloquea aunque tenga el privilegio de tabla.
-- =============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
