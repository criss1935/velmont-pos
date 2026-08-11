-- =============================================================================
-- Normalización de nombres en item_types / condition_options
--
-- El `unique` original es case-sensitive: "Tenis" y "tenis" no chocan hoy, y
-- tampoco un espacio de más ("Rayones " vs "Rayones"). Es un hueco real de
-- integridad para catálogos que un admin va a estar editando desde una
-- pantalla — se cierra con un índice único funcional, sin cambiar el tipo de
-- columna ni tocar cómo se guardan las órdenes (item_type/condition_tags
-- siguen siendo texto congelado, ver plan: no hay problema de integridad
-- histórica que resolver ahí).
-- =============================================================================

create unique index item_types_name_normalized_key
  on item_types (lower(trim(name)));

create unique index condition_options_label_normalized_key
  on condition_options (lower(trim(label)));
