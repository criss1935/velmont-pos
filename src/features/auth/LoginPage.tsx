import { useState, type FormEvent } from 'react'
import { Brand } from '@/components/Brand'
import { Button, Input } from '@/components/ui'
import { auth, DataError } from '@/data'
import { useSession } from '@/app/session'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const bootstrap = useSession((state) => state.bootstrap)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      await auth.signIn(email.trim(), password)
      // El guardia de rutas reacciona al perfil, así que basta con recargarlo:
      // no hace falta navegar a mano.
      await bootstrap()
    } catch (cause) {
      setError(cause instanceof DataError ? cause.message : 'No se pudo iniciar sesión.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Brand size="lg" />
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <Input
            label="Correo"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Input
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Entrar
          </Button>
        </form>

        <p className={styles.footer}>Punto de venta</p>
      </div>
    </div>
  )
}
