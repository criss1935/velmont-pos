/**
 * Tipos de objetos de base de datos que YA existen en una migración pero que
 * todavía no están en `database.types.ts`.
 *
 * `database.types.ts` es generado (`supabase gen types`) y la regla 5 de
 * CLAUDE.md prohíbe editarlo a mano — con razón: cualquier retoque manual se
 * pierde en la siguiente regeneración, en silencio. Pero la migración 0020
 * (caja chica) se escribió sin acceso al proyecto remoto, así que el archivo
 * generado aún no la conoce y `supabase.from('petty_cash_movements')` no
 * compilaría.
 *
 * Este módulo es la conciliación: declara SOLO lo que agrega la 0020, en un
 * archivo aparte, y expone un cliente tipado con ello. La superficie es
 * mínima y vive en un único repositorio (`repositories/pettyCash.ts`).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TODO al aplicar la migración 0020 contra el proyecto:                    │
 * │   1. supabase db push                                                    │
 * │   2. supabase gen types typescript --project-id zagpfcaizhteizqlserj      │
 * │        > src/data/database.types.ts                                      │
 * │   3. borrar este archivo y cambiar `pendingDb` por `supabase` en          │
 * │      repositories/pettyCash.ts                                           │
 * │   4. correr el advisor de seguridad de Supabase (regla 4)                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './client'

export type PettyCashMovementType = 'fondeo' | 'gasto'

/*
 * `type` y no `interface`, aquí y abajo, a propósito.
 *
 * `GenericSchema` de postgrest-js exige `Row: Record<string, unknown>`. Un
 * alias de tipo satisface ese índice implícitamente; una interfaz NO — TypeScript
 * se lo niega porque una interfaz puede ampliarse por declaración más tarde y
 * dejar de cumplirlo. El schema entero se colapsa entonces a `never` y cada
 * columna del resultado se vuelve un error, que es justo lo que pasaba.
 */
type PettyCashMovementRow = {
  id: string
  type: PettyCashMovementType
  amount_cents: number
  reason: string
  cash_session_id: string | null
  created_by: string | null
  created_at: string
}

type PettyCashBalanceRow = {
  funded_cents: number
  spent_cents: number
  balance_cents: number
}

export interface PendingDatabase {
  __InternalSupabase: { PostgrestVersion: '12' }
  public: {
    Tables: {
      petty_cash_movements: {
        Row: PettyCashMovementRow
        Insert: {
          id?: string
          type: PettyCashMovementType
          amount_cents: number
          reason: string
          cash_session_id?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<PettyCashMovementRow>
        Relationships: []
      }
    }
    Views: {
      petty_cash_balance: {
        Row: PettyCashBalanceRow
        // Una vista no se escribe, pero `GenericView` de supabase-js exige las
        // tres formas. `never` es la manera de decir "esta columna no se puede
        // insertar" — es lo mismo que emite `supabase gen types` para
        // `cash_session_expected`.
        Insert: { funded_cents?: never; spent_cents?: never; balance_cents?: never }
        Update: { funded_cents?: never; spent_cents?: never; balance_cents?: never }
        Relationships: []
      }
    }
    Functions: {
      fund_petty_cash: {
        Args: {
          p_movement_id: string
          p_cash_movement_id: string
          p_session_id: string
          p_amount: number
          p_reason: string
        }
        Returns: undefined
      }
    }
    Enums: {
      petty_cash_movement_type: PettyCashMovementType
    }
    CompositeTypes: Record<never, never>
  }
}

/**
 * El mismo cliente de siempre (misma sesión, mismo storage, misma conexión):
 * solo cambia el tipo con el que se mira. No se crea un segundo cliente — dos
 * clientes de supabase-js sobre el mismo storage pelean por el refresh del
 * token y acaban cerrando la sesión del operador a media venta.
 */
export const pendingDb = supabase as unknown as SupabaseClient<PendingDatabase>
