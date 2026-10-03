import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn, matches } from '@/lib/utils'

/**
 * Campo con autocompletado: al escribir se despliega la lista filtrada y al
 * elegir una opción queda cargada en el campo. Teclado: flechas, Enter y Escape.
 * options: [{ value, label, detail, disabled }]
 */
export function Combobox({
  label,
  hint,
  error,
  value,
  onChange,
  options = [],
  placeholder,
  disabled,
  required,
  className,
  emptyText = 'Sin coincidencias',
}) {
  const id = useId()
  const listId = `${id}-list`
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const selected = options.find((option) => option.value === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const filtered = useMemo(
    () => options.filter((option) => matches(`${option.label} ${option.detail ?? ''}`, query)).slice(0, 50),
    [options, query],
  )

  // Al cerrar, el campo vuelve a mostrar la opción elegida
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const choose = (option) => {
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const move = (step) => {
    if (!filtered.length) return
    setActive((current) => (current + step + filtered.length) % filtered.length)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      else move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      choose(filtered[active])
    } else if (event.key === 'Tab' && open && query) {
      // Escribir y pasar al siguiente campo deja elegida la opción resaltada
      choose(filtered[active])
    } else if (event.key === 'Escape' && open) {
      // No cierra el diálogo que contiene al campo
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <label htmlFor={id} className="text-sm font-semibold text-[#536c83]">{label}</label>}
      <div ref={rootRef} className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          required={required && !value}
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : selected?.label ?? ''}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-11 w-full min-w-0 rounded-lg border border-[#cbd6e1] bg-white pr-16 pl-3 text-base text-ink shadow-xs',
            'transition-colors placeholder:text-ink-soft/70 focus:border-navy-400 disabled:cursor-not-allowed disabled:bg-navy-50/60',
          )}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-ink-soft">
          {value && !disabled && !required && (
            <button type="button" aria-label="Quitar selección" className="rounded p-1 hover:bg-navy-50"
              onClick={() => { onChange(''); inputRef.current?.focus() }}>
              <X className="size-4" />
            </button>
          )}
          <ChevronDown className="pointer-events-none size-4" aria-hidden="true" />
        </div>

        {open && !disabled && (
          <ul id={listId} role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-soft">{emptyText}</li>}
            {filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex cursor-pointer flex-col px-3 py-2 text-sm',
                  index === active && 'bg-navy-50',
                  option.value === value && 'font-semibold text-navy-700',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span>{option.label}</span>
                {option.detail && <small className="text-xs text-ink-soft">{option.detail}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && !error && <span className="text-xs text-ink-soft">{hint}</span>}
      {error && <span className="text-xs text-[var(--color-danger-fg)]">{error}</span>}
    </div>
  )
}
