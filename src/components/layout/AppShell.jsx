import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Eye, LogOut, PanelLeft, ShieldCheck } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Button } from '@/components/ui'
import { NAV_ITEMS, ROLE_LABELS } from '@/lib/constants'
import { useAuth } from '@/lib/auth'

function Topbar({ onOpenMenu }) {
  const { pathname } = useLocation()
  const { role, canWrite, signOut } = useAuth()
  const current = NAV_ITEMS.find((item) => item.to === pathname) ?? NAV_ITEMS[0]

  return (
    <header className="sticky top-0 z-30 flex min-h-[68px] flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMenu}
          aria-label="Abrir navegación"
        >
          <PanelLeft />
        </Button>
        <span className="truncate">
          CEPEV <span className="px-1.5 text-navy-200">/</span>
          <span className="font-medium text-ink">{current.label}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-md bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy-600 sm:inline-flex">
          {canWrite ? <ShieldCheck className="size-3.5" /> : <Eye className="size-3.5" />}
          {ROLE_LABELS[role]}
        </span>
        <Button variant="secondary" size="sm" onClick={signOut}>
          <LogOut />
          <span className="hidden sm:inline">Salir</span>
        </Button>
      </div>
    </header>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-dvh">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1540px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <footer className="mx-auto flex w-full max-w-[1540px] flex-wrap justify-between gap-2 border-t border-line px-4 py-5 text-[11px] text-ink-soft sm:px-6 lg:px-8">
          <span>CEPEV · Centro de Perfeccionamiento de Líderes y Colportores</span>
          <span>Datos alojados en Supabase · Acceso por rol</span>
        </footer>
      </div>
    </div>
  )
}
