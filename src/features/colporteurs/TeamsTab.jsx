import { useMemo, useState } from 'react'
import { MapPin, Pencil, Plus, Users } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, Input, QueryBoundary, SearchInput, Select } from '@/components/ui'
import { useColporteurActions, usePeopleRegistry, useRotations, useTeams } from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { addDays, formatDate, todayISO } from '@/lib/utils'
import { MunicipalitySelect, MUNICIPALITY_BY_CODE, municipalityLabel } from './MunicipalitySelect'
import { normalizeSearch, rotationStatus } from './reporting'

export default function TeamsTab() {
  const { canWrite } = useAuth()
  const teamsQuery = useTeams()
  const peopleQuery = usePeopleRegistry('Colportor')
  const rotationsQuery = useRotations()
  const actions = useColporteurActions()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [canceling, setCanceling] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const teams = teamsQuery.data ?? []
  const people = peopleQuery.data ?? []
  const rotations = rotationsQuery.data ?? []
  const today = todayISO()
  const busy = Object.values(actions).some((mutation) => mutation.isPending)
  const eligibleTeams = teams.filter((team) => team.municipality_code)
  const peopleByTeam = useMemo(() => {
    const result = new Map()
    for (const person of peopleQuery.data ?? []) {
      if (!result.has(person.team_id)) result.set(person.team_id, [])
      result.get(person.team_id).push(person)
    }
    return result
  }, [peopleQuery.data])
  const visibleTeams = teams.filter((team) => normalizeSearch(team.name + ' ' + team.base_name)
    .includes(normalizeSearch(search)))
  const open = (kind, values) => { setModal(kind); setForm(values) }
  const close = () => { if (!busy) setModal(null) }
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const mutations = { team: actions.saveTeam, assignment: actions.assignTeam, rotation: actions.saveRotation }
  const titles = { team: form.id ? 'Cambiar municipio base' : 'Crear equipo por municipio',
    assignment: 'Asignar colportor a un equipo', rotation: form.id ? 'Editar rotación' : 'Programar rotación' }

  return <>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <SearchInput aria-label="Buscar equipo por municipio" placeholder="Buscar equipo o municipio" value={search} onChange={(event) => setSearch(event.target.value)} />
      {canWrite && <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => open('team', { municipality_code: '' })}><Plus /> Crear equipo</Button>
        <Button variant="secondary" disabled={busy || !eligibleTeams.length || !peopleQuery.isSuccess}
          onClick={() => open('assignment', { person_id: '', team_id: '' })}><Users /> Asignar colportor</Button>
      </div>}
    </div>
    <QueryBoundary query={teamsQuery}>
      {!teams.length && <Card><p className="p-8 text-center text-ink-soft">Crea un equipo seleccionando su municipio base y luego asigna sus colportores.</p></Card>}
      {teams.length > 0 && !visibleTeams.length && <p className="p-6 text-ink-soft">No hay equipos con ese nombre.</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {visibleTeams.map((team) => <Card key={team.id}>
          <CardHeader title={team.name} description={'Municipio base: ' + (team.base_name ?? team.name)}
            action={<Badge>{team.members_count ?? 0} colportores</Badge>} />
          <div className="space-y-4 p-4 sm:p-6">
            {!team.municipality_code && <p className="rounded-lg bg-gold-50 p-3 text-sm text-gold-700">
              Este equipo anterior necesita un municipio base. Usa «Asignar municipio» para actualizarlo.
            </p>}
            <QueryBoundary query={peopleQuery}>
              <div className="flex flex-wrap gap-2">
                {(peopleByTeam.get(team.id) ?? []).map((person) => <Badge key={person.id} className="max-w-full whitespace-normal" tone={person.is_available ? 'navy' : 'gold'}>{person.full_name}</Badge>)}
                {!peopleByTeam.get(team.id)?.length && <p className="text-sm text-ink-soft">Sin colportores asignados.</p>}
              </div>
            </QueryBoundary>
            {canWrite && <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => open('team', { id: team.id, municipality_code: team.municipality_code ?? '' })}>
                <Pencil /> {team.municipality_code ? 'Cambiar municipio base' : 'Asignar municipio'}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy || !team.municipality_code}
                onClick={() => open('assignment', { person_id: '', team_id: team.id })}><Users /> Asignar colportor</Button>
              <Button variant="secondary" size="sm" disabled={busy || !team.municipality_code}
                onClick={() => open('rotation', { team_id: team.id, municipality_code: '', start_date: today, end_date: addDays(today, 7) })}>
                <MapPin /> Programar rotación
              </Button>
            </div>}
          </div>
        </Card>)}
      </div>
    </QueryBoundary>

    <Card className="mt-5">
      <CardHeader title="Colportores sin equipo" description="También puedes cambiar el equipo desde Registro de colportores." />
      <QueryBoundary query={peopleQuery}>
        <div className="flex flex-wrap gap-2 p-4">
          {(peopleByTeam.get(null) ?? []).map((person) => canWrite
            ? <Button key={person.id} variant="secondary" size="sm" disabled={busy || !eligibleTeams.length}
                onClick={() => open('assignment', { person_id: person.id, team_id: '' })}>{person.full_name}</Button>
            : <Badge key={person.id}>{person.full_name}</Badge>)}
          {!peopleByTeam.get(null)?.length && <p className="text-sm text-ink-soft">Todos los colportores tienen equipo.</p>}
        </div>
      </QueryBoundary>
    </Card>

    <Card className="mt-5">
      <CardHeader title="Rotaciones" description="El nombre visible del equipo sigue su destino vigente. Al terminar, vuelve al municipio base."
        action={<label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} /> Mostrar finalizadas
        </label>} />
      <QueryBoundary query={rotationsQuery}>
        <div className="divide-y divide-line px-4 sm:px-6">
          {rotations.filter((rotation) => showPast || rotation.end_date > today).map((rotation) => {
            const status = rotationStatus(rotation, today)
            const municipality = MUNICIPALITY_BY_CODE.get(rotation.municipality_code)
            const team = teams.find((item) => item.id === rotation.team_id)
            return <div key={rotation.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-semibold">{municipality ? municipalityLabel(municipality) : rotation.city}</p>
                <p className="text-sm text-ink-soft">Equipo base: {team?.base_name ?? rotation.teams?.name ?? 'Equipo anterior'}</p>
                <p className="text-sm text-ink-soft">{formatDate(rotation.start_date)} → {formatDate(rotation.end_date)} (salida)</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={status === 'Vigente' ? 'green' : status === 'Programada' ? 'gold' : 'navy'}>{status}</Badge>
                {canWrite && status !== 'Finalizada' && <>
                  <Button variant="ghost" size="sm" disabled={busy}
                    onClick={() => open('rotation', { ...rotation, municipality_code: rotation.municipality_code ?? '' })}>Editar</Button>
                  {status === 'Programada' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCanceling(rotation)}>Cancelar rotación</Button>}
                </>}
              </div>
            </div>
          })}
          {!rotations.some((rotation) => showPast || rotation.end_date > today)
            && <p className="py-8 text-sm text-ink-soft">No hay rotaciones en esta vista.</p>}
        </div>
      </QueryBoundary>
    </Card>

    <Dialog open={Boolean(modal)} onClose={close} title={titles[modal] ?? ''} footer={<>
      <Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button>
      <Button type="submit" form="colporteur-team-form" loading={mutations[modal]?.isPending} disabled={busy}>Guardar</Button>
    </>}>
      <form id="colporteur-team-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault()
        if (!busy) mutations[modal]?.mutate(form, { onSuccess: () => setModal(null) })
      }}>
        {modal === 'team' && <>
          <MunicipalitySelect label="Municipio base del equipo" value={form.municipality_code} onChange={update('municipality_code')} />
          <p className="text-sm text-ink-soft sm:col-span-2">El nombre se genera con el municipio y departamento. Las rotaciones cambian el destino temporalmente.</p>
        </>}
        {modal === 'assignment' && <>
          <QueryBoundary query={peopleQuery}>
            <Select label="Colportor" required value={form.person_id} onChange={update('person_id')} placeholder="Selecciona una persona"
              options={people.map((person) => ({ value: person.id, label: person.full_name }))} />
          </QueryBoundary>
          <Select label="Equipo de destino" value={form.team_id} onChange={update('team_id')} placeholder="Dejar sin equipo"
            options={eligibleTeams.map((team) => ({ value: team.id, label: team.name }))} />
          <p className="text-sm text-ink-soft sm:col-span-2">La asignación reemplaza el equipo actual de esta persona. Sus ventas anteriores conservan el equipo registrado.</p>
        </>}
        {modal === 'rotation' && <>
          <Select label="Equipo" required disabled={Boolean(form.id)} value={form.team_id} onChange={update('team_id')} placeholder="Selecciona un equipo"
            className="sm:col-span-2" options={eligibleTeams.map((team) => ({ value: team.id, label: team.base_name }))} />
          <MunicipalitySelect value={form.municipality_code} onChange={update('municipality_code')} />
          <Input label="Inicio" type="date" required value={form.start_date} onChange={update('start_date')} />
          <Input label="Salida (no incluida)" type="date" required min={form.start_date ? addDays(form.start_date, 1) : undefined}
            value={form.end_date} onChange={update('end_date')} />
          <p className="text-sm text-ink-soft sm:col-span-2">La próxima rotación puede empezar el día de salida. No se permiten periodos superpuestos. Las ventas ya registradas conservan su ciudad.</p>
        </>}
      </form>
    </Dialog>
    <ConfirmDialog open={Boolean(canceling)} onClose={() => { if (!busy) setCanceling(null) }}
      title="Cancelar rotación futura" description={canceling ? canceling.city + ' · ' + formatDate(canceling.start_date) : ''}
      confirmLabel="Cancelar rotación" loading={actions.cancelRotation.isPending}
      onConfirm={() => actions.cancelRotation.mutate({ id: canceling.id }, { onSuccess: () => setCanceling(null) })} />
  </>
}
