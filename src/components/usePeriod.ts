import { useMemo, useState } from 'react'
import { presetRange, type PeriodPreset, type PeriodRange } from '@/lib/period'

export function usePeriod(initial: PeriodPreset) {
  const [preset, setPreset] = useState<PeriodPreset>(initial)
  const [custom, setCustom] = useState<PeriodRange>({ from: null, to: null })
  // El rango se recalcula al cambiar de preset; "hoy" se toma al momento.
  const range = useMemo(() => presetRange(preset, custom), [preset, custom])
  return { preset, setPreset, custom, setCustom, range }
}

export type Period = ReturnType<typeof usePeriod>
