import { isStorageError } from '@supabase/storage-js'
import { supabase } from '../client'
import { DataError } from '../errors'
import { isOfflineEnabled } from '../offline/flag'
import { insertIdempotent } from '../offline/idempotent'
import { isNetworkError } from '../offline/network'
import { enqueue, storeBlob } from '../offline/queue'
import type { ReceptionPhoto } from '../types'

const BUCKET = 'order-media'

/** URL pública de un objeto del bucket, lista para <img src>. Pura construcción de
 * texto — no hace ninguna llamada de red, así que funciona igual si el archivo
 * todavía no se ha subido de verdad (recepción offline). */
export function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

function extensionOf(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

/** Ruta derivable sin red — se puede pasar al RPC de recepción aunque la subida real esté pendiente. */
export function receptionPhotoPath(orderId: string, articleId: string, mimeType: string): string {
  return `orders/${orderId}/${articleId}/${crypto.randomUUID()}.${extensionOf(mimeType)}`
}

export function newSignaturePath(): string {
  return `signatures/${crypto.randomUUID()}.png`
}

/**
 * Sube un binario a Storage. `storage-js` sí rechaza la promesa (a diferencia
 * de postgrest-js): un `StorageUnknownError` (no hubo respuesta real) se deja
 * pasar tal cual para que `isNetworkError` lo reconozca; un `StorageApiError`
 * (el servidor SÍ respondió — bucket, RLS, validación) se traduce.
 *
 * `upsert: true` a propósito: la ruta es client-generada y estable frente a un
 * reintento (la respuesta del primer intento pudo perderse aunque el archivo
 * ya hubiera llegado) — un segundo intento al MISMO path debe poder
 * sobrescribir en vez de fallar con "ya existe".
 */
async function uploadBlob(path: string, file: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType, upsert: true })
  if (!error) return

  if (isStorageError(error) && error.name !== 'StorageUnknownError') {
    throw new DataError('No se pudo subir el archivo.')
  }
  throw error
}

export interface ReceptionPhotoDraft {
  id: string
  orderId: string
  articleId: string
  path: string
  classification: string | null
  sortOrder: number
}

interface PhotoRow {
  id: string
  storage_path: string
  classification: string | null
}

/**
 * Aplica la subida + el registro de fila contra Supabase. Es la MISMA función
 * que usa la ruta feliz (abajo) y el motor de sync al drenar la cola.
 * Idempotente: un reintento con el mismo `id` de fila devuelve la fila que ya
 * se insertó, en vez de duplicarla.
 */
export async function applyUploadReceptionPhoto(
  draft: ReceptionPhotoDraft,
  file: Blob,
  contentType: string,
): Promise<ReceptionPhoto> {
  await uploadBlob(draft.path, file, contentType)

  const row = await insertIdempotent<PhotoRow>(
    () =>
      supabase
        .from('order_photos')
        .insert({
          id: draft.id,
          order_id: draft.orderId,
          article_id: draft.articleId,
          storage_path: draft.path,
          classification: draft.classification,
          sort_order: draft.sortOrder,
        })
        .select('id, storage_path, classification')
        .single(),
    () => supabase.from('order_photos').select('id, storage_path, classification').eq('id', draft.id).single(),
  )

  return {
    id: row.id,
    storagePath: row.storage_path,
    url: publicUrl(row.storage_path),
    classification: row.classification,
  }
}

/**
 * Sube una foto de evidencia y registra su fila. Se llama DESPUÉS de crear la
 * orden (necesita el order_id y el article_id para la ruta). Storage no
 * participa de la transacción de Postgres — por eso las fotos van en una
 * segunda fase, tanto si hubo red como si no.
 *
 * `dependsOn`: si la orden/artículo todavía no existen en el servidor (la
 * recepción misma quedó encolada), esta foto debe esperar a que esa mutación
 * termine — si no, el insert de `order_photos` fallaría por llave foránea (un
 * error real, no de red) y la foto quedaría marcada como fallida sin remedio.
 */
export async function uploadReceptionPhoto(input: {
  orderId: string
  articleId: string
  file: File
  classification?: string | null
  sortOrder?: number
  dependsOn?: string[]
}): Promise<ReceptionPhoto> {
  const draft: ReceptionPhotoDraft = {
    id: crypto.randomUUID(),
    orderId: input.orderId,
    articleId: input.articleId,
    path: receptionPhotoPath(input.orderId, input.articleId, input.file.type),
    classification: input.classification?.trim() || null,
    sortOrder: input.sortOrder ?? 0,
  }

  try {
    return await applyUploadReceptionPhoto(draft, input.file, input.file.type)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    await storeBlob(draft.id, input.file)
    await enqueue({
      type: 'photos.uploadReceptionPhoto',
      entityId: draft.id,
      payload: draft as unknown as Record<string, unknown>,
      blobKeys: [draft.id],
      dependsOn: input.dependsOn ?? [],
    })

    return {
      id: draft.id,
      storagePath: draft.path,
      url: publicUrl(draft.path),
      classification: draft.classification,
    }
  }
}

/**
 * Aplica la subida de la firma. Reutilizada por la ruta feliz y por el motor
 * de sync. `upsert` por la misma razón que las fotos: el path es client-
 * generado y estable frente a reintento.
 */
export async function applyUploadSignature(path: string, blob: Blob): Promise<{ path: string; url: string }> {
  await uploadBlob(path, blob, 'image/png')
  return { path, url: publicUrl(path) }
}

/**
 * Sube la firma del cliente (PNG). No se ata al order_id porque se captura
 * antes de que exista la orden: se guarda bajo `signatures/` y su ruta se
 * pasa al RPC create_reception. La firma NUNCA viaja como string gigante en
 * la fila. La ruta es derivable sin red, así que se puede devolver de
 * inmediato aunque la subida real quede encolada.
 */
export async function uploadSignature(blob: Blob): Promise<{ path: string; url: string }> {
  const path = newSignaturePath()

  try {
    return await applyUploadSignature(path, blob)
  } catch (cause) {
    if (!isOfflineEnabled() || !isNetworkError(cause)) throw cause

    const blobKey = crypto.randomUUID()
    await storeBlob(blobKey, blob)
    await enqueue({
      type: 'signature.upload',
      entityId: blobKey,
      payload: { path },
      blobKeys: [blobKey],
    })

    return { path, url: publicUrl(path) }
  }
}
