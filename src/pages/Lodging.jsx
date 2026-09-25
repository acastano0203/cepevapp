import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Baby,
  BedDouble,
  CheckCircle2,
  ClipboardList,
  Crown,
  DoorOpen,
  Eye,
  LogIn,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
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
  Textarea,
  Tr,
} from '@/components/ui'
import {
  useActiveStays,
  useRoomIssues,
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
import { addDays, ageFrom, cn, formatDate, formatDateTime, formatNumber, matches, percent, todayISO, whatsappUrl } from '@/lib/utils'

const PAGE_SIZE = 12

/** Quién puede alojarse; por defecto el diálogo muestra solo cepevistas y colportores. */
const LODGING_KINDS = ['Cepevista', 'Colportor', 'Llegada', 'Residente', 'Logistica', 'Conductor', 'Administrativo']
const GUEST_KINDS = ['Cepevista', 'Colportor']

/** Camarote al que pertenece una cama: 01 y 02 son el 1, 03 y 04 el 2… */
const bunkOf = (bed) => (/^\d+$/.test(bed.bed_label) ? Math.ceil(Number(bed.bed_label) / 2) : bed.bed_label)

/**
 * Nivel de la cama en el camarote. Si la vista aún no trae bed_level (falta
 * correr 17_lodging_rooms.sql), se deduce del número: impar inferior, par superior.
 */
const levelOf = (bed) =>
  bed.bed_level ?? (/^\d+$/.test(bed.bed_label) && Number(bed.bed_label) % 2 === 0 ? 'Superior' : 'Inferior')

const LEVEL_TEXT = { Inferior: 'Cama inferior ↓', Superior: 'Cama superior ↑' }

const bedName = (bed) => `Camarote ${bunkOf(bed)} · ${LEVEL_TEXT[levelOf(bed)]} (n.º ${bed.bed_label})`

/** A partir de esta edad solo se ofrecen camas inferiores. */
const LOWER_BED_AGE = 50

/** Los niños de esta edad o menos duermen en la cama del adulto que los acompaña. */
const CHILD_MAX_AGE = 5
const MAX_CHILDREN = 3
const emptyChild = () => ({ full_name: '', age: '' })

/** Tipos de novedad de un dormitorio. */
const ISSUE_CATEGORIES = ['Mantenimiento', 'Limpieza', 'Queja', 'Convivencia', 'Otro']
const emptyIssue = () => ({ category: 'Mantenimiento', priority: 'Normal', detail: '' })

const STATUS_BADGE = {
  Libre: { tone: 'green', text: 'Libre' },
  Ocupada: { tone: 'red', text: 'Ocupada' },
  Capitan: { tone: 'gold', text: 'Capitán' },
  Bloqueada: { tone: 'neutral', text: 'Bloqueada' },
}

/** "Sofía (3 años), Juan (1 año)" */
const childrenText = (children = []) =>
  children.map((child) => `${child.full_name} (${child.age} ${child.age === 1 ? 'año' : 'años'})`).join(', ')

/** Dos rangos [inicio, fin) se cruzan. */
const overlaps = (stay, start, end) => stay.start_date < end && start < stay.end_date

export default function Lodging() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const bedsQuery = useBeds()
  const staysQuery = useStays()
  const arrivalsQuery = useArrivals()
  const checkoutsQuery = usePendingCheckouts()
  const peopleQuery = usePeople({ kinds: LODGING_KINDS })
  const activeStaysQuery = useActiveStays()
  const issuesQuery = useRoomIssues()
  const actions = useLodgingActions()
  const savePerson = useSavePerson()
  const captainsQuery = usePeople({ kinds: ['Cepevista', 'Colportor'] })

  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [stayForm, setStayForm] = useState(null)
  const [personForm, setPersonForm] = useState(null)
  const [roomForm, setRoomForm] = useState(null)
  const [deletingRoom, setDeletingRoom] = useState(null)
  const [detailRoomId, setDetailRoomId] = useState(null)
  const [issuesRoomId, setIssuesRoomId] = useState(null)
  const [issueForm, setIssueForm] = useState(emptyIssue)
  const [issueView, setIssueView] = useState('abiertas')
  const [resolving, setResolving] = useState(null) // { id, resolution }

  const view = searchParams.get('vista') ?? ''
  const beds = useMemo(() => bedsQuery.data ?? [], [bedsQuery.data])

  const stats = useMemo(() => {
    const total = beds.length
    // La cama del capitán cuenta como ocupada: nadie más puede reservarla
    const occupied = beds.filter((bed) => bed.availability === 'Ocupada' || bed.availability === 'Capitan').length
    const free = beds.filter((bed) => bed.availability === 'Libre').length
    const blocked = beds.filter((bed) => bed.availability === 'Bloqueada').length
    return { total, occupied, free, blocked, occupancy: percent(occupied, total) }
  }, [beds])

  /** Agrupa las camas por habitación para pintar el mapa del centro. */
  const rooms = useMemo(() => {
    const map = new Map()
    beds.forEach((bed) => {
      if (!map.has(bed.room_id)) {
        map.set(bed.room_id, {
          id: bed.room_id,
          code: bed.room_code,
          sex: bed.sex,
          captainId: bed.captain_id,
          captainName: bed.captain_name,
          captainPhone: bed.captain_phone,
          captainBed: null,
          beds: [],
        })
      }
      const room = map.get(bed.room_id)
      room.beds.push(bed)
      if (bed.is_captain_bed) room.captainBed = bed.bed_label
    })
    // Cada camarote: la cama superior arriba y la inferior abajo
    return [...map.values()].map((room) => {
      const bunks = new Map()
      room.beds.forEach((bed) => {
        const key = bunkOf(bed)
        if (!bunks.has(key)) bunks.set(key, { number: key, upper: null, lower: null })
        bunks.get(key)[levelOf(bed) === 'Superior' ? 'upper' : 'lower'] = bed
      })
      return { ...room, bunks: [...bunks.values()] }
    })
  }, [beds])

  const detailRoom = rooms.find((room) => room.id === detailRoomId) ?? null
  const issuesRoom = rooms.find((room) => room.id === issuesRoomId) ?? null

  /** Novedades por dormitorio (más recientes primero). */
  const issuesByRoom = useMemo(() => {
    const map = new Map()
    ;(issuesQuery.data ?? []).forEach((issue) => {
      if (!map.has(issue.room_id)) map.set(issue.room_id, [])
      map.get(issue.room_id).push(issue)
    })
    return map
  }, [issuesQuery.data])

  const openIssuesOf = (roomId) => (issuesByRoom.get(roomId) ?? []).filter((issue) => issue.status === 'Abierta')

  const openIssues = (roomId) => {
    setIssuesRoomId(roomId)
    setIssueForm(emptyIssue())
    setIssueView('abiertas')
    setResolving(null)
  }

  const submitIssue = (event) => {
    event.preventDefault()
    actions.createRoomIssue.mutate({ ...issueForm, room_id: issuesRoomId }, { onSuccess: () => setIssueForm(emptyIssue()) })
  }

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

  const activeStays = useMemo(() => activeStaysQuery.data ?? [], [activeStaysQuery.data])

  /** Niños por estadía, para mostrarlos en la cama del adulto. */
  const childrenByStay = useMemo(
    () => new Map(activeStays.map((stay) => [stay.id, stay.stay_children ?? []])),
    [activeStays],
  )

  /** Los capitanes ya tienen su cama: no se les asigna otra. */
  const captainIds = useMemo(() => new Set(beds.map((bed) => bed.captain_id).filter(Boolean)), [beds])

  /** Personas de la sección elegida sin otra estadía que se cruce con las fechas ni capitanía. */
  const peopleForStay = useMemo(() => {
    if (!stayForm) return []
    const busy = new Set(
      activeStays
        .filter((stay) => overlaps(stay, stayForm.start_date, stayForm.end_date))
        .map((stay) => stay.person_id),
    )
    return (peopleQuery.data ?? []).filter(
      (person) =>
        person.sex === stayForm.sex &&
        (stayForm.allKinds || GUEST_KINDS.includes(person.kind)) &&
        (!busy.has(person.id) || person.id === stayForm.person_id) &&
        !captainIds.has(person.id),
    )
  }, [activeStays, captainIds, peopleQuery.data, stayForm])

  // Mayores de 50: solo camas inferiores, sin importar el filtro elegido
  const onlyLower = Number(stayForm?.age) > LOWER_BED_AGE

  /** Camas de la sección libres durante toda la estadía: sin capitán, bloqueo ni reservas cruzadas. */
  const freeBedsForStay = useMemo(() => {
    if (!stayForm) return []
    const taken = new Set(
      activeStays
        .filter((stay) => overlaps(stay, stayForm.start_date, stayForm.end_date))
        .map((stay) => stay.bed_id),
    )
    return beds.filter(
      (bed) =>
        bed.sex === stayForm.sex &&
        !bed.is_blocked &&
        !bed.is_captain_bed &&
        !taken.has(bed.bed_id) &&
        (!onlyLower || levelOf(bed) === 'Inferior'),
    )
  }, [activeStays, beds, stayForm, onlyLower])

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
    setVisibleCount(PAGE_SIZE)
  }

  const openStayForm = (values = {}) => {
    // La sección sale de la cama o de la persona que se trae preseleccionada
    const bed = values.bed_id && beds.find((item) => item.bed_id === values.bed_id)
    const person = values.person_id && peopleQuery.data?.find((item) => item.id === values.person_id)
    setStayForm({
      person_id: '',
      bed_id: '',
      start_date: todayISO(),
      end_date: addDays(todayISO(), 7),
      sex: bed?.sex ?? person?.sex ?? 'Mujeres',
      allKinds: Boolean(person && !GUEST_KINDS.includes(person.kind)),
      age: person?.birth_date ? String(ageFrom(person.birth_date)) : '',
      has_children: false,
      children: [emptyChild()],
      ...values,
    })
  }

  const submitStay = (event) => {
    event.preventDefault()
    actions.createStay.mutate(stayForm, { onSuccess: () => setStayForm(null) })
  }

  const updateChild = (index, field, value) =>
    setStayForm((prev) => ({
      ...prev,
      children: prev.children.map((child, i) => (i === index ? { ...child, [field]: value } : child)),
    }))

  const renderBed = (room, bed) => {
    const kids = bed.stay_id ? (childrenByStay.get(bed.stay_id) ?? []) : []
    return (
      <button
        key={bed.bed_id}
        type="button"
        title={`${bedName(bed)} · ${
          bed.availability === 'Ocupada'
            ? `${bed.person_name}${kids.length ? ` con ${childrenText(kids)} en la misma cama` : ''}`
            : bed.availability === 'Capitan'
              ? `${room.sex === 'Mujeres' ? 'Capitana' : 'Capitán'}: ${room.captainName ?? ''}`
              : bed.availability === 'Bloqueada'
                ? (bed.blocked_reason ?? 'Bloqueada')
                : 'Libre'
        }`}
        aria-label={`${room.code}, ${bedName(bed)}: ${bed.availability}`}
        disabled={!canWrite || bed.availability !== 'Libre'}
        onClick={() => openStayForm({ bed_id: bed.bed_id })}
        className={cn(
          'flex w-full items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-[11px] transition',
          bed.availability === 'Libre' && 'border-green-500 bg-green-100 text-green-800 hover:bg-green-200',
          bed.availability === 'Ocupada' && 'border-red-400 bg-red-100 text-red-700',
          bed.availability === 'Capitan' && 'border-gold-500 bg-gold-100 text-gold-700',
          bed.availability === 'Bloqueada' && 'border-[#dfc7bf] bg-[#f4eae7] text-[#9c6556]',
        )}
      >
        {bed.availability === 'Capitan' ? (
          <Crown className="size-3.5" aria-hidden="true" />
        ) : (
          <BedDouble className="size-3.5" aria-hidden="true" />
        )}
        {levelOf(bed)}
        {kids.length > 0 && (
          <span className="inline-flex items-center" aria-label={`con ${kids.length} niño(s)`}>
            <Baby className="size-3.5" aria-hidden="true" />
            {kids.length > 1 && kids.length}
          </span>
        )}
      </button>
    )
  }

  const captainCandidates = captainsQuery.data ?? []
  const captainOptions = roomForm ? captainCandidates.filter((person) => person.sex === roomForm.sex) : []

  /** Reserva vigente de una persona (si ya duerme en alguna cama). */
  const currentStayOf = (personId) =>
    personId ? activeStays.find((stay) => stay.person_id === personId && stay.end_date > todayISO()) : undefined

  // Cambio de capitán al editar: el nuevo deja su cama y se decide qué pasa con el anterior
  const captainChanged = Boolean(
    roomForm?.id && roomForm.original_captain_id && roomForm.captain_id && roomForm.captain_id !== roomForm.original_captain_id,
  )
  const newCaptainStay = roomForm ? currentStayOf(roomForm.captain_id) : undefined
  const newCaptainBed = newCaptainStay && beds.find((bed) => bed.bed_id === newCaptainStay.bed_id)
  const newCaptainName = captainCandidates.find((person) => person.id === roomForm?.captain_id)?.full_name
  const oldCaptainBedOptions = captainChanged
    ? roomForm.roomBeds.filter(
        (bed) =>
          bed.bed_label !== roomForm.captain_bed &&
          !bed.is_blocked &&
          (bed.availability === 'Libre' || bed.is_captain_bed || bed.bed_id === newCaptainStay?.bed_id),
      )
    : []

  const submitRoom = (event) => {
    event.preventDefault()
    actions.saveRoom.mutate(roomForm, { onSuccess: () => setRoomForm(null) })
  }

  const confirmDeleteRoom = () =>
    actions.deleteRoom.mutate({ id: deletingRoom.id }, { onSuccess: () => setDeletingRoom(null) })

  const submitPerson = (event) => {
    event.preventDefault()
    savePerson.mutate(personForm, { onSuccess: () => setPersonForm(null) })
  }

  return (
    <>
      <PageHeader title="Alojamientos" subtitle="Cada persona, en el lugar adecuado.">
        <TodayChip />
        {canWrite && (
          <Button variant="secondary" onClick={() => setRoomForm({ code: '', sex: 'Mujeres', bunks: 3, captain_id: '', captain_phone: '', captain_bed: '01' })}>
            <DoorOpen />
            Nuevo dormitorio
          </Button>
        )}
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
                  <Td>
                  {stay.people?.full_name}
                  {stay.stay_children?.length > 0 && (
                    <small className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
                      <Baby className="size-3.5 shrink-0" aria-hidden="true" />
                      Misma cama: {childrenText(stay.stay_children)}
                    </small>
                  )}
                </Td>
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
              <i className="size-2.5 rounded-sm bg-red-100 ring-1 ring-red-400" /> Ocupada / reservada
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-green-100 ring-1 ring-green-500" /> Libre
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm bg-gold-100 ring-1 ring-gold-500" /> Capitán
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
                  <article
                    key={room.id}
                    className="surface cursor-pointer p-4 select-none"
                    title="Doble clic para ver el detalle"
                    onDoubleClick={(event) => {
                      // El doble clic sobre una cama o un botón no abre el detalle
                      if (!event.target.closest('button, a')) setDetailRoomId(room.id)
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="min-w-0 truncate font-semibold text-ink">{room.code}</h2>
                      <div className="flex items-center gap-1">
                        <Badge>{room.sex}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailRoomId(room.id)}
                          aria-label={`Ver detalle de ${room.code}`}
                        >
                          <Eye />
                        </Button>
                        {canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setRoomForm({
                                  id: room.id,
                                  code: room.code,
                                  sex: room.sex,
                                  bunks: room.bunks.length,
                                  captain_id: room.captainId ?? '',
                                  captain_phone: room.captainPhone ?? '',
                                  captain_bed: room.captainBed ?? '01',
                                  roomBeds: room.beds,
                                  original_captain_id: room.captainId ?? '',
                                  original_captain_name: room.captainName ?? '',
                                  old_captain_stays: false,
                                  old_captain_bed: '',
                                  old_captain_end: '',
                                })
                              }
                              aria-label={`Editar ${room.code}`}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-bg)]"
                              onClick={() => setDeletingRoom(room)}
                              aria-label={`Eliminar ${room.code}`}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      {room.beds.filter((bed) => bed.availability === 'Libre').length} libres de{' '}
                      {room.beds.length} camas · {room.bunks.length} camarotes
                    </p>
                    <p className="mt-1 mb-3 flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
                      <Crown className="size-3.5 shrink-0 text-gold-600" aria-hidden="true" />
                      {room.captainName ? (
                        <>
                          <span className="truncate">
                            {room.sex === 'Mujeres' ? 'Capitana' : 'Capitán'}: <strong className="font-semibold text-ink">{room.captainName}</strong>
                          </span>
                          {whatsappUrl(room.captainPhone) && (
                            <a
                              href={whatsappUrl(room.captainPhone)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex shrink-0 items-center gap-1 font-medium text-green-700 hover:underline"
                              aria-label={`Escribir por WhatsApp a ${room.captainName}`}
                            >
                              <MessageCircle className="size-3.5" aria-hidden="true" />
                              {room.captainPhone}
                            </a>
                          )}
                        </>
                      ) : (
                        <span>Sin capitán asignado (edítalo para elegirlo)</span>
                      )}
                    </p>
                    {(() => {
                      const open = openIssuesOf(room.id)
                      const urgent = open.some((issue) => issue.priority === 'Urgente')
                      return (
                        <button
                          type="button"
                          onClick={() => openIssues(room.id)}
                          className={cn(
                            'mb-3 flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition',
                            open.length === 0 && 'border-line text-ink-soft hover:bg-[#f8fafc]',
                            open.length > 0 && !urgent && 'border-gold-300 bg-gold-50 text-gold-700 hover:bg-gold-100',
                            urgent && 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100',
                          )}
                        >
                          <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">
                            {open.length === 0
                              ? 'Sin novedades abiertas'
                              : `${open.length} ${open.length === 1 ? 'novedad abierta' : 'novedades abiertas'}${urgent ? ' · urgente' : ''}: ${open[0].category.toLowerCase()}`}
                          </span>
                          <span className="shrink-0 font-medium">{canWrite ? 'Ver / registrar' : 'Ver'}</span>
                        </button>
                      )
                    })()}
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                      {room.bunks.map((bunk) => (
                        <div key={bunk.number} className="flex flex-col gap-1 rounded-lg border border-line p-1">
                          <span className="text-center text-[10px] font-semibold text-ink-soft">C{bunk.number}</span>
                          {bunk.upper && renderBed(room, bunk.upper)}
                          {bunk.lower && renderBed(room, bunk.lower)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              {visibleRooms.length === 0 && (
                <Card>
                  <p className="px-6 py-10 text-center text-sm text-ink-soft">
                    {rooms.length === 0
                      ? 'Todavía no hay dormitorios. Créalos con "Nuevo dormitorio".'
                      : 'No hay habitaciones que coincidan con el filtro.'}
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
                <Td>
                  {stay.people?.full_name}
                  {stay.stay_children?.length > 0 && (
                    <small className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
                      <Baby className="size-3.5 shrink-0" aria-hidden="true" />
                      Misma cama: {childrenText(stay.stay_children)}
                    </small>
                  )}
                </Td>
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
              label="Sección"
              value={stayForm.sex}
              onChange={(event) =>
                // Cambiar de sección invalida la persona y la cama elegidas
                setStayForm((prev) => ({ ...prev, sex: event.target.value, person_id: '', bed_id: '' }))
              }
              options={SEX_GROUPS.map((value) => ({ value, label: value }))}
            />
            <Select
              label="Mostrar"
              value={stayForm.allKinds ? 'todas' : 'huespedes'}
              onChange={(event) => setStayForm((prev) => ({ ...prev, allKinds: event.target.value === 'todas', person_id: '' }))}
              options={[
                { value: 'huespedes', label: 'Cepevistas y colportores' },
                { value: 'todas', label: 'Todas las personas' },
              ]}
            />
            <Select
              label="Persona"
              required
              className="sm:col-span-2"
              value={stayForm.person_id}
              onChange={(event) => {
                const person = peopleForStay.find((item) => item.id === event.target.value)
                // La edad se precarga con la fecha de nacimiento de la ficha
                setStayForm((prev) => ({
                  ...prev,
                  person_id: event.target.value,
                  age: person?.birth_date ? String(ageFrom(person.birth_date)) : prev.age,
                }))
              }}
              placeholder={peopleForStay.length ? 'Seleccionar…' : `No hay personas de ${stayForm.sex} sin alojamiento en esas fechas`}
              hint="No aparecen los capitanes ni quienes ya tienen una estadía que se cruza con las fechas."
              options={peopleForStay.map((person) => ({
                value: person.id,
                label: `${person.full_name} · ${label(person.kind)}`,
              }))}
            />
            <Input
              label="Edad"
              className="sm:col-span-2"
              type="number"
              min="0"
              max="120"
              required
              value={stayForm.age}
              onChange={(event) => setStayForm((prev) => ({ ...prev, age: event.target.value }))}
              hint={onlyLower ? `Mayor de ${LOWER_BED_AGE} años: solo camas inferiores.` : 'Se completa con la ficha de la persona.'}
            />
            <Select
              label="Cama disponible"
              required
              className="sm:col-span-2"
              value={freeBedsForStay.some((bed) => bed.bed_id === stayForm.bed_id) ? stayForm.bed_id : ''}
              onChange={(event) => setStayForm((prev) => ({ ...prev, bed_id: event.target.value }))}
              placeholder={
                freeBedsForStay.length
                  ? 'Seleccionar…'
                  : `No hay camas ${onlyLower ? 'inferiores ' : ''}de ${stayForm.sex} libres en esas fechas`
              }
              hint={`${freeBedsForStay.filter((bed) => levelOf(bed) === 'Inferior').length} inferiores y ${
                freeBedsForStay.filter((bed) => levelOf(bed) === 'Superior').length
              } superiores libres durante toda la estadía (sin la del capitán ni las bloqueadas).`}
              options={freeBedsForStay.map((bed) => ({
                value: bed.bed_id,
                label: `${bed.room_code} · ${bedName(bed)}`,
              }))}
            />
            <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-semibold text-[#536c83]">
                Niños de {CHILD_MAX_AGE} años o menos
              </legend>
              <Select
                label={`¿Tiene hijos de ${CHILD_MAX_AGE} años o menos que dormirán con él o ella?`}
                value={stayForm.has_children ? 'si' : 'no'}
                onChange={(event) => setStayForm((prev) => ({ ...prev, has_children: event.target.value === 'si' }))}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'si', label: 'Sí, duermen en la misma cama' },
                ]}
              />
              {stayForm.has_children && (
                <>
                  {stayForm.children.map((child, index) => (
                    <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
                      <Input
                        label={`Nombre del niño ${index + 1}`}
                        required
                        value={child.full_name}
                        onChange={(event) => updateChild(index, 'full_name', event.target.value)}
                      />
                      <Select
                        label="Edad"
                        required
                        value={child.age}
                        onChange={(event) => updateChild(index, 'age', event.target.value)}
                        placeholder="—"
                        options={Array.from({ length: CHILD_MAX_AGE + 1 }, (_, age) => ({
                          value: String(age),
                          label: age === 1 ? '1 año' : `${age} años`,
                        }))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mb-1.5"
                        disabled={stayForm.children.length === 1}
                        onClick={() =>
                          setStayForm((prev) => ({ ...prev, children: prev.children.filter((_, i) => i !== index) }))
                        }
                        aria-label={`Quitar niño ${index + 1}`}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                      <Baby className="size-3.5" aria-hidden="true" />
                      Quedan registrados en esta reserva, durmiendo en la misma cama del adulto.
                    </span>
                    {stayForm.children.length < MAX_CHILDREN && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setStayForm((prev) => ({ ...prev, children: [...prev.children, emptyChild()] }))}
                      >
                        <Plus />
                        Otro niño
                      </Button>
                    )}
                  </div>
                </>
              )}
            </fieldset>
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

      {/* Alta o edición de dormitorio */}
      <Dialog
        open={Boolean(roomForm)}
        onClose={() => setRoomForm(null)}
        title={roomForm?.id ? 'Editar dormitorio' : 'Nuevo dormitorio'}
        description="Cada camarote tiene cama inferior y superior. Se numeran solas: 01 inferior, 02 superior…"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoomForm(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="room-form" loading={actions.saveRoom.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        {roomForm && (
          <form id="room-form" onSubmit={submitRoom} className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Nombre del dormitorio"
              required
              className="sm:col-span-2"
              placeholder="Ej.: Dormitorio 1, A-101"
              value={roomForm.code}
              onChange={(event) => setRoomForm((prev) => ({ ...prev, code: event.target.value }))}
            />
            <Select
              label="Sección"
              value={roomForm.sex}
              onChange={(event) => {
                const sex = event.target.value
                // El capitán debe ser de la misma sección: si ya no coincide, se quita
                setRoomForm((prev) =>
                  prev.captain_id && captainCandidates.find((person) => person.id === prev.captain_id)?.sex !== sex
                    ? { ...prev, sex, captain_id: '', captain_phone: '' }
                    : { ...prev, sex },
                )
              }}
              options={SEX_GROUPS.map((value) => ({ value, label: value }))}
            />
            <Input
              label="Número de camarotes"
              type="number"
              min="1"
              max="50"
              required
              value={roomForm.bunks}
              onChange={(event) => setRoomForm((prev) => ({ ...prev, bunks: event.target.value }))}
              hint={
                roomForm.id
                  ? `${Number(roomForm.bunks) * 2 || 0} camas. Al bajarlo se retiran los últimos camarotes, solo si nunca tuvieron estadías.`
                  : `${Number(roomForm.bunks) * 2 || 0} camas: ${Number(roomForm.bunks) || 0} inferiores y ${Number(roomForm.bunks) || 0} superiores.`
              }
            />
            <Select
              label={roomForm.sex === 'Mujeres' ? 'Capitana del dormitorio' : 'Capitán del dormitorio'}
              required
              value={roomForm.captain_id}
              onChange={(event) => {
                const person = captainCandidates.find((item) => item.id === event.target.value)
                const stay = currentStayOf(event.target.value)
                const freed = stay && roomForm.roomBeds?.find((bed) => bed.bed_id === stay.bed_id)
                setRoomForm((prev) => ({
                  ...prev,
                  captain_id: event.target.value,
                  captain_phone: person?.phone ?? '',
                  // Por defecto el capitán anterior pasa a la cama que deja el nuevo
                  old_captain_bed: freed?.bed_label ?? '',
                  old_captain_end: stay?.end_date ?? addDays(todayISO(), 30),
                }))
              }}
              placeholder={captainOptions.length ? 'Seleccionar…' : `No hay cepevistas ni colportores de ${roomForm.sex}`}
              hint={`Cepevistas y colportores de la sección ${roomForm.sex}.`}
              options={captainOptions.map((person) => ({ value: person.id, label: `${person.full_name} · ${label(person.kind)}` }))}
            />
            <Input
              label="WhatsApp"
              type="tel"
              required
              inputMode="tel"
              placeholder="3001234567"
              value={roomForm.captain_phone}
              onChange={(event) => setRoomForm((prev) => ({ ...prev, captain_phone: event.target.value }))}
            />
            {roomForm.id ? (
              <Select
                label="Cama del capitán"
                className="sm:col-span-2"
                value={roomForm.captain_bed}
                onChange={(event) => setRoomForm((prev) => ({ ...prev, captain_bed: event.target.value }))}
                options={roomForm.roomBeds.map((bed) => ({ value: bed.bed_label, label: bedName(bed) }))}
                hint="Debe estar libre de reservas; nadie más podrá reservarla."
              />
            ) : (
              <p className="flex items-center gap-2 text-xs text-ink-soft sm:col-span-2">
                <Crown className="size-3.5 text-gold-600" aria-hidden="true" />
                La cama inferior del camarote 1 (cama 01) queda reservada para el capitán.
              </p>
            )}
            {captainChanged && (
              <fieldset className="grid gap-3 rounded-xl border border-gold-300 bg-gold-50 p-3 sm:col-span-2 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold text-gold-700">Cambio de capitán</legend>
                {newCaptainStay && (
                  <p className="text-xs text-ink sm:col-span-2">
                    <strong>{newCaptainName}</strong> deja su cama actual
                    {newCaptainBed ? ` (${newCaptainBed.room_code} · ${bedName(newCaptainBed)})` : ''} y pasa a la cama
                    del capitán. Esa cama queda libre.
                  </p>
                )}
                <Select
                  label={`¿Qué pasa con ${roomForm.original_captain_name || 'el capitán anterior'}?`}
                  className="sm:col-span-2"
                  value={roomForm.old_captain_stays ? 'queda' : 'sale'}
                  onChange={(event) => setRoomForm((prev) => ({ ...prev, old_captain_stays: event.target.value === 'queda' }))}
                  options={[
                    { value: 'sale', label: 'Deja el dormitorio' },
                    { value: 'queda', label: 'Se queda en el dormitorio' },
                  ]}
                />
                {roomForm.old_captain_stays && (
                  <>
                    <Select
                      label="Cama donde se queda"
                      required
                      value={oldCaptainBedOptions.some((bed) => bed.bed_label === roomForm.old_captain_bed) ? roomForm.old_captain_bed : ''}
                      onChange={(event) => setRoomForm((prev) => ({ ...prev, old_captain_bed: event.target.value }))}
                      placeholder={oldCaptainBedOptions.length ? 'Seleccionar…' : 'No hay camas libres en este dormitorio'}
                      options={oldCaptainBedOptions.map((bed) => ({
                        value: bed.bed_label,
                        label: `${bedName(bed)}${bed.bed_id === newCaptainStay?.bed_id ? ' · la que deja el nuevo capitán' : ''}`,
                      }))}
                    />
                    <Input
                      label="Salida tentativa"
                      type="date"
                      required
                      min={addDays(todayISO(), 1)}
                      value={roomForm.old_captain_end}
                      onChange={(event) => setRoomForm((prev) => ({ ...prev, old_captain_end: event.target.value }))}
                    />
                  </>
                )}
              </fieldset>
            )}
          </form>
        )}
      </Dialog>

      {/* Novedades del dormitorio */}
      <Dialog
        open={Boolean(issuesRoom)}
        onClose={() => setIssuesRoomId(null)}
        size="lg"
        title={issuesRoom ? `Novedades · ${issuesRoom.code}` : ''}
        description="Mantenimiento, limpieza, quejas y convivencia del dormitorio."
        footer={
          <Button variant="secondary" onClick={() => setIssuesRoomId(null)}>
            Cerrar
          </Button>
        }
      >
        {issuesRoom && (
          <div className="grid gap-5">
            {canWrite && (
              <form onSubmit={submitIssue} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
                <Select
                  label="Tipo"
                  value={issueForm.category}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, category: event.target.value }))}
                  options={ISSUE_CATEGORIES.map((value) => ({ value, label: value }))}
                />
                <Select
                  label="Prioridad"
                  value={issueForm.priority}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, priority: event.target.value }))}
                  options={[
                    { value: 'Normal', label: 'Normal' },
                    { value: 'Urgente', label: 'Urgente' },
                  ]}
                />
                <Textarea
                  label="Detalle"
                  required
                  rows={3}
                  className="sm:col-span-2"
                  placeholder="Ej.: la ducha no tiene agua caliente; ruido después de las 10 p. m.…"
                  value={issueForm.detail}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, detail: event.target.value }))}
                />
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" size="sm" loading={actions.createRoomIssue.isPending}>
                    <Plus />
                    Registrar novedad
                  </Button>
                </div>
              </form>
            )}

            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">
                {issueView === 'abiertas' ? 'Novedades abiertas' : 'Todas las novedades'}
              </h3>
              <Select
                className="w-44"
                aria-label="Filtrar novedades"
                value={issueView}
                onChange={(event) => setIssueView(event.target.value)}
                options={[
                  { value: 'abiertas', label: 'Solo abiertas' },
                  { value: 'todas', label: 'Todas' },
                ]}
              />
            </div>

            {(() => {
              const list = (issuesByRoom.get(issuesRoom.id) ?? []).filter(
                (issue) => issueView === 'todas' || issue.status === 'Abierta',
              )
              if (issuesQuery.isPending) return <Skeleton className="h-24" />
              if (list.length === 0) {
                return (
                  <p className="rounded-xl bg-[#f8fafc] px-4 py-6 text-center text-sm text-ink-soft">
                    {issueView === 'abiertas' ? 'No hay novedades abiertas en este dormitorio.' : 'Aún no hay novedades registradas.'}
                  </p>
                )
              }
              return (
                <ul className="grid gap-3">
                  {list.map((issue) => (
                    <li
                      key={issue.id}
                      className={cn(
                        'rounded-xl border p-3',
                        issue.status === 'Resuelta' ? 'border-line bg-[#f8fafc]' : issue.priority === 'Urgente' ? 'border-red-300' : 'border-gold-300',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="navy">{issue.category}</Badge>
                        {issue.priority === 'Urgente' && <Badge tone="red">Urgente</Badge>}
                        <Badge tone={issue.status === 'Resuelta' ? 'green' : 'gold'}>{issue.status}</Badge>
                        <span className="ml-auto text-xs text-ink-soft">{formatDateTime(issue.created_at)}</span>
                      </div>
                      <p className="mt-2 text-sm whitespace-pre-line text-ink">{issue.detail}</p>
                      <p className="mt-1 text-xs text-ink-soft">Reportó: {issue.reported_by_name ?? '—'}</p>

                      {issue.status === 'Resuelta' && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-success-fg)]">
                          <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            Resuelta por {issue.resolved_by_name ?? '—'} el {formatDateTime(issue.resolved_at)}
                            {issue.resolution ? `: ${issue.resolution}` : ''}
                          </span>
                        </p>
                      )}

                      {canWrite && issue.status === 'Abierta' && resolving?.id !== issue.id && (
                        <div className="mt-3 flex justify-end">
                          <Button size="sm" variant="secondary" onClick={() => setResolving({ id: issue.id, resolution: '' })}>
                            <CheckCircle2 />
                            Marcar resuelta
                          </Button>
                        </div>
                      )}
                      {canWrite && resolving?.id === issue.id && (
                        <form
                          className="mt-3 grid gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            actions.resolveRoomIssue.mutate(resolving, { onSuccess: () => setResolving(null) })
                          }}
                        >
                          <Input
                            label="¿Qué se hizo? (opcional)"
                            value={resolving.resolution}
                            onChange={(event) => setResolving((prev) => ({ ...prev, resolution: event.target.value }))}
                          />
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => setResolving(null)}>
                              Cancelar
                            </Button>
                            <Button type="submit" size="sm" loading={actions.resolveRoomIssue.isPending}>
                              Confirmar
                            </Button>
                          </div>
                        </form>
                      )}
                      {canWrite && issue.status === 'Resuelta' && (
                        <div className="mt-2 flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={actions.reopenRoomIssue.isPending && actions.reopenRoomIssue.variables === issue.id}
                            onClick={() => actions.reopenRoomIssue.mutate(issue.id)}
                          >
                            <RotateCcw />
                            Reabrir
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            })()}
          </div>
        )}
      </Dialog>

      {/* Detalle del dormitorio */}
      <Dialog
        open={Boolean(detailRoom)}
        onClose={() => setDetailRoomId(null)}
        size="lg"
        title={detailRoom ? `Dormitorio ${detailRoom.code}` : ''}
        description={
          detailRoom
            ? `${detailRoom.sex} · ${detailRoom.bunks.length} camarotes · ${detailRoom.beds.length} camas`
            : ''
        }
        footer={
          <Button variant="secondary" onClick={() => setDetailRoomId(null)}>
            Cerrar
          </Button>
        }
      >
        {detailRoom && (
          <div className="grid gap-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Libres', detailRoom.beds.filter((bed) => bed.availability === 'Libre').length, 'text-green-700'],
                ['Ocupadas', detailRoom.beds.filter((bed) => bed.availability === 'Ocupada').length, 'text-red-700'],
                ['Bloqueadas', detailRoom.beds.filter((bed) => bed.availability === 'Bloqueada').length, 'text-ink'],
                [
                  'Niños en camas',
                  detailRoom.beds.reduce((sum, bed) => sum + (bed.stay_id ? (childrenByStay.get(bed.stay_id)?.length ?? 0) : 0), 0),
                  'text-ink',
                ],
              ].map(([term, value, color]) => (
                <div key={term} className="rounded-xl border border-line p-3">
                  <dt className="text-xs text-ink-soft">{term}</dt>
                  <dd className={cn('text-xl font-semibold', color)}>{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gold-50 p-3 text-sm">
              <Crown className="size-4 shrink-0 text-gold-600" aria-hidden="true" />
              {detailRoom.captainName ? (
                <>
                  <span>
                    {detailRoom.sex === 'Mujeres' ? 'Capitana' : 'Capitán'}:{' '}
                    <strong className="font-semibold">{detailRoom.captainName}</strong>
                    {detailRoom.captainBed && ` · cama ${detailRoom.captainBed}`}
                  </span>
                  {whatsappUrl(detailRoom.captainPhone) && (
                    <a
                      href={whatsappUrl(detailRoom.captainPhone)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-green-700 hover:underline"
                    >
                      <MessageCircle className="size-4" aria-hidden="true" />
                      {detailRoom.captainPhone}
                    </a>
                  )}
                </>
              ) : (
                <span className="text-ink-soft">Sin capitán asignado</span>
              )}
            </div>

            <Table columns={['Camarote', 'Cama', 'Estado', 'Ocupante', 'Estadía']}>
              {detailRoom.bunks.flatMap((bunk) =>
                [bunk.upper, bunk.lower].filter(Boolean).map((bed) => {
                  const kids = bed.stay_id ? (childrenByStay.get(bed.stay_id) ?? []) : []
                  const badge = STATUS_BADGE[bed.availability] ?? STATUS_BADGE.Libre
                  return (
                    <Tr key={bed.bed_id}>
                      <Td className="font-medium">C{bunk.number}</Td>
                      <Td className="text-xs">{LEVEL_TEXT[levelOf(bed)]} · n.º {bed.bed_label}</Td>
                      <Td>
                        <Badge tone={badge.tone}>{badge.text}</Badge>
                      </Td>
                      <Td>
                        {bed.availability === 'Ocupada' ? (
                          <>
                            {bed.person_name}
                            {kids.length > 0 && (
                              <small className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
                                <Baby className="size-3.5 shrink-0" aria-hidden="true" />
                                Misma cama: {childrenText(kids)}
                              </small>
                            )}
                          </>
                        ) : bed.availability === 'Capitan' ? (
                          detailRoom.captainName ?? '—'
                        ) : bed.availability === 'Bloqueada' ? (
                          <span className="text-xs text-ink-soft">{bed.blocked_reason ?? 'Sin detalle'}</span>
                        ) : (
                          <span className="text-ink-soft">—</span>
                        )}
                      </Td>
                      <Td className="text-xs">
                        {bed.availability === 'Ocupada' && bed.start_date
                          ? `${formatDate(bed.start_date)} – ${formatDate(bed.end_date)} · ${bed.stay_status}`
                          : '—'}
                      </Td>
                    </Tr>
                  )
                }),
              )}
            </Table>

            {canWrite && detailRoom.beds.some((bed) => bed.availability === 'Libre') && (
              <p className="text-xs text-ink-soft">Para asignar una cama libre, haz clic sobre ella en el mapa.</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
              <span className="flex items-center gap-2">
                <ClipboardList className="size-4 text-ink-soft" aria-hidden="true" />
                {openIssuesOf(detailRoom.id).length} novedades abiertas ·{' '}
                {(issuesByRoom.get(detailRoom.id) ?? []).length} en total
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const id = detailRoom.id
                  setDetailRoomId(null)
                  openIssues(id)
                }}
              >
                Ver novedades
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingRoom)}
        onClose={() => setDeletingRoom(null)}
        onConfirm={confirmDeleteRoom}
        loading={actions.deleteRoom.isPending}
        confirmLabel="Eliminar dormitorio"
        title={deletingRoom ? `Eliminar ${deletingRoom.code}` : ''}
        description={
          deletingRoom
            ? `Se eliminan sus ${deletingRoom.beds.length} camas. Si tiene estadías registradas, el servidor lo impedirá para conservar el historial.`
            : ''
        }
      />

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
