import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, MapPin, Plus, Users } from 'lucide-react'
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
  Table,
  Td,
  Tr,
} from '@/components/ui'
import {
  useColporteurActions,
  useColporteurProgress,
  useRotations,
  useSales,
  useTeams,
} from '@/hooks/useCepev'
import { PeopleRegistry } from '@/features/people/PeopleRegistry'
import { SEX_GROUPS } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, formatDate, formatNumber, matches, percent, todayISO } from '@/lib/utils'

export default function Colporteurs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const today = todayISO()
  const progressQuery = useColporteurProgress()
  const salesQuery = useSales(addDays(today, -6), today)
  const rotationsQuery = useRotations()
  const teamsQuery = useTeams()
  const actions = useColporteurActions()

  const [tab, setTab] = useState('resultados')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})

  const view = searchParams.get('vista') ?? ''
  const progress = useMemo(() => progressQuery.data ?? [], [progressQuery.data])

  const reportedToday = useMemo(
    () => new Set((salesQuery.data ?? []).filter((sale) => sale.report_date === today).map((sale) => sale.person_id)),
    [salesQuery.data, today],
  )

  const totals = useMemo(() => {
    const books = progress.reduce((sum, row) => sum + row.books_last_7d, 0)
    const goal = progress.reduce((sum, row) => sum + row.daily_goal * 7, 0)
    return { books, goal, compliance: percent(books, goal) }
  }, [progress])

  const missingToday = progress.filter((row) => !reportedToday.has(row.person_id))
  const futureRotations = (rotationsQuery.data ?? []).filter((rotation) => rotation.start_date > today)

  const visibleRows = useMemo(
    () =>
      progress.filter((row) => {
        if (!matches(`${row.full_name} ${row.team_name ?? ''} ${row.current_city ?? ''}`, search)) return false
        if (view === 'faltantes') return !reportedToday.has(row.person_id)
        if (view === 'bajo') return row.books_last_7d < row.daily_goal * 7
        return true
      }),
    [progress, search, view, reportedToday],
  )

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }

  const openModal = (type, values = {}) => {
    setForm(values)
    setModal(type)
  }

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const closeModal = () => setModal(null)

  const mutations = {
    sale: actions.registerSale,
    correct: actions.correctSale,
    rotation: actions.createRotation,
  }

  const titles = {
    sale: 'Registrar libros vendidos',
    correct: 'Corregir reporte diario',
    rotation: 'Programar rotación de ciudad',
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    mutations[modal].mutate(form, { onSuccess: closeModal })
  }

  const saleFor = (personId) =>
    (salesQuery.data ?? []).find((sale) => sale.person_id === personId && sale.report_date === today)

  return (
    <>
      <PageHeader title="Colportores" subtitle="Equipos, ciudades y resultados diarios.">
        <TodayChip />
        {canWrite && tab === 'resultados' && (
          <Button onClick={() => openModal('sale', { person_id: '', report_date: today, books_sold: '' })}>
            <Plus />
            Registrar siembras
          </Button>
        )}
      </PageHeader>

      <div role="tablist" aria-label="Secciones de colportores" className="mb-5 flex gap-1 border-b border-line">
        {[
          { id: 'resultados', label: 'Resultados diarios' },
          { id: 'registro', label: 'Registro de colportores' },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={
              'relative -mb-px min-h-11 px-3 text-sm font-medium transition-colors sm:px-4 ' +
              (tab === item.id
                ? 'border-b-2 border-navy-600 text-navy-700'
                : 'border-b-2 border-transparent text-ink-soft hover:text-ink')
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'registro' && <PeopleRegistry kind="Colportor" />}

      {tab === 'resultados' && (
        <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Libros vendidos" value={formatNumber(totals.books)} detail={`Meta 7 días: ${formatNumber(totals.goal)}`} onClick={() => setView('')} />
        <KpiCard label="Cumplimiento" value={`${totals.compliance}%`} detail="Acumulado de los últimos 7 días" tone={totals.compliance >= 80 ? 'green' : 'gold'} onClick={() => setView('bajo')} />
        <KpiCard label="Sin reporte hoy" value={missingToday.length} detail="Un pendiente no es lo mismo que cero ventas" tone="gold" onClick={() => setView('faltantes')} />
        <KpiCard label="Rotaciones futuras" value={futureRotations.length} detail="Cambios de ciudad programados" />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchInput
          placeholder="Buscar persona, ciudad o equipo…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar colportor"
        />
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                openModal('rotation', {
                  team_id: '',
                  city: '',
                  start_date: addDays(today, 7),
                  end_date: addDays(today, 28),
                })
              }
            >
              <MapPin />
              Programar rotación
            </Button>
          </div>
        )}
      </div>

      {view && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-navy-50 px-4 py-2.5 text-sm">
          <span>Vista: {view === 'faltantes' ? 'Sin reporte hoy' : 'Por debajo de la meta'}</span>
          <button type="button" className="font-semibold text-navy-600" onClick={() => setView('')}>
            Mostrar todo ×
          </button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Resultados por colportor"
          description="Meta acumulada de los últimos 7 días según la meta diaria de cada persona."
        />
        <QueryBoundary query={progressQuery} empty="Todavía no hay colportores registrados.">
          <Table columns={['Colportor', 'Equipo / ciudad', 'Hoy', '7 días / meta', 'Cumplimiento', '']}>
            {visibleRows.map((row) => {
              const sale = saleFor(row.person_id)
              const goal = row.daily_goal * 7
              const compliance = percent(row.books_last_7d, goal)

              return (
                <Tr key={row.person_id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={row.full_name} />
                      <strong className="text-sm">{row.full_name}</strong>
                    </div>
                  </Td>
                  <Td className="text-xs">
                    {row.team_name ?? 'Individual'}
                    <br />
                    <span className="text-ink-soft">{row.current_city}</span>
                  </Td>
                  <Td>
                    {sale ? (
                      <strong className="text-sm">{sale.books_sold} libros</strong>
                    ) : (
                      <Badge tone="gold">Sin reporte</Badge>
                    )}
                  </Td>
                  <Td className="text-sm">
                    {row.books_last_7d} / {goal}
                  </Td>
                  <Td>
                    <div className="flex min-w-32 items-center gap-2">
                      <Progress value={compliance} className="w-20" tone={compliance >= 80 ? 'green' : 'gold'} />
                      <span className="text-xs">{compliance}%</span>
                    </div>
                  </Td>
                  <Td>
                    {canWrite &&
                      (sale ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openModal('correct', { id: sale.id, books_sold: sale.books_sold, reason: '' })}
                        >
                          Editar reporte
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openModal('sale', { person_id: row.person_id, report_date: today, books_sold: '' })}
                        >
                          Registrar
                        </Button>
                      ))}
                  </Td>
                </Tr>
              )
            })}
          </Table>
        </QueryBoundary>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Permanencia y rotaciones"
          description="Los periodos terminan en la fecha de salida; el siguiente destino puede empezar ese mismo día."
        />
        <QueryBoundary query={rotationsQuery} empty="Sin rotaciones programadas.">
          <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-2">
            {(teamsQuery.data ?? []).map((team) => {
              const teamRotations = (rotationsQuery.data ?? []).filter((item) => item.teams?.id === team.id)
              const members = progress.filter((row) => row.team_name === team.name).length

              return (
                <div key={team.id}>
                  <h3 className="mb-3 flex flex-wrap items-center gap-2 font-semibold">
                    <Users className="size-4 text-navy-400" aria-hidden="true" />
                    Equipo {team.name}
                    <Badge className="ml-auto">{members} personas</Badge>
                  </h3>
                  {teamRotations.length === 0 && (
                    <p className="text-sm text-ink-soft">Sin rotaciones registradas.</p>
                  )}
                  {teamRotations.map((rotation) => (
                    <div key={rotation.id} className="flex items-center gap-3 border-t border-[#edf1f5] py-3">
                      <MapPin className="size-4 shrink-0 text-navy-300" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <strong className="block text-sm">{rotation.city}</strong>
                        <small className="text-xs text-ink-soft">
                          {formatDate(rotation.start_date)} → {formatDate(rotation.end_date)}
                        </small>
                      </div>
                      <Badge tone={rotation.start_date > today ? 'gold' : 'green'}>
                        {rotation.start_date > today ? 'Programada' : 'Vigente'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </QueryBoundary>
      </Card>

      <Dialog
        open={Boolean(modal)}
        onClose={closeModal}
        title={titles[modal] ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="colporteur-form" loading={mutations[modal]?.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        <form id="colporteur-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {modal === 'sale' && (
            <>
              <Select
                label="Colportor"
                required
                className="sm:col-span-2"
                value={form.person_id}
                onChange={update('person_id')}
                placeholder="Seleccionar…"
                options={progress.map((row) => ({ value: row.person_id, label: row.full_name }))}
              />
              <Input label="Fecha del reporte" type="date" required max={today} value={form.report_date} onChange={update('report_date')} />
              <Input label="Libros vendidos" type="number" min="0" step="1" required value={form.books_sold} onChange={update('books_sold')} />
            </>
          )}

          {modal === 'correct' && (
            <>
              <Input label="Libros vendidos" type="number" min="0" step="1" required value={form.books_sold} onChange={update('books_sold')} />
              <Input label="Motivo de la corrección" required value={form.reason} onChange={update('reason')} />
            </>
          )}

          {modal === 'rotation' && (
            <>
              <Select
                label="Equipo"
                required
                value={form.team_id}
                onChange={update('team_id')}
                placeholder="Seleccionar…"
                options={(teamsQuery.data ?? []).map((team) => ({ value: team.id, label: team.name }))}
              />
              <Input label="Ciudad de destino" required value={form.city} onChange={update('city')} />
              <Input label="Inicio de permanencia" type="date" required value={form.start_date} onChange={update('start_date')} />
              <Input label="Salida de la ciudad" type="date" required value={form.end_date} onChange={update('end_date')} />
            </>
          )}

        </form>
      </Dialog>

      <div className="mt-5 flex items-center gap-3 rounded-lg bg-navy-50 px-4 py-3 text-[13px] text-navy-600">
        <BookOpen className="size-4 shrink-0" aria-hidden="true" />
        Cada persona solo puede tener un reporte por día: para ajustarlo usa «Editar reporte» e indica el motivo.
      </div>
        </>
      )}
    </>
  )
}
