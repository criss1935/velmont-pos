-- =============================================================================
-- Inventario administrable
--
-- Completa lo que 0001/0002 dejó pendiente para que Inventario sea un módulo
-- de verdad: datos maestros editables (descripción), bitácora con snapshot de
-- stock antes/después, motivo obligatorio en ajustes, y la validación que
-- faltaba — el trigger de movimientos nunca impidió que el stock quedara
-- negativo.
-- =============================================================================

alter table supplies
  add column description text;

alter table supply_movements
  add column reference   text,
  -- No hay forma de reconstruir el histórico real de stock previo a esta
  -- migración, así que las filas existentes quedan con before = after (mismo
  -- valor que tiene la fila hoy): es una aproximación honesta, no un dato
  -- inventado. Los movimientos nuevos sí lo calculan de verdad (ver trigger).
  add column stock_before numeric(12, 3) not null default 0,
  add column stock_after  numeric(12, 3) not null default 0;

update supply_movements m
   set stock_before = s.stock,
       stock_after  = s.stock
  from supplies s
 where s.id = m.supply_id;

-- El motivo es la defensa del negocio ante un ajuste ("¿por qué cambió el
-- stock sin que hubiera compra ni consumo?"). Para compra/consumo/merma la
-- nota sigue siendo opcional: el tipo de movimiento ya explica qué pasó.
alter table supply_movements
  add constraint supply_movements_ajuste_requires_note
  check (type <> 'ajuste' or note is not null);

-- El trigger original solo sumaba/restaba. Reescrito para: (1) negar el
-- movimiento si el resultado sería negativo — antes nada lo impedía — y
-- (2) dejar grabado en la propia fila de movimiento el stock antes y después,
-- que es lo que vuelve la bitácora auditable de verdad.
-- `set search_path = public`: 0003_harden_functions.sql ya lo había fijado con
-- un ALTER aparte, pero un CREATE OR REPLACE sin repetirlo lo resetea — hay que
-- incluirlo aquí también para no reabrir el hueco que 0003 cerró.
create or replace function apply_supply_movement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_stock numeric(12, 3);
  next_stock    numeric(12, 3);
begin
  select stock into current_stock from supplies where id = new.supply_id for update;

  next_stock := current_stock + case new.type
                                   when 'compra'  then new.quantity
                                   when 'ajuste'  then new.quantity
                                   when 'consumo' then -new.quantity
                                   when 'merma'   then -new.quantity
                                 end;

  if next_stock < 0 then
    raise exception
      'No hay stock suficiente: quedarían % unidades. Revisa la cantidad o registra antes una compra.',
      next_stock;
  end if;

  perform set_config('velmont.applying_movement', 'on', true);

  update supplies set stock = next_stock where id = new.supply_id;

  update supply_movements
     set stock_before = current_stock,
         stock_after  = next_stock
   where id = new.id;

  perform set_config('velmont.applying_movement', 'off', true);

  return null;
end;
$$;
