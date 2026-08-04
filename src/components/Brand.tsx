import styles from './Brand.module.css'
import { cn } from '@/lib/cn'

/**
 * La marca Velmont. Única fuente del logo en toda la app.
 *
 * El emblema (`public/brand/emblem.png`) se extrae del arte oficial con
 * `node scripts/make-brand-assets.mjs`; no se dibuja aquí ni se retoca a mano.
 * Ninguna pantalla pinta la marca por su cuenta: login, splash y sidebar pasan
 * todas por este componente, así que cambiar el logo es cambiar el asset.
 *
 * PENDIENTE: el emblema es PNG porque el original es un PDF de Illustrator y
 * ninguna herramienta de esta máquina convierte PDF a SVG. Con un SVG exportado
 * desde Illustrator escalaría sin límite y pesaría una fracción — cuando exista,
 * se sustituye el <img> por el <svg> y este componente no cambia más.
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
      <img
        className={styles.mark}
        src="/brand/emblem.png"
        srcSet="/brand/emblem.png 1x, /brand/emblem@2x.png 2x"
        alt="Velmont"
        width={129}
        height={128}
        // Es lo primero que se ve al abrir; que no espere al resto del layout.
        fetchPriority="high"
      />

      {showWordmark && (
        <span className={styles.wordmark}>
          <span className={styles.word}>
            {/* La V va en el degradado dorado del arte oficial y el resto en el
                color de texto del contexto. Se parte en dos <span> porque el
                degradado necesita recortarse contra el glifo, y eso no se puede
                aplicar a una sola letra sin envolverla. */}
            <span className={styles.wordGold}>V</span>ELMONT
          </span>
          <span className={styles.tagline}>Luxury Shoe Care</span>
          <span className={styles.claim}>El lujo también se cuida</span>
        </span>
      )}
    </div>
  )
}
