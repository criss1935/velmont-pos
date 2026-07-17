-- =============================================================================
-- Storage: bucket `order-media`  (fotos de recepción + firma)
--
-- Bucket PÚBLICO por decisión de operación: las evidencias se muestran con la
-- URL directa, sin firmar. La lectura es pública; escribir/borrar exige un
-- empleado autenticado (is_staff). Los archivos NUNCA se guardan como base64 en
-- las tablas: viven aquí, y las tablas solo guardan la ruta.
--
-- Estructura de rutas:
--   orders/{order_id}/{article_id}/{uuid}.jpg   — fotos del artículo
--   orders/{order_id}/signature.png             — firma del cliente
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-media',
  'order-media',
  true,
  10485760,                                   -- 10 MB por archivo
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública de los objetos del bucket (el bucket es público).
create policy "order_media_read"
  on storage.objects for select
  to public
  using (bucket_id = 'order-media');

-- Subir: solo personal autenticado.
create policy "order_media_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'order-media' and public.is_staff());

-- Reemplazar (upsert de la firma, por ejemplo): solo personal.
create policy "order_media_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'order-media' and public.is_staff())
  with check (bucket_id = 'order-media' and public.is_staff());

-- Borrar (quitar una foto antes de finalizar): solo personal.
create policy "order_media_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'order-media' and public.is_staff());
