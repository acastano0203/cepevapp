import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingState } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import ConfigNeeded from '@/pages/ConfigNeeded'
import Login from '@/pages/Login'

// Cada módulo se carga bajo demanda: el bundle inicial se mantiene liviano.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Kitchen = lazy(() => import('@/pages/Kitchen'))
const Fleet = lazy(() => import('@/pages/Fleet'))
const Lodging = lazy(() => import('@/pages/Lodging'))
const Colporteurs = lazy(() => import('@/pages/Colporteurs'))

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingState label="Preparando la operación…" />
    </div>
  )
}

function ProtectedRoutes() {
  const { session, loading } = useAuth()

  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/ingresar" replace />

  return (
    <AppShell />
  )
}

export default function App() {
  const { session, loading } = useAuth()

  // Sin credenciales no hay nada que mostrar: se explica que falta en vez de
  // dejar una pagina en blanco con un error de consola.
  if (!isSupabaseConfigured) return <ConfigNeeded />

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/ingresar"
          element={!loading && session ? <Navigate to="/" replace /> : <Login />}
        />
        <Route element={<ProtectedRoutes />}>
          <Route index element={<Dashboard />} />
          <Route path="cocina" element={<Kitchen />} />
          <Route path="vehiculos" element={<Fleet />} />
          <Route path="alojamientos" element={<Lodging />} />
          <Route path="colportores" element={<Colporteurs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
