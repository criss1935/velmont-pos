import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Page.module.css'

export function Page({
  title,
  subtitle,
  actions,
  flush = false,
  scrollActions = false,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Sin padding en el cuerpo: la pantalla gestiona su propio layout. */
  flush?: boolean
  /** En celular, las acciones van en una sola fila que se desliza en vez de apilarse. */
  scrollActions?: boolean
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && (
          <div className={cn(styles.actions, scrollActions && styles.actionsScroll)}>{actions}</div>
        )}
      </header>

      <div className={cn(styles.body, flush ? styles.flush : 'vm-scroll')}>{children}</div>
    </div>
  )
}
