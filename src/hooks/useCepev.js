import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { colporteurApi, dashboardApi, fleetApi, kitchenApi, lodgingApi, peopleApi } from '@/lib/api'
import { addDays, todayISO } from '@/lib/utils'

/** Claves de cache centralizadas: evita invalidaciones dispersas. */
export const qk = {
  dashboard: ['dashboard'],
  audit: ['audit'],
  people: (filters) => ['people', filters ?? {}],
  teams: ['teams'],
  kitchenDay: (date) => ['kitchen', 'day', date],
  kitchenWeek: (date) => ['kitchen', 'week', date],
  beds: ['lodging', 'beds'],
  stays: ['lodging', 'stays'],
  arrivals: ['lodging', 'arrivals'],
  checkouts: ['lodging', 'checkouts'],
  vehicles: ['fleet', 'vehicles'],
  trips: ['fleet', 'trips'],
  fuel: ['fleet', 'fuel'],
  maintenance: ['fleet', 'maintenance'],
  progress: ['colporteurs', 'progress'],
  registry: (kind) => ['people', 'registry', kind],
  sales: (from, to) => ['colporteurs', 'sales', from, to],
  rotations: ['colporteurs', 'rotations'],
}

/* ---------------------------------------------------------------------------
 * Helper de mutaciones: toast de exito/error + invalidacion declarativa
 * ------------------------------------------------------------------------ */
function useAppMutation(mutationFn, { success, invalidate = [], onDone } = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      const keys = [...invalidate, qk.dashboard, qk.audit]
      keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }))
      if (success) toast.success(typeof success === 'function' ? success(data, variables) : success)
      onDone?.(data, variables)
    },
    onError: (error) => toast.error(error.message),
  })
}

/* ===========================================================================
 * Inicio
 * ======================================================================== */
export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: dashboardApi.counters })

export const useAudit = (limit = 8) =>
  useQuery({ queryKey: qk.audit, queryFn: () => dashboardApi.audit(limit) })

/* ===========================================================================
 * Personas
 * ======================================================================== */
export const usePeople = (filters) =>
  useQuery({ queryKey: qk.people(filters), queryFn: () => peopleApi.list(filters) })

export const useTeams = () => useQuery({ queryKey: qk.teams, queryFn: peopleApi.teams })

const PEOPLE_KEYS = [['people'], ['colporteurs'], qk.progress, qk.arrivals]

export const useSavePerson = () =>
  useAppMutation(peopleApi.upsert, {
    success: (_data, variables) => (variables.id ? 'Ficha actualizada' : 'Ficha registrada'),
    invalidate: PEOPLE_KEYS,
  })

export const useDeletePerson = () =>
  useAppMutation(peopleApi.remove, {
    success: 'Registro eliminado',
    invalidate: PEOPLE_KEYS,
  })

export const useSetAvailability = () =>
  useAppMutation(peopleApi.setAvailability, {
    success: (data) => (data?.is_available ? 'Ficha reactivada' : 'Ficha desactivada'),
    invalidate: PEOPLE_KEYS,
  })

/* ===========================================================================
 * Cocina
 * ======================================================================== */
export const useKitchenDay = (date) =>
  useQuery({ queryKey: qk.kitchenDay(date), queryFn: () => kitchenApi.day(date), enabled: Boolean(date) })

export const useKitchenWeek = (startDate = todayISO()) =>
  useQuery({
    queryKey: qk.kitchenWeek(startDate),
    queryFn: () => kitchenApi.week(startDate),
    select: (rows) => {
      const map = new Map()
      for (let i = 0; i < 7; i += 1) {
        const date = addDays(startDate, i)
        map.set(date, { date, total: 0, filled: 0, published: false })
      }
      rows.forEach((row) => {
        const entry = map.get(row.service_date)
        if (!entry) return
        entry.total += 1
        if (row.person_id) entry.filled += 1
        entry.published = entry.published || row.is_published
      })
      return [...map.values()]
    },
  })

export const useKitchenActions = (date) => {
  const invalidate = [['kitchen']]
  return {
    autofill: useAppMutation(() => kitchenApi.autofill(date), {
      success: (count) => `Propuesta generada: ${count} puestos asignados`,
      invalidate,
    }),
    publish: useAppMutation(() => kitchenApi.publish(date), {
      success: 'Calendario de cocina publicado',
      invalidate,
    }),
    assign: useAppMutation(kitchenApi.assign, {
      success: 'Turno actualizado',
      invalidate,
    }),
    ensureDay: useAppMutation(() => kitchenApi.ensureDay(date), {
      success: 'Puestos del día creados',
      invalidate,
    }),
  }
}

/* ===========================================================================
 * Alojamientos
 * ======================================================================== */
export const useBeds = () => useQuery({ queryKey: qk.beds, queryFn: lodgingApi.beds })
export const useStays = () => useQuery({ queryKey: qk.stays, queryFn: () => lodgingApi.stays() })
export const useArrivals = () => useQuery({ queryKey: qk.arrivals, queryFn: lodgingApi.arrivalsWithoutBed })
export const usePendingCheckouts = () =>
  useQuery({ queryKey: qk.checkouts, queryFn: lodgingApi.pendingCheckouts })

const LODGING_KEYS = [qk.beds, qk.stays, qk.arrivals, qk.checkouts]

export const useLodgingActions = () => ({
  createStay: useAppMutation(lodgingApi.createStay, {
    success: 'Cama reservada',
    invalidate: LODGING_KEYS,
  }),
  checkIn: useAppMutation(lodgingApi.checkIn, {
    success: 'Ingreso confirmado',
    invalidate: LODGING_KEYS,
  }),
  checkOut: useAppMutation(lodgingApi.checkOut, {
    success: 'Salida confirmada, cama liberada',
    invalidate: LODGING_KEYS,
  }),
})

/* ===========================================================================
 * Flota
 * ======================================================================== */
export const useVehicles = () => useQuery({ queryKey: qk.vehicles, queryFn: fleetApi.vehicles })
export const useTrips = () => useQuery({ queryKey: qk.trips, queryFn: () => fleetApi.trips() })
export const useFuelLogs = () => useQuery({ queryKey: qk.fuel, queryFn: () => fleetApi.fuel() })
export const useMaintenanceLogs = () =>
  useQuery({ queryKey: qk.maintenance, queryFn: () => fleetApi.maintenance() })

const FLEET_KEYS = [qk.vehicles, qk.trips, qk.fuel, qk.maintenance]

export const useFleetActions = () => ({
  createTrip: useAppMutation(fleetApi.createTrip, {
    success: 'Vehículo y conductor reservados',
    invalidate: FLEET_KEYS,
  }),
  closeTrip: useAppMutation(fleetApi.closeTrip, {
    success: 'Devolución registrada',
    invalidate: FLEET_KEYS,
  }),
  registerFuel: useAppMutation(fleetApi.registerFuel, {
    success: 'Carga de combustible registrada',
    invalidate: FLEET_KEYS,
  }),
  registerMaintenance: useAppMutation(fleetApi.registerMaintenance, {
    success: 'Hoja de vida actualizada',
    invalidate: FLEET_KEYS,
  }),
})

/* ===========================================================================
 * Colportaje
 * ======================================================================== */
export const useColporteurProgress = () =>
  useQuery({ queryKey: qk.progress, queryFn: colporteurApi.progress })

export const usePeopleRegistry = (kind) =>
  useQuery({ queryKey: qk.registry(kind), queryFn: () => peopleApi.registry(kind) })

export const useSales = (from, to) =>
  useQuery({ queryKey: qk.sales(from, to), queryFn: () => colporteurApi.salesRange(from, to) })

export const useRotations = () =>
  useQuery({ queryKey: qk.rotations, queryFn: colporteurApi.rotations })

const COLPORTEUR_KEYS = [qk.progress, ['colporteurs'], qk.rotations]

export const useColporteurActions = () => ({
  registerSale: useAppMutation(colporteurApi.registerSale, {
    success: 'Reporte diario registrado',
    invalidate: COLPORTEUR_KEYS,
  }),
  correctSale: useAppMutation(colporteurApi.correctSale, {
    success: 'Reporte corregido',
    invalidate: COLPORTEUR_KEYS,
  }),
  createRotation: useAppMutation(colporteurApi.createRotation, {
    success: 'Rotación programada',
    invalidate: COLPORTEUR_KEYS,
  }),
})
