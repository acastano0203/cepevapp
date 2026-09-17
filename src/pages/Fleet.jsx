import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bus, Fuel, MapPin, Plus, Users, Wrench } from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { VEHICLE_STATUSES } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, formatCurrency, formatDate, formatDateTime, formatNumber, todayISO } from '@/lib/utils'

const emptyForms = {
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
  const driversQuery = usePeople({ kind: 'Conductor', available: true })
  const actions = useFleetActions()

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})

  const view = searchParams.get('vista') ?? ''
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data])

  const stats = useMemo(
    () => ({
      available: vehicles.filter((v) => v.status === 'Disponible' && !v.busy_today).length,
      due: vehicles.filter((v) => v.service_due).length,
      blocked: vehicles.filter((v) => v.status !== 'Disponible').length,
      trips: (tripsQuery.data ?? []).filter((t) => t.status === 'Reservado' || t.status === 'En ruta').length,
    }),
    [vehicles, tripsQuery.data],
  )

  const visibleVehicles = useMemo(() => {
    if (view === 'disponibles') return vehicles.filter((v) => v.status === 'Disponible' && !v.busy_today)
    if (view === 'mantenimiento') return vehicles.filter((v) => v.service_due)
    if (view === 'bloqueados') return vehicles.filter((v) => v.status !== 'Disponible')
    return vehicles
  }, [vehicles, view])

  const setView = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('vista', next)
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }

  const openModal = (type, values = {}) => {
    setForm({ ...emptyForms[type], ...values })
    setModal(type)
  }

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const closeModal = () => setModal(null)

  const mutationByModal = {
    trip: actions.createTrip,
    close: actions.closeTrip,
    fuel: actions.registerFuel,
    maintenance: actions.registerMaintenance,
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    mutationByModal[modal].mutate(form, { onSuccess: closeModal })
  }

  const vehicleOptions = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.name} · ${vehicle.status}`,
  }))

  const titles = {
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
          <Button onClick={() => openModal('trip', { starts_at: `${todayISO()}T08:00`, ends_at: `${todayISO()}T17:00` })}>
            <Plus />
            Reservar vehículo
          </Button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Disponibles hoy" value={stats.available} detail="Sin reservas durante el día" tone="green" onClick={() => setView('disponibles')} />
        <KpiCard label="Reservas activas" value={stats.trips} detail="Vehículo y conductor asignados" onClick={() => setView('')} />
        <KpiCard label="Mantenimientos próximos" value={stats.due} detail="7 días o kilometraje alcanzado" tone="gold" onClick={() => setView('mantenimiento')} />
        <KpiCard label="No disponibles" value={stats.blocked} detail="Mantenimiento o fuera de servicio" tone="red" onClick={() => setView('bloqueados')} />
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
            <article key={vehicle.id} className="surface p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-xl bg-navy-50 p-3 text-navy-600">
                  <Bus className="size-6" aria-hidden="true" />
                </span>
                <Badge tone={vehicle.status === 'Disponible' ? 'green' : 'gold'}>{vehicle.status}</Badge>
              </div>
              <h2 className="text-lg font-semibold text-ink">{vehicle.name}</h2>
              <span className="mt-1 mb-3 inline-block rounded border border-[#ccd6df] px-1.5 py-0.5 text-[11px] tracking-widest">
                {vehicle.plate}
              </span>
              <div className="mb-4 flex flex-wrap gap-3 text-xs text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {vehicle.current_city}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  {vehicle.capacity} pasajeros
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-[#edf1f5] pt-4">
                <div>
                  <small className="block text-[11px] text-ink-soft">Odómetro</small>
                  <strong className="text-base">{formatNumber(vehicle.odometer_km)} km</strong>
                </div>
                <div>
                  <small className="block text-[11px] text-ink-soft">Próxima revisión</small>
                  <strong className="text-base">{formatDate(vehicle.next_service_date)}</strong>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                O al alcanzar {formatNumber(vehicle.next_service_km)} km
                {vehicle.service_due && <span className="ml-1 font-semibold text-gold-700">· Pendiente</span>}
              </p>
              {canWrite && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
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
                </div>
              )}
            </article>
          ))}
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
          {modal === 'trip' && (
            <>
              <Select label="Vehículo" required value={form.vehicle_id} onChange={update('vehicle_id')} placeholder="Seleccionar…" options={vehicleOptions} />
              <Select
                label="Conductor"
                required
                value={form.driver_id}
                onChange={update('driver_id')}
                placeholder="Seleccionar…"
                options={(driversQuery.data ?? []).map((person) => ({ value: person.id, label: person.full_name }))}
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
    </>
  )
}
