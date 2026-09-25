import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarDays, ClipboardList, Send, TriangleAlert, Trash2, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Input,
  KpiCard,
  QueryBoundary,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui'
import { useKitchenActions, useKitchenDay, useKitchenLimits, useKitchenWeek, usePeople } from '@/hooks/useCepev'
import {
  KITCHEN_ELIGIBLE_KINDS,
  KITCHEN_GENDER_KINDS,
  MEALS,
  MEAL_WINDOW,
  SEX_GROUPS,
  TASKS,
  label,
} from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, cn, formatDate, formatTime, todayISO } from '@/lib/utils'

const splitsByGender = (kind) => KITCHEN_GENDER_KINDS.includes(kind)

/** Grupos (Hombres / Mujeres) de cepevistas y colportores presentes en una comida. */
function mealSexes(shifts = []) {
  return [...new Set(shifts.filter((s) => splitsByGender(s.person_kind) && s.person_sex).map((s) => s.person_sex))]
}

/** Detecta cruces de horario y comidas con géneros mezclados para señalarlos antes de guardar. */
function findConflicts(shifts = []) {
  const conflicts = new Set()
  MEALS.forEach((meal) => {
    const mealShifts = shifts.filter((s) => s.meal === meal)
    if (mealSexes(mealShifts).length > 1) {
      mealShifts.filter((s) => splitsByGender(s.person_kind)).forEach((s) => conflicts.add(s.id))
    }
  })
  shifts.forEach((a) => {
    if (!a.person_id) return
    if (a.is_available === false) conflicts.add(a.id)
    shifts.forEach((b) => {
      if (a.id === b.id || b.person_id !== a.person_id) return
      if (a.starts_at < b.ends_at && b.starts_at < a.ends_at) {
        conflicts.add(a.id)
        conflicts.add(b.id)
      }
    })
  })
  return conflicts
}

/** Una fila de la grilla: se marca para poder quitarla. */
function ParticipantRow({ shift, conflict, selectable, selected, onToggle }) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
        selected ? 'bg-navy-50' : 'hover:bg-navy-50/50',
        conflict && 'bg-[var(--color-danger-bg)]',
        !selectable && 'cursor-default',
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[#1f3b57]"
          checked={selected}
          onChange={() => onToggle(shift.id)}
        />
      ) : (
        <span className="mt-1 size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {conflict && (
            <TriangleAlert
              className="size-3.5 shrink-0 text-[var(--color-danger-fg)]"
              aria-label="Asignación con conflicto"
            />
          )}
          <span className="truncate font-medium text-ink">{shift.person_name}</span>
        </span>
        <span className="block text-xs text-ink-soft">
          {label(shift.task)} · {formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}
          {shift.person_kind ? ` · ${label(shift.person_kind)}` : ''}
        </span>
      </span>
    </label>
  )
}

export default function Kitchen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const [date, setDate] = useState(todayISO())
  const [assigning, setAssigning] = useState(null) // comida sobre la que se asigna
  const [assignSex, setAssignSex] = useState('') // grupo del turno: Hombres o Mujeres
  const [pickedPeople, setPickedPeople] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [selectedTask, setSelectedTask] = useState(TASKS[0])
  const [limitMin, setLimitMin] = useState('') // cupo de la comida en edición
  const [limitMax, setLimitMax] = useState('')
  const [selected, setSelected] = useState(() => new Set()) // puestos marcados para quitar

  const view = searchParams.get('vista') ?? ''
  const dayQuery = useKitchenDay(date)
  const weekQuery = useKitchenWeek(todayISO())
  const staffQuery = usePeople({ kinds: KITCHEN_ELIGIBLE_KINDS, available: true })
  const limitsQuery = useKitchenLimits()
  const actions = useKitchenActions(date)

  /** Cupo guardado de la comida; sin datos, al menos una persona y sin tope. */
  const limitFor = (meal) => limitsQuery.data?.[meal] ?? { min: 1, max: null }

  const shifts = useMemo(() => dayQuery.data ?? [], [dayQuery.data])
  const conflicts = useMemo(() => findConflicts(shifts), [shifts])
  const published = shifts[0]?.is_published ?? false

  const byMeal = useMemo(() => {
    const map = new Map(MEALS.map((meal) => [meal, []]))
    shifts.forEach((shift) => map.get(shift.meal)?.push(shift))
    return map
  }, [shifts])

  const mealsBelowMin = MEALS.filter((meal) => (byMeal.get(meal) ?? []).length < limitFor(meal).min)

  /** Comidas que quedan a la vista con el filtro activo. */
  const mealsToShow = MEALS.filter((meal) => {
    const list = byMeal.get(meal) ?? []
    if (view === 'faltantes') return list.length < limitFor(meal).min
    if (view === 'conflictos') return list.some((shift) => conflicts.has(shift.id))
    return true
  })

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Grupo ya fijado por los cepevistas o colportores que están en la comida. */
  const lockedSexFor = (meal) => {
    const sexes = mealSexes(byMeal.get(meal))
    return sexes.length === 1 ? sexes[0] : ''
  }

  const openAssign = (meal) => {
    const limit = limitFor(meal)
    setLimitMin(String(limit.min))
    setLimitMax(limit.max == null ? '' : String(limit.max))
    setAssigning(meal)
    setSelectedTask(TASKS[0])
    setAssignSex(lockedSexFor(meal))
    setPickedPeople(new Set())
    setSearch('')
  }

  const chooseSex = (sex) => {
    setAssignSex(sex)
    setPickedPeople(new Set())
  }

  const togglePerson = (id) =>
    setPickedPeople((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submitAssign = (event) => {
    event.preventDefault()
    const people = (staffQuery.data ?? []).filter((person) => pickedPeople.has(person.id))
    actions.add.mutate(
      { date, meal: assigning, task: selectedTask, people },
      {
        onSuccess: ({ failed }) => {
          failed.forEach(({ person, message }) => toast.error(`${person.full_name}: ${message}`))
          setAssigning(null)
        },
      },
    )
  }

  const removeSelected = (meal) => {
    const ids = (byMeal.get(meal) ?? []).filter((shift) => selected.has(shift.id)).map((shift) => shift.id)
    if (!ids.length) return
    actions.remove.mutate(
      { shiftIds: ids },
      {
        onSuccess: () =>
          setSelected((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
          }),
      },
    )
  }

  /**
   * Quien todavía no está en esa comida, agrupado para el diálogo. Cepevistas y
   * colportores se filtran por el grupo del turno; el personal de apoyo no.
   */
  const availableFor = (meal, sex) => {
    const taken = new Set((byMeal.get(meal) ?? []).map((shift) => shift.person_id))
    const term = search.trim().toLowerCase()
    const free = (staffQuery.data ?? []).filter(
      (person) => !taken.has(person.id) && (!term || person.full_name.toLowerCase().includes(term)),
    )
    return [
      { title: 'Cepevistas', people: free.filter((p) => p.kind === 'Cepevista' && p.sex === sex) },
      { title: 'Colportores', people: free.filter((p) => p.kind === 'Colportor' && p.sex === sex) },
      { title: 'Personal de apoyo', people: free.filter((p) => !splitsByGender(p.kind)) },
    ]
  }

  const lockedSex = assigning ? lockedSexFor(assigning) : ''

  // Cupo del turno abierto en el diálogo
  const savedLimit = assigning ? limitFor(assigning) : { min: 1, max: null }
  const assignedCount = assigning ? (byMeal.get(assigning) ?? []).length : 0
  const minValue = Number(limitMin)
  const maxValue = Number(limitMax)
  const limitError =
    limitMin === '' || !Number.isInteger(minValue) || minValue < 1
      ? 'El mínimo debe ser al menos 1.'
      : limitMax === '' || !Number.isInteger(maxValue) || maxValue < minValue
        ? 'El máximo no puede ser menor que el mínimo.'
        : maxValue > 999
          ? 'El máximo no puede pasar de 999.'
          : ''
  const limitChanged = minValue !== savedLimit.min || maxValue !== savedLimit.max
  const seatsLeft = savedLimit.max == null ? Infinity : Math.max(savedLimit.max - assignedCount, 0)
  const missing = Math.max(savedLimit.min - assignedCount, 0)

  const saveLimits = () => actions.setLimits.mutate({ meal: assigning, min: minValue, max: maxValue })
  const groups = assigning && assignSex ? availableFor(assigning, assignSex) : []

  return (
    <>
      <PageHeader title="Cocina" subtitle="Personas y turnos para cada comida.">
        <label className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] text-ink-soft">
          <CalendarDays className="size-4" aria-hidden="true" />
          <span className="sr-only">Día del calendario</span>
          <input
            type="date"
            className="bg-transparent outline-none"
            value={date}
            min={todayISO()}
            max={addDays(todayISO(), 30)}
            onChange={(event) => {
              setDate(event.target.value || todayISO())
              setSelected(new Set())
            }}
          />
        </label>
        {canWrite && (
          <Button onClick={() => actions.autofill.mutate()} loading={actions.autofill.isPending}>
            <ClipboardList />
            Generar propuesta
          </Button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Participantes del día"
          value={shifts.length}
          detail="Preparación y comedor"
          onClick={() => setView('')}
        />
        <KpiCard
          label="Comidas bajo el mínimo"
          value={mealsBelowMin.length}
          detail={mealsBelowMin.length ? mealsBelowMin.join(', ') : 'Las tres comidas con su mínimo'}
          tone={mealsBelowMin.length ? 'gold' : 'green'}
          onClick={() => setView('faltantes')}
        />
        <KpiCard
          label="Cruces de horario"
          value={conflicts.size}
          detail={conflicts.size ? 'Revisar asignaciones' : 'Sin conflictos detectados'}
          tone={conflicts.size ? 'red' : 'green'}
          onClick={() => setView('conflictos')}
        />
        <KpiCard
          label="Personal elegible"
          value={staffQuery.data?.length ?? 0}
          detail="Cepevistas, colportores, logística, conducción y administración"
        />
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={published ? 'green' : 'gold'}>
            {published ? 'Calendario publicado' : 'Borrador pendiente de aprobación'}
          </Badge>
          <span className="text-sm text-ink-soft capitalize">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        {canWrite && (
          <Button variant="secondary" onClick={() => actions.publish.mutate()} loading={actions.publish.isPending}>
            <Send />
            Aprobar y publicar
          </Button>
        )}
      </div>

      {view && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-navy-50 px-4 py-2.5 text-sm">
          <span>
            Vista: {view === 'faltantes' ? 'Comidas bajo el mínimo' : 'Asignaciones con conflicto'}
          </span>
          <button type="button" className="font-semibold text-navy-600" onClick={() => setView('')}>
            Mostrar todo ×
          </button>
        </div>
      )}

      {dayQuery.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {MEALS.map((meal) => (
            <Skeleton key={meal} className="h-80" />
          ))}
        </div>
      ) : mealsToShow.length === 0 ? (
        <Card>
          <p className="px-6 py-12 text-center text-sm text-ink-soft">
            {view === 'faltantes'
              ? 'Las tres comidas del día ya tienen su mínimo de servidores.'
              : 'Ninguna asignación del día tiene conflictos.'}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {MEALS.map((meal, index) => {
            const mealShifts = byMeal.get(meal) ?? []
            const visible =
              view === 'conflictos' ? mealShifts.filter((shift) => conflicts.has(shift.id)) : mealShifts
            const marked = mealShifts.filter((shift) => selected.has(shift.id)).length
            const sexes = mealSexes(mealShifts)
            const limit = limitFor(meal)
            const count = mealShifts.length
            const removingHere =
              actions.remove.isPending &&
              (actions.remove.variables?.shiftIds ?? []).some((id) =>
                mealShifts.some((shift) => shift.id === id),
              )

            if (!mealsToShow.includes(meal)) return null

            return (
              <Card key={meal} className="flex flex-col">
                <div className="flex items-center gap-3 border-b border-[#edf1f5] bg-[#f9fbfd] px-4 py-4">
                  <span className="rounded-md bg-gold-100 px-2 py-1.5 text-xs font-semibold text-gold-700">
                    0{index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-ink">{meal}</h2>
                    <p className="text-xs text-ink-soft">{MEAL_WINDOW[meal]}</p>
                  </div>
                  {sexes.length > 0 && (
                    <Badge tone={sexes.length > 1 ? 'red' : 'navy'}>
                      {sexes.length > 1 ? 'Grupos mezclados' : sexes[0]}
                    </Badge>
                  )}
                  <Badge
                    tone={count < limit.min ? 'gold' : limit.max != null && count > limit.max ? 'red' : 'green'}
                    className="flex-col items-end gap-0"
                  >
                    <span>
                      {count} {count === 1 ? 'persona' : 'personas'}
                    </span>
                    <span className="text-[10px] opacity-80">
                      {limit.max != null ? `cupo ${limit.min}–${limit.max}` : `mínimo ${limit.min}`}
                    </span>
                  </Badge>
                </div>

                <div className="flex-1 px-2 py-2">
                  {visible.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-ink-soft">
                      {mealShifts.length === 0
                        ? 'Todavía no hay nadie en esta comida.'
                        : 'Sin puestos en esta vista.'}
                    </p>
                  ) : (
                    visible.map((shift) => (
                      <ParticipantRow
                        key={shift.id}
                        shift={shift}
                        conflict={conflicts.has(shift.id)}
                        selectable={canWrite}
                        selected={selected.has(shift.id)}
                        onToggle={toggle}
                      />
                    ))
                  )}
                </div>

                {canWrite && (
                  <div className="flex flex-col gap-2 border-t border-[#edf1f5] px-4 py-3">
                    <Button onClick={() => openAssign(meal)}>
                      <UserPlus />
                      Asignar
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={marked === 0}
                      loading={removingHere}
                      onClick={() => removeSelected(meal)}
                    >
                      <Trash2 />
                      Quitar{marked > 0 ? ` (${marked})` : ''}
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Card className="mt-5">
        <CardHeader
          title="Calendario semanal"
          description="La propuesta conserva las asignaciones existentes; cualquier cambio vuelve el día a borrador."
        />
        <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-7">
          {weekQuery.data?.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => {
                setDate(day.date)
                setSelected(new Set())
              }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border border-line px-2 py-3 text-[13px] transition',
                date === day.date ? 'border-navy-500 bg-navy-50' : 'hover:bg-navy-50/60',
              )}
            >
              <span className="capitalize">{formatDate(day.date)}</span>
              <strong className="text-lg">{day.total}</strong>
              <small className="text-[11px] text-ink-soft">
                {day.published ? 'Publicado' : 'Borrador'}
              </small>
            </button>
          ))}
        </div>
      </Card>

      <Dialog
        open={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        size="lg"
        title="Asignar personas a la comida"
        description={assigning ? `${assigning} · ${MEAL_WINDOW[assigning]}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssigning(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="assign-form"
              loading={actions.add.isPending}
              disabled={pickedPeople.size === 0 || pickedPeople.size > seatsLeft}
            >
              Agregar a la grilla{pickedPeople.size > 0 ? ` (${pickedPeople.size})` : ''}
            </Button>
          </>
        }
      >
        <form id="assign-form" onSubmit={submitAssign} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-[#536c83]">Cupo de servidores · {assigning}</legend>
            <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Input
                label="Mínimo"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={limitMin}
                onChange={(event) => setLimitMin(event.target.value)}
              />
              <Input
                label="Máximo"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={limitMax}
                onChange={(event) => setLimitMax(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                className="col-span-2 sm:col-span-1"
                disabled={!limitChanged || Boolean(limitError)}
                loading={actions.setLimits.isPending}
                onClick={saveLimits}
              >
                Guardar cupo
              </Button>
            </div>
            <span className={cn('text-xs', limitError ? 'text-[var(--color-danger-fg)]' : 'text-ink-soft')}>
              {limitError ||
                [
                  `Asignados: ${assignedCount}`,
                  missing > 0 ? `faltan ${missing} para el mínimo` : 'mínimo cubierto',
                  seatsLeft === Infinity ? 'sin tope guardado' : seatsLeft > 0 ? `caben ${seatsLeft} más` : 'cupo lleno',
                ].join(' · ')}
              {limitChanged && !limitError ? ' · Guarda el cupo para aplicarlo.' : ''}
            </span>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold text-[#536c83]">1. Grupo del turno</legend>
            <div className="grid grid-cols-2 gap-2">
              {SEX_GROUPS.map((sex) => (
                <button
                  key={sex}
                  type="button"
                  aria-pressed={assignSex === sex}
                  disabled={Boolean(lockedSex) && lockedSex !== sex}
                  onClick={() => chooseSex(sex)}
                  className={cn(
                    'h-11 rounded-lg border text-sm font-semibold transition-colors',
                    assignSex === sex
                      ? 'border-navy-500 bg-navy-50 text-navy-600'
                      : 'border-line bg-white text-ink hover:bg-navy-50/60',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                >
                  {sex}
                </button>
              ))}
            </div>
            <span className="text-xs text-ink-soft">
              {lockedSex
                ? `Este turno ya es de ${lockedSex}: lo definen los cepevistas y colportores asignados.`
                : 'Cepevistas y colportores de distinto género no comparten turno de cocina.'}
            </span>
          </fieldset>

          <Select
            label="2. Tarea"
            value={selectedTask}
            onChange={(event) => setSelectedTask(event.target.value)}
            options={TASKS.map((task) => ({ value: task, label: label(task) }))}
          />

          <div className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-sm font-semibold text-[#536c83]">
              <span>3. Personas disponibles</span>
              {seatsLeft !== Infinity && (
                <span className="text-xs font-medium text-ink-soft">
                  {pickedPeople.size} de {seatsLeft} cupos
                </span>
              )}
            </span>
            {!assignSex ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[13px] text-ink-soft">
                Elige el grupo del turno para ver a los cepevistas y colportores disponibles.
              </p>
            ) : (
              <QueryBoundary query={staffQuery} loadingLabel="Cargando personal…">
                <SearchInput
                  className="sm:max-w-none"
                  placeholder="Buscar por nombre"
                  aria-label="Buscar persona"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
                  {groups.map((group) => (
                    <section key={group.title}>
                      <h3 className="sticky top-0 flex items-center justify-between border-b border-[#edf1f5] bg-[#f9fbfd] px-3 py-2 text-xs font-semibold text-ink-soft">
                        <span>
                          {group.title}
                          {group.title !== 'Personal de apoyo' ? ` · ${assignSex}` : ''}
                        </span>
                        <span>{group.people.length}</span>
                      </h3>
                      {group.people.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-ink-soft">Nadie disponible.</p>
                      ) : (
                        group.people.map((person) => (
                          <label
                            key={person.id}
                            className={cn(
                              'flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                              pickedPeople.has(person.id) ? 'bg-navy-50' : 'hover:bg-navy-50/50',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="size-4 shrink-0 accent-[#1f3b57]"
                              checked={pickedPeople.has(person.id)}
                              disabled={!pickedPeople.has(person.id) && pickedPeople.size >= seatsLeft}
                              onChange={() => togglePerson(person.id)}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium text-ink">{person.full_name}</span>
                            <span className="shrink-0 text-xs text-ink-soft">
                              {group.title === 'Personal de apoyo' ? label(person.kind) : (person.teams?.name ?? '')}
                            </span>
                          </label>
                        ))
                      )}
                    </section>
                  ))}
                </div>
              </QueryBoundary>
            )}
          </div>

          <p className="rounded-lg bg-navy-50 px-3 py-2.5 text-[13px] text-ink-soft">
            Puedes marcar varias personas hasta llenar el cupo. El servidor rechaza a quien tenga
            otro turno cruzado, un recorrido asignado en ese horario, cuyo equipo esté de rotación
            en otra ciudad ese día, que no sea del grupo del turno o que exceda el máximo.
            «Generar propuesta» completa cada comida hasta su mínimo.
          </p>
        </form>
      </Dialog>
    </>
  )
}
