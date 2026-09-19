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
      <span className="text-[11px] font-bold tracking-[0.19em] text-gold-400">GESTIÓN INTEGRAL</span>
    </div>
  )
}

function NavList({ onNavigate }) {
  return (
    <nav aria-label="Módulos" className="px-3">
      <p className="px-3 pt-3 pb-2 text-[11px] font-semibold tracking-[0.13em] text-navy-200">
        OPERACIÓN
      </p>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-navy-500/70 text-white'
                    : 'text-navy-100 hover:bg-navy-500/40 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  {isActive && <span className="ml-auto size-1.5 rounded-full bg-gold-500" />}
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
    <div className="flex h-full flex-col bg-navy-700 text-white">
      <Logo />
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <NavList onNavigate={onNavigate} />
        <div className="mx-4 mt-8 flex gap-2.5 border-t border-navy-500/60 pt-5 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-gold-400" aria-hidden="true" />
          <div>
            Sede principal
            <small className="mt-1 block text-xs text-navy-200">Piedecuesta, Colombia</small>
          </div>
        </div>
      </div>
      <div className="flex gap-2.5 px-5 py-5 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold-400" aria-hidden="true" />
        <div className="min-w-0">
          <span className="block truncate font-medium">{profile?.full_name ?? 'Usuario CEPEV'}</span>
          <small className="mt-0.5 block text-xs text-navy-200">{ROLE_LABELS[role]}</small>
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
              className="absolute top-4 right-3 z-10 rounded-lg p-2 text-navy-100 hover:bg-navy-500/50"
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
