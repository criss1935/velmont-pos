import { Brand } from './Brand'
import styles from './Splash.module.css'

/** Pantalla de arranque, mientras se restaura la sesión guardada. */
export function Splash() {
  return (
    <div className={styles.splash}>
      <Brand size="lg" />
    </div>
  )
}
