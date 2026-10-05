import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const CONTROL =
  'w-full min-w-0 rounded-lg border border-[#cbd6e1] bg-white px-3 text-base text-ink shadow-xs ' +
  'transition-colors placeholder:text-ink-soft/70 focus:border-navy-400 disabled:cursor-not-allowed disabled:bg-navy-50/60'

export function Field({ label, hint, error, children, className, htmlFor }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)} htmlFor={htmlFor}>
      {label && <span className="text-sm font-semibold text-[#536c83]">{label}</span>}
      {children}
      {hint && !error && <span className="text-xs text-ink-soft">{hint}</span>}
      {error && <span className="text-xs text-[var(--color-danger-fg)]">{error}</span>}
    </label>
  )
}

export function Input({ label, hint, error, className, ...props }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={id}>
      <input id={id} className={cn(CONTROL, 'h-11')} {...props} />
    </Field>
  )
}

// Hidden by default; the eye only reveals the text while the user keeps it open.
export function PasswordInput({ label, hint, error, className, ...props }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={id}>
      <div className="relative">
        <input id={id} {...props} type={visible ? 'text' : 'password'} className={cn(CONTROL, 'h-11 pr-12')} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-navy-400"
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
    </Field>
  )
}

export function Textarea({ label, hint, error, className, ...props }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={id}>
      <textarea id={id} rows={3} className={cn(CONTROL, 'resize-y py-2')} {...props} />
    </Field>
  )
}

/**
 * Select nativo: accesible en móvil sin librerías extra.
 * options: [{ value, label, disabled }]
 */
export function Select({ label, hint, error, options = [], placeholder, className, ...props }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={id}>
      <select id={id} className={cn(CONTROL, 'h-11 appearance-none bg-no-repeat pr-9')} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function SearchInput({ className, ...props }) {
  return (
    <div
      className={cn(
        'flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#d7e1eb] bg-white px-3 sm:max-w-sm',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink-soft" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="w-full min-w-0 bg-transparent text-sm outline-none"
        {...props}
      />
    </div>
  )
}
