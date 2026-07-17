import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Badge.module.css'

export type BadgeTone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  tone?: BadgeTone
  /** Punto de color a la izquierda — para estados. */
  dot?: boolean
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', dot = false, children, className }: BadgeProps) {
  return (
    <span className={cn(styles.badge, styles[tone], className)}>
      {dot && <span className={styles.dot} aria-hidden />}
      {children}
    </span>
  )
}
