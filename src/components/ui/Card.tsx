import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import styles from './Card.module.css'

// `title` se omite del tipo nativo a propósito: en el DOM es el tooltip (string),
// y aquí es el encabezado de la tarjeta (ReactNode). Sin el Omit, chocan.
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Dibuja el filete dorado en el canto superior. */
  accent?: boolean
  /** Quita el padding del cuerpo — para tablas y listas a sangre. */
  flush?: boolean
  title?: ReactNode
  subtitle?: ReactNode
  /** Acciones alineadas a la derecha del encabezado. */
  actions?: ReactNode
  footer?: ReactNode
}

export function Card({
  accent = false,
  flush = false,
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(styles.card, accent && styles.accent, flush && styles.flush, className)}
      {...rest}
    >
      {(title || actions) && (
        <div className={styles.header}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}

      <div className={styles.body}>{children}</div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}
