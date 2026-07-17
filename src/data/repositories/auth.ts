import { supabase } from '../client'
import { DataError, unwrapMaybe } from '../errors'
import { readThrough } from '../offline/cache'
import type { Profile } from '../types'

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // El mensaje crudo de Supabase viene en inglés y no le sirve al operador.
    if (error.message.includes('Invalid login credentials')) {
      throw new DataError('Correo o contraseña incorrectos.')
    }
    throw new DataError(error.message)
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new DataError(error.message)
}

/**
 * Perfil del usuario en sesión, o null si no hay sesión.
 *
 * Devuelve null también si el empleado fue desactivado: RLS ya le habría negado
 * todo lo demás, así que es mejor tratarlo como "no está dentro" desde el
 * arranque, y no dejarlo entrar a una app que va a fallar en cada pantalla.
 *
 * `getSession()` lee la sesión de `localStorage` (no depende de red salvo que
 * el token ya haya expirado). La fila de `profiles` sí es una llamada de red
 * real — y esta función corre en CADA arranque de la app (`bootstrap()`, sin
 * try/catch): si fallara sin más, la tablet se quedaría en el splash para
 * siempre en un arranque en frío sin conexión. Por eso va envuelta en
 * `readThrough`: sin red, sirve el último perfil conocido de este usuario.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: session } = await supabase.auth.getSession()
  const userId = session.session?.user.id
  if (!userId) return null

  const { value: row } = await readThrough(`auth:profile:${userId}`, async () =>
    unwrapMaybe(
      // `.retry(false)`: postgrest-js reintenta un GET hasta 3 veces con
      // backoff antes de resolver en error — sin esto, cada arranque en frío
      // sin señal tarda varios segundos de más antes de caer al caché.
      await supabase
        .from('profiles')
        .select('id, full_name, role, active')
        .eq('id', userId)
        .retry(false)
        .maybeSingle(),
    ),
  )

  if (!row || !row.active) return null

  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role === 'admin' ? 'admin' : 'operador',
    active: row.active,
  }
}

/** Notifica cambios de sesión (login, logout, expiración del token). */
export function onAuthChange(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange(() => callback())
  return () => data.subscription.unsubscribe()
}

/**
 * Id del usuario en sesión, o null. Lectura local (`getSession()`, sin red
 * salvo token expirado) — para sellar `created_by`/`opened_by` en los inserts
 * directos que no pasan por una función RPC (esas ya usan `auth.uid()` del
 * lado del servidor; los inserts planos desde el cliente no lo hacían).
 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}
