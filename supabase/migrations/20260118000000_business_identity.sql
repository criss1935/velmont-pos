-- =============================================================================
-- Identidad del negocio en business_settings
--
-- El ticket (documents.ts) leía nombre/teléfono/dirección de VITE_BUSINESS_*
-- (variables de entorno, fijas al compilar) — cambiarlas exigía un redeploy.
-- Se mueven a la fila única de configuración, editable por admin desde la
-- pantalla, igual que ya pasó con el umbral de alto valor y los términos de
-- responsiva.
--
-- `logo_url` se agrega ahora (nullable, sin default) porque es barato y dejar
-- el hueco listo — pero el renderizado del logo en el ticket NO se construye
-- en esta migración: hoy no hay archivo de logo real ni soporte de imagen en
-- el sistema de bloques del ticket (ver documents.ts/types.ts). Se resuelve
-- cuando el cliente entregue el logo.
-- =============================================================================

alter table business_settings
  add column name    text not null default 'Velmont',
  add column phone    text not null default '',
  add column address  text not null default '',
  add column logo_url text;
