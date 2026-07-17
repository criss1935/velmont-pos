import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y rellénalos.',
  )
}

/**
 * Cliente de Supabase.
 *
 * Este módulo es la ÚNICA parte de la app que lo importa. Todo lo demás pasa por
 * los repositorios de `src/data/repositories`. Esa frontera es lo que después
 * permite meter una cola offline (o cambiar de backend) sin tocar una sola
 * pantalla: si la UI llamara a Supabase directo, habría que reescribirla entera.
 */
export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
