import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BedDouble,
  BookOpen,
  Bus,
  CircleCheck,
  ClipboardList,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  KpiCard,
  Progress,
  QueryBoundary,
  Skeleton,
} from '@/components/ui'
import { useAudit, useDashboard, useRoomIssues } from '@/hooks/useCepev'
import { cn, formatNumber, percent, relativeTime } from '@/lib/utils'

/** Color del contador según la gravedad del pendiente. */
const SEVERITY = {
  high: 'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]',
  medium: 'bg-gold-100 text-gold-700',
}

function AttentionRow({ icon: Icon, count, severity = 'medium', title, detail, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 border-b border-[#edf1f5] px-4 py-3.5 text-left transition last:border-0 hover:bg-navy-50/60 sm:px-6"
    >
      <span
        className={cn(
          'flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl px-2 text-xl font-semibold tabular-nums',
          SEVERITY[severity],
        )}
      >
        {formatNumber(count)}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </strong>
        <small className="mt-0.5 block text-xs text-ink-soft">{detail}</small>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-navy-600"
        aria-hidden="true"
      />
    </button>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const dashboard = useDashboard()
  const audit = useAudit(6)
  const issues = useRoomIssues()
  const data = dashboard.data

  if (dashboard.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const occupancy = percent(data?.beds_occupied, data?.beds_total)
  const kitchenPeople = data?.kitchen_filled_today ?? 0
  const mealsMissing = data?.kitchen_meals_missing_today ?? 0
  const salesPercent = percent(data?.books_last_7d, data?.books_goal_7d)

  const openIssues = (issues.data ?? []).filter((issue) => issue.status === 'Abierta')
  const urgentIssues = openIssues.filter((issue) => issue.priority === 'Urgente').length

  /**
   * Pendientes del día. Los que están en cero no son prioridad: se agrupan
   * al final como "Al día" en lugar de ocupar una fila cada uno.
   */
  const attention = [
    {
      key: 'cocina',
      icon: UtensilsCrossed,
      count: mealsMissing,
      severity: 'high',
      title: mealsMissing === 1 ? 'Comida sin equipo en cocina' : 'Comidas sin equipo en cocina',
      detail: 'Completa el equipo y publica el calendario',
      done: 'cocina',
      to: '/cocina?vista=faltantes',
    },
    {
      key: 'llegadas',
      icon: BedDouble,
      count: data?.arrivals_pending ?? 0,
      severity: 'high',
      title: 'Llegadas sin cama asignada',
      detail: 'Consulta disponibilidad y registra la reserva',
      done: 'llegadas',
      to: '/alojamientos?vista=llegadas',
    },
    {
      key: 'novedades',
      icon: ClipboardList,
      count: openIssues.length,
      severity: urgentIssues > 0 ? 'high' : 'medium',
      title: openIssues.length === 1 ? 'Novedad abierta en dormitorios' : 'Novedades abiertas en dormitorios',
      detail: urgentIssues > 0 ? `${urgentIssues} urgente${urgentIssues === 1 ? '' : 's'} · mantenimiento, quejas y más` : 'Mantenimiento, limpieza, quejas y convivencia',
      done: 'novedades',
      to: '/alojamientos',
    },
    {
      key: 'salidas',
      icon: CircleCheck,
      count: data?.checkouts_pending ?? 0,
      severity: 'medium',
      title: 'Salidas por confirmar',
      detail: 'La cama sigue ocupada hasta confirmar la salida',
      done: 'salidas',
      to: '/alojamientos?vista=salidas',
    },
    {
      key: 'mantenimiento',
      icon: Wrench,
      count: data?.vehicles_service_due ?? 0,
      severity: 'medium',
      title: 'Vehículos con mantenimiento pendiente',
      detail: 'Próximos 7 días o kilometraje alcanzado',
      done: 'vehículos',
      to: '/vehiculos?vista=mantenimiento',
    },
    {
      key: 'reportes',
      icon: BookOpen,
      count: data?.sales_missing_today ?? 0,
      severity: 'medium',
      title: 'Colportores sin reporte hoy',
      detail: 'Un reporte pendiente no es lo mismo que cero ventas',
      done: 'reportes',
      to: '/colportores?vista=faltantes',
    },
  ]
  const pending = attention
    .filter((item) => item.count > 0)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
  const upToDate = attention.filter((item) => item.count === 0)

  return (
    <>
      <PageHeader
        title="La operación, en un solo lugar"
        subtitle="Revisa los pendientes del día y coordina el siguiente paso."
      >
        <TodayChip />
      </PageHeader>

      {/* Banda de resumen */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-5 rounded-xl border-l-4 border-gold-500 bg-navy-700 px-5 py-6 text-white sm:px-8">
        <div className="min-w-0">
          <span className="text-[11px] font-bold tracking-[0.13em] text-gold-300">
            OPERACIÓN DEL DÍA
          </span>
          <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            Preparados para servir.
          </h2>
          <p className="mt-2 text-sm text-navy-100">
            {formatNumber(data?.beds_free ?? 0)} camas disponibles ·{' '}
            {data?.trips_active ?? 0} recorridos activos
          </p>
        </div>
        <div className="flex items-center gap-4 border-navy-500 pl-0 sm:border-l sm:pl-8">
          <strong className="text-4xl font-medium tracking-tighter sm:text-5xl">
            {formatNumber(data?.beds_occupied ?? 0)}
          </strong>
          <span className="text-[13px] text-navy-100">
            personas alojadas
            <br />
            de {formatNumber(data?.beds_total ?? 0)} camas
          </span>
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Cocina"
          value={kitchenPeople}
          detail="Personas asignadas hoy"
          tone="gold"
          icon={UtensilsCrossed}
          onClick={() => navigate('/cocina')}
        />
        <KpiCard
          label="Vehículos"
          value={data?.vehicles_available ?? 0}
          detail="Disponibles durante el día"
          icon={Bus}
          onClick={() => navigate('/vehiculos?vista=disponibles')}
        />
        <KpiCard
          label="Alojamientos"
          value={formatNumber(data?.beds_free ?? 0)}
          detail="Camas libres hoy"
          tone="green"
          icon={BedDouble}
          onClick={() => navigate('/alojamientos?vista=libres')}
        />
        <KpiCard
          label="Colportores"
          value={`${salesPercent}%`}
          detail="Cumplimiento · últimos 7 días"
          icon={BookOpen}
          onClick={() => navigate('/colportores')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader
            title="Necesita tu atención"
            description="Prioridades para la coordinación de hoy"
            action={
              <Badge tone={pending.length ? (pending.some((item) => item.severity === 'high') ? 'red' : 'gold') : 'green'}>
                {pending.length ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Todo al día'}
              </Badge>
            }
          />
          {pending.map((item) => (
            <AttentionRow
              key={item.key}
              icon={item.icon}
              count={item.count}
              severity={item.severity}
              title={item.title}
              detail={item.detail}
              onClick={() => navigate(item.to)}
            />
          ))}
          {pending.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <CircleCheck className="size-8 text-[var(--color-success-fg)]" aria-hidden="true" />
              <strong className="text-sm font-semibold text-ink">No hay pendientes para hoy</strong>
              <small className="text-xs text-ink-soft">Cocina, alojamientos, vehículos y reportes están al día.</small>
            </div>
          )}
          {pending.length > 0 && upToDate.length > 0 && (
            <div className="flex items-start gap-2 bg-[var(--color-success-bg)] px-4 py-3 text-xs text-[var(--color-success-fg)] sm:px-6">
              <CircleCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Al día:</strong> {upToDate.map((item) => item.done).join(', ')}.
              </span>
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title="Ocupación de la sede"
              description="Camas ocupadas sobre la capacidad física"
            />
            <CardBody>
              <div className="flex items-center gap-5">
                <strong className="text-4xl leading-none font-semibold tracking-tighter text-navy-700">
                  {occupancy}
                  <span className="text-xl">%</span>
                </strong>
                <div>
                  <Badge tone={occupancy > 92 ? 'gold' : 'green'}>
                    {occupancy > 92 ? 'Capacidad ajustada' : 'Capacidad disponible'}
                  </Badge>
                  <p className="mt-2 text-[13px] text-ink-soft">
                    {formatNumber(data?.beds_occupied ?? 0)} ocupadas ·{' '}
                    {formatNumber(data?.beds_free ?? 0)} libres
                  </p>
                </div>
              </div>
              <Progress value={occupancy} className="mt-4 h-3" />
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
                <span>Capacidad: {formatNumber(data?.beds_total ?? 0)} camas</span>
                <span>{formatNumber(data?.beds_blocked ?? 0)} bloqueadas</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Últimos movimientos" description="Bitácora del centro" />
            <QueryBoundary query={audit} empty="Todavía no hay movimientos registrados.">
              <ul>
                {audit.data?.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 border-b border-[#edf1f5] px-4 py-3 text-sm last:border-0 sm:px-6"
                  >
                    <CircleCheck className="size-4 shrink-0 text-navy-300" aria-hidden="true" />
                    <div className="min-w-0 flex-1" title={entry.summary}>
                      <span className="block truncate">{entry.summary}</span>
                      <small className="text-xs text-ink-soft">
                        {entry.actor_name} · {relativeTime(entry.occurred_at)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </QueryBoundary>
          </Card>
        </div>
      </div>
    </>
  )
}
