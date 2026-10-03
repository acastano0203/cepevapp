import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, toFriendlyError } from './supabase'
import { DEFAULT_ROLE_MODULES, NAV_ITEMS } from './constants'

const ALL_MODULES = NAV_ITEMS.map((item) => item.module)

/** Módulos del usuario. Si la base no tiene la migración 27, usa los accesos por defecto. */
async function loadModules(role) {
  if (role === 'admin') return ALL_MODULES
  const { data, error } = await supabase.rpc('my_modules')
  if (error) {
    console.warn('[CEPEV] Accesos por perfil no disponibles; se usan los de por defecto:', error.message)
    return DEFAULT_ROLE_MODULES[role] ?? []
  }
  return data ?? []
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setModules([])
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[CEPEV] No se pudo leer el perfil:', error.message)
      setProfile({ id: userId, full_name: 'Usuario CEPEV', role: 'cepevista' })
      setModules(await loadModules('cepevista'))
      return
    }
    const next = data ?? { id: userId, full_name: 'Usuario CEPEV', role: 'cepevista' }
    setModules(await loadModules(next.role))
    setProfile(next)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session ?? null)
      await loadProfile(data.session?.user?.id)
      if (active) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      await loadProfile(nextSession?.user?.id)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(toFriendlyError(error))
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setModules([])
  }, [])

  const value = useMemo(() => {
    const role = profile?.role ?? 'cepevista'
    const isAdmin = role === 'admin'
    /** Lo que el administrador marcó para este perfil (el admin ve todo). */
    const hasModule = (module) => isAdmin || modules.includes(module)
    const canReport = hasModule('mantenimiento')
    const canRead = isAdmin || modules.some((module) => module !== 'mantenimiento' && module !== 'administracion')
    return {
      session,
      user: session?.user ?? null,
      profile,
      role,
      modules,
      hasModule,
      canWrite: isAdmin,
      isAdmin,
      canRead,
      canReport,
      /** Reporta mantenimiento pero no lo gestiona: ve la vista sencilla del módulo. */
      reporterOnly: !isAdmin && canReport,
      loading,
      signIn,
      signOut,
    }
  }, [session, profile, modules, loading, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return context
}
