import { useRef, useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DIAGRAM_MARK_TYPES, type DiagramMark, type DiagramMarkType } from '@/data'
import styles from './Reception.module.css'

/**
 * Diagrama de observaciones del sneaker.
 *
 * El empleado toca una zona de la silueta y se crea un marcador numerado; luego
 * elige el tipo y una descripción. Las coordenadas se guardan RELATIVAS (0..1) al
 * recuadro, así el marcador cae en el mismo punto en cualquier tamaño de pantalla.
 *
 * Silueta propia en SVG (no una imagen externa): entona con el sistema Velmont y
 * escala sin pixelarse en la tablet.
 */
export function SneakerDiagram({
  marks,
  onChange,
  readOnly = false,
}: {
  marks: DiagramMark[]
  onChange?: (marks: DiagramMark[]) => void
  readOnly?: boolean
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<DiagramMark | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function handleTap(event: React.MouseEvent<HTMLDivElement>) {
    if (readOnly || !surfaceRef.current) return
    // No crear marcador si se tocó uno existente (ese abre su edición).
    if ((event.target as HTMLElement).closest('[data-mark]')) return

    const rect = surfaceRef.current.getBoundingClientRect()
    const xRel = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const yRel = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    const idx = marks.reduce((max, m) => Math.max(max, m.idx), 0) + 1

    setEditingId(null)
    setDraft({ idx, xRel, yRel, type: 'Rayón', description: '' })
  }

  function commitDraft(type: DiagramMarkType, description: string) {
    if (!draft || !onChange) return
    const clean = description.trim() || null

    if (editingId) {
      onChange(marks.map((m) => (markKey(m) === editingId ? { ...m, type, description: clean } : m)))
    } else {
      onChange([...marks, { ...draft, type, description: clean }])
    }
    setDraft(null)
    setEditingId(null)
  }

  function editMark(mark: DiagramMark) {
    if (readOnly) return
    setEditingId(markKey(mark))
    setDraft(mark)
  }

  function removeMark(mark: DiagramMark) {
    if (!onChange) return
    // Se renumeran para que la secuencia visible siga siendo 1, 2, 3…
    const remaining = marks
      .filter((m) => markKey(m) !== markKey(mark))
      .map((m, i) => ({ ...m, idx: i + 1 }))
    onChange(remaining)
    setDraft(null)
    setEditingId(null)
  }

  return (
    <div className={styles.diagram}>
      <div
        ref={surfaceRef}
        className={cn(styles.diagramSurface, !readOnly && styles.diagramInteractive)}
        onClick={handleTap}
        role={readOnly ? undefined : 'button'}
        aria-label={readOnly ? 'Diagrama de observaciones' : 'Toca una zona para marcar una observación'}
      >
        <SneakerSilhouette />

        {marks.map((mark) => (
          <span
            key={markKey(mark)}
            data-mark
            className={styles.diagramMark}
            style={{ left: `${mark.xRel * 100}%`, top: `${mark.yRel * 100}%` }}
            onClick={() => editMark(mark)}
            title={mark.type}
          >
            {mark.idx}
          </span>
        ))}

        {!readOnly && marks.length === 0 && (
          <span className={styles.diagramHint}>Toca el tenis donde veas un daño</span>
        )}
      </div>

      {marks.length > 0 && (
        <ol className={styles.markList}>
          {marks.map((mark) => (
            <li key={markKey(mark)} className={styles.markItem}>
              <span className={styles.markBadge}>{mark.idx}</span>
              <div className={styles.markBody}>
                <span className={styles.markType}>{mark.type}</span>
                {mark.description && <span className={styles.markDesc}>{mark.description}</span>}
              </div>
              {!readOnly && (
                <button type="button" className={styles.markRemove} onClick={() => removeMark(mark)}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {draft && (
        <MarkModal
          mark={draft}
          onCancel={() => {
            setDraft(null)
            setEditingId(null)
          }}
          onSave={commitDraft}
        />
      )}
    </div>
  )
}

/** Clave estable del marcador: id de la base si existe, o su índice capturado. */
function markKey(mark: DiagramMark): string {
  return mark.id ?? `local-${mark.idx}`
}

function MarkModal({
  mark,
  onCancel,
  onSave,
}: {
  mark: DiagramMark
  onCancel: () => void
  onSave: (type: DiagramMarkType, description: string) => void
}) {
  const [type, setType] = useState<DiagramMarkType>(mark.type)
  const [description, setDescription] = useState(mark.description ?? '')

  return (
    <Modal
      open
      onClose={onCancel}
      title={`Observación ${mark.idx}`}
      description="Marca el tipo de daño y descríbelo si hace falta."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => onSave(type, description)}>
            Guardar observación
          </Button>
        </>
      }
    >
      <div className={styles.markForm}>
        <div className={styles.markTypes}>
          {DIAGRAM_MARK_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              className={cn(styles.markTypeChip, type === option && styles.markTypeChipActive)}
              onClick={() => setType(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <Input
          label="Descripción (opcional)"
          placeholder="Ej. Rayón profundo en lateral exterior"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Modal>
  )
}

/** Silueta de sneaker de perfil, trazada al estilo de la marca. */
function SneakerSilhouette() {
  return (
    <svg className={styles.diagramSvg} viewBox="0 0 320 180" role="img" aria-label="Silueta de tenis">
      <g
        fill="none"
        stroke="var(--vm-border-strong)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Suela */}
        <path
          d="M18 150 Q14 132 40 130 L280 128 Q300 128 302 140 Q303 152 286 154 L44 156 Q22 156 18 150 Z"
          fill="var(--vm-surface-2)"
        />
        {/* Cuerpo del tenis (upper) */}
        <path
          d="M40 130 Q44 96 70 84 Q96 72 120 74 L150 52 Q168 44 182 60 L196 82 Q250 84 270 100 Q286 112 280 128 Z"
          fill="var(--vm-surface-1)"
        />
        {/* Puntera */}
        <path d="M40 130 Q54 112 84 110 Q92 122 88 130 Z" fill="var(--vm-surface-3)" />
        {/* Lengüeta */}
        <path d="M150 52 Q158 40 170 46 L182 60 Q170 62 160 70 Z" />
        {/* Cordones */}
        <path d="M120 82 L150 70 M126 96 L158 84 M134 110 L168 98" stroke="var(--vm-gold-500)" />
        {/* Costura del talón */}
        <path d="M270 100 Q276 114 272 128" />
      </g>
    </svg>
  )
}
