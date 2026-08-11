-- =============================================================================
-- Recepción a nivel de orden: firma del cliente + responsiva aceptada
--
-- La firma NO se guarda como string gigante en la fila: se sube como PNG al
-- bucket `order-media` y aquí solo queda su ruta. La responsiva es una sola por
-- recepción (cubre todos los artículos y evidencias).
-- =============================================================================

alter table orders
  add column signature_path         text,
  add column responsiva_accepted    boolean not null default false,
  add column responsiva_accepted_at timestamptz;
