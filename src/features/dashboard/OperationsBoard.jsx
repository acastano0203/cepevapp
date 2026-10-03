import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, BookOpen, Bus, MapPin, UtensilsCrossed } from 'lucide-react'
import { Badge, Card, CardHeader, Progress, QueryBoundary } from '@/components/ui'
import {
  useActiveTrips,
  useBeds,
  useFieldRotations,
  useKitchenDay,
  useKitchenLimits,
  usePeople,
  useTeams,
  useVehicles,
} from '@/hooks/useCepev'
import { MEALS, MEAL_WINDOW, SEX_GROUPS, label } from '@/lib/constants'
import { cn, formatDate, formatNumber, percent, todayISO } from '@/lib/utils'

const OCCUPIED = ['Ocupada', 'Capitan']

const daysUntil = (iso) =>
  Math.round((new Date(`${iso}T12:00:00`) - new Date(`${todayISO()}T12:00:00`)) / 86400000)

const shortDate = (iso) => formatDate(iso, { day: 'numeric', month: 'short' })

const timeOf = (value) =>
  new Date(value).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

function PanelLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-navy-600 hover:underline">
      {children} <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  )
}

/** Medidor: valor contra capacidad, con el número siempre escrito (nunca solo color). */
function Meter({ title, value, total, detail, tone = 'navy', status }) {
  const pct = percent(value, total)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-ink">{title}</span>
        <span className="tabular-nums text-ink">
          <strong>{formatNumber(value)}</strong>
          <span className="text-ink-soft"> / {formatNumber(total)}</span>
          {status}
        </span>
      </div>
      <Progress value={pct} tone={tone} className="h-2.5" />
      {detail && <span className="text-xs text-ink-soft">{detail}</span>}
    </div>
  )
}

/* ---------------------------------------------------------------- Alojamientos */
function LodgingPanel() {
  const query = useBeds()
  const summary = useMemo(() => {
    const beds = query.data ?? []
    const tally = (rows) => ({
      total: rows.length,
      occupied: rows.filter((bed) => OCCUPIED.includes(bed.availability)).length,
      free: rows.filter((bed) => bed.availability === 'Libre').length,
      blocked: rows.filter((bed) => bed.availability === 'Bloqueada').length,
    })
    const buildings = [...new Set(beds.map((bed) => bed.building ?? '—'))].sort()
    return {
      all: tally(beds),
      sections: SEX_GROUPS.map((sex) => ({ sex, ...tally(beds.filter((bed) => bed.sex === sex)) })),
      buildings: buildings.map((building) => ({ building, ...tally(beds.filter((bed) => (bed.building ?? '—') === building)) })),
    }
  }, [query.data])
  const usable = summary.all.total - summary.all.blocked
  const occupancy = percent(summary.all.occupied, usable)

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><BedDouble className="size-5 text-navy-500" aria-hidden="true" />Capacidad de alojamiento</span>}
        description="Camas ocupadas hoy frente a las disponibles para uso"
        action={<PanelLink to="/alojamientos">Alojamientos</PanelLink>} />
      <QueryBoundary query={query} loadingLabel="Cargando camas…" empty="Aún no hay camas registradas.">
        <div className="flex flex-col gap-5 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <strong className="text-5xl leading-none font-semibold tracking-tighter text-navy-700 tabular-nums">
              {occupancy}<span className="text-2xl">%</span>
            </strong>
            <p className="text-sm text-ink-soft">
              <strong className="text-ink">{formatNumber(summary.all.occupied)}</strong> ocupadas ·{' '}
              <strong className="text-ink">{formatNumber(summary.all.free)}</strong> libres ·{' '}
              {formatNumber(summary.all.blocked)} bloqueadas
              <br />Capacidad física: {formatNumber(summary.all.total)} camas
            </p>
            <Badge tone={occupancy > 92 ? 'gold' : 'green'}>{occupancy > 92 ? 'Capacidad ajustada' : 'Hay cupo'}</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {summary.sections.map((section) => (
              <Meter key={section.sex} title={`Sección ${section.sex}`}
                value={section.occupied} total={section.total - section.blocked}
                tone={section.free === 0 && section.total > 0 ? 'gold' : 'navy'}
                detail={`${formatNumber(section.free)} libres${section.blocked ? ` · ${section.blocked} bloqueadas` : ''}`} />
            ))}
          </div>

          {summary.buildings.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Por edificio</p>
              <ul className="flex flex-col gap-3">
                {summary.buildings.map((item) => (
                  <li key={item.building}>
                    <Meter title={`Edificio ${item.building}`} value={item.occupied} total={item.total - item.blocked}
                      detail={`${formatNumber(item.free)} libres`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </QueryBoundary>
    </Card>
  )
}

/* ---------------------------------------------------------------- Cocina */
function KitchenPanel() {
  const today = todayISO()
  const dayQuery = useKitchenDay(today)
  const limitsQuery = useKitchenLimits()

  const meals = useMemo(() => {
    const rows = (dayQuery.data ?? []).filter((row) => row.person_id)
    // useKitchenLimits entrega un mapa { Desayuno: { min, max }, ... }
    const limits = limitsQuery.data ?? {}
    return MEALS.map((meal) => {
      const assigned = rows.filter((row) => row.meal === meal)
      const limit = limits[meal] ?? {}
      return {
        meal,
        count: assigned.length,
        preparation: assigned.filter((row) => row.task === 'Preparacion').length,
        dining: assigned.filter((row) => row.task === 'Comedor').length,
        min: Number(limit.min) || 0,
        max: Number(limit.max) || 0,
      }
    })
  }, [dayQuery.data, limitsQuery.data])
  const published = (dayQuery.data ?? []).some((row) => row.is_published)
  const total = meals.reduce((sum, meal) => sum + meal.count, 0)

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><UtensilsCrossed className="size-5 text-navy-500" aria-hidden="true" />Distribución de cocina · hoy</span>}
        description={`${formatNumber(total)} turnos asignados entre las tres comidas`}
        action={<Badge tone={published ? 'green' : 'gold'}>{published ? 'Publicado' : 'Borrador'}</Badge>} />
      <QueryBoundary query={dayQuery} loadingLabel="Cargando cocina…">
        <ul className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
          {meals.map((meal) => {
            const missing = Math.max(meal.min - meal.count, 0)
            const over = meal.max > 0 && meal.count > meal.max
            const status = missing > 0
              ? <Badge tone="gold" className="ml-2">Faltan {missing}</Badge>
              : over ? <Badge tone="red" className="ml-2">Sobrecupo</Badge>
                : meal.count > 0 ? <Badge tone="green" className="ml-2">Completo</Badge> : null
            return (
              <li key={meal.meal}>
                <Meter title={`${label(meal.meal)} · ${MEAL_WINDOW[meal.meal]}`}
                  value={meal.count} total={meal.min || meal.max || meal.count}
                  tone={missing > 0 ? 'gold' : 'green'} status={status}
                  detail={`Preparación ${meal.preparation} · Comedor ${meal.dining}${meal.min ? ` · mínimo ${meal.min}` : ''}${meal.max ? `, máximo ${meal.max}` : ''}`} />
              </li>
            )
          })}
        </ul>
        <div className="border-t border-[#edf1f5] px-4 py-3 sm:px-6">
          <PanelLink to="/cocina">Abrir cocina</PanelLink>
        </div>
      </QueryBoundary>
    </Card>
  )
}

/* ---------------------------------------------------------------- Vehículos */
const TRIP_TONES = { 'En ruta': 'green', Reservado: 'navy' }

function FleetPanel() {
  const vehiclesQuery = useVehicles()
  const tripsQuery = useActiveTrips()

  const counts = useMemo(() => {
    const vehicles = vehiclesQuery.data ?? []
    return [
      { key: 'disponibles', label: 'Disponibles', value: vehicles.filter((v) => v.status === 'Disponible' && !v.busy_today).length, tone: 'text-[var(--color-success-fg)]' },
      { key: 'ruta', label: 'En recorrido hoy', value: vehicles.filter((v) => v.busy_today).length, tone: 'text-navy-700' },
      { key: 'mantenimiento', label: 'En mantenimiento', value: vehicles.filter((v) => v.status === 'Mantenimiento').length, tone: 'text-gold-700' },
      { key: 'fuera', label: 'Fuera de servicio', value: vehicles.filter((v) => v.status === 'Fuera de servicio').length, tone: 'text-[var(--color-danger-fg)]' },
    ]
  }, [vehiclesQuery.data])
  const vehicles = vehiclesQuery.data ?? []
  const alerts = vehicles.filter((v) => v.service_due || v.documents_alert).length

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Bus className="size-5 text-navy-500" aria-hidden="true" />Vehículos</span>}
        description={`${formatNumber(vehicles.length)} vehículos en la flota`}
        action={<PanelLink to="/vehiculos">Vehículos</PanelLink>} />
      <QueryBoundary query={vehiclesQuery} loadingLabel="Cargando flota…">
        <dl className="grid grid-cols-2 gap-px border-b border-[#edf1f5] bg-[#edf1f5] sm:grid-cols-4">
          {counts.map((item) => (
            <div key={item.key} className="bg-white px-4 py-3">
              <dt className="text-xs text-ink-soft">{item.label}</dt>
              <dd className={cn('text-2xl font-semibold tabular-nums', item.tone)}>{item.value}</dd>
            </div>
          ))}
        </dl>
        {alerts > 0 && (
          <p className="border-b border-[#edf1f5] bg-gold-100 px-4 py-2 text-xs text-gold-700 sm:px-6">
            {alerts} {alerts === 1 ? 'vehículo requiere' : 'vehículos requieren'} atención: mantenimiento próximo o documentos por vencer.
          </p>
        )}
        <div className="px-4 py-4 sm:px-6">
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Recorridos activos y próximos</p>
          <QueryBoundary query={tripsQuery} empty="No hay recorridos reservados ni en ruta.">
            <ul className="flex flex-col divide-y divide-[#edf1f5]">
              {(tripsQuery.data ?? []).map((trip) => (
                <li key={trip.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {trip.vehicles?.name ?? 'Vehículo'} <span className="text-ink-soft">→ {trip.destination_city}</span>
                    </p>
                    <p className="text-xs text-ink-soft">
                      {trip.people?.full_name ?? 'Sin conductor'} · {timeOf(trip.starts_at)} – {timeOf(trip.ends_at)}
                    </p>
                  </div>
                  <Badge tone={TRIP_TONES[trip.status] ?? 'neutral'}>{trip.status}</Badge>
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </div>
      </QueryBoundary>
    </Card>
  )
}

/* ---------------------------------------------------------------- Colportores */
function ColporteurPanel() {
  const teamsQuery = useTeams()
  const rotationsQuery = useFieldRotations()
  const peopleQuery = usePeople({ kind: 'Colportor' })

  /**
   * Todo equipo activo está en un campo: el destino de su rotación vigente o,
   * sin rotación, su municipio base. Las rotaciones solo agregan si está fuera
   * y cuándo sale la próxima vez.
   */
  const { teams, unassigned } = useMemo(() => {
    const today = todayISO()
    const membersByTeam = new Map()
    let withoutTeam = 0
    for (const person of peopleQuery.data ?? []) {
      if (!person.team_id) { withoutTeam += 1; continue }
      membersByTeam.set(person.team_id, [...(membersByTeam.get(person.team_id) ?? []), person.full_name])
    }
    const rotations = rotationsQuery.data ?? []
    const list = (teamsQuery.data ?? []).map((team) => {
      const own = rotations.filter((rotation) => rotation.team_id === team.id)
      const current = own.find((rotation) => rotation.start_date <= today) ?? null
      const next = own.find((rotation) => rotation.start_date > today) ?? null
      const place = (rotation) => ({
        name: rotation.colombia_municipalities?.name ?? rotation.city,
        department: rotation.colombia_municipalities?.department,
      })
      return {
        ...team,
        current,
        next,
        field: current ? place(current) : { name: team.base_city, department: team.department },
        nextField: next ? place(next) : null,
        members: membersByTeam.get(team.id) ?? [],
      }
    })
    // En rotación primero, luego los que salen pronto, luego el resto por nombre
    const rank = (team) => (team.current ? 0 : team.next ? 1 : 2)
    list.sort((a, b) => rank(a) - rank(b)
      || String(a.next?.start_date ?? '').localeCompare(String(b.next?.start_date ?? ''))
      || String(a.field.name ?? '').localeCompare(String(b.field.name ?? ''), 'es'))
    return { teams: list, unassigned: withoutTeam }
  }, [peopleQuery.data, rotationsQuery.data, teamsQuery.data])

  const assigned = teams.reduce((sum, team) => sum + team.members.length, 0)
  const rotating = teams.filter((team) => team.current).length
  const leaving = teams.filter((team) => team.next).length

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><BookOpen className="size-5 text-navy-500" aria-hidden="true" />Colportores en campo</span>}
        description={`${teams.length} ${teams.length === 1 ? 'equipo' : 'equipos'} · ${assigned} colportores asignados · ${rotating} en rotación · ${leaving} ${leaving === 1 ? 'sale' : 'salen'} en los próximos 30 días`}
        action={<PanelLink to="/colportores">Colportores</PanelLink>} />
      <QueryBoundary query={teamsQuery} loadingLabel="Cargando equipos…" empty="Aún no hay equipos de colportores activos.">
        {rotationsQuery.isError && (
          <p role="alert" className="border-b border-[#edf1f5] bg-gold-100 px-4 py-2 text-xs text-gold-700 sm:px-6">
            No se pudieron cargar las rotaciones: se muestra el municipio base de cada equipo.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-[#edf1f5]">
          {teams.map((team) => {
            const days = team.next ? daysUntil(team.next.start_date) : null
            return (
              <li key={team.id} className="flex flex-col gap-1.5 px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                    <MapPin className="size-4 shrink-0 text-navy-500" aria-hidden="true" />
                    <span className="truncate">
                      {team.field.name ?? 'Sin municipio asignado'}
                      {team.field.department && <span className="text-ink-soft">, {team.field.department}</span>}
                    </span>
                  </p>
                  {team.current
                    ? <Badge tone="green">En rotación · regresa {shortDate(team.current.end_date)}</Badge>
                    : <Badge tone="neutral">En municipio base</Badge>}
                </div>
                <p className="text-xs text-ink-soft">
                  Equipo {team.base_name ?? team.name}
                  {team.current && ` · ${shortDate(team.current.start_date)} → ${shortDate(team.current.end_date)}`}
                </p>
                {team.next && (
                  <p className="text-xs">
                    <Badge tone="gold">{days === 0 ? 'Sale hoy' : days === 1 ? 'Sale mañana' : `Sale en ${days} días`}</Badge>
                    <span className="ml-2 text-ink">
                      hacia {team.nextField.name}{team.nextField.department && `, ${team.nextField.department}`}
                      {' '}· {shortDate(team.next.start_date)} → {shortDate(team.next.end_date)}
                    </span>
                  </p>
                )}
                <p className="text-xs text-ink">
                  {team.members.length === 0
                    ? <span className="text-ink-soft">Sin colportores asignados</span>
                    : <>
                        <strong>{team.members.length}</strong> {team.members.length === 1 ? 'colportor' : 'colportores'}:{' '}
                        {team.members.slice(0, 4).join(', ')}
                        {team.members.length > 4 && ` y ${team.members.length - 4} más`}
                      </>}
                </p>
              </li>
            )
          })}
        </ul>
        {unassigned > 0 && (
          <p className="border-t border-[#edf1f5] px-4 py-3 text-xs text-ink-soft sm:px-6">
            {unassigned} {unassigned === 1 ? 'colportor no tiene' : 'colportores no tienen'} equipo asignado.
          </p>
        )}
      </QueryBoundary>
    </Card>
  )
}

/** Tablero con lo principal de cada módulo: capacidad, cocina, flota y campo. */
export function OperationsBoard() {
  return (
    <section aria-labelledby="board-title" className="mt-5">
      <h2 id="board-title" className="mb-3 text-[11px] font-bold tracking-[0.13em] text-navy-400">TABLERO DE OPERACIÓN</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <LodgingPanel />
        <KitchenPanel />
        <FleetPanel />
        <ColporteurPanel />
      </div>
    </section>
  )
}
