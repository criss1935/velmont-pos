import { NavLink, Outlet } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { OfflineBanner } from '@/features/sync/OfflineBanner'
import { SyncIndicator } from '@/features/sync/SyncIndicator'
import { cn } from '@/lib/cn'
import { formatCents } from '@/lib/money'
import { useIsAdmin, useSession } from './session'
import styles from './AppLayout.module.css'

interface NavItem {
  to: string
  label: string
  icon: string
  adminOnly?: boolean
}

const NAV: NavItem[] = [
  { to: '/recibir', label: 'Recibir', icon: '✛' },
  { to: '/ordenes', label: 'Órdenes', icon: '⬗' },
  { to: '/clientes', label: 'Clientes', icon: '◉' },
  { to: '/caja', label: 'Caja', icon: '▤' },
  { to: '/inventario', label: 'Inventario', icon: '⬢' },
  { to: '/catalogo', label: 'Catálogo', icon: '▥', adminOnly: true },
  { to: '/reportes', label: 'Reportes', icon: '◆', adminOnly: true },
  { to: '/configuracion', label: 'Configuración', icon: '⚙', adminOnly: true },
]

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function AppLayout() {
  const profile = useSession((state) => state.profile)
  const cashSession = useSession((state) => state.cashSession)
  const signOut = useSession((state) => state.signOut)
  const isAdmin = useIsAdmin()

  const items = NAV.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className={styles.shell}>
      {/* --- Sidebar (escritorio / tablet horizontal) --- */}
      {/* `vm-on-dark` remapea los tokens a su versión sobre negro: todo lo que
          caiga dentro del sidebar (badges, botones, el estado de caja) se
          adapta sin estilos propios. Ver styles/tokens.css. */}
      <aside className={cn(styles.sidebar, 'vm-on-dark')}>
        <div className={styles.brand}>
          <Brand />
        </div>

        <nav className={styles.nav}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(styles.link, isActive && styles.active)}
            >
              <span className={styles.icon} aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.spacer} />

        <SyncIndicator />

        {/* Sin caja abierta no se puede cobrar en efectivo — la base lo rechaza.
            Mejor que el operador lo vea aquí que descubrirlo con el cliente
            enfrente y el ticket a medias. */}
        <div className={cn(styles.cash, !cashSession && styles.cashClosed)}>
          <span className={styles.cashLabel}>Caja</span>
          {cashSession ? (
            <span className={styles.cashValue} data-numeric>
              {formatCents(cashSession.expected)}
            </span>
          ) : (
            <span className={styles.cashWarning}>Cerrada</span>
          )}
        </div>

        {profile && (
          <div className={styles.user}>
            <span className={styles.avatar}>{initials(profile.fullName)}</span>
            <div className={styles.userInfo}>
              <div className={styles.userName}>{profile.fullName}</div>
              <div className={styles.userRole}>{profile.role}</div>
            </div>
            <button
              type="button"
              className={styles.signOut}
              onClick={() => void signOut()}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              ⏻
            </button>
          </div>
        )}
      </aside>

      {/* --- Área principal --- */}
      <div className={styles.main}>
        {/* Barra superior compacta (solo móvil). */}
        <header className={styles.mobileBar}>
          <Brand size="sm" />
          <div className={styles.mobileBarRight}>
            <SyncIndicator mobile />
            <span className={cn(styles.mobileCash, !cashSession && styles.mobileCashClosed)}>
              <span className={styles.mobileCashLabel}>Caja</span>
              {cashSession ? (
                <span data-numeric>{formatCents(cashSession.expected)}</span>
              ) : (
                <span>Cerrada</span>
              )}
            </span>
            {profile && (
              <button
                type="button"
                className={styles.mobileSignOut}
                onClick={() => void signOut()}
                aria-label="Cerrar sesión"
              >
                ⏻
              </button>
            )}
          </div>
        </header>

        <OfflineBanner />

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      {/* --- Navegación inferior (solo móvil) --- */}
      <nav className={styles.bottomNav}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}
          >
            <span className={styles.tabIcon} aria-hidden>
              {item.icon}
            </span>
            <span className={styles.tabLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
