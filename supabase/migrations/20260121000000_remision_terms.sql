-- =============================================================================
-- Términos de responsiva para la nota de remisión
--
-- La nota de remisión (documents.ts → remisionDocument) imprime
-- `reception_terms` — el mismo texto que el cliente ve en pantalla en el paso
-- Responsiva del wizard. El texto acordado con el negocio sustituye al
-- placeholder genérico con el que nació la columna en 0006.
--
-- El UPDATE solo toca filas que aún traen el placeholder original: si el
-- admin ya personalizó los términos desde /configuracion, su texto se
-- respeta.
-- =============================================================================

alter table business_settings
  alter column reception_terms set default
'El negocio no se hace responsable por fallas ocultas, desgastes previos o daños causados por materiales que no hayan sido reportados por el cliente al momento de la entrega.

Para tenis con un valor comercial elevado, el cliente deberá presentar el ticket de compra o las especificaciones del calzado al momento de la entrega, con el fin de establecer el valor real y las responsabilidades correspondientes.

Se requiere un anticipo del 50% del costo del servicio al dejar el trabajo, y el 50% restante al finalizar y entregar el producto.';

update business_settings
set reception_terms = default
where reception_terms =
  'El cliente confirma que el estado del artículo, las observaciones y las evidencias registradas corresponden a las condiciones en que el artículo fue entregado al establecimiento.';
