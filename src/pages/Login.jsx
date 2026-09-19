import { useState } from 'react'
import { toast } from 'sonner'
import { LogIn, MapPin, TriangleAlert } from 'lucide-react'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '', fullName: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(form.email.trim(), form.password)
      } else {
        await signUp(form.email.trim(), form.password, form.fullName.trim())
        toast.success('Cuenta creada. Revisa tu correo si se solicita confirmación.')
        setMode('signin')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Panel de marca */}
      <div className="relative isolate flex flex-col items-center justify-center overflow-hidden bg-navy-700 px-6 py-12 text-center text-white sm:px-10 lg:px-14 lg:py-16">
        {/* Halo dorado: da profundidad sin competir con el logo */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 size-120 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl"
        />

        <BrandLogo
          className="size-28 shadow-lg shadow-navy-900/30 sm:size-32 lg:size-36"
          fallbackClassName="text-2xl"
        />

        <p className="mt-7 text-[11px] font-bold tracking-[0.32em] text-gold-400">CEPEV</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[0.04em] uppercase sm:text-4xl lg:text-5xl">
          Gestión integral
        </h1>
        <span aria-hidden="true" className="mt-6 block h-px w-16 bg-gold-500" />

        <p className="mt-6 max-w-md text-sm leading-relaxed text-navy-100 sm:text-base">
          La operación del centro en un solo lugar. Cocina, alojamientos, flota y colportaje
          coordinados con reglas que evitan cruces de horario, camas duplicadas y reportes
          repetidos.
        </p>

        <p className="mt-10 flex items-center gap-2 text-xs text-navy-200">
          <MapPin className="size-3.5 shrink-0 text-gold-400" aria-hidden="true" />
          Centro de Perfeccionamiento de Líderes y Colportores · Piedecuesta, Colombia
        </p>
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center bg-[#f6f8fb] px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="surface px-6 py-7 shadow-sm sm:px-8 sm:py-9">
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              {mode === 'signin' ? 'Ingresar' : 'Crear cuenta'}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              {mode === 'signin'
                ? 'Usa el correo autorizado por la coordinación.'
                : 'Tu cuenta inicia con permiso de solo lectura hasta que se asigne un rol.'}
            </p>

            {!isSupabaseConfigured && (
              <p className="mt-5 flex gap-2 rounded-lg bg-gold-100 px-3 py-2.5 text-xs text-gold-700">
                <TriangleAlert className="size-4 shrink-0" />
                Falta configurar las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              {mode === 'signup' && (
                <Input
                  label="Nombre completo"
                  value={form.fullName}
                  onChange={update('fullName')}
                  autoComplete="name"
                  required
                />
              )}
              <Input
                label="Correo"
                type="email"
                value={form.email}
                onChange={update('email')}
                autoComplete="email"
                required
              />
              <Input
                label="Contraseña"
                type="password"
                value={form.password}
                onChange={update('password')}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />

              {error && (
                <p className="flex gap-2 rounded-lg bg-[var(--color-danger-bg)] px-3 py-2.5 text-sm text-[var(--color-danger-fg)]">
                  <TriangleAlert className="size-4 shrink-0" />
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" loading={loading} className="mt-1 w-full">
                <LogIn />
                {mode === 'signin' ? 'Ingresar' : 'Registrarme'}
              </Button>
            </form>

            <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-soft">
              {mode === 'signin' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
              <button
                type="button"
                className="font-semibold text-navy-600 underline underline-offset-4"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setError('')
                }}
              >
                {mode === 'signin' ? 'Crear una' : 'Ingresar'}
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-ink-soft">
            El acceso queda registrado en la bitácora del centro.
          </p>
        </div>
      </div>
    </div>
  )
}
