import { applyAddMovement, applyOpenSession } from '../repositories/cash'
import { applyCreateCustomer } from '../repositories/customers'
import { applyRecordPayment } from '../repositories/payments'
import { applyUploadReceptionPhoto, applyUploadSignature, type ReceptionPhotoDraft } from '../repositories/photos'
import { applyCreateReception, type ReceptionRpcPayload } from '../repositories/reception'
import { applyRecordSupplyMovement } from '../repositories/supplies'
import { deleteBlob, getBlob } from './queue'
import type { QueuedMutation } from './types'

type Handler = (mutation: QueuedMutation) => Promise<void>

async function requireBlob(mutation: QueuedMutation): Promise<Blob> {
  const key = mutation.blobKeys[0]
  if (!key) throw new Error(`Mutación "${mutation.type}" sin blob asociado.`)

  const blob = await getBlob(key)
  if (!blob) throw new Error(`El archivo de "${mutation.type}" ya no está disponible localmente.`)

  return blob
}

/**
 * Tabla tipo → función que aplica la mutación real contra Supabase. Es la
 * MISMA función que usa cada repositorio en su ruta feliz (online) — no hay
 * dos implementaciones de "cómo se manda esto" que puedan divergir.
 */
export const dispatch: Partial<Record<QueuedMutation['type'], Handler>> = {
  'customers.create': async (mutation) => {
    await applyCreateCustomer(
      mutation.payload as {
        id: string
        fullName: string
        phone: string | null
        email: string | null
        notes: string | null
      },
    )
  },

  'reception.create': async (mutation) => {
    await applyCreateReception(mutation.payload as unknown as ReceptionRpcPayload)
  },

  'photos.uploadReceptionPhoto': async (mutation) => {
    const draft = mutation.payload as unknown as ReceptionPhotoDraft
    const blob = await requireBlob(mutation)
    await applyUploadReceptionPhoto(draft, blob, blob.type || 'image/jpeg')
    await deleteBlob(mutation.blobKeys[0]!)
  },

  'signature.upload': async (mutation) => {
    const payload = mutation.payload as { path: string }
    const blob = await requireBlob(mutation)
    await applyUploadSignature(payload.path, blob)
    await deleteBlob(mutation.blobKeys[0]!)
  },

  'cash.open': async (mutation) => {
    await applyOpenSession(
      mutation.payload as unknown as { id: string; opening_cents: number; opened_by: string | null },
    )
  },

  'cash.addMovement': async (mutation) => {
    await applyAddMovement(
      mutation.payload as unknown as {
        id: string
        cash_session_id: string
        type: 'entrada' | 'salida'
        amount_cents: number
        reason: string
        created_by: string | null
      },
    )
  },

  'payments.record': async (mutation) => {
    await applyRecordPayment(
      mutation.payload as unknown as {
        id: string
        order_id: string
        method: 'efectivo' | 'tarjeta' | 'transferencia'
        amount_cents: number
        cash_session_id: string | null
        tendered_cents: number | null
        change_cents: number | null
        reference: string | null
        created_by: string | null
      },
    )
  },

  'supplies.recordMovement': async (mutation) => {
    await applyRecordSupplyMovement(
      mutation.payload as unknown as {
        id: string
        supply_id: string
        type: 'compra' | 'consumo' | 'ajuste' | 'merma'
        quantity: number
        order_id: string | null
        note: string | null
        reference: string | null
        created_by: string | null
      },
    )
  },
}
