import { useState } from 'react'
import { toast } from 'sonner'
import { LogIn, TriangleAlert } from 'lucide-react'
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
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Panel de marca */}
      <div className="flex flex-col justify-between bg-navy-700 px-6 py-10 text-white sm:px-10 lg:px-14">
        <div>
          <p className="text-[11px] font-bold tracking-[0.19em] text-gold-400">GESTIÓN INTEGRAL</p>
          <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            La operación del centro, en un solo lugar.
          </h1>
          <p className="mt-4 max-w-md text-sm text-navy-100">
            Cocina, alojamientos, flota y colportaje coordinados con reglas que evitan cruces de
            horario, camas duplicadas y reportes repetidos.
          </p>
        </div>
        <ul className="mt-10 grid gap-3 text-sm text-navy-100 sm:grid-cols-2">
          {[
            'Turnos de cocina con validación automática',
            'Camas asignadas por habitación y sexo',
            'Reservas de vehículo sin superposición',
            'Metas diarias de colportaje por equipo',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold-500" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            {mode === 'signin' ? 'Ingresar' : 'Crear cuenta'}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {mode === 'signin'
              ? 'Usa el correo autorizado por la coordinación.'
              : 'Tu cuenta inicia con permiso de solo lectura hasta que se asigne un rol.'}
          </p>

          {!isSupabaseConfigured && (
            <p className="mt-4 flex gap-2 rounded-lg bg-gold-100 px-3 py-2.5 text-xs text-gold-700">
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

            <Button type="submit" size="lg" loading={loading}>
              <LogIn />
              {mode === 'signin' ? 'Ingresar' : 'Registrarme'}
            </Button>
          </form>

          <button
            type="button"
            className="mt-5 text-sm font-medium text-navy-600 underline underline-offset-4"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError('')
            }}
          >
            {mode === 'signin' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}
          </button>
        </div>
      </div>
    </div>
  )
}
