import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BedDouble, LogIn, LogOut, Plus } from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Input,
  KpiCard,
  Progress,
  QueryBoundary,
  SearchInput,
  Select,
  Skeleton,
  Table,
  Td,
  Tr,
} from '@/components/ui'
import {
  useArrivals,
  useBeds,
  useLodgingActions,
  usePendingCheckouts,
  usePeople,
  useSavePerson,
  useStays,
} from '@/hooks/useCepev'
import { PERSON_KINDS, SEX_GROUPS, label } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, ageFrom, cn, formatDate, formatNumber, matches, percent, todayISO } from '@/lib/utils'

const PAGE_SIZE = 12

export default function Lodging() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const bedsQuery = useBeds()
  const staysQuery = useStays()
  const arrivalsQuery = useArrivals()
  const checkoutsQuery = usePendingCheckouts()
  const peopleQuery = usePeople({ kinds: ['Llegada', 'Residente', 'Colportor', 'Logistica', 'Conductor', 'Administrativo'] })
  const actions = useLodgingActions()
  const savePerson = useSavePerson()

  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [stayForm, setStayForm] = useState(null)
  const [personForm, setPersonForm] = useState(null)

  const view = searchParams.get('vista') ?? ''
  const beds = useMemo(() => bedsQuery.data ?? [], [bedsQuery.data])

  const stats = useMemo(() => {
    const total = beds.length
    const occupied = beds.filter((bed) => bed.availability === 'Ocupada').length
    const free = beds.filter((bed) => bed.availability === 'Libre').length
    const blocked = beds.filter((bed) => bed.availability === 'Bloqueada').length
    return { total, occupied, free, blocked, occupancy: percent(occupied, total) }
  }, [beds])

  /** Agrupa las camas por habitación para pintar el mapa del centro. */
  const rooms = useMemo(() => {
    const map = new Map()
    beds.forEach((bed) => {
      if (!map.has(bed.room_id)) {
        map.set(bed.room_id, { id: bed.room_id, code: bed.room_code, sex: bed.sex, beds: [] })
      }
      map.get(bed.room_id).beds.push(bed)
    })
    return [...map.values()]
  }, [beds])

  const visibleRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (!matches(room.code, search)) return false
        if (view === 'libres') return room.beds.some((bed) => bed.availability === 'Libre')
        if (view === 'Mujeres' || view === 'Hombres') return room.sex === view
        if (view === 'bloqueadas') return room.beds.some((bed) => bed.availability === 'Bloqueada')
        return true
      }),
    [rooms, search, view],
  )

  const freeBedsForPerson = useMemo(() => {
    if (!stayForm?.person_id) return []
    const person = peopleQuery.data?.find((item) => item.id === stayForm.person_id)
    if (!person) return []
    return beds.filter((bed) => bed.availability === 'Libre' && bed.sex === person.sex)
  }, [beds, peopleQuery.data, stayForm?.person_id])

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
    setVisibleCount(PAGE_SIZE)
  }

  const openStayForm = (values = {}) =>
    setStayForm({
      person_id: '',
      bed_id: '',
      start_date: todayISO(),
      end_date: addDays(todayISO(), 7),
      ...values,
    })

  const submitStay = (event) => {
    event.preventDefault()
    actions.createStay.mutate(stayForm, { onSuccess: () => setStayForm(null) })
  }

  const submitPerson = (event) => {
    event.preventDefault()
    savePerson.mutate(personForm, { onSuccess: () => setPersonForm(null) })
  }

  return (
    <>
      <PageHeader title="Alojamientos" subtitle="Cada persona, en el lugar adecuado.">
        <TodayChip />
        {canWrite && (
          <Button onClick={() => openStayForm()}>
            <Plus />
            Asignar cama
          </Button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ocupación actual" value={`${stats.occupancy}%`} detail={`${formatNumber(stats.occupied)} de ${formatNumber(stats.total)} camas`} onClick={() => setView('')} />
        <KpiCard label="Camas disponibles" value={formatNumber(stats.free)} detail={`${formatNumber(stats.blocked)} bloqueadas`} tone="green" onClick={() => setView('libres')} />
        <KpiCard label="Llegadas sin asignar" value={arrivalsQuery.data?.length ?? 0} detail="Personas pendientes de reserva" tone="gold" onClick={() => setView('llegadas')} />
        <KpiCard label="Salidas por confirmar" value={checkoutsQuery.data?.length ?? 0} detail="La cama sigue ocupada" tone="gold" onClick={() => setView('salidas')} />
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <SearchInput
          placeholder="Buscar habitación: A-101…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setVisibleCount(PAGE_SIZE)
          }}
          aria-label="Buscar habitación"
        />
        <Select
          className="w-full sm:w-56"
          label=""
          value={view}
          onChange={(event) => setView(event.target.value)}
          options={[
            { value: '', label: 'Todas las habitaciones' },
            { value: 'Mujeres', label: 'Mujeres' },
            { value: 'Hombres', label: 'Hombres' },
            { value: 'libres', label: 'Con camas libres' },
            { value: 'bloqueadas', label: 'Con camas bloqueadas' },
            { value: 'llegadas', label: 'Llegadas pendientes' },
            { value: 'salidas', label: 'Salidas pendientes' },
          ]}
        />
        {canWrite && (
          <Button
            variant="secondary"
            onClick={() =>
              setPersonForm({
                full_name: '',
                sex: 'Mujeres',
                birth_date: '2000-01-01',
                phone: '',
                base_city: 'Piedecuesta',
                kind: 'Llegada',
                daily_goal: 0,
              })
            }
          >
            <Plus />
            Persona
          </Button>
        )}
      </div>

      {view === 'llegadas' ? (
        <Card>
          <CardHeader title="Personas pendientes de alojamiento" description="Llegadas sin cama asignada" />
          <QueryBoundary query={arrivalsQuery} empty="Todas las llegadas tienen alojamiento asignado.">
            <ul>
              {arrivalsQuery.data?.map((person) => (
                <li key={person.id} className="flex items-center gap-3 border-b border-[#edf1f5] px-4 py-3 last:border-0 sm:px-6">
                  <Avatar name={person.full_name} />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{person.full_name}</strong>
                    <small className="text-xs text-ink-soft">
                      {person.sex} · {ageFrom(person.birth_date)} años
                    </small>
                  </div>
                  {canWrite && (
                    <Button size="sm" variant="secondary" onClick={() => openStayForm({ person_id: person.id })}>
                      Asignar cama
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </Card>
      ) : view === 'salidas' ? (
        <Card>
          <CardHeader title="Salidas pendientes de confirmación" description="La fecha tentativa no libera la cama por sí sola." />
          <QueryBoundary query={checkoutsQuery} empty="No hay salidas vencidas.">
            <Table columns={['Persona', 'Habitación / cama', 'Salida prevista', '']}>
              {checkoutsQuery.data?.map((stay) => (
                <Tr key={stay.id}>
                  <Td>{stay.people?.full_name}</Td>
                  <Td>
                    {stay.beds?.rooms?.code} / {stay.beds?.label}
                  </Td>
                  <Td>{formatDate(stay.end_date)}</Td>
                  <Td>
                    {canWrite && (
                      <Button size="sm" variant="secondary" onClick={() => actions.checkOut.mutate(stay.id)}>
                        <LogOut />
                        Confirmar salida
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          </QueryBoundary>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-5 text-xs text-ink-soft">
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-navy-100 ring-1 ring-navy-300" /> Ocupada / reservada
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-300" /> Libre
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-[#f4eae7] ring-1 ring-[#dfc7bf]" /> Bloqueada
            </span>
          </div>

          {bedsQuery.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-40" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleRooms.slice(0, visibleCount).map((room) => (
                  <article key={room.id} className="surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-semibold text-ink">{room.code}</h2>
                      <Badge>{room.sex}</Badge>
                    </div>
                    <p className="mt-1 mb-3 text-xs text-ink-soft">
                      {room.beds.filter((bed) => bed.availability === 'Libre').length} libres de{' '}
                      {room.beds.length} camas
                    </p>
                    <div className="grid grid-cols-6 gap-1.5">
                      {room.beds.map((bed) => (
                        <button
                          key={bed.bed_id}
                          type="button"
                          title={
                            bed.availability === 'Ocupada'
                              ? bed.person_name
                              : bed.availability === 'Bloqueada'
                                ? (bed.blocked_reason ?? 'Bloqueada')
                                : 'Libre'
                          }
                          aria-label={`${room.code}, cama ${bed.bed_label}: ${bed.availability}`}
                          disabled={!canWrite || bed.availability !== 'Libre'}
                          onClick={() => openStayForm({ bed_id: bed.bed_id })}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-md border px-1 py-2.5 text-[11px] transition',
                            bed.availability === 'Libre' &&
                              'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                            bed.availability === 'Ocupada' && 'border-navy-200 bg-navy-50 text-navy-600',
                            bed.availability === 'Bloqueada' && 'border-[#dfc7bf] bg-[#f4eae7] text-[#9c6556]',
                          )}
                        >
                          <BedDouble className="size-4" aria-hidden="true" />
                          {bed.bed_label}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              {visibleRooms.length === 0 && (
                <Card>
                  <p className="px-6 py-10 text-center text-sm text-ink-soft">
                    No hay habitaciones que coincidan con el filtro.
                  </p>
                </Card>
              )}

              {visibleCount < visibleRooms.length && (
                <Button variant="secondary" className="mx-auto mt-5" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                  Mostrar más habitaciones ({visibleRooms.length - visibleCount})
                </Button>
              )}
            </>
          )}
        </>
      )}

      <Card className="mt-5">
        <CardHeader title="Reservas y movimientos recientes" description="Confirma ingresos y salidas para liberar camas." />
        <QueryBoundary query={staysQuery} empty="Sin movimientos registrados.">
          <Table columns={['Persona', 'Habitación / cama', 'Estadía', 'Estado', '']}>
            {staysQuery.data?.map((stay) => (
              <Tr key={stay.id}>
                <Td>{stay.people?.full_name}</Td>
                <Td>
                  {stay.beds?.rooms?.code} / {stay.beds?.label}
                </Td>
                <Td className="text-xs">
                  {formatDate(stay.start_date)} – {formatDate(stay.end_date)}
                </Td>
                <Td>
                  <Badge tone={stay.status === 'Finalizado' ? 'green' : stay.status === 'Reservado' ? 'navy' : 'gold'}>
                    {stay.status}
                  </Badge>
                </Td>
                <Td>
                  {canWrite && stay.status === 'Reservado' && (
                    <Button size="sm" variant="secondary" onClick={() => actions.checkIn.mutate(stay.id)}>
                      <LogIn />
                      Confirmar ingreso
                    </Button>
                  )}
                  {canWrite && stay.status === 'Alojado' && (
                    <Button size="sm" variant="ghost" onClick={() => actions.checkOut.mutate(stay.id)}>
                      <LogOut />
                      Confirmar salida
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </QueryBoundary>
      </Card>

      {/* Reservar cama */}
      <Dialog
        open={Boolean(stayForm)}
        onClose={() => setStayForm(null)}
        title="Reservar alojamiento"
        description="La disponibilidad se valida para toda la estadía."
        footer={
          <>
            <Button variant="secondary" onClick={() => setStayForm(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="stay-form" loading={actions.createStay.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        {stayForm && (
          <form id="stay-form" onSubmit={submitStay} className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Persona"
              required
              className="sm:col-span-2"
              value={stayForm.person_id}
              onChange={(event) => setStayForm((prev) => ({ ...prev, person_id: event.target.value, bed_id: '' }))}
              placeholder="Seleccionar…"
              options={(peopleQuery.data ?? []).map((person) => ({
                value: person.id,
                label: `${person.full_name} · ${person.sex} · ${label(person.kind)}`,
              }))}
            />
            <Select
              label="Cama libre"
              required
              className="sm:col-span-2"
              value={stayForm.bed_id}
              onChange={(event) => setStayForm((prev) => ({ ...prev, bed_id: event.target.value }))}
              placeholder={stayForm.person_id ? 'Seleccionar…' : 'Elige primero la persona'}
              hint="Solo se listan camas libres de la sección que corresponde a la persona."
              options={freeBedsForPerson.map((bed) => ({
                value: bed.bed_id,
                label: `${bed.room_code} · Cama ${bed.bed_label}`,
              }))}
            />
            <Input
              label="Llegada"
              type="date"
              required
              value={stayForm.start_date}
              onChange={(event) => setStayForm((prev) => ({ ...prev, start_date: event.target.value }))}
            />
            <Input
              label="Salida tentativa"
              type="date"
              required
              min={addDays(stayForm.start_date, 1)}
              value={stayForm.end_date}
              onChange={(event) => setStayForm((prev) => ({ ...prev, end_date: event.target.value }))}
            />
          </form>
        )}
      </Dialog>

      {/* Alta de persona */}
      <Dialog
        open={Boolean(personForm)}
        onClose={() => setPersonForm(null)}
        title="Registrar persona"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPersonForm(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="person-form" loading={savePerson.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        {personForm && (
          <form id="person-form" onSubmit={submitPerson} className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Nombre completo"
              required
              className="sm:col-span-2"
              value={personForm.full_name}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, full_name: event.target.value }))}
            />
            <Select
              label="Sexo para alojamiento"
              value={personForm.sex}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, sex: event.target.value }))}
              options={SEX_GROUPS.map((value) => ({ value, label: value }))}
            />
            <Input
              label="Fecha de nacimiento"
              type="date"
              required
              max={todayISO()}
              value={personForm.birth_date}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, birth_date: event.target.value }))}
            />
            <Input
              label="Teléfono"
              type="tel"
              value={personForm.phone}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <Select
              label="Función"
              value={personForm.kind}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, kind: event.target.value }))}
              options={PERSON_KINDS.map((value) => ({ value, label: label(value) }))}
            />
            <Input
              label="Ciudad base"
              className="sm:col-span-2"
              value={personForm.base_city}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, base_city: event.target.value }))}
            />
          </form>
        )}
      </Dialog>

      <Card className="mt-5">
        <CardHeader title="Capacidad del centro" />
        <div className="px-4 py-5 sm:px-6">
          <Progress value={stats.occupancy} className="h-3" tone={stats.occupancy > 92 ? 'gold' : 'navy'} />
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
            <span>{formatNumber(stats.occupied)} ocupadas</span>
            <span>{formatNumber(stats.free)} libres</span>
            <span>{formatNumber(stats.blocked)} bloqueadas</span>
          </div>
        </div>
      </Card>
    </>
  )
}
