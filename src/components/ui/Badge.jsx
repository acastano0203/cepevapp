import { cn } from '@/lib/utils'

const TONES = {
  navy: 'bg-navy-50 text-navy-600',
  gold: 'bg-gold-100 text-gold-700',
  green: 'bg-[var(--color-success-bg)] text-[var(--color-success-fg)]',
  red: 'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]',
  neutral: 'bg-[#eef1f5] text-ink-soft',
}

export function Badge({ tone = 'navy', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs leading-tight font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Avatar({ name = '', className }) {
  const text = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-[11px] font-bold text-navy-500',
        className,
      )}
    >
      {text}
    </span>
  )
}
