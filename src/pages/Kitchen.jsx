import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ClipboardList, Plus, Send, TriangleAlert, UserCheck } from 'lucide-react'
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

function SlotRow({ shift, conflict, canWrite, onAssign }) {
  const filled = Boolean(shift.person_id)

  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 py-2 text-sm',
        !filled && 'my-1 rounded-lg border border-dashed border-gold-300 bg-gold-50/60 px-3',
        conflict && 'rounded-lg bg-[var(--color-danger-bg)] px-3',
      )}
    >
      {filled ? (
        <UserCheck className={cn('size-4 shrink-0', conflict ? 'text-[var(--color-danger-fg)]' : 'text-emerald-600')} />
      ) : (
        <Plus className="size-4 shrink-0 text-gold-600" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {shift.person_name ?? <span className="text-gold-700">Puesto libre</span>}
      </span>
      {canWrite && (
        <Button variant="ghost" size="sm" onClick={() => onAssign(shift)}>
          {filled ? 'Cambiar' : 'Asignar'}
        </Button>
      )}
    </div>
  )
}

export default function Kitchen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const [date, setDate] = useState(todayISO())
  const [editing, setEditing] = useState(null)
  const [selectedPerson, setSelectedPerson] = useState('')

  const view = searchParams.get('vista') ?? ''
  const dayQuery = useKitchenDay(date)
  const weekQuery = useKitchenWeek(todayISO())
  const staffQuery = usePeople({ kinds: KITCHEN_ELIGIBLE_KINDS, available: true })
  const actions = useKitchenActions(date)

  const shifts = useMemo(() => dayQuery.data ?? [], [dayQuery.data])
  const conflicts = useMemo(() => findConflicts(shifts), [shifts])
  const filled = shifts.filter((shift) => shift.person_id).length
  const open = shifts.length - filled
  const published = shifts[0]?.is_published ?? false

  const visibleShifts = useMemo(() => {
    if (view === 'faltantes') return shifts.filter((shift) => !shift.person_id)
    if (view === 'conflictos') return shifts.filter((shift) => conflicts.has(shift.id))
    return shifts
  }, [shifts, view, conflicts])

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }

  const openAssign = (shift) => {
    setEditing(shift)
    setSelectedPerson(shift.person_id ?? '')
  }

  const submitAssign = (event) => {
    event.preventDefault()
    actions.assign.mutate(
      { shiftId: editing.id, personId: selectedPerson || null },
      { onSuccess: () => setEditing(null) },
    )
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
            onChange={(event) => setDate(event.target.value || todayISO())}
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
        <KpiCard label="Cobertura de turnos" value={`${filled}/${shifts.length}`} detail="Preparación y comedor" onClick={() => setView('')} />
        <KpiCard
          label="Puestos sin cubrir"
          value={open}
          detail={open ? 'Requiere asignación' : 'Equipo completo'}
          tone={open ? 'gold' : 'green'}
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
          detail="Logística, conducción y administración"
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
            Vista: {view === 'faltantes' ? 'Puestos sin cubrir' : 'Asignaciones con conflicto'}
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
      ) : shifts.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <TriangleAlert className="size-8 text-gold-500" />
            <p className="text-sm text-ink-soft">Este día todavía no tiene puestos creados.</p>
            {canWrite && (
              <Button onClick={() => actions.ensureDay.mutate()} loading={actions.ensureDay.isPending}>
                Crear los 18 puestos del día
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {MEALS.map((meal, index) => {
            const mealShifts = shifts.filter((shift) => shift.meal === meal)
            const mealVisible = visibleShifts.filter((shift) => shift.meal === meal)
            const mealFilled = mealShifts.filter((shift) => shift.person_id).length

            return (
              <Card key={meal}>
                <div className="flex items-center gap-3 border-b border-[#edf1f5] bg-[#f9fbfd] px-4 py-4">
                  <span className="rounded-md bg-gold-100 px-2 py-1.5 text-xs font-semibold text-gold-700">
                    0{index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-ink">{meal}</h2>
                    <p className="text-xs text-ink-soft">{MEAL_WINDOW[meal]}</p>
                  </div>
                  <Badge tone={mealFilled === mealShifts.length ? 'green' : 'gold'}>
                    {mealFilled}/{mealShifts.length}
                  </Badge>
                </div>

                {TASKS.map((task) => {
                  const taskShifts = mealVisible.filter((shift) => shift.task === task)
                  const reference = mealShifts.find((shift) => shift.task === task)

                  return (
                    <div key={task} className="border-t border-[#edf1f5] px-4 py-3 first:border-0">
                      <h3 className="mb-1 flex items-center justify-between gap-2 text-[13px] font-semibold">
                        {label(task)}
                        <small className="text-[11px] font-normal text-ink-soft">
                          {formatTime(reference?.starts_at)}–{formatTime(reference?.ends_at)}
                        </small>
                      </h3>
                      {taskShifts.length === 0 ? (
                        <p className="py-2 text-xs text-ink-soft">Sin puestos en esta vista.</p>
                      ) : (
                        taskShifts.map((shift) => (
                          <SlotRow
                            key={shift.id}
                            shift={shift}
                            conflict={conflicts.has(shift.id)}
                            canWrite={canWrite}
                            onAssign={openAssign}
                          />
                        ))
                      )}
                    </div>
                  )
                })}
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
              onClick={() => setDate(day.date)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border border-line px-2 py-3 text-[13px] transition',
                date === day.date ? 'border-navy-500 bg-navy-50' : 'hover:bg-navy-50/60',
              )}
            >
              <span className="capitalize">{formatDate(day.date)}</span>
              <strong className="text-lg">
                {day.filled}/{day.total}
              </strong>
              <small className="text-[11px] text-ink-soft">
                {day.published ? 'Publicado' : 'Borrador'}
              </small>
            </button>
          ))}
        </div>
      </Card>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Asignar persona al turno"
        description={
          editing
            ? `${editing.meal} · ${label(editing.task)} · ${formatTime(editing.starts_at)}–${formatTime(editing.ends_at)}`
            : ''
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="assign-form" loading={actions.assign.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        <form id="assign-form" onSubmit={submitAssign} className="flex flex-col gap-4">
          <QueryBoundary query={staffQuery} loadingLabel="Cargando personal…">
            <Select
              label="Persona asignada"
              value={selectedPerson}
              onChange={(event) => setSelectedPerson(event.target.value)}
              placeholder="Dejar el puesto libre"
              options={(staffQuery.data ?? []).map((person) => ({
                value: person.id,
                label: `${person.full_name} · ${label(person.kind)}`,
              }))}
            />
          </QueryBoundary>
          <p className="rounded-lg bg-navy-50 px-3 py-2.5 text-[13px] text-ink-soft">
            El servidor rechaza a quien esté fuera de la sede, tenga otro turno cruzado o un
            recorrido asignado en ese horario.
          </p>
        </form>
      </Dialog>
    </>
  )
}
