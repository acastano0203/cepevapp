import { cn } from '@/lib/utils'

export function Card({ className, children, ...props }) {
  return (
    <section className={cn('surface overflow-hidden', className)} {...props}>
      {children}
    </section>
  )
}

export function CardHeader({ title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-[#edf1f5] px-4 py-4 sm:px-6 sm:py-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink sm:text-lg">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, children }) {
  return <div className={cn('px-4 py-4 sm:px-6 sm:py-5', className)}>{children}</div>
}

/** Tarjeta de indicador: clicable para filtrar el módulo correspondiente. */
export function KpiCard({ label, value, detail, tone = 'navy', onClick, icon: Icon }) {
  const tones = {
    navy: 'border-t-navy-500 text-navy-700',
    gold: 'border-t-gold-500 text-gold-700',
    green: 'border-t-emerald-500 text-emerald-700',
    red: 'border-t-red-400 text-[var(--color-danger-fg)]',
  }

  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'surface w-full border-t-[3px] px-4 py-4 text-left transition sm:px-5',
        tones[tone],
        onClick && 'hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md',
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-ink-soft sm:text-sm">
        <span className="truncate">{label}</span>
        {Icon && <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />}
      </span>
      <strong className="mt-2 block text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
        {value}
      </strong>
      {detail && <span className="mt-1 block text-xs text-ink-soft">{detail}</span>}
    </Component>
  )
}
