import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui'
import { DataError, photos as photosRepo, type ReceptionPhoto } from '@/data'
import { compressImage } from '@/lib/image'
import { CLASSIFICATIONS } from '../photoClassifications'
import { PhotoGallery } from './PhotoGallery'
import styles from './PhotoEditor.module.css'

const MAX_PHOTOS = 20

/**
 * Evidencia fotográfica de una orden ya creada, editable.
 *
 * Pensado para el celular: la orden se levanta en la computadora (sin cámara) y
 * después alguien entra a la orden desde el teléfono, toma las fotos y las sube
 * aquí. Cada alta/baja queda en la bitácora de auditoría (trigger en la base).
 *
 * `editable=false` (orden entregada/cancelada, o fuera de modo edición) es la
 * misma galería de solo lectura de siempre.
 */
export function PhotoEditor({
  orderId,
  articleId,
  photos,
  editable,
  onChanged,
}: {
  orderId: string
  articleId: string | null
  photos: ReceptionPhoto[]
  editable: boolean
  onChanged: () => void
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [classification, setClassification] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ReceptionPhoto | null>(null)

  const room = MAX_PHOTOS - photos.length

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const files = Array.from(list).slice(0, Math.max(room, 0))
    if (files.length === 0) return

    setError(null)
    setProgress({ done: 0, total: files.length })

    let sortOrder = photos.length
    let failures = 0
    let lastError: string | null = null

    // Una por una: en datos móviles, subir varias en paralelo satura la
    // conexión y hace que todas tarden más (y que fallen juntas).
    for (const file of files) {
      try {
        const compressed = await compressImage(file)
        await photosRepo.addOrderPhoto({
          orderId,
          articleId,
          file: compressed,
          classification: classification || null,
          sortOrder: sortOrder++,
        })
      } catch (cause) {
        failures++
        lastError = cause instanceof DataError ? cause.message : 'No se pudo subir la foto.'
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    }

    setProgress(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''

    if (failures > 0) {
      setError(
        failures === files.length
          ? lastError
          : `${files.length - failures} de ${files.length} fotos subidas. ${lastError ?? ''}`,
      )
    }
    onChanged()
  }

  const remove = useMutation({
    mutationFn: (photo: ReceptionPhoto) => photosRepo.deleteOrderPhoto(photo),
    onSuccess: () => {
      setConfirming(null)
      onChanged()
    },
  })

  const busy = progress !== null

  return (
    <div className={styles.root}>
      <PhotoGallery
        photos={photos}
        {...(editable ? { onDelete: (photo: ReceptionPhoto) => setConfirming(photo) } : {})}
        emptyText={editable ? 'Aún no hay fotos. Toma o sube la primera.' : 'Sin fotografías registradas.'}
      />

      {editable && (
        <div className={styles.controls}>
          <select
            className={styles.select}
            value={classification}
            disabled={busy}
            onChange={(event) => setClassification(event.target.value)}
            aria-label="Clasificación de las próximas fotos"
          >
            <option value="">Sin clasificar</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className={styles.buttons}>
            <Button
              variant="primary"
              size="lg"
              disabled={room <= 0}
              loading={busy}
              onClick={() => cameraRef.current?.click()}
            >
              📷 Tomar foto
            </Button>
            <Button size="lg" disabled={room <= 0 || busy} onClick={() => galleryRef.current?.click()}>
              🖼️ Subir de galería
            </Button>
          </div>

          <p className={styles.hint}>
            {progress
              ? `Subiendo ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…`
              : room <= 0
                ? `Límite de ${MAX_PHOTOS} fotos alcanzado.`
                : `${photos.length}/${MAX_PHOTOS} fotos`}
          </p>

          {error && <p className={styles.error}>{error}</p>}

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
        </div>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => {
          setConfirming(null)
          remove.reset()
        }}
        title="¿Eliminar esta foto?"
        description="Se borra de la orden. El movimiento queda registrado en la bitácora."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(null)
                remove.reset()
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => confirming && remove.mutate(confirming)}
            >
              Sí, eliminar
            </Button>
          </>
        }
      >
        {confirming && (
          <img
            src={confirming.url}
            alt={confirming.classification ?? 'Foto a eliminar'}
            className={styles.preview}
          />
        )}
        {remove.error && (
          <p className={styles.error}>
            {remove.error instanceof DataError ? remove.error.message : 'No se pudo eliminar la foto.'}
          </p>
        )}
      </Modal>
    </div>
  )
}
