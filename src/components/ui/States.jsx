import { CircleCheck, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Progress({ value = 0, className, tone = 'navy' }) {
  const tones = { navy: 'bg-navy-600', gold: 'bg-gold-500', green: 'bg-emerald-500' }
  const safe = Math.max(0, Math.min(100, Number(value) || 0))

  return (
    <div
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-navy-100', className)}
    >
      <div className={cn('h-full rounded-full transition-all duration-500', tones[tone])} style={{ width: `${safe}%` }} />
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-lg bg-navy-100/70', className)} />
}

export function LoadingState({ label = 'Cargando información…', className }) {
  return (
    <div className={cn('flex items-center gap-3 px-6 py-10 text-sm text-ink-soft', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function EmptyState({ text, icon: Icon = CircleCheck, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Icon className="size-8 text-navy-300" aria-hidden="true" />
      <p className="text-sm text-ink-soft">{text}</p>
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-[var(--color-danger-bg)] px-4 py-4 text-sm text-[var(--color-danger-fg)]">
      <span className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {error?.message ?? 'No se pudo cargar la información.'}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-4">
          Reintentar
        </button>
      )}
    </div>
  )
}

/** Envuelve el contenido de una consulta con sus tres estados. */
export function QueryBoundary({ query, children, empty, loadingLabel }) {
  if (query.isPending) return <LoadingState label={loadingLabel} />
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (empty && (!query.data || query.data.length === 0)) return <EmptyState text={empty} />
  return children
}
