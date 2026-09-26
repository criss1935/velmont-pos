import { useRef, useState } from 'react'
import { compressImage } from '@/lib/image'
import { CLASSIFICATIONS } from '../photoClassifications'
import type { DraftPhoto } from './store'
import styles from './Reception.module.css'

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
