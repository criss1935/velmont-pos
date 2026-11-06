import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { toDateInput } from '@/lib/dates'
import { PERIOD_PRESETS, periodLabel } from '@/lib/period'
import type { Period } from './usePeriod'
import styles from './PeriodPicker.module.css'


/** Atajos de periodo (chips deslizables) + fechas personalizadas, como en el POS de Tori Hana. */
export function PeriodPicker({ period, allowAll = false }: { period: Period; allowAll?: boolean }) {
  const today = toDateInput(new Date())
  const presets = PERIOD_PRESETS.filter((p) => allowAll || p.id !== 'todo')

  return (
    <div className={styles.wrap}>
      <div className={styles.chips} role="tablist" aria-label="Periodo">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period.preset === p.id}
            className={cn(styles.chip, period.preset === p.id && styles.chipActive)}
            onClick={() => {
              // Al abrir «Personalizado» se parte del rango que ya se estaba viendo.
              if (p.id === 'custom' && !period.custom.from) {
                period.setCustom({ from: period.range.from ?? today, to: period.range.to ?? today })
              }
              period.setPreset(p.id)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period.preset === 'custom' && (
        <div className={styles.dates}>
          <Input
            className={styles.dateField}
            type="date"
            label="Desde"
            max={today}
            value={period.custom.from ?? ''}
            onChange={(e) => period.setCustom({ ...period.custom, from: e.target.value || null })}
          />
          <Input
            className={styles.dateField}
            type="date"
            label="Hasta"
            max={today}
            value={period.custom.to ?? ''}
            onChange={(e) => period.setCustom({ ...period.custom, to: e.target.value || null })}
          />
        </div>
      )}

      <p className={styles.label}>{periodLabel(period.range)}</p>
    </div>
  )
}
