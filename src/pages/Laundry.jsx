import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ClipboardList, Send, Trash2, UserPlus, WashingMachine } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, CardHeader, Dialog, KpiCard, QueryBoundary, Select } from '@/components/ui'
import { useLaundryActions, useLaundryDay, useLaundryWeek, usePeople } from '@/hooks/useCepev'
import { KITCHEN_ELIGIBLE_KINDS, label } from '@/lib/constants'
import { LAUNDRY_CAPACITY, LAUNDRY_MACHINES, LAUNDRY_TURNS } from '@/lib/laundry'
import { useAuth } from '@/lib/auth'
import { addDays, cn, formatDate, todayISO } from '@/lib/utils'

export default function Laundry() {
  const { canWrite } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [date, setDate] = useState(todayISO())
  const [assigning, setAssigning] = useState(null)
  const [personId, setPersonId] = useState('')
  const dayQuery = useLaundryDay(date)
  const weekQuery = useLaundryWeek(todayISO())
  const peopleQuery = usePeople({ available: true })
  const actions = useLaundryActions()
  const rows = dayQuery.data ?? []
  const bookings = rows.filter((row) => row.machine > 0)
  const coordinatorRows = rows.filter((row) => row.machine === 0)
  const coordinator = coordinatorRows[0]
  const conflicts = rows.filter((row) => row.block_reason)
  const published = rows.some((row) => row.is_published)
  const busy = Object.values(actions).some((action) => action.isPending)
  const ready = dayQuery.isSuccess && !dayQuery.isFetching
  const view = searchParams.get('vista') ?? ''
  const setView = (value) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('vista', value)
    else next.delete('vista')
    setSearchParams(next, { replace: true })
  }
  const changeDate = (value) => {
    setDate(value || todayISO())
    setAssigning(null)
  }
  const openAssign = (target) => {
    setPersonId(target.coordinator ? coordinator?.person_id ?? '' : '')
    setAssigning({ ...target, date })
  }
  const eligiblePeople = (peopleQuery.data ?? []).filter((person) => {
    if (!assigning) return false
    if (assigning.coordinator) {
      return !bookings.some((row) => row.person_id === person.id)
    }
    return KITCHEN_ELIGIBLE_KINDS.includes(person.kind)
      && !rows.some((row) => row.turn === assigning.turn && row.person_id === person.id)
  })
  const submit = (event) => {
    event.preventDefault()
    if (!assigning || !personId || busy) return
    const mutation = assigning.coordinator ? actions.coordinator : actions.add
    mutation.mutate({ ...assigning, personId }, { onSuccess: () => setAssigning(null) })
  }
  const visibleMachines = (turn) => LAUNDRY_MACHINES.filter((machine) => {
    const row = bookings.find((item) => item.turn === turn && item.machine === machine)
    if (view === 'faltantes') return !row
    if (view === 'conflictos') return Boolean(row?.block_reason)
    return true
  })

  return (
    <>
      <PageHeader title="Lavandería" subtitle="4 lavadoras · 2 turnos diarios · 8 cupos por día.">
        <label className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] text-ink-soft">
          <CalendarDays className="size-4" aria-hidden="true" />
          <span className="sr-only">Día de lavandería</span>
          <input type="date" className="bg-transparent outline-none" value={date}
            min={todayISO()} max={addDays(todayISO(), 30)} disabled={busy}
            onChange={(event) => changeDate(event.target.value)} />
        </label>
        {canWrite && (
          <Button disabled={!ready || busy} loading={actions.autofill.isPending}
            onClick={() => actions.autofill.mutate({ date })}>
            <ClipboardList /> Generar propuesta
          </Button>
        )}
      </PageHeader>

      <QueryBoundary query={dayQuery} loadingLabel="Cargando lavandería…">
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Cupos asignados" value={bookings.length} detail="De 8 cupos diarios" onClick={() => setView('')} />
          <KpiCard label="Cupos disponibles" value={LAUNDRY_CAPACITY - bookings.length}
            detail="Una persona por lavadora y turno" tone={bookings.length < LAUNDRY_CAPACITY ? 'gold' : 'green'}
            onClick={() => setView('faltantes')} />
          <KpiCard label="Asignaciones con conflicto" value={conflicts.length}
            detail="Incluye la coordinación" tone={conflicts.length ? 'red' : 'green'} onClick={() => setView('conflictos')} />
          <KpiCard label="Coordinación del día" value={coordinator ? 'Asignada' : 'Pendiente'}
            detail={coordinator?.person_name ?? 'Asignación manual para ambos turnos'} tone={coordinator ? 'green' : 'gold'} />
        </div>

        <Card className="mb-5">
          <CardHeader title="Coordinador de lavandería" description="Una persona disponible a cargo de los dos turnos del día. Se asigna manualmente." />
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold text-ink">{coordinator?.person_name ?? 'Sin coordinador asignado'}</p>
              <p className="text-sm text-ink-soft">11:00–13:00 y 15:00–17:00 · Hora de Colombia</p>
              {coordinatorRows.filter((row) => row.block_reason).map((row) => (
                <p key={row.id} role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">
                  Turno {row.turn}: {row.block_reason}
                </p>
              ))}
            </div>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={!ready || busy} onClick={() => openAssign({ coordinator: true })}>
                  <UserPlus /> {coordinator ? 'Cambiar coordinador' : 'Asignar coordinador'}
                </Button>
                {coordinator && <Button variant="secondary" disabled={!ready || busy}
                  onClick={() => actions.coordinator.mutate({ date, personId: null })}><Trash2 /> Quitar coordinador</Button>}
              </div>
            )}
          </div>
        </Card>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={published ? 'green' : 'gold'}>{published ? 'Calendario publicado' : 'Borrador pendiente de aprobación'}</Badge>
            <span className="text-sm capitalize text-ink-soft">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
          {canWrite && <Button variant="secondary" loading={actions.publish.isPending}
            disabled={!ready || busy || bookings.length !== LAUNDRY_CAPACITY || coordinatorRows.length !== 2 || conflicts.length > 0}
            onClick={() => actions.publish.mutate({ date })}><Send /> Aprobar y publicar</Button>}
        </div>
        <p className="mb-4 text-sm text-ink-soft">Para publicar, completa los 8 cupos y asigna un coordinador sin conflictos. Cualquier cambio vuelve el día a borrador.</p>
        {view && <div className="mb-4 flex items-center justify-between rounded-lg bg-navy-50 px-4 py-3 text-sm">
          <span>{view === 'faltantes' ? 'Cupos disponibles' : 'Asignaciones con conflicto'}</span>
          <button type="button" className="font-semibold text-navy-600" onClick={() => setView('')}>Mostrar todo</button>
        </div>}

        <div className="grid gap-5 xl:grid-cols-2">
          {LAUNDRY_TURNS.map((turn) => (
            <Card key={turn.id}>
              <CardHeader title={turn.label} description={turn.window + ' · Hora de Colombia'} />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {visibleMachines(turn.id).map((machine) => {
                  const row = bookings.find((item) => item.turn === turn.id && item.machine === machine)
                  return (
                    <div key={machine} className={cn('flex flex-col gap-3 rounded-xl border p-4',
                      row?.block_reason ? 'border-red-300 bg-red-50' : 'border-line bg-[#f9fbfd]')}>
                      <div className="flex items-center justify-between gap-2">
                        <WashingMachine className="size-8 text-navy-600" aria-hidden="true" />
                        <Badge tone={row ? 'green' : 'gold'}>{row ? 'Asignada' : 'Disponible'}</Badge>
                      </div>
                      <h3 className="font-semibold text-ink">Lavadora {machine}</h3>
                      <p className="text-sm text-ink">{row?.person_name ?? 'Sin persona asignada'}</p>
                      {row && <p className="text-xs text-ink-soft">{label(row.person_kind)}</p>}
                      {row?.block_reason && <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{row.block_reason}</p>}
                      {canWrite && (row
                        ? <Button variant="secondary" className="mt-auto" disabled={!ready || busy}
                            onClick={() => actions.remove.mutate({ date, shiftId: row.id })}>
                            <Trash2 /> Quitar
                          </Button>
                        : <Button className="mt-auto" disabled={!ready || busy} onClick={() => openAssign({ turn: turn.id, machine })}>
                            <UserPlus /> Asignar
                          </Button>)}
                    </div>
                  )
                })}
                {visibleMachines(turn.id).length === 0 && <p className="py-6 text-sm text-ink-soft sm:col-span-2">No hay cupos en esta vista.</p>}
              </div>
            </Card>
          ))}
        </div>
      </QueryBoundary>

      <Card className="mt-5">
        <CardHeader title="Calendario semanal" description="La propuesta conserva las asignaciones existentes y prioriza a quienes tienen menos horas de lavandería en los últimos 7 días." />
        <QueryBoundary query={weekQuery}>
          <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-7">
            {weekQuery.data?.map((day) => (
              <button key={day.date} type="button" disabled={busy} onClick={() => changeDate(day.date)}
                className={cn('flex flex-col items-center gap-1 rounded-lg border border-line px-2 py-3 text-[13px]',
                  date === day.date ? 'border-navy-500 bg-navy-50' : 'hover:bg-navy-50/60')}>
                <span className="capitalize">{formatDate(day.date)}</span>
                <strong className="text-lg">{day.total}/8</strong>
                <small>{day.published ? 'Publicado' : 'Borrador'}</small>
              </button>
            ))}
          </div>
        </QueryBoundary>
      </Card>

      <Dialog open={Boolean(assigning)} onClose={() => { if (!busy) setAssigning(null) }}
        title={assigning?.coordinator ? 'Asignar coordinador del día' : 'Asignar lavadora'}
        description={assigning?.coordinator ? 'Responsable de ambos turnos; no ocupa una lavadora.'
          : assigning ? 'Lavadora ' + assigning.machine + ' · ' + LAUNDRY_TURNS.find((turn) => turn.id === assigning.turn)?.window : ''}
        footer={<>
          <Button variant="secondary" disabled={busy} onClick={() => setAssigning(null)}>Cancelar</Button>
          <Button type="submit" form="laundry-assign" disabled={!personId || busy || !peopleQuery.isSuccess}
            loading={actions.add.isPending || actions.coordinator.isPending}>Guardar asignación</Button>
        </>}>
        <form id="laundry-assign" onSubmit={submit} className="flex flex-col gap-4">
          <QueryBoundary query={peopleQuery} loadingLabel="Cargando personas disponibles…">
            <Select label="Persona disponible" value={personId} onChange={(event) => setPersonId(event.target.value)}
              placeholder="Selecciona una persona" options={eligiblePeople.map((person) => ({
                value: person.id, label: person.full_name + ' · ' + label(person.kind),
              }))} />
            {eligiblePeople.length === 0 && <p className="text-sm text-ink-soft">No hay personas disponibles para esta asignación.</p>}
          </QueryBoundary>
          <p className="rounded-lg bg-navy-50 px-3 py-3 text-sm text-ink-soft">
            El servidor valida disponibilidad, rotaciones y cruces con cocina, recorridos y lavandería.
            El coordinador debe estar libre durante ambos turnos y no puede ocupar una lavadora.
          </p>
        </form>
      </Dialog>
    </>
  )
}
