-- =============================================================================
-- close_cash_session — corte de caja.
--
-- Por qué RPC: el "esperado" tiene que leerse en el MISMO instante en que se
-- congela el corte. Si el cliente lee el esperado, lo muestra, el operador
-- cuenta el dinero, y mientras tanto entra otro cobro en efectivo, cerrar con el
-- número que leyó al principio graba una diferencia falsa. Aquí el cálculo y el
-- cierre pasan dentro de la misma transacción.
--
-- La diferencia se guarda calculada (no derivada) a propósito: el corte es un
-- documento firmado. Debe seguir diciendo lo que decía el día que se firmó.
-- =============================================================================

create or replace function close_cash_session(
  p_session_id uuid,
  p_counted    integer,
  p_notes      text default null
)
returns cash_sessions
language plpgsql
set search_path = public
as $$
declare
  v_expected integer;
  v_session  cash_sessions;
begin
  if p_counted < 0 then
    raise exception 'El efectivo contado no puede ser negativo.';
  end if;

  -- `for update` bloquea la sesión: dos tablets no pueden cerrarla a la vez.
  perform 1 from cash_sessions where id = p_session_id and closed_at is null for update;

  if not found then
    raise exception 'Esa caja no existe o ya fue cerrada.';
  end if;

  select expected_cents into v_expected
    from cash_session_expected
   where cash_session_id = p_session_id;

  update cash_sessions
     set closed_at        = now(),
         closed_by        = auth.uid(),
         counted_cents    = p_counted,
         expected_cents   = v_expected,
         difference_cents = p_counted - v_expected,
         notes            = nullif(btrim(p_notes), '')
   where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function close_cash_session(uuid, integer, text) from public;
grant execute on function close_cash_session(uuid, integer, text) to authenticated;
