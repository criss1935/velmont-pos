import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    // Precachea el app shell (JS/CSS/HTML) para que la tablet, sin señal, al
    // recargar o despertar de suspensión, siga pudiendo ARRANCAR react — sin
    // esto ninguna cola local sirve de nada porque la app nunca llega a correr.
    // Las llamadas a Supabase NO se cachean aquí: esa capa vive en
    // src/data/offline, no en Workbox.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // ya existe public/manifest.webmanifest, no generar otro
      workbox: {
        // woff2 incluido: las tipografías de marca van auto-hospedadas (ver
        // styles/global.css). Sin esto el service worker no las precachea y la
        // tablet sin señal caería a la fuente del sistema.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // La tablet entra por la IP de la LAN durante el desarrollo.
    host: true,
    // 5200 y no el 5173 por defecto: ese lo ocupa otro proyecto de DC consulting.
    port: 5200,
    strictPort: true,
  },
})
