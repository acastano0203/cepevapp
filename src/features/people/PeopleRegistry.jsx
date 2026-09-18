import { useMemo, useState } from 'react'
import { BedDouble, Pencil, Plus, Power, Trash2, TriangleAlert } from 'lucide-react'
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
  useDeletePerson,
  usePeopleRegistry,
  useSavePerson,
  useSetAvailability,
  useTeams,
} from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { cn, formatDate, formatNumber, matches } from '@/lib/utils'
import { PersonForm, emptyPerson, toFormValues } from './PersonForm'
import { getRegistryConfig } from './registryConfig'

/** Celda con el dato propio de cada tipo: resultados o alojamiento. */
function SpecificCell({ row, config }) {
  if (config.showResults) {
    return row.reports_count > 0 ? (
      <>
        <strong className="text-sm">{formatNumber(row.books_total)}</strong> libros
        <br />
        <span className="text-ink-soft">
          {row.reports_count} reportes · último {formatDate(row.last_report_date)}
        </span>
      </>
    ) : (
      <span className="text-ink-soft">Sin reportes</span>
    )
  }

  return row.current_bed ? (
    <span className="inline-flex items-center gap-1.5">
      <BedDouble className="size-3.5 text-navy-400" aria-hidden="true" />
      {row.current_bed}
    </span>
  ) : (
    <span className="text-ink-soft">Sin alojamiento</span>
  )
}

function ActionButtons({ row, onEdit, onToggle, onDelete, compact }) {
  return (
    <div className={cn('flex gap-1', compact ? 'flex-wrap' : 'justify-end')}>
      <Button variant={compact ? 'secondary' : 'ghost'} size="sm" onClick={() => onEdit(row)}>
        <Pencil />
        Editar
      </Button>
      <Button
        variant="ghost"
        size={compact ? 'sm' : 'icon'}
        onClick={() => onToggle(row)}
        aria-label={`${row.is_available ? 'Desactivar' : 'Reactivar'} a ${row.full_name}`}
        title={row.is_available ? 'Desactivar' : 'Reactivar'}
      >
        <Power className={row.is_available ? 'text-emerald-600' : 'text-ink-soft'} />
        {compact && (row.is_available ? 'Desactivar' : 'Reactivar')}
      </Button>
      <Button
        variant="ghost"
        size={compact ? 'sm' : 'icon'}
        onClick={() => onDelete(row)}
        aria-label={`Eliminar a ${row.full_name}`}
        title="Eliminar"
      >
        <Trash2 className="text-[var(--color-danger-fg)]" />
        {compact && 'Eliminar'}
      </Button>
    </div>
  )
}

/** Fila de la tabla (escritorio). */
function ReadRow({ row, config, canWrite, ...handlers }) {
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
        <span className="block text-sm">
          {row.phone || <span className="text-ink-soft">Sin teléfono</span>}
        </span>
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
        {config.showTeam && (
          <>
            {row.team_name ?? <span className="text-ink-soft">Individual</span>}
            <br />
          </>
        )}
        <span className={config.showTeam ? 'text-ink-soft' : undefined}>{row.current_city}</span>
      </td>
      {config.showGoal && (
        <td className="px-4 py-3 text-sm whitespace-nowrap">{row.daily_goal} / día</td>
      )}
      <td className="px-4 py-3 text-xs">
        <SpecificCell row={row} config={config} />
      </td>
      <td className="px-4 py-3">
        <Badge tone={row.is_available ? 'green' : 'neutral'}>
          {row.is_available ? 'Activo' : 'Inactivo'}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {canWrite && <ActionButtons row={row} {...handlers} />}
      </td>
    </tr>
  )
}

/** Misma ficha, en formato tarjeta para pantallas pequeñas. */
function ReadCard({ row, config, canWrite, ...handlers }) {
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
          <dt className="text-ink-soft">{config.showTeam ? 'Equipo / ciudad' : 'Procedencia'}</dt>
          <dd className="truncate font-medium">
            {config.showTeam ? `${row.team_name ?? 'Individual'} · ` : ''}
            {row.current_city}
          </dd>
        </div>
        {config.showGoal && (
          <div>
            <dt className="text-ink-soft">Meta diaria</dt>
            <dd className="font-medium">{row.daily_goal} libros</dd>
          </div>
        )}
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
          <dt className="text-ink-soft">{config.showResults ? 'Resultados' : 'Alojamiento'}</dt>
          <dd className="font-medium">
            <SpecificCell row={row} config={config} />
          </dd>
        </div>
      </dl>

      {canWrite && (
        <div className="mt-4">
          <ActionButtons row={row} compact {...handlers} />
        </div>
      )}
    </li>
  )
}

/**
 * Grilla de registro de personas: crear, ver, editar y eliminar.
 * El tipo de persona lo define `kind`; el resto sale de registryConfig.
 */
export function PeopleRegistry({ kind }) {
  const config = getRegistryConfig(kind)
  const { canWrite, isAdmin } = useAuth()

  const registry = usePeopleRegistry(kind)
  const teamsQuery = useTeams()
  const savePerson = useSavePerson()
  const deletePerson = useDeletePerson()
  const setAvailability = useSetAvailability()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('todos')
  const [form, setForm] = useState(null) // null = nadie en edición
  const [toDelete, setToDelete] = useState(null)

  const rows = useMemo(() => registry.data ?? [], [registry.data])

  const stats = useMemo(
    () => ({
      total: rows.length,
      activos: rows.filter((row) => row.is_available).length,
      inactivos: rows.filter((row) => !row.is_available).length,
      extra: config.showGoal
        ? rows.filter((row) => row.is_available).reduce((sum, row) => sum + row.daily_goal, 0)
        : rows.filter((row) => row.current_bed).length,
    }),
    [rows, config.showGoal],
  )

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const haystack = `${row.full_name} ${row.document_id ?? ''} ${row.email ?? ''} ${
          row.team_name ?? ''
        } ${row.current_city} ${row.phone ?? ''}`
        if (!matches(haystack, search)) return false
        if (status === 'activos') return row.is_available
        if (status === 'inactivos') return !row.is_available
        return true
      }),
    [rows, search, status],
  )

  const columns = [
    config.showResults ? 'Colportor' : 'Cepevista',
    'Contacto',
    config.showTeam ? 'Equipo / ciudad' : 'Procedencia',
    ...(config.showGoal ? ['Meta'] : []),
    config.showResults ? 'Resultados' : 'Alojamiento',
    'Estado',
    '',
  ]

  const handlers = {
    onEdit: (row) => setForm(toFormValues(row)),
    onToggle: (row) => setAvailability.mutate({ id: row.id, available: !row.is_available }),
    onDelete: setToDelete,
  }

  const cancel = () => setForm(null)
  const submit = (values) => savePerson.mutate({ ...values, kind }, { onSuccess: cancel })
  const confirmDelete = (force = false) =>
    deletePerson.mutate({ id: toDelete.id, force }, { onSuccess: () => setToDelete(null) })

  const renderForm = () => (
    <PersonForm
      value={form}
      onChange={setForm}
      onSubmit={submit}
      onCancel={cancel}
      teams={teamsQuery.data ?? []}
      saving={savePerson.isPending}
      config={config}
    />
  )

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={config.metrics.totalLabel}
          value={stats.total}
          detail="Fichas en el sistema"
          onClick={() => setStatus('todos')}
        />
        <KpiCard
          label="Activos"
          value={stats.activos}
          detail="Disponibles para asignación"
          tone="green"
          onClick={() => setStatus('activos')}
        />
        <KpiCard
          label="Inactivos"
          value={stats.inactivos}
          detail="Conservan su historial"
          tone="gold"
          onClick={() => setStatus('inactivos')}
        />
        <KpiCard
          label={config.metrics.extraLabel}
          value={formatNumber(stats.extra)}
          detail={config.metrics.extraDetail}
          icon={config.icon}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          placeholder="Buscar por nombre, documento, correo o ciudad…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={`Buscar ${config.singular}`}
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
          <Button onClick={() => setForm(emptyPerson(config))}>
            <Plus />
            Nuevo {config.singular}
          </Button>
        )}
      </div>

      {/* Alta: el formulario aparece arriba de la grilla */}
      {form && !form.id && <div className="mb-4">{renderForm()}</div>}

      <Card>
        <CardHeader
          title={config.title}
          description={`${visible.length} de ${stats.total} fichas · edita o elimina desde la misma grilla`}
        />

        <QueryBoundary query={registry} empty={`Todavía no hay ${config.plural} registrados.`}>
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-soft sm:px-6">
              Ningún registro coincide con la búsqueda.
            </p>
          ) : (
            <>
              {/* Escritorio */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr className="border-b border-[#edf1f5]">
                      {columns.map((column, index) => (
                        <th
                          key={index}
                          scope="col"
                          className={cn(
                            'h-11 px-4 text-left text-xs font-semibold tracking-wide text-ink-soft uppercase',
                            index === columns.length - 1 && 'text-right',
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
                          <td colSpan={columns.length} className="p-3">
                            {renderForm()}
                          </td>
                        </tr>
                      ) : (
                        <ReadRow
                          key={row.id}
                          row={row}
                          config={config}
                          canWrite={canWrite}
                          {...handlers}
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
                      {renderForm()}
                    </li>
                  ) : (
                    <ReadCard
                      key={row.id}
                      row={row}
                      config={config}
                      canWrite={canWrite}
                      {...handlers}
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
        title={`Eliminar ${config.singular}`}
        description={toDelete?.full_name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            {toDelete?.can_delete ? (
              <Button
                variant="danger"
                onClick={() => confirmDelete(false)}
                loading={deletePerson.isPending}
              >
                <Trash2 />
                Eliminar
              </Button>
            ) : (
              <Button
                onClick={() => {
                  handlers.onToggle(toDelete)
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
              todo su historial. Es lo recomendable cuando alguien termina su temporada.
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
