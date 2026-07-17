import { useState } from 'react'
import { Modal } from '@/components/ui'
import type { ReceptionPhoto } from '@/data'
import styles from './PhotoGallery.module.css'

/**
 * Evidencia fotográfica de un artículo, en modo lectura.
 *
 * Miniaturas con `loading="lazy"`: en una orden con varios artículos y varias
 * fotos cada uno, cargar todo de golpe es exactamente el escenario que el
 * atributo nativo evita — el navegador solo pide el archivo cuando la
 * miniatura entra en viewport, sin librería adicional.
 */
export function PhotoGallery({ photos }: { photos: ReceptionPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const current = openIndex === null ? null : photos[openIndex]

  if (photos.length === 0) {
    return <p className={styles.empty}>Sin fotografías registradas.</p>
  }

  return (
    <>
      <div className={styles.grid}>
        {photos.map((photo, index) => (
          <Thumbnail key={photo.id} photo={photo} onOpen={() => setOpenIndex(index)} />
        ))}
      </div>

      <Modal
        open={current !== null}
        onClose={() => setOpenIndex(null)}
        title={current?.classification ?? `Foto ${(openIndex ?? 0) + 1} de ${photos.length}`}
        wide
      >
        {current && (
          <div className={styles.lightbox}>
            <FullImage photo={current} />
            {photos.length > 1 && (
              <div className={styles.lightboxNav}>
                <button
                  type="button"
                  className={styles.navButton}
                  onClick={() => setOpenIndex((openIndex! - 1 + photos.length) % photos.length)}
                >
                  ← Anterior
                </button>
                <span className={styles.navCount}>
                  {(openIndex ?? 0) + 1} / {photos.length}
                </span>
                <button
                  type="button"
                  className={styles.navButton}
                  onClick={() => setOpenIndex((openIndex! + 1) % photos.length)}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

function Thumbnail({ photo, onOpen }: { photo: ReceptionPhoto; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)

  return (
    <button type="button" className={styles.thumb} onClick={onOpen} disabled={failed}>
      {failed ? (
        <span className={styles.thumbError} aria-hidden>
          ✕
        </span>
      ) : (
        <img
          src={photo.url}
          alt={photo.classification ?? 'Evidencia fotográfica'}
          loading="lazy"
          className={styles.thumbImg}
          onError={() => setFailed(true)}
        />
      )}
      {photo.classification && !failed && (
        <span className={styles.thumbTag}>{photo.classification}</span>
      )}
    </button>
  )
}

function FullImage({ photo }: { photo: ReceptionPhoto }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <p className={styles.loadError}>No se pudo cargar esta fotografía.</p>
  }

  return (
    <img
      src={photo.url}
      alt={photo.classification ?? 'Evidencia fotográfica'}
      className={styles.lightboxImg}
      onError={() => setFailed(true)}
    />
  )
}
