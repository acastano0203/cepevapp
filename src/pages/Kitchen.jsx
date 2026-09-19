import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ClipboardList, Send, TriangleAlert, Trash2, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  KpiCard,
  QueryBoundary,
  Select,
  Skeleton,
} from '@/components/ui'
import { useKitchenActions, useKitchenDay, useKitchenWeek, usePeople } from '@/hooks/useCepev'
import { KITCHEN_ELIGIBLE_KINDS, MEALS, MEAL_WINDOW, TASKS, label } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, cn, formatDate, formatTime, todayISO } from '@/lib/utils'

/** Detecta cruces de horario del mismo día para señalarlos antes de guardar. */
function findConflicts(shifts = []) {
  const conflicts = new Set()
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
  const [selectedPerson, setSelectedPerson] = useState('')
  const [selectedTask, setSelectedTask] = useState(TASKS[0])
  const [selected, setSelected] = useState(() => new Set()) // puestos marcados para quitar

  const view = searchParams.get('vista') ?? ''
  const dayQuery = useKitchenDay(date)
  const weekQuery = useKitchenWeek(todayISO())
  const staffQuery = usePeople({ kinds: KITCHEN_ELIGIBLE_KINDS, available: true })
  const actions = useKitchenActions(date)

  const shifts = useMemo(() => dayQuery.data ?? [], [dayQuery.data])
  const conflicts = useMemo(() => findConflicts(shifts), [shifts])
  const published = shifts[0]?.is_published ?? false

  const byMeal = useMemo(() => {
    const map = new Map(MEALS.map((meal) => [meal, []]))
    shifts.forEach((shift) => map.get(shift.meal)?.push(shift))
    return map
  }, [shifts])

  const mealsWithoutTeam = MEALS.filter((meal) => (byMeal.get(meal) ?? []).length === 0)

  /** Comidas que quedan a la vista con el filtro activo. */
  const mealsToShow = MEALS.filter((meal) => {
    const list = byMeal.get(meal) ?? []
    if (view === 'faltantes') return list.length === 0
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

  const openAssign = (meal) => {
    setAssigning(meal)
    setSelectedTask(TASKS[0])
    setSelectedPerson('')
  }

  const submitAssign = (event) => {
    event.preventDefault()
    actions.add.mutate(
      { date, meal: assigning, task: selectedTask, personId: selectedPerson },
      { onSuccess: () => setAssigning(null) },
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

  /** Quien todavía no está en esa comida: evita proponer un duplicado. */
  const availableFor = (meal) => {
    const taken = new Set((byMeal.get(meal) ?? []).map((shift) => shift.person_id))
    return (staffQuery.data ?? []).filter((person) => !taken.has(person.id))
  }

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
          label="Comidas sin equipo"
          value={mealsWithoutTeam.length}
          detail={mealsWithoutTeam.length ? mealsWithoutTeam.join(', ') : 'Las tres comidas cubiertas'}
          tone={mealsWithoutTeam.length ? 'gold' : 'green'}
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
            Vista: {view === 'faltantes' ? 'Comidas sin equipo' : 'Asignaciones con conflicto'}
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
              ? 'Las tres comidas del día ya tienen equipo.'
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
                  <Badge tone={mealShifts.length ? 'green' : 'gold'}>
                    {mealShifts.length} {mealShifts.length === 1 ? 'persona' : 'personas'}
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
        title="Asignar persona a la comida"
        description={assigning ? `${assigning} · ${MEAL_WINDOW[assigning]}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssigning(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="assign-form" loading={actions.add.isPending} disabled={!selectedPerson}>
              Agregar a la grilla
            </Button>
          </>
        }
      >
        <form id="assign-form" onSubmit={submitAssign} className="flex flex-col gap-4">
          <Select
            label="Tarea"
            value={selectedTask}
            onChange={(event) => setSelectedTask(event.target.value)}
            options={TASKS.map((task) => ({ value: task, label: label(task) }))}
          />
          <QueryBoundary query={staffQuery} loadingLabel="Cargando personal…">
            <Select
              label="Persona asignada"
              value={selectedPerson}
              onChange={(event) => setSelectedPerson(event.target.value)}
              placeholder="Elige a quien participa"
              hint="Cepevistas y colportores también pueden cubrir turnos de cocina."
              options={(assigning ? availableFor(assigning) : []).map((person) => ({
                value: person.id,
                label: `${person.full_name} · ${label(person.kind)}`,
              }))}
            />
          </QueryBoundary>
          <p className="rounded-lg bg-navy-50 px-3 py-2.5 text-[13px] text-ink-soft">
            Puedes agregar tantas personas como necesites. El servidor rechaza a quien tenga otro
            turno cruzado, un recorrido asignado en ese horario o cuyo equipo esté de rotación en
            otra ciudad ese día.
          </p>
        </form>
      </Dialog>
    </>
  )
}
