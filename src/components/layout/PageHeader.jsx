import { CalendarDays } from 'lucide-react'
import { formatLongDate, todayISO } from '@/lib/utils'

export function PageHeader({ eyebrow = 'CENTRO DE ESTUDIOS CEPEV', title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-bold tracking-[0.13em] text-navy-400">{eyebrow}</p>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>
    </div>
  )
}

export function TodayChip() {
  return (
    <span className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] text-ink-soft">
      <CalendarDays className="size-4" aria-hidden="true" />
      <span className="capitalize">{formatLongDate(todayISO())}</span>
    </span>
  )
}
