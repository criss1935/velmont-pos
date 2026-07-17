import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './styles/global.css'

// Precache del app shell: sin esto, una tablet sin señal que recarga la página
// nunca llega a ejecutar React, y ninguna cola offline sirve de nada.
registerSW({ immediate: true })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // La tablet vive en el mostrador todo el día: refrescar al recuperar el
      // foco haría parpadear la pantalla en mitad de una operación.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró #root en index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
