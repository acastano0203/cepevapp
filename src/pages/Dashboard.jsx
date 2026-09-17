import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BedDouble,
  BookOpen,
  Bus,
  CircleCheck,
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
import { useAudit, useDashboard } from '@/hooks/useCepev'
import { formatNumber, percent, relativeTime } from '@/lib/utils'

function AttentionRow({ icon: Icon, tone = 'navy', title, detail, onClick }) {
  const tones = {
    navy: 'bg-navy-50 text-navy-600',
    gold: 'bg-gold-100 text-gold-700',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[#edf1f5] px-4 py-4 text-left last:border-0 hover:bg-navy-50/50 sm:px-6"
    >
      <span className={`rounded-xl p-3 ${tones[tone]}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-ink">{title}</strong>
        <small className="mt-0.5 block text-xs text-ink-soft">{detail}</small>
      </span>
      <ArrowRight className="size-4 shrink-0 text-navy-300" aria-hidden="true" />
    </button>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const dashboard = useDashboard()
  const audit = useAudit(6)
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
  const kitchenCoverage = `${data?.kitchen_filled_today ?? 0}/${data?.kitchen_slots_today ?? 0}`
  const salesPercent = percent(data?.books_last_7d, data?.books_goal_7d)

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
          value={kitchenCoverage}
          detail="Puestos cubiertos hoy"
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

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title="Necesita tu atención"
            description="Prioridades para la coordinación de hoy"
          />
          <AttentionRow
            icon={UtensilsCrossed}
            tone="gold"
            title={`${(data?.kitchen_slots_today ?? 0) - (data?.kitchen_filled_today ?? 0)} puestos por cubrir en cocina`}
            detail="Completa el equipo y publica el calendario"
            onClick={() => navigate('/cocina?vista=faltantes')}
          />
          <AttentionRow
            icon={BedDouble}
            title={`${data?.arrivals_pending ?? 0} llegadas sin cama asignada`}
            detail="Consulta disponibilidad y registra la reserva"
            onClick={() => navigate('/alojamientos?vista=llegadas')}
          />
          <AttentionRow
            icon={CircleCheck}
            tone="gold"
            title={`${data?.checkouts_pending ?? 0} salidas por confirmar`}
            detail="La cama sigue ocupada hasta confirmar la salida"
            onClick={() => navigate('/alojamientos?vista=salidas')}
          />
          <AttentionRow
            icon={Wrench}
            title={`${data?.vehicles_service_due ?? 0} mantenimientos por atender`}
            detail="Próximos 7 días o kilometraje alcanzado"
            onClick={() => navigate('/vehiculos?vista=mantenimiento')}
          />
          <AttentionRow
            icon={BookOpen}
            tone="gold"
            title={`${data?.sales_missing_today ?? 0} colportores sin reporte hoy`}
            detail="Un reporte pendiente no es lo mismo que cero ventas"
            onClick={() => navigate('/colportores?vista=faltantes')}
          />
        </Card>

        <div className="flex flex-col gap-5">
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
                    <div className="min-w-0">
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
