import { useRef, useState } from 'react'
import type { DraftPhoto } from './store'
import styles from './Reception.module.css'

const CLASSIFICATIONS = [
  'Frontal',
  'Lateral izquierdo',
  'Lateral derecho',
  'Suela',
  'Detalle de daño',
  'Otro',
]

const MAX_PHOTOS = 10

/**
 * Evidencia fotográfica del artículo.
 *
 * Desde la tablet: tomar foto con la cámara (input capture) o elegir de la
 * galería. Las imágenes se comprimen en el cliente antes de guardarse en memoria
 * (se suben a Storage al finalizar) — nada de base64, y peso controlado.
 */
export function PhotoCapture({
  photos,
  onAdd,
  onUpdate,
  onRemove,
}: {
  photos: DraftPhoto[]
  onAdd: (files: File[]) => void
  onUpdate: (photoKey: string, classification: string | null) => void
  onRemove: (photoKey: string) => void
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const room = MAX_PHOTOS - photos.length

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setBusy(true)
    try {
      const files = Array.from(list).slice(0, room)
      const compressed = await Promise.all(files.map(compressImage))
      onAdd(compressed)
    } finally {
      setBusy(false)
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  return (
    <div className={styles.photos}>
      <div className={styles.photoActions}>
        <button
          type="button"
          className={styles.photoButton}
          disabled={room <= 0 || busy}
          onClick={() => cameraRef.current?.click()}
        >
          <span aria-hidden>📷</span> Tomar foto
        </button>
        <button
          type="button"
          className={styles.photoButton}
          disabled={room <= 0 || busy}
          onClick={() => galleryRef.current?.click()}
        >
          <span aria-hidden>🖼️</span> Elegir imagen
        </button>
        <span className={styles.photoCount}>
          {photos.length}/{MAX_PHOTOS}
        </span>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {photos.length === 0 ? (
        <p className={styles.photoEmpty}>Aún no hay fotografías del artículo.</p>
      ) : (
        <div className={styles.photoGrid}>
          {photos.map((photo) => (
            <figure key={photo.key} className={styles.photoCard}>
              <img src={photo.url} alt="Evidencia" className={styles.photoImg} />
              <button
                type="button"
                className={styles.photoRemove}
                onClick={() => onRemove(photo.key)}
                aria-label="Quitar foto"
              >
                ✕
              </button>
              <select
                className={styles.photoSelect}
                value={photo.classification ?? ''}
                onChange={(event) => onUpdate(photo.key, event.target.value || null)}
              >
                <option value="">Sin clasificar</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Reduce la imagen a un máximo de 1600px y la reencoda a JPEG ~0.8. Una foto de
 * cámara de tablet pasa de varios MB a unos cientos de KB sin pérdida visible en
 * un ticket ni en la galería del detalle.
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    )
    if (!blob) return file

    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    // Si el navegador no puede procesarla, se sube tal cual.
    return file
  }
}
