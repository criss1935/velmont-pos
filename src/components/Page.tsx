import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Page.module.css'

export function Page({
  title,
  subtitle,
  actions,
  flush = false,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Sin padding en el cuerpo: la pantalla gestiona su propio layout. */
  flush?: boolean
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>

      <div className={cn(styles.body, flush ? styles.flush : 'vm-scroll')}>{children}</div>
    </div>
  )
}
