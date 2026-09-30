import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Building2,
  Bus,
  FileText,
  Fuel,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  Input,
  KpiCard,
  QueryBoundary,
  Select,
  Skeleton,
  Table,
  Td,
  Tr,
} from '@/components/ui'
import {
  useFleetActions,
  useFuelLogs,
  useMaintenanceLogs,
  usePeople,
  useTrips,
  useVehicles,
} from '@/hooks/useCepev'
import {
  DOCUMENT_STATUS_TONES,
  VEHICLE_OWNERSHIPS,
  VEHICLE_SERVICE_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  label,
} from '@/lib/constants'
import { fleetApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { addDays, formatCurrency, formatDate, formatDateTime, formatNumber, todayISO } from '@/lib/utils'

const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

/** Vencimiento de un documento del vehiculo con su alerta. */
function DocumentRow({ name, expiry, status }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-ink-soft">{name}</dt>
      <dd className="flex items-center gap-1.5 text-xs">
        {expiry && <span className="text-ink">{formatDate(expiry, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
        <Badge tone={DOCUMENT_STATUS_TONES[status] ?? 'neutral'} className="py-0.5">
          {status}
        </Badge>
      </dd>
    </div>
  )
}

/** Abre la planilla privada con un enlace temporal. */
async function openDocument(path) {
  // La pestaña se abre antes de esperar al servidor para que el navegador no la bloquee.
  const tab = window.open('', '_blank')
  try {
    const url = await fleetApi.documentUrl(path)
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (error) {
    tab?.close()
    toast.error(error.message)
  }
}

const emptyForms = {
  vehicle: {
    id: '',
    plate: '',
    vehicle_type: VEHICLE_TYPES[0],
    brand: '',
    model_year: '',
    color: '',
    capacity: 12,
    odometer_km: 0,
    next_service_km: '',
    next_service_date: '',
    status: 'Disponible',
    driver_id: '',
    ownership: 'CEPEV',
    owner_id: '',
    owner_name: '',
    owner_phone: '',
    service_type: 'Particular',
    soat_expiry: '',
    insurance_expiry: '',
    public_service_file: '',
    public_service_file_name: '',
    public_service_upload: null,
    remove_public_service_file: false,
  },
  trip: { vehicle_id: '', driver_id: '', destination_city: '', starts_at: '', ends_at: '' },
  close: { id: '', return_km: '', return_city: 'Piedecuesta' },
  fuel: { vehicle_id: '', liters: '', amount_cop: '', odometer_km: '' },
  maintenance: {
    vehicle_id: '',
    detail: '',
    cost_cop: '',
    status: 'Disponible',
    next_service_date: '',
    next_service_km: '',
  },
}

export default function Fleet() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { canWrite } = useAuth()

  const vehiclesQuery = useVehicles()
  const tripsQuery = useTrips()
  const fuelQuery = useFuelLogs()
  const maintenanceQuery = useMaintenanceLogs()
  // Solo conduce quien tiene licencia de conduccion vigente.
  const driversQuery = usePeople({ licensed: true })
  // Propietario de un vehiculo externo: cualquier persona registrada.
  const ownersQuery = usePeople({})
  const actions = useFleetActions()

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const view = searchParams.get('vista') ?? ''
  const ownership = searchParams.get('propiedad') ?? ''
  const allVehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data])
  const vehicles = useMemo(
    () => (ownership ? allVehicles.filter((v) => (v.ownership ?? 'CEPEV') === ownership) : allVehicles),
    [allVehicles, ownership],
  )

  const stats = useMemo(
    () => ({
      available: vehicles.filter((v) => v.status === 'Disponible' && !v.busy_today).length,
      due: vehicles.filter((v) => v.service_due).length,
      blocked: vehicles.filter((v) => v.status !== 'Disponible').length,
      documents: vehicles.filter((v) => v.documents_alert).length,
      trips: (tripsQuery.data ?? []).filter((t) => t.status === 'Reservado' || t.status === 'En ruta').length,
    }),
    [vehicles, tripsQuery.data],
  )

  const visibleVehicles = useMemo(() => {
    if (view === 'disponibles') return vehicles.filter((v) => v.status === 'Disponible' && !v.busy_today)
    if (view === 'mantenimiento') return vehicles.filter((v) => v.service_due)
    if (view === 'bloqueados') return vehicles.filter((v) => v.status !== 'Disponible')
    if (view === 'documentos') return vehicles.filter((v) => v.documents_alert)
    return vehicles
  }, [vehicles, view])

  const setParam = (key) => (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set(key, next)
    else params.delete(key)
    setSearchParams(params, { replace: true })
  }
  const setView = setParam('vista')
  const setOwnership = setParam('propiedad')

  const ownershipFilters = [
    { value: '', label: 'Todos', count: allVehicles.length },
    ...VEHICLE_OWNERSHIPS.map((option) => ({
      value: option.value,
      label: option.value === 'CEPEV' ? 'Propios del CEPEV' : 'Externos',
      count: allVehicles.filter((v) => (v.ownership ?? 'CEPEV') === option.value).length,
    })),
  ]

  const openModal = (type, values = {}) => {
    setForm({ ...emptyForms[type], ...values })
    setModal(type)
  }

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const closeModal = () => setModal(null)

  const mutationByModal = {
    vehicle: actions.saveVehicle,
    trip: actions.createTrip,
    close: actions.closeTrip,
    fuel: actions.registerFuel,
    maintenance: actions.registerMaintenance,
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    mutationByModal[modal].mutate(form, {
      onSuccess: closeModal,
      // La ficha quedo guardada aunque fallo la planilla: se cierra para no duplicar el alta.
      onError: (error) => {
        if (!error.vehicleSaved) return
        closeModal()
        vehiclesQuery.refetch()
      },
    })
  }

  const vehicleOptions = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.plate} · ${vehicle.name}`,
  }))

  const driverOption = (person) => ({
    value: person.id,
    label: `${person.full_name} · ${label(person.kind)} · Lic. ${person.license_number} (vence ${formatDate(
      person.license_expiry,
    )})`,
  })
  const drivers = driversQuery.data ?? []
  const driverOptions = drivers.map(driverOption)
  // Para un recorrido, ademas, la persona debe figurar como disponible.
  const tripDriverOptions = drivers.filter((person) => person.is_available).map(driverOption)
  const driverHint = driversQuery.isPending
    ? 'Cargando conductores…'
    : drivers.length === 0
      ? 'Nadie tiene licencia vigente registrada. Cárgala en la ficha de la persona.'
      : 'Solo aparecen personas con licencia de conducción vigente.'

  const ownerOptions = (ownersQuery.data ?? []).map((person) => ({
    value: person.id,
    label: `${person.full_name} · ${label(person.kind)}`,
  }))

  /** Abre el formulario con la ficha cargada, o vacio para un alta. */
  const editVehicle = (vehicle) =>
    openModal('vehicle', {
      id: vehicle.id,
      plate: vehicle.plate,
      vehicle_type: vehicle.vehicle_type ?? VEHICLE_TYPES[0],
      brand: vehicle.brand ?? '',
      model_year: vehicle.model_year ?? '',
      color: vehicle.color ?? '',
      capacity: vehicle.capacity,
      odometer_km: vehicle.odometer_km,
      next_service_km: vehicle.next_service_km,
      next_service_date: vehicle.next_service_date,
      status: vehicle.status,
      // Si el conductor asignado ya no tiene licencia vigente, hay que elegir otro.
      driver_id: vehicle.driver_license_invalid ? '' : (vehicle.driver_id ?? ''),
      ownership: vehicle.ownership ?? 'CEPEV',
      owner_id: vehicle.owner_id ?? '',
      owner_name: vehicle.owner_name ?? '',
      owner_phone: vehicle.owner_id ? '' : (vehicle.owner_phone ?? ''),
      service_type: vehicle.service_type ?? 'Particular',
      soat_expiry: vehicle.soat_expiry ?? '',
      insurance_expiry: vehicle.insurance_expiry ?? '',
      public_service_file: vehicle.public_service_file ?? '',
      public_service_file_name: vehicle.public_service_file_name ?? '',
    })

  const selectUpload = (event) => {
    const file = event.target.files?.[0] ?? null
    if (file && file.size > DOCUMENT_MAX_BYTES) {
      toast.error('El archivo supera los 10 MB.')
      event.target.value = ''
      return
    }
    setForm((prev) => ({ ...prev, public_service_upload: file }))
  }

  /** Quita el archivo elegido y deja el selector vacio otra vez. */
  const discardUpload = () => {
    setForm((prev) => ({ ...prev, public_service_upload: null }))
    setFileInputKey((key) => key + 1)
  }

  /** Marca (o desmarca) la planilla cargada para eliminarla al guardar. */
  const setRemoveFile = (remove) => setForm((prev) => ({ ...prev, remove_public_service_file: remove }))

  const confirmDelete = () =>
    actions.deleteVehicle.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) })

  const titles = {
    vehicle: form.id ? 'Editar ficha del vehículo' : 'Registrar vehículo',
    trip: 'Reservar vehículo y conductor',
    close: 'Registrar devolución',
    fuel: 'Registrar combustible',
    maintenance: 'Actualizar hoja de vida',
  }

  return (
    <>
      <PageHeader title="Vehículos" subtitle="Disponibilidad, recorridos y cuidado de la flota.">
        <TodayChip />
        {canWrite && (
          <>
            <Button
              variant="secondary"
              onClick={() => openModal('trip', { starts_at: `${todayISO()}T08:00`, ends_at: `${todayISO()}T17:00` })}
            >
              Reservar vehículo
            </Button>
            <Button
              onClick={() =>
                openModal('vehicle', {
                  next_service_date: addDays(todayISO(), 90),
                  next_service_km: 5000,
                })
              }
            >
              <Plus />
              Nuevo vehículo
            </Button>
          </>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Disponibles hoy" value={stats.available} detail="Sin reservas durante el día" tone="green" onClick={() => setView('disponibles')} />
        <KpiCard label="Reservas activas" value={stats.trips} detail="Vehículo y conductor asignados" onClick={() => setView('')} />
        <KpiCard label="Mantenimientos próximos" value={stats.due} detail="7 días o kilometraje alcanzado" tone="gold" onClick={() => setView('mantenimiento')} />
        <KpiCard label="No disponibles" value={stats.blocked} detail="Mantenimiento o fuera de servicio" tone="red" onClick={() => setView('bloqueados')} />
        <KpiCard label="Documentos por revisar" value={stats.documents} detail="SOAT o todo riesgo a 30 días, o sin planilla" tone="red" onClick={() => setView('documentos')} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Propiedad del vehículo">
        {ownershipFilters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={ownership === option.value}
            onClick={() => setOwnership(option.value)}
            className={
              ownership === option.value
                ? 'rounded-full bg-navy-600 px-3.5 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full bg-navy-50 px-3.5 py-1.5 text-sm font-medium text-navy-600 hover:bg-navy-100'
            }
          >
            {option.label} <span className="opacity-70">({option.count})</span>
          </button>
        ))}
      </div>

      {view && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-navy-50 px-4 py-2.5 text-sm">
          <span>Filtro activo</span>
          <button type="button" className="font-semibold text-navy-600" onClick={() => setView('')}>
            Mostrar todo ×
          </button>
        </div>
      )}

      {vehiclesQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleVehicles.map((vehicle) => (
            <article key={vehicle.id} className="surface flex flex-col p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="rounded-xl bg-navy-50 p-3 text-navy-600">
                  <Bus className="size-6" aria-hidden="true" />
                </span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {vehicle.ownership === 'Externo' ? (
                    <Badge tone="neutral">Externo</Badge>
                  ) : (
                    <Badge tone="navy">CEPEV</Badge>
                  )}
                  {vehicle.service_type === 'Publico' && <Badge tone="gold">Servicio público</Badge>}
                  <Badge tone={vehicle.status === 'Disponible' ? 'green' : 'gold'}>{vehicle.status}</Badge>
                </div>
              </div>

              <h2 className="text-lg font-semibold text-ink">
                {vehicle.brand} {label(vehicle.vehicle_type)}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="rounded border border-[#ccd6df] px-1.5 py-0.5 font-semibold tracking-widest text-ink">
                  {vehicle.plate}
                </span>
                {vehicle.model_year && <span>Modelo {vehicle.model_year}</span>}
                {vehicle.color && <span>· {vehicle.color}</span>}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-[#edf1f5] pt-4">
                <div>
                  <dt className="text-[11px] text-ink-soft">Kilometraje</dt>
                  <dd className="text-base font-semibold">{formatNumber(vehicle.odometer_km)} km</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-soft">Próximo mantenimiento</dt>
                  <dd className="text-base font-semibold">
                    {formatNumber(vehicle.next_service_km)} km
                    {vehicle.service_due && (
                      <span className="ml-1 text-xs font-semibold text-gold-700">· Pendiente</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-soft">Capacidad</dt>
                  <dd className="text-sm">{vehicle.capacity} pasajeros</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-soft">Ciudad actual</dt>
                  <dd className="text-sm">{vehicle.current_city}</dd>
                </div>
              </dl>

              <div
                className={`mt-4 rounded-lg border px-3 py-2.5 ${
                  vehicle.documents_alert ? 'border-gold-500/40 bg-gold-100/40' : 'border-[#edf1f5]'
                }`}
              >
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Documentos
                </p>
                <dl className="grid gap-1.5">
                  <DocumentRow name="SOAT" expiry={vehicle.soat_expiry} status={vehicle.soat_status ?? 'Sin registrar'} />
                  <DocumentRow
                    name="Póliza todo riesgo"
                    expiry={vehicle.insurance_expiry}
                    status={vehicle.insurance_status ?? 'Sin registrar'}
                  />
                  {vehicle.service_type === 'Publico' && (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-xs text-ink-soft">Planilla servicio público</dt>
                      <dd className="text-xs">
                        {vehicle.public_service_file ? (
                          <button
                            type="button"
                            onClick={() => openDocument(vehicle.public_service_file)}
                            className="inline-flex items-center gap-1 font-semibold text-navy-600 hover:underline"
                            title={vehicle.public_service_file_name ?? undefined}
                          >
                            <FileText className="size-3.5" aria-hidden="true" />
                            Ver planilla
                          </button>
                        ) : (
                          <Badge tone="red" className="py-0.5">
                            Sin cargar
                          </Badge>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {vehicle.ownership === 'Externo' && (
                <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-[#eef1f5] px-3 py-2.5 text-sm">
                  <Building2 className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {vehicle.owner_display_name ?? 'Propietario sin registrar'}
                    </span>
                    <small className="text-xs text-ink-soft">
                      Propietario{vehicle.owner_kind ? ` · ${label(vehicle.owner_kind)}` : ''}
                      {vehicle.owner_phone ? ` · ${vehicle.owner_phone}` : ''}
                    </small>
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-navy-50/70 px-3 py-2.5 text-sm">
                <UserRound className="size-4 shrink-0 text-navy-500" aria-hidden="true" />
                <div className="min-w-0">
                  {vehicle.driver_name ? (
                    <>
                      <span className="block truncate font-medium text-ink">{vehicle.driver_name}</span>
                      <small className="text-xs text-ink-soft">
                        {label(vehicle.driver_kind)}
                        {vehicle.driver_license_number && ` · Lic. ${vehicle.driver_license_number}`}
                      </small>
                      {vehicle.driver_license_invalid && (
                        <small className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[var(--color-danger-fg)]">
                          <KeyRound className="size-3" aria-hidden="true" />
                          Sin licencia vigente · reasignar conductor
                        </small>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-soft">Sin conductor asignado</span>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs text-ink-soft">
                Próxima revisión: {formatDate(vehicle.next_service_date)}
              </p>

              {canWrite && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#edf1f5] pt-4">
                  <Button size="sm" variant="secondary" onClick={() => editVehicle(vehicle)}>
                    <Pencil />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openModal('fuel', { vehicle_id: vehicle.id, odometer_km: vehicle.odometer_km })}
                  >
                    <Fuel />
                    Combustible
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      openModal('maintenance', {
                        vehicle_id: vehicle.id,
                        status: vehicle.status,
                        next_service_date: addDays(todayISO(), 90),
                        next_service_km: vehicle.odometer_km + 5000,
                      })
                    }
                  >
                    <Wrench />
                    Hoja de vida
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-bg)]"
                    onClick={() => setDeleting(vehicle)}
                    aria-label={`Eliminar ${vehicle.plate}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </article>
          ))}
          {visibleVehicles.length === 0 && (
            <Card className="sm:col-span-2 xl:col-span-3">
              <p className="px-6 py-12 text-center text-sm text-ink-soft">
                {vehicles.length === 0
                  ? 'Todavía no hay vehículos registrados.'
                  : 'Ningún vehículo coincide con el filtro activo.'}
              </p>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-5">
        <CardHeader
          title="Agenda de recorridos"
          description="Las reservas validan cruces del vehículo, del conductor y de los turnos de cocina."
        />
        <QueryBoundary query={tripsQuery} empty="No hay recorridos registrados todavía.">
          <Table columns={['Vehículo / conductor', 'Destino', 'Horario', 'Estado', '']}>
            {tripsQuery.data?.map((trip) => (
              <Tr key={trip.id}>
                <Td>
                  <strong className="block text-sm">{trip.vehicles?.name}</strong>
                  <small className="text-xs text-ink-soft">{trip.people?.full_name}</small>
                </Td>
                <Td>{trip.destination_city}</Td>
                <Td className="text-xs">
                  {formatDateTime(trip.starts_at)}
                  <br />→ {formatDateTime(trip.ends_at)}
                </Td>
                <Td>
                  <Badge tone={trip.status === 'Finalizado' ? 'green' : 'navy'}>{trip.status}</Badge>
                </Td>
                <Td>
                  {canWrite && trip.status !== 'Finalizado' && trip.status !== 'Cancelado' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        openModal('close', {
                          id: trip.id,
                          return_km: (trip.vehicles?.odometer_km ?? 0) + 60,
                          return_city: 'Piedecuesta',
                        })
                      }
                    >
                      Devolver
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </QueryBoundary>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Combustible registrado"
            description={`${formatCurrency(
              (fuelQuery.data ?? []).reduce((total, log) => total + log.amount_cop, 0),
            )} en los últimos registros`}
          />
          <QueryBoundary query={fuelQuery} empty="Sin cargas registradas todavía.">
            <ul>
              {fuelQuery.data?.map((log) => (
                <li key={log.id} className="flex items-center gap-3 border-b border-[#edf1f5] px-4 py-3 text-sm last:border-0 sm:px-6">
                  <Fuel className="size-4 shrink-0 text-navy-400" />
                  <div className="min-w-0">
                    <span className="block truncate">
                      {log.vehicles?.name} · {log.liters} litros
                    </span>
                    <small className="text-xs text-ink-soft">
                      {formatCurrency(log.amount_cop)} · {formatNumber(log.odometer_km)} km ·{' '}
                      {formatDate(log.log_date)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </Card>

        <Card>
          <CardHeader title="Historial técnico" description="Trabajos y novedades por vehículo" />
          <QueryBoundary query={maintenanceQuery} empty="Sin mantenimientos registrados.">
            <ul>
              {maintenanceQuery.data?.map((log) => (
                <li key={log.id} className="flex items-center gap-3 border-b border-[#edf1f5] px-4 py-3 text-sm last:border-0 sm:px-6">
                  <Wrench className="size-4 shrink-0 text-navy-400" />
                  <div className="min-w-0">
                    <span className="block truncate">
                      {log.vehicles?.name} · {log.detail}
                    </span>
                    <small className="text-xs text-ink-soft">
                      {formatDate(log.log_date)} · {formatCurrency(log.cost_cop)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </Card>
      </div>

      <Dialog
        open={Boolean(modal)}
        onClose={closeModal}
        size={modal === 'vehicle' ? 'lg' : 'md'}
        title={titles[modal] ?? ''}
        description="Los datos quedan registrados en la bitácora del centro."
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="fleet-form" loading={mutationByModal[modal]?.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        <form id="fleet-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {modal === 'vehicle' && (
            <>
              <Select
                label="Propiedad"
                required
                value={form.ownership}
                onChange={update('ownership')}
                options={VEHICLE_OWNERSHIPS}
                className="sm:col-span-2"
              />
              {form.ownership === 'Externo' && (
                <>
                  <Select
                    label="Propietario registrado"
                    value={form.owner_id}
                    onChange={update('owner_id')}
                    placeholder="No está registrado"
                    hint="Cepevista, visitante u otra persona registrada."
                    options={ownerOptions}
                    className="sm:col-span-2"
                  />
                  {!form.owner_id && (
                    <>
                      <Input
                        label="Nombre del propietario"
                        required
                        value={form.owner_name}
                        onChange={update('owner_name')}
                        placeholder="Nombre completo"
                      />
                      <Input
                        label="Teléfono del propietario"
                        type="tel"
                        value={form.owner_phone}
                        onChange={update('owner_phone')}
                        placeholder="3001234567"
                      />
                    </>
                  )}
                </>
              )}
              <Select
                label="Tipo de servicio"
                required
                value={form.service_type}
                onChange={update('service_type')}
                options={VEHICLE_SERVICE_TYPES}
              />
              <div className="hidden sm:block" />
              <Input
                label="Vencimiento del SOAT"
                type="date"
                required
                value={form.soat_expiry}
                onChange={update('soat_expiry')}
                hint="Se alerta 30 días antes del vencimiento."
              />
              <Input
                label="Vencimiento póliza todo riesgo"
                type="date"
                value={form.insurance_expiry}
                onChange={update('insurance_expiry')}
                hint="Opcional. Déjalo vacío si no tiene póliza."
              />
              {form.service_type === 'Publico' && (
                <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="public-service-file" className="text-sm font-semibold text-[#536c83]">
                    Planilla de servicio público
                  </label>

                  {form.public_service_file && !form.public_service_upload && (
                    <div
                      className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                        form.remove_public_service_file ? 'bg-[var(--color-danger-bg)]' : 'bg-navy-50/70'
                      }`}
                    >
                      <FileText className="size-4 shrink-0 text-navy-500" aria-hidden="true" />
                      <span
                        className={`min-w-0 flex-1 truncate ${form.remove_public_service_file ? 'line-through text-ink-soft' : ''}`}
                      >
                        {form.public_service_file_name || 'Planilla cargada'}
                      </span>
                      {form.remove_public_service_file ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRemoveFile(false)}>
                          Deshacer
                        </Button>
                      ) : (
                        <>
                          <Button type="button" size="sm" variant="ghost" onClick={() => openDocument(form.public_service_file)}>
                            Ver
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-bg)]"
                            onClick={() => setRemoveFile(true)}
                          >
                            <Trash2 />
                            Quitar
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  {form.public_service_upload && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-navy-50/70 px-3 py-2 text-sm">
                      <FileText className="size-4 shrink-0 text-navy-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">Se subirá: {form.public_service_upload.name}</span>
                      <Button type="button" size="sm" variant="ghost" onClick={discardUpload}>
                        Descartar
                      </Button>
                    </div>
                  )}

                  <input
                    key={fileInputKey}
                    id="public-service-file"
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    onChange={selectUpload}
                    className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy-600 hover:file:bg-navy-100"
                  />
                  <span className="text-xs text-ink-soft">
                    {form.remove_public_service_file
                      ? 'La planilla se eliminará al guardar. Puedes elegir otro archivo para reemplazarla.'
                      : form.public_service_file
                        ? 'Elige otro archivo para reemplazarla. PDF o imagen, hasta 10 MB.'
                        : 'PDF o imagen, hasta 10 MB.'}
                  </span>
                </div>
              )}
              {form.service_type !== 'Publico' && form.public_service_file && (
                <p className="text-xs text-gold-700 sm:col-span-2">
                  Al guardar como particular se eliminará la planilla de servicio público cargada.
                </p>
              )}
              <Input
                label="Placa"
                required
                value={form.plate}
                onChange={update('plate')}
                placeholder="ABC123"
                hint="Se guarda en mayúsculas y sin espacios."
              />
              <Select
                label="Tipo de vehículo"
                required
                value={form.vehicle_type}
                onChange={update('vehicle_type')}
                options={VEHICLE_TYPES.map((type) => ({ value: type, label: label(type) }))}
              />
              <Input label="Marca" required value={form.brand} onChange={update('brand')} placeholder="Chevrolet" />
              <Input
                label="Año del vehículo"
                type="number"
                min="1950"
                max="2100"
                value={form.model_year}
                onChange={update('model_year')}
                placeholder="2018"
              />
              <Input label="Color" value={form.color} onChange={update('color')} placeholder="Blanco" />
              <Input
                label="Capacidad de pasajeros"
                type="number"
                min="1"
                required
                value={form.capacity}
                onChange={update('capacity')}
              />
              <Input
                label="Kilometraje actual"
                type="number"
                min="0"
                required
                value={form.odometer_km}
                onChange={update('odometer_km')}
              />
              <Input
                label="Kilometraje del próximo mantenimiento"
                type="number"
                min="1"
                required
                value={form.next_service_km}
                onChange={update('next_service_km')}
              />
              <Input
                label="Fecha de la próxima revisión"
                type="date"
                required
                value={form.next_service_date}
                onChange={update('next_service_date')}
              />
              <Select
                label="Estado"
                value={form.status}
                onChange={update('status')}
                options={VEHICLE_STATUSES.map((status) => ({ value: status, label: status }))}
              />
              <Select
                label="Conductor a cargo"
                value={form.driver_id}
                onChange={update('driver_id')}
                placeholder="Sin conductor asignado"
                hint={driverHint}
                options={driverOptions}
                className="sm:col-span-2"
              />
            </>
          )}

          {modal === 'trip' && (
            <>
              <Select label="Vehículo" required value={form.vehicle_id} onChange={update('vehicle_id')} placeholder="Seleccionar…" options={vehicleOptions} />
              <Select
                label="Conductor"
                required
                value={form.driver_id}
                onChange={update('driver_id')}
                placeholder="Seleccionar…"
                hint={driverHint}
                options={tripDriverOptions}
              />
              <Input label="Ciudad de destino" required value={form.destination_city} onChange={update('destination_city')} />
              <div className="hidden sm:block" />
              <Input label="Salida" type="datetime-local" required value={form.starts_at} onChange={update('starts_at')} />
              <Input label="Regreso previsto" type="datetime-local" required value={form.ends_at} onChange={update('ends_at')} />
            </>
          )}

          {modal === 'close' && (
            <>
              <Input label="Odómetro (km)" type="number" min="0" required value={form.return_km} onChange={update('return_km')} />
              <Input label="Ciudad al devolver" required value={form.return_city} onChange={update('return_city')} />
            </>
          )}

          {modal === 'fuel' && (
            <>
              <Select label="Vehículo" required value={form.vehicle_id} onChange={update('vehicle_id')} placeholder="Seleccionar…" options={vehicleOptions} className="sm:col-span-2" />
              <Input label="Combustible (litros)" type="number" min="0.01" step="0.01" required value={form.liters} onChange={update('liters')} />
              <Input label="Valor pagado (COP)" type="number" min="1" required value={form.amount_cop} onChange={update('amount_cop')} />
              <Input label="Odómetro (km)" type="number" min="0" required value={form.odometer_km} onChange={update('odometer_km')} className="sm:col-span-2" />
            </>
          )}

          {modal === 'maintenance' && (
            <>
              <Select label="Vehículo" required value={form.vehicle_id} onChange={update('vehicle_id')} placeholder="Seleccionar…" options={vehicleOptions} className="sm:col-span-2" />
              <Input label="Trabajo realizado / novedad" required value={form.detail} onChange={update('detail')} className="sm:col-span-2" />
              <Input label="Costo (COP)" type="number" min="0" value={form.cost_cop} onChange={update('cost_cop')} />
              <Select
                label="Estado del vehículo"
                value={form.status}
                onChange={update('status')}
                options={VEHICLE_STATUSES.map((status) => ({ value: status, label: status }))}
              />
              <Input label="Próxima revisión" type="date" required min={addDays(todayISO(), 1)} value={form.next_service_date} onChange={update('next_service_date')} />
              <Input label="Próxima revisión (km)" type="number" min="1" required value={form.next_service_km} onChange={update('next_service_km')} />
            </>
          )}
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={actions.deleteVehicle.isPending}
        confirmLabel="Eliminar vehículo"
        title={deleting ? `Eliminar ${deleting.brand} ${label(deleting.vehicle_type)}` : ''}
        description={
          deleting
            ? `Placa ${deleting.plate}. Si tiene recorridos registrados, el servidor lo impedirá para conservar el historial.`
            : ''
        }
      />
    </>
  )
}
