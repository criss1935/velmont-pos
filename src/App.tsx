import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './app/AppLayout'
import { useSession } from './app/session'
import { auth } from './data'
import { LoginPage } from './features/auth/LoginPage'
import { ReceivePage } from './features/orders/ReceivePage'
import { OrdersPage } from './features/orders/OrdersPage'
import { OrderDetailPage } from './features/orders/OrderDetailPage'
import { CustomersPage } from './features/customers/CustomersPage'
import { CashPage } from './features/cash/CashPage'
import { InventoryPage } from './features/inventory/InventoryPage'
import { CatalogPage } from './features/catalog/CatalogPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { Splash } from './components/Splash'

// Reportes y Gastos traen las gráficas (recharts, ~400 kB): se cargan solo al
// abrirlas, para que el mostrador no las descargue en cada arranque.
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const ExpensesPage = lazy(() => import('./features/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))

export function App() {
  const profile = useSession((state) => state.profile)
  const bootstrap = useSession((state) => state.bootstrap)

  useEffect(() => {
    void bootstrap()

    // El token de Supabase caduca. Si expira estando la tablet encendida, hay
    // que enterarse y volver al login en vez de dejar la UI fallando en silencio.
    return auth.onAuthChange(() => void bootstrap())
  }, [bootstrap])

  // `undefined` = todavía no sabemos si hay sesión. Distinguirlo de `null` evita
  // el parpadeo del login antes de restaurar la sesión guardada.
  if (profile === undefined) return <Splash />

  if (profile === null) return <LoginPage />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/recibir" replace />} />
          <Route path="/recibir" element={<ReceivePage />} />
          <Route path="/ordenes" element={<OrdersPage />} />
          <Route path="/ordenes/:id" element={<OrderDetailPage />} />
          <Route path="/clientes" element={<CustomersPage />} />
          <Route path="/caja" element={<CashPage />} />
          <Route path="/inventario" element={<InventoryPage />} />
          <Route
            path="/catalogo"
            element={
              profile.role === 'admin' ? <CatalogPage /> : <Navigate to="/recibir" replace />
            }
          />
          <Route
            path="/reportes"
            element={
              profile.role === 'admin' ? <Suspense fallback={null}><ReportsPage /></Suspense> : <Navigate to="/recibir" replace />
            }
          />
          <Route
            path="/gastos"
            element={
              profile.role === 'admin' ? <Suspense fallback={null}><ExpensesPage /></Suspense> : <Navigate to="/recibir" replace />
            }
          />
          <Route
            path="/configuracion"
            element={
              profile.role === 'admin' ? <SettingsPage /> : <Navigate to="/recibir" replace />
            }
          />
          <Route path="*" element={<Navigate to="/recibir" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
