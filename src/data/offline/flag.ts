/**
 * Interruptor maestro de la cola offline.
 *
 * Dos niveles: la variable de entorno (`VITE_OFFLINE_ENABLED`) es el default de
 * despliegue, apagado hasta validar cada fase. El override en `localStorage`
 * deja que un admin la prenda/apague en la tablet misma, sin esperar un
 * redeploy — para probar, o para apagarla de inmediato si algo falla en campo.
 */

const OVERRIDE_KEY = 'velmont:offline-flag'

function envDefault(): boolean {
  return import.meta.env.VITE_OFFLINE_ENABLED === 'true'
}

export function isOfflineEnabled(): boolean {
  const override = window.localStorage.getItem(OVERRIDE_KEY)
  if (override === 'on') return true
  if (override === 'off') return false
  return envDefault()
}

export function setOfflineOverride(value: 'on' | 'off' | null): void {
  if (value === null) {
    window.localStorage.removeItem(OVERRIDE_KEY)
  } else {
    window.localStorage.setItem(OVERRIDE_KEY, value)
  }
}
