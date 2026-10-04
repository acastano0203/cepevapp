import { useState } from 'react'
import { toast } from 'sonner'
import { LogIn, TriangleAlert } from 'lucide-react'
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
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Panel de marca: solo en pantallas anchas */}
      <div className="relative isolate hidden flex-col justify-center overflow-hidden bg-navy-700 px-14 text-white lg:flex xl:px-20">
        {/* Halo dorado: da profundidad sin competir con el logo */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 -z-10 size-96 rounded-full bg-gold-500/10 blur-3xl"
        />

        <BrandLogo className="size-20 shadow-lg shadow-navy-900/30" fallbackClassName="text-xl" />

        <p className="mt-10 text-[11px] font-bold tracking-[0.32em] text-gold-400">CEPEV</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight xl:text-5xl">Sistema de gestión</h1>
        <span aria-hidden="true" className="mt-8 block h-px w-16 bg-gold-500" />

        <p className="mt-8 text-sm text-navy-200">Piedecuesta, Colombia</p>
      </div>

      {/* Formulario */}
      <div className="flex min-h-dvh items-center justify-center bg-[#f6f8fb] px-4 py-10 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Marca compacta para móvil y tablet */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <BrandLogo className="size-16" fallbackClassName="text-lg" />
            <p className="mt-4 text-[11px] font-bold tracking-[0.32em] text-gold-600">CEPEV</p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-ink">Sistema de gestión</h1>
          </div>

          <div className="surface px-6 py-7 shadow-sm sm:px-8 sm:py-8">
            <h2 className="text-xl font-bold tracking-tight text-ink">
              {mode === 'signin' ? 'Ingresar' : 'Crear cuenta'}
            </h2>

            {!isSupabaseConfigured && (
              <p className="mt-5 flex gap-2 rounded-lg bg-gold-100 px-3 py-2.5 text-xs text-gold-700">
                <TriangleAlert className="size-4 shrink-0" />
                Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
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
        </div>
      </div>
    </div>
  )
}
