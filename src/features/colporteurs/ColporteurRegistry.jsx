import { useMemo, useState } from 'react'
import { BookOpen, Pencil, Plus, Power, Trash2, TriangleAlert } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  KpiCard,
  QueryBoundary,
  SearchInput,
  Select,
} from '@/components/ui'
import {
  useColporteurRegistry,
  useDeletePerson,
  useSavePerson,
  useSetAvailability,
  useTeams,
} from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { cn, formatDate, formatNumber, matches } from '@/lib/utils'
import { ColporteurForm, EMPTY_COLPORTEUR, toFormValues } from './ColporteurForm'

const COLUMNS = ['Colportor', 'Contacto', 'Equipo / ciudad', 'Meta', 'Resultados', 'Estado', '']

/** Celdas de una fila en modo lectura (escritorio). */
function ReadRow({ row, canWrite, onEdit, onToggle, onDelete }) {
  return (
    <tr className="border-b border-[#edf1f5] last:border-0 hover:bg-navy-50/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={row.full_name} />
          <div className="min-w-0">
            <strong className="block truncate text-sm">{row.full_name}</strong>
            <small className="block truncate text-xs text-ink-soft">
              {row.document_id ? `${row.document_type} ${row.document_id}` : 'Sin documento'} ·{' '}
              {row.age} años
            </small>
          </div>
        </div>
      </td>
      <td className="max-w-56 px-4 py-3">
        <span className="block text-sm">{row.phone || <span className="text-ink-soft">Sin teléfono</span>}</span>
        {row.email ? (
          <a
            href={`mailto:${row.email}`}
            className="block truncate text-xs text-navy-500 underline underline-offset-2"
            title={row.email}
          >
            {row.email}
          </a>
        ) : (
          <span className="text-xs text-ink-soft">Sin correo</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        {row.team_name ?? <span className="text-ink-soft">Individual</span>}
        <br />
        <span className="text-ink-soft">{row.current_city}</span>
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">{row.daily_goal} / día</td>
      <td className="px-4 py-3 text-xs">
        {row.reports_count > 0 ? (
          <>
            <strong className="text-sm">{formatNumber(row.books_total)}</strong> libros
            <br />
            <span className="text-ink-soft">
              {row.reports_count} reportes · último {formatDate(row.last_report_date)}
            </span>
          </>
        ) : (
          <span className="text-ink-soft">Sin reportes</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={row.is_available ? 'green' : 'neutral'}>
          {row.is_available ? 'Activo' : 'Inactivo'}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {canWrite && (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => onEdit(row)} aria-label={`Editar ${row.full_name}`}>
              <Pencil />
              Editar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggle(row)}
              aria-label={row.is_available ? `Desactivar ${row.full_name}` : `Reactivar ${row.full_name}`}
              title={row.is_available ? 'Desactivar' : 'Reactivar'}
            >
              <Power className={row.is_available ? 'text-emerald-600' : 'text-ink-soft'} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(row)}
              aria-label={`Eliminar ${row.full_name}`}
              title="Eliminar"
            >
              <Trash2 className="text-[var(--color-danger-fg)]" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}

/** Misma fila, en formato tarjeta para pantallas pequeñas. */
function ReadCard({ row, canWrite, onEdit, onToggle, onDelete }) {
  return (
    <li className="border-b border-[#edf1f5] p-4 last:border-0">
      <div className="flex items-start gap-3">
        <Avatar name={row.full_name} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate">{row.full_name}</strong>
          <small className="block truncate text-xs text-ink-soft">
            {row.document_id ? `${row.document_type} ${row.document_id}` : 'Sin documento'} ·{' '}
            {row.sex} · {row.age} años
          </small>
        </div>
        <Badge tone={row.is_available ? 'green' : 'neutral'}>
          {row.is_available ? 'Activo' : 'Inactivo'}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-ink-soft">Equipo / ciudad</dt>
          <dd className="font-medium">
            {row.team_name ?? 'Individual'} · {row.current_city}
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Meta diaria</dt>
          <dd className="font-medium">{row.daily_goal} libros</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-soft">Contacto</dt>
          <dd className="truncate font-medium">
            {row.phone || 'sin teléfono'}
            {row.email ? ' · ' : ''}
            {row.email && (
              <a href={`mailto:${row.email}`} className="text-navy-500 underline underline-offset-2">
                {row.email}
              </a>
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-soft">Resultados</dt>
          <dd className="font-medium">
            {row.reports_count > 0
              ? `${formatNumber(row.books_total)} libros en ${row.reports_count} reportes`
              : 'Sin reportes registrados'}
          </dd>
        </div>
      </dl>

      {canWrite && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => onEdit(row)}>
            <Pencil />
            Editar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onToggle(row)}>
            <Power />
            {row.is_available ? 'Desactivar' : 'Reactivar'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(row)}>
            <Trash2 className="text-[var(--color-danger-fg)]" />
            Eliminar
          </Button>
        </div>
      )}
    </li>
  )
}

export function ColporteurRegistry() {
  const { canWrite, isAdmin } = useAuth()
  const registry = useColporteurRegistry()
  const teamsQuery = useTeams()
  const savePerson = useSavePerson()
  const deletePerson = useDeletePerson()
  const setAvailability = useSetAvailability()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('todos')
  const [form, setForm] = useState(null) // null = nadie en edicion
  const [toDelete, setToDelete] = useState(null)

  const rows = useMemo(() => registry.data ?? [], [registry.data])

  const stats = useMemo(
    () => ({
      total: rows.length,
      activos: rows.filter((row) => row.is_available).length,
      inactivos: rows.filter((row) => !row.is_available).length,
      meta: rows.filter((row) => row.is_available).reduce((sum, row) => sum + row.daily_goal, 0),
    }),
    [rows],
  )

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const haystack = `${row.full_name} ${row.document_id ?? ''} ${row.email ?? ''} ${row.team_name ?? ''} ${row.current_city} ${row.phone ?? ''}`
        if (!matches(haystack, search)) return false
        if (status === 'activos') return row.is_available
        if (status === 'inactivos') return !row.is_available
        return true
      }),
    [rows, search, status],
  )

  const startCreate = () => setForm({ ...EMPTY_COLPORTEUR })
  const startEdit = (row) => setForm(toFormValues(row))
  const cancel = () => setForm(null)

  const submit = (values) =>
    savePerson.mutate({ ...values, kind: 'Colportor' }, { onSuccess: cancel })

  const toggle = (row) =>
    setAvailability.mutate({ id: row.id, available: !row.is_available })

  const confirmDelete = (force = false) =>
    deletePerson.mutate({ id: toDelete.id, force }, { onSuccess: () => setToDelete(null) })

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Colportores registrados" value={stats.total} detail="Fichas en el sistema" onClick={() => setStatus('todos')} />
        <KpiCard label="Activos" value={stats.activos} detail="Disponibles para asignación" tone="green" onClick={() => setStatus('activos')} />
        <KpiCard label="Inactivos" value={stats.inactivos} detail="Conservan su historial" tone="gold" onClick={() => setStatus('inactivos')} />
        <KpiCard label="Meta diaria del equipo" value={formatNumber(stats.meta)} detail="Suma de metas de los activos" icon={BookOpen} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          placeholder="Buscar por nombre, documento, correo, equipo o ciudad…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar colportor"
        />
        <Select
          className="w-full sm:w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'activos', label: 'Solo activos' },
            { value: 'inactivos', label: 'Solo inactivos' },
          ]}
        />
        {canWrite && (
          <Button onClick={startCreate} disabled={form?.id === null && form !== null}>
            <Plus />
            Nuevo colportor
          </Button>
        )}
      </div>

      {/* Alta: el formulario aparece dentro de la misma grilla, arriba de todo */}
      {form && !form.id && (
        <div className="mb-4">
          <ColporteurForm
            value={form}
            onChange={setForm}
            onSubmit={submit}
            onCancel={cancel}
            teams={teamsQuery.data ?? []}
            saving={savePerson.isPending}
          />
        </div>
      )}

      <Card>
        <CardHeader
          title="Registro de colportores"
          description={`${visible.length} de ${stats.total} fichas · edita o elimina desde la misma grilla`}
        />

        <QueryBoundary query={registry} empty="Todavía no hay colportores registrados.">
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-soft sm:px-6">
              Ningún colportor coincide con la búsqueda.
            </p>
          ) : (
            <>
              {/* Escritorio */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr className="border-b border-[#edf1f5]">
                      {COLUMNS.map((column, index) => (
                        <th
                          key={index}
                          scope="col"
                          className={cn(
                            'h-11 px-4 text-left text-xs font-semibold tracking-wide text-ink-soft uppercase',
                            index === COLUMNS.length - 1 && 'text-right',
                          )}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) =>
                      form?.id === row.id ? (
                        <tr key={row.id} className="border-b border-[#edf1f5] last:border-0">
                          <td colSpan={COLUMNS.length} className="p-3">
                            <ColporteurForm
                              value={form}
                              onChange={setForm}
                              onSubmit={submit}
                              onCancel={cancel}
                              teams={teamsQuery.data ?? []}
                              saving={savePerson.isPending}
                            />
                          </td>
                        </tr>
                      ) : (
                        <ReadRow
                          key={row.id}
                          row={row}
                          canWrite={canWrite}
                          onEdit={startEdit}
                          onToggle={toggle}
                          onDelete={setToDelete}
                        />
                      ),
                    )}
                  </tbody>
                </table>
              </div>

              {/* Móvil */}
              <ul className="md:hidden">
                {visible.map((row) =>
                  form?.id === row.id ? (
                    <li key={row.id} className="border-b border-[#edf1f5] p-3 last:border-0">
                      <ColporteurForm
                        value={form}
                        onChange={setForm}
                        onSubmit={submit}
                        onCancel={cancel}
                        teams={teamsQuery.data ?? []}
                        saving={savePerson.isPending}
                      />
                    </li>
                  ) : (
                    <ReadCard
                      key={row.id}
                      row={row}
                      canWrite={canWrite}
                      onEdit={startEdit}
                      onToggle={toggle}
                      onDelete={setToDelete}
                    />
                  ),
                )}
              </ul>
            </>
          )}
        </QueryBoundary>
      </Card>

      {/* Confirmación de borrado */}
      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        size="sm"
        title="Eliminar colportor"
        description={toDelete?.full_name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            {toDelete?.can_delete ? (
              <Button variant="danger" onClick={() => confirmDelete(false)} loading={deletePerson.isPending}>
                <Trash2 />
                Eliminar
              </Button>
            ) : (
              <Button
                onClick={() => {
                  toggle(toDelete)
                  setToDelete(null)
                }}
              >
                <Power />
                Desactivar
              </Button>
            )}
          </>
        }
      >
        {toDelete?.can_delete ? (
          <p className="text-sm text-ink-soft">
            Esta ficha no tiene reportes, estadías ni recorridos asociados: se puede eliminar sin
            perder información. La acción queda registrada en la bitácora.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="flex gap-2 rounded-lg bg-gold-100 px-3 py-2.5 text-sm text-gold-700">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Tiene historial registrado: {toDelete?.reports_count} reportes,{' '}
              {toDelete?.stays_count} estadías y {toDelete?.trips_count} recorridos.
            </p>
            <p className="text-sm text-ink-soft">
              Al <strong>desactivarlo</strong> desaparece de las listas operativas pero conserva
              todos sus resultados históricos. Es lo recomendable cuando alguien termina su
              temporada de colportaje.
            </p>
            {isAdmin && (
              <button
                type="button"
                onClick={() => confirmDelete(true)}
                className="self-start text-sm font-semibold text-[var(--color-danger-fg)] underline underline-offset-4"
              >
                Eliminar definitivamente y borrar su historial
              </button>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
