-- =============================================================================
-- Catálogo inicial de Velmont.
--
-- ⚠️ LOS PRECIOS SON UNA PROPUESTA, NO UN DATO. Están puestos para que el
-- sistema arranque con algo usable; hay que confirmarlos con el cliente antes
-- de operar. Se cargan en centavos (15000 = $150.00).
--
-- Idempotente: se puede volver a correr sin duplicar.
-- =============================================================================

insert into service_categories (name, sort_order) values
  ('Tenis',   1),
  ('Bolsas',  2),
  ('Gorras',  3),
  ('Extras',  4)
on conflict (name) do nothing;

insert into services (category_id, name, description, price_cents, estimated_days, sort_order)
select c.id, s.name, s.description, s.price_cents, s.estimated_days, s.sort_order
from (values
  -- Tenis — el núcleo del negocio.
  ('Tenis',  'Limpieza básica',        'Exterior, suela y agujetas.',                     15000, 2, 1),
  ('Tenis',  'Limpieza profunda',      'Básica + interior, entresuela y desmanchado.',    25000, 3, 2),
  ('Tenis',  'Restauración premium',   'Profunda + retoque de color y recuperación.',     45000, 5, 3),
  ('Tenis',  'Limpieza express',       'Limpieza básica el mismo día.',                   22000, 0, 4),
  ('Tenis',  'Blanqueado de suela',    'Recupera la suela amarillenta.',                  12000, 2, 5),

  -- Bolsas y gorras — la expansión que ya está contemplada.
  ('Bolsas', 'Limpieza de bolsa',      'Limpieza exterior e interior.',                   30000, 3, 1),
  ('Gorras', 'Limpieza de gorra',      'Limpieza sin deformar la visera.',                12000, 2, 1),

  -- Extras — se suman como línea adicional a un servicio principal.
  ('Extras', 'Impermeabilizado',       'Capa protectora repelente al agua.',              10000, 0, 1),
  ('Extras', 'Cambio de agujetas',     'Agujetas nuevas.',                                 5000, 0, 2),
  ('Extras', 'Desodorizado',           'Tratamiento antibacterial del interior.',          6000, 0, 3)
) as s(category, name, description, price_cents, estimated_days, sort_order)
join service_categories c on c.name = s.category
where not exists (
  select 1 from services existing where existing.name = s.name
);

-- Insumos base, para que el módulo de inventario tenga de dónde partir.
insert into supplies (name, unit, stock, min_stock) values
  ('Shampoo para calzado',   'ml',     0, 1000),
  ('Limpiador de suela',     'ml',     0,  500),
  ('Impermeabilizante',      'ml',     0,  500),
  ('Cepillo suave',          'pieza',  0,    3),
  ('Cepillo de cerda dura',  'pieza',  0,    3),
  ('Paño de microfibra',     'pieza',  0,   10),
  ('Agujetas blancas',       'par',    0,   10),
  ('Agujetas negras',        'par',    0,   10)
on conflict (name) do nothing;
