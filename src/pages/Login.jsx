import { useState } from 'react'
import { LogIn, TriangleAlert } from 'lucide-react'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button, Input, PasswordInput } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

// Only the user is remembered (never the password), and only after a successful login.
const LAST_USER_KEY = 'cepev-last-user'

function readLastUser() {
  try { return localStorage.getItem(LAST_USER_KEY) ?? '' } catch { return '' }
}

export default function Login() {
  const { signIn } = useAuth()
  const [form, setForm] = useState(() => ({ email: readLastUser(), password: '' }))
  // True while the field still shows the remembered user untouched.
  const [prefilled, setPrefilled] = useState(() => form.email !== '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  // Tapping the remembered user clears it to type another one; after that it behaves normally.
  function clearPrefilledUser() {
    if (!prefilled) return
    setPrefilled(false)
    setForm((prev) => ({ ...prev, email: '' }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const email = form.email.trim()
      await signIn(email, form.password)
      try { localStorage.setItem(LAST_USER_KEY, email) } catch { /* private mode: nothing to remember */ }
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
              Ingresar
            </h2>

            {!isSupabaseConfigured && (
              <p className="mt-5 flex gap-2 rounded-lg bg-gold-100 px-3 py-2.5 text-xs text-gold-700">
                <TriangleAlert className="size-4 shrink-0" />
                Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <Input
                label="Usuario"
                type="email"
                value={form.email}
                onChange={(event) => { setPrefilled(false); update('email')(event) }}
                onFocus={clearPrefilledUser}
                autoComplete="username"
                required
              />
              <PasswordInput
                label="Contraseña"
                value={form.password}
                onChange={update('password')}
                autoComplete="current-password"
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
                Ingresar
              </Button>
            </form>

            <p className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-soft">
              ¿No tienes cuenta? Pídela al administrador del CEPEV.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
