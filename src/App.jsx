import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { EmptyState, LoadingState } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { NAV_ITEMS } from '@/lib/constants'
import { isSupabaseConfigured } from '@/lib/supabase'
import ConfigNeeded from '@/pages/ConfigNeeded'
import Login from '@/pages/Login'

// Cada módulo se carga bajo demanda: el bundle inicial se mantiene liviano.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Laundry = lazy(() => import('@/pages/Laundry'))
const Kitchen = lazy(() => import('@/pages/Kitchen'))
const Fleet = lazy(() => import('@/pages/Fleet'))
const Lodging = lazy(() => import('@/pages/Lodging'))
const Colporteurs = lazy(() => import('@/pages/Colporteurs'))
const Cepevistas = lazy(() => import('@/pages/Cepevistas'))
const Payments = lazy(() => import('@/pages/Payments'))
const Maintenance = lazy(() => import('@/pages/Maintenance'))
const Administration = lazy(() => import('@/pages/Administration'))

/** Página de cada módulo del menú (la clave es NAV_ITEMS[].module). */
const PAGES = {
  inicio: Dashboard,
  cocina: Kitchen,
  lavanderia: Laundry,
  vehiculos: Fleet,
  alojamientos: Lodging,
  colportores: Colporteurs,
  cepevistas: Cepevistas,
  pagos: Payments,
  mantenimiento: Maintenance,
  administracion: Administration,
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingState label="Preparando la operación…" />
    </div>
  )
}

function ProtectedRoutes() {
  const { session, loading, profile } = useAuth()

  // Espera también el perfil y sus módulos: sin ellos el menú y las rutas estarían vacíos
  if (loading || (session && profile?.id !== session.user.id)) return <FullScreenLoader />
  if (!session) return <Navigate to="/ingresar" replace />

  return (
    <AppShell />
  )
}

function NoAccess() {
  return (
    <EmptyState text="Tu perfil aún no tiene módulos asignados. Pide al administrador que te dé acceso." />
  )
}

export default function App() {
  const { session, loading, hasModule } = useAuth()

  // Sin credenciales no hay nada que mostrar: se explica que falta en vez de
  // dejar una pagina en blanco con un error de consola.
  if (!isSupabaseConfigured) return <ConfigNeeded />

  // Solo existen las rutas de los módulos que el administrador habilitó al perfil
  const allowed = NAV_ITEMS.filter((item) => hasModule(item.module))
  const home = allowed[0]?.to

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/ingresar"
          element={!loading && session ? <Navigate to="/" replace /> : <Login />}
        />
        <Route element={<ProtectedRoutes />}>
          {allowed.map((item) => {
            const Page = PAGES[item.module]
            return item.to === '/'
              ? <Route key={item.module} index element={<Page />} />
              : <Route key={item.module} path={item.to.slice(1)} element={<Page />} />
          })}
          <Route path="*" element={home ? <Navigate to={home} replace /> : <NoAccess />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
