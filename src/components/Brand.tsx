import styles from './Brand.module.css'
import { cn } from '@/lib/cn'

/**
 * ⚠️ PROVISIONAL — este NO es el logo de Velmont.
 *
 * Es un marcador de posición construido con los colores de marca, para que la
 * app no se vea rota mientras llega el archivo real. Cuando esté el logo, se
 * sustituye SOLO este componente (y `public/brand/`): ninguna pantalla dibuja
 * la marca por su cuenta, todas pasan por aquí.
 */
export function Brand({
  size = 'md',
  showWordmark = true,
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  showWordmark?: boolean
  className?: string
}) {
  return (
    <div className={cn(styles.brand, styles[size], className)}>
      <svg className={styles.mark} viewBox="0 0 40 40" role="img" aria-label="Velmont">
        {/* Monograma: una V trazada como el filo de un corte, no como una letra
            de fuente. El degradado va de bronce a dorado claro en la diagonal. */}
        <defs>
          <linearGradient id="vm-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--vm-gold-600)" />
            <stop offset="50%" stopColor="var(--vm-gold-300)" />
            <stop offset="100%" stopColor="var(--vm-gold-500)" />
          </linearGradient>
        </defs>

        <rect
          x="0.75"
          y="0.75"
          width="38.5"
          height="38.5"
          rx="7"
          fill="var(--vm-surface-2)"
          stroke="url(#vm-gold)"
          strokeWidth="1.5"
        />
        <path
          d="M11 12 L20 28 L29 12"
          fill="none"
          stroke="url(#vm-gold)"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {showWordmark && (
        <span className={styles.wordmark}>
          Velmont
          <span className={styles.tagline}>Cuidado de calzado</span>
        </span>
      )}
    </div>
  )
}
