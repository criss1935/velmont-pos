/**
 * Frontera de datos.
 *
 * La UI importa de aquí y solo de aquí. Nadie fuera de `src/data` importa
 * `@supabase/supabase-js` ni `./client` — esa disciplina es lo que permite
 * meter después una cola offline (o cambiar de backend) sin tocar una pantalla.
 */

export * from './types'
export { DataError } from './errors'

export * as auth from './repositories/auth'
export * as cash from './repositories/cash'
export * as catalog from './repositories/catalog'
export * as customers from './repositories/customers'
export * as orders from './repositories/orders'
export * as payments from './repositories/payments'
export * as photos from './repositories/photos'
export * as reception from './repositories/reception'
export * as reports from './repositories/reports'
export * as settings from './repositories/settings'
export * as supplies from './repositories/supplies'

// Superficie mínima de la cola offline hacia el resto de la app: arrancar el
// motor de sync y forzar un drenado manual. El resto (Dexie, el detalle de
// cada mutación) queda encerrado en `./offline`, igual que Supabase queda
// encerrado en `./client` para el resto de los repositorios.
export * as offlineSync from './offline/sync-engine'

// Estado de sincronización para la UI (indicador, banner, panel) y el estado
// derivado por orden (badge en Órdenes/detalle). Igual que arriba: solo la
// superficie que las pantallas necesitan, nunca Dexie ni el detalle interno.
export { useSyncStatus, startSyncStatusPolling } from './offline/useSyncStatus'
export { statusForOrder, type OrderSyncStatus } from './offline/orderStatus'
export { isOfflineEnabled } from './offline/flag'
export type { MutationStatus, MutationType, QueuedMutation, SyncLogEntry } from './offline/types'
