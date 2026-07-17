/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_BUSINESS_NAME?: string
  readonly VITE_BUSINESS_PHONE?: string
  readonly VITE_BUSINESS_ADDRESS?: string
  /** Interruptor maestro de la cola offline. Default apagado hasta validar. */
  readonly VITE_OFFLINE_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
