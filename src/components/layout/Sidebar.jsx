import { NavLink } from 'react-router-dom'
import { MapPin, ShieldCheck, X } from 'lucide-react'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { NAV_ITEMS, ROLE_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

function Logo() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-7 pb-5">
      <BrandLogo className="size-28" fallbackClassName="text-xl" />
      <span className="text-[11px] font-bold tracking-[0.19em] text-navy-600">GESTIÓN INTEGRAL</span>
    </div>
  )
}

function NavList({ onNavigate }) {
  const { hasModule } = useAuth()
  const items = NAV_ITEMS.filter((item) => hasModule(item.module))
  return (
    <nav aria-label="Módulos" className="px-3">
      <p className="px-3 pt-3 pb-2 text-[11px] font-semibold tracking-[0.13em] text-ink-soft">
        OPERACIÓN
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'brisa-nav flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-semibold transition-colors duration-200',
                  isActive
                    ? 'brisa-nav-active'
                    : 'text-ink hover:bg-navy-50',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  {isActive && <span className="ml-auto size-1.5 rounded-full bg-current" />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function SidebarContent({ onNavigate }) {
  const { profile, role } = useAuth()

  return (
    <div className="flex h-full flex-col border-r border-line bg-white text-ink">
      <Logo />
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <NavList onNavigate={onNavigate} />
        <div className="mx-4 mt-8 flex gap-2.5 border-t border-line pt-5 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
          <div>
            Sede principal
            <small className="mt-1 block text-xs text-ink-soft">Piedecuesta, Colombia</small>
          </div>
        </div>
      </div>
      <div className="flex gap-2.5 px-5 py-5 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
        <div className="min-w-0">
          <span className="block truncate font-medium">{profile?.full_name ?? 'Usuario CEPEV'}</span>
          <small className="mt-0.5 block text-xs text-ink-soft">{ROLE_LABELS[role]}</small>
        </div>
      </div>
    </div>
  )
}

export function Sidebar({ mobileOpen, onCloseMobile }) {
  return (
    <>
      {/* Escritorio */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-60">
          <SidebarContent />
        </div>
      </aside>

      {/* Móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar navegación"
            className="absolute inset-0 bg-navy-900/60"
            onClick={onCloseMobile}
          />
          <div className="relative h-full w-72 max-w-[85vw] shadow-2xl">
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Cerrar navegación"
              className="absolute top-4 right-3 z-10 rounded-lg p-2 text-ink hover:bg-navy-100"
            >
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={onCloseMobile} />
          </div>
        </div>
      )}
    </>
  )
}
