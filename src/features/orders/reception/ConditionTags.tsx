import { cn } from '@/lib/cn'
import styles from './Reception.module.css'

/**
 * Estado en que se recibe el artículo: chips grandes (touch) de selección
 * múltiple + una descripción libre. Es la constancia de cómo llegó el artículo;
 * se guarda con la orden y se imprime en la nota.
 */
export function ConditionTags({
  options,
  selected,
  onToggle,
  notes,
  onNotesChange,
}: {
  options: string[]
  selected: string[]
  onToggle: (label: string) => void
  notes: string
  onNotesChange: (notes: string) => void
}) {
  return (
    <div className={styles.condition}>
      <div className={styles.conditionChips}>
        {options.map((label) => {
          const active = selected.includes(label)
          return (
            <button
              key={label}
              type="button"
              className={cn(styles.conditionChip, active && styles.conditionChipActive)}
              onClick={() => onToggle(label)}
              aria-pressed={active}
            >
              {active && <span aria-hidden>✓ </span>}
              {label}
            </button>
          )
        })}
      </div>

      <label className={styles.conditionNotesLabel}>
        Observaciones adicionales
        <textarea
          className={styles.conditionNotes}
          rows={2}
          placeholder="Describe el estado con el que llega el artículo…"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      </label>
    </div>
  )
}
