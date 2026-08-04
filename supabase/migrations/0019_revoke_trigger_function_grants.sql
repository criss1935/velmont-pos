-- Quita EXECUTE a anon/authenticated sobre las funciones de trigger.
--
-- Supabase concede EXECUTE a todo el mundo por defecto sobre cualquier función
-- del esquema `public`, incluidas las que solo existen para colgarse de un
-- trigger. El advisor de seguridad las marca como "SECURITY DEFINER ejecutable
-- por anónimos", que suena peor de lo que es: PostgREST ni siquiera las publica
-- (devuelven `trigger`, no un tipo del API) y llamarlas directo da 404. Se
-- verificó contra el REST API antes de escribir esto.
--
-- Aun así se revocan: no hay ninguna razón para que estén concedidas, y dejar
-- el advisor limpio hace que la próxima advertencia real no se pierda entre
-- ruido conocido.
--
-- Revocar EXECUTE no rompe los triggers: PostgreSQL no comprueba ese permiso
-- cuando dispara uno, solo cuando alguien llama a la función por su nombre.

revoke execute on function public.apply_order_discount()        from anon, authenticated;
revoke execute on function public.apply_supply_movement()       from anon, authenticated;
revoke execute on function public.guard_profile_privileges()    from anon, authenticated;
revoke execute on function public.guard_supply_stock()          from anon, authenticated;
revoke execute on function public.handle_new_user()             from anon, authenticated;
revoke execute on function public.log_order_status_change()     from anon, authenticated;
revoke execute on function public.recalc_order_totals()         from anon, authenticated;
revoke execute on function public.touch_updated_at()            from anon, authenticated;

-- NO se tocan `is_admin()` ni `is_staff()`, aunque el advisor también las marque.
--
-- Las llaman las políticas RLS, y una expresión de política se evalúa con los
-- privilegios de quien hace la consulta: si se le quita EXECUTE a `anon`, sus
-- consultas dejarían de devolver vacío y empezarían a reventar con un error de
-- permisos. El resultado neto sería peor, no mejor — hoy un anónimo recibe
-- `200 []`, que es exactamente lo que debe recibir. Ambas devuelven `false`
-- sin sesión, así que no filtran nada.
