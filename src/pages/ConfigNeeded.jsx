import { TriangleAlert } from 'lucide-react'
import { missingEnvVars } from '@/lib/supabase'

/**
 * Se muestra cuando faltan las credenciales de Supabase.
 * Evita la pantalla en blanco y dice exactamente que falta y donde ponerlo.
 */
export default function ConfigNeeded() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-700 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <span className="inline-flex rounded-xl bg-gold-100 p-3 text-gold-700">
          <TriangleAlert className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-4 text-xl font-bold tracking-tight text-ink">
          Falta conectar la base de datos
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          La aplicación se compiló sin estas variables de entorno:
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {missingEnvVars.map((name) => (
            <li
              key={name}
              className="rounded-lg bg-[var(--color-danger-bg)] px-3 py-2 font-mono text-sm text-[var(--color-danger-fg)]"
            >
              {name}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-4 text-sm text-ink-soft">
          <div>
            <strong className="block text-ink">En tu equipo</strong>
            Añádelas al archivo <code className="font-mono">.env</code> y reinicia{' '}
            <code className="font-mono">npm run dev</code>.
          </div>
          <div>
            <strong className="block text-ink">En Vercel</strong>
            Settings → Environment Variables, marcadas para Production, Preview y Development.
            Después hay que <strong>volver a desplegar</strong>: los valores se incrustan durante la
            compilación, no al abrir la página.
          </div>
          <div>
            <strong className="block text-ink">Dónde se obtienen</strong>
            Supabase → Settings → API: <em>Project URL</em> y la clave <em>anon</em> /{' '}
            <em>publishable</em>.
          </div>
        </div>
      </div>
    </div>
  )
}
