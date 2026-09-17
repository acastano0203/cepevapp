import { useId } from 'react'
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
