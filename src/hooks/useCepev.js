import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminApi, colporteurManagementApi, colporteurApi, dashboardApi, fleetApi, kitchenApi, laundryApi, lodgingApi, maintenanceApi, paymentsApi, peopleApi } from '@/lib/api'
import { addDays, todayISO } from '@/lib/utils'

/** Claves de cache centralizadas: evita invalidaciones dispersas. */
export const qk = {
  dashboard: ['dashboard'],
  audit: ['audit'],
  people: (filters) => ['people', filters ?? {}],
  teams: ['teams'],
  kitchenDay: (date) => ['kitchen', 'day', date],
  kitchenWeek: (date) => ['kitchen', 'week', date],
  kitchenLimits: ['kitchen', 'limits'],
  beds: ['lodging', 'beds'],
  stays: ['lodging', 'stays'],
  arrivals: ['lodging', 'arrivals'],
  checkouts: ['lodging', 'checkouts'],
  activeStays: ['lodging', 'active-stays'],
  roomIssues: ['lodging', 'room-issues'],
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

export const useFieldRotations = () =>
  useQuery({ queryKey: ['colporteurs', 'field-rotations'], queryFn: () => dashboardApi.fieldRotations() })

export const useActiveTrips = () =>
  useQuery({ queryKey: ['fleet', 'active-trips'], queryFn: () => dashboardApi.activeTrips() })

export const useAudit = (limit = 8) =>
  useQuery({ queryKey: qk.audit, queryFn: () => dashboardApi.audit(limit) })

/* ===========================================================================
 * Personas
 * ======================================================================== */
export const usePeople = (filters) =>
  useQuery({ queryKey: qk.people(filters), queryFn: () => peopleApi.list(filters) })

export const useTeams = () => useQuery({ queryKey: qk.teams, queryFn: peopleApi.teams })

const PEOPLE_KEYS = [['laundry'], ['kitchen'], ['people'], ['colporteurs'], ['payments'], qk.progress, qk.arrivals]

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
        map.set(date, { date, total: 0, published: false })
      }
      rows.forEach((row) => {
        const entry = map.get(row.service_date)
        if (!entry) return
        entry.total += 1
        entry.published = entry.published || row.is_published
      })
      return [...map.values()]
    },
  })

/** Cupo por comida como mapa { Desayuno: { min, max }, ... }. */
export const useKitchenLimits = () =>
  useQuery({
    queryKey: qk.kitchenLimits,
    queryFn: kitchenApi.limits,
    select: (rows) =>
      Object.fromEntries(rows.map((row) => [row.meal, { min: row.min_people, max: row.max_people }])),
  })

export const useKitchenActions = (date) => {
  const invalidate = [['kitchen'], ['laundry']]
  return {
    autofill: useAppMutation(() => kitchenApi.autofill(date), {
      success: (count) => `Propuesta generada: ${count} puestos asignados`,
      invalidate,
    }),
    publish: useAppMutation(() => kitchenApi.publish(date), {
      success: 'Calendario de cocina publicado',
      invalidate,
    }),
    add: useAppMutation(kitchenApi.addMany, {
      success: ({ meal, added }) =>
        `${meal}: ${added.length === 1 ? '1 persona agregada' : `${added.length} personas agregadas`} a la grilla`,
      invalidate,
    }),
    setLimits: useAppMutation(kitchenApi.setLimits, {
      success: (_data, { meal, min, max }) => `${meal}: cupo de ${min} a ${max} servidores`,
      invalidate,
    }),
    remove: useAppMutation(kitchenApi.remove, {
      success: (count) => (count === 1 ? 'Puesto retirado' : `${count} puestos retirados`),
      invalidate,
    }),
  }
}

/* ===========================================================================
 * Alojamientos
 * ======================================================================== */
export const useBeds = () => useQuery({ queryKey: qk.beds, queryFn: lodgingApi.beds })
export const useRoomCaptains = (enabled = true) =>
  useQuery({ queryKey: ['lodging', 'captains'], queryFn: lodgingApi.roomCaptains, enabled })
export const useStays = () => useQuery({ queryKey: qk.stays, queryFn: () => lodgingApi.stays() })
export const useArrivals = () => useQuery({ queryKey: qk.arrivals, queryFn: lodgingApi.arrivalsWithoutBed })
export const useRoomIssues = () => useQuery({ queryKey: qk.roomIssues, queryFn: lodgingApi.roomIssues })
export const useActiveStays = () => useQuery({ queryKey: qk.activeStays, queryFn: lodgingApi.activeStays })
export const usePendingCheckouts = () =>
  useQuery({ queryKey: qk.checkouts, queryFn: lodgingApi.pendingCheckouts })

const LODGING_KEYS = [qk.beds, qk.stays, qk.arrivals, qk.checkouts, qk.activeStays, qk.roomIssues]

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
  saveRoom: useAppMutation(lodgingApi.saveRoom, {
    success: (_data, variables) => (variables.id ? 'Dormitorio actualizado' : 'Dormitorio creado'),
    invalidate: [...LODGING_KEYS, ['lodging', 'captains'], ['people']],
  }),
  createRoomIssue: useAppMutation(lodgingApi.createRoomIssue, {
    success: 'Novedad registrada',
    invalidate: [qk.roomIssues],
  }),
  resolveRoomIssue: useAppMutation(lodgingApi.resolveRoomIssue, {
    success: 'Novedad resuelta',
    invalidate: [qk.roomIssues],
  }),
  reopenRoomIssue: useAppMutation(lodgingApi.reopenRoomIssue, {
    success: 'Novedad reabierta',
    invalidate: [qk.roomIssues],
  }),
  deleteRoom: useAppMutation(lodgingApi.deleteRoom, {
    success: 'Dormitorio eliminado',
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

const FLEET_KEYS = [['laundry'], qk.vehicles, qk.trips, qk.fuel, qk.maintenance, ['fleet', 'active-trips']]

export const useFleetActions = () => ({
  saveVehicle: useAppMutation(fleetApi.saveVehicle, {
    success: (_data, variables) => (variables.id ? 'Ficha del vehículo actualizada' : 'Vehículo registrado'),
    invalidate: FLEET_KEYS,
  }),
  deleteVehicle: useAppMutation(fleetApi.deleteVehicle, {
    success: 'Vehículo eliminado',
    invalidate: FLEET_KEYS,
  }),
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

const COLPORTEUR_KEYS = [['people'], ['teams'], ['kitchen'], ['laundry'], qk.progress, ['colporteurs'], qk.rotations]

export const useColporteurActions = () => ({
  saveTeam: useAppMutation(colporteurManagementApi.saveTeam, {
    success: 'Equipo actualizado', invalidate: COLPORTEUR_KEYS,
  }),
  assignTeam: useAppMutation(colporteurManagementApi.assignTeam, {
    success: 'Asignación actualizada', invalidate: COLPORTEUR_KEYS,
  }),
  saveRotation: useAppMutation(colporteurManagementApi.saveRotation, {
    success: 'Rotación guardada', invalidate: COLPORTEUR_KEYS,
  }),
  cancelRotation: useAppMutation(colporteurManagementApi.cancelRotation, {
    success: 'Rotación cancelada', invalidate: COLPORTEUR_KEYS,
  }),
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

export const useLaundryDay = (date) => useQuery({
  queryKey: ['laundry', 'day', date], queryFn: () => laundryApi.day(date), enabled: Boolean(date),
})

export const useLaundryWeek = (startDate = todayISO()) => useQuery({
  queryKey: ['laundry', 'week', startDate],
  queryFn: () => laundryApi.week(startDate),
  select: (rows) => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDate, i)
    const day = rows.filter((row) => row.service_date === date)
    return { date, total: day.filter((row) => row.machine > 0).length, published: day.some((row) => row.is_published) }
  }),
})

export const useLaundryActions = () => {
  const invalidate = [['laundry'], ['kitchen']]
  return {
    add: useAppMutation(laundryApi.add, { success: 'Lavadora asignada', invalidate }),
    remove: useAppMutation(laundryApi.remove, { success: 'Cupo liberado', invalidate }),
    coordinator: useAppMutation(laundryApi.coordinator, { success: 'Coordinación actualizada', invalidate }),
    autofill: useAppMutation(laundryApi.autofill, {
      success: (count) => `Propuesta generada: ${count} cupos asignados; coordinación manual`, invalidate,
    }),
    publish: useAppMutation(laundryApi.publish, { success: 'Calendario de lavandería publicado', invalidate }),
  }
}

export const useColporteurReports = (from, to, enabled = true) => useQuery({
  queryKey: ['colporteurs', 'reports', from, to],
  queryFn: () => colporteurManagementApi.reports(from, to),
  enabled: enabled && Boolean(from && to),
})

/* ===========================================================================
 * Administración
 * ======================================================================== */
export const useRoleModules = () => useQuery({ queryKey: ['admin', 'role-modules'], queryFn: adminApi.roleModules })
export const useAdminUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users })

export const useAdminActions = () => ({
  setRoleModules: useAppMutation(adminApi.setRoleModules, {
    success: 'Accesos guardados. Se aplican cuando cada usuario vuelva a ingresar o recargue la página.',
    invalidate: [['admin']],
  }),
  createUser: useAppMutation(adminApi.createUser, { success: 'Usuario creado', invalidate: [['admin'], ['lodging', 'captains']] }),
  updateUser: useAppMutation(adminApi.updateUser, { success: 'Usuario actualizado', invalidate: [['admin'], ['lodging', 'captains'], qk.beds, ['people']] }),
  deleteUser: useAppMutation(adminApi.deleteUser, { success: 'Usuario eliminado', invalidate: [['admin'], ['lodging', 'captains']] }),
})

/* ===========================================================================
 * Mantenimiento
 * ======================================================================== */
const MAINTENANCE_KEYS = [['maintenance']]

export const useMaintenanceAreas = () =>
  useQuery({ queryKey: ['maintenance', 'areas'], queryFn: maintenanceApi.areas })

export const useMaintenanceRooms = () =>
  useQuery({ queryKey: ['maintenance', 'rooms'], queryFn: maintenanceApi.rooms })

export const useMaintenanceReports = (enabled = true) =>
  useQuery({ queryKey: ['maintenance', 'reports'], queryFn: maintenanceApi.reports, enabled })

export const useMaintenancePhoto = (path) =>
  useQuery({
    queryKey: ['maintenance', 'photo', path],
    queryFn: () => maintenanceApi.photoUrl(path),
    enabled: Boolean(path),
    staleTime: 5 * 60 * 1000,
  })

export const useMaintenanceActions = () => ({
  create: useAppMutation(maintenanceApi.create, { success: 'Reporte enviado', invalidate: MAINTENANCE_KEYS }),
  update: useAppMutation(maintenanceApi.update, {
    success: (_data, variables) => (variables.status === 'Resuelto' ? 'Reporte resuelto' : 'Reporte actualizado'),
    invalidate: MAINTENANCE_KEYS,
  }),
  saveArea: useAppMutation(maintenanceApi.saveArea, { success: 'Área guardada', invalidate: MAINTENANCE_KEYS }),
})

/* ===========================================================================
 * Pagos
 * ======================================================================== */
const PAYMENT_KEYS = [['payments']]

export const usePaymentSettings = () =>
  useQuery({ queryKey: ['payments', 'settings'], queryFn: paymentsApi.settings })

export const usePaymentServiceTypes = () =>
  useQuery({ queryKey: ['payments', 'service-types'], queryFn: paymentsApi.serviceTypes })

export const usePaymentAccounts = () =>
  useQuery({ queryKey: ['payments', 'accounts'], queryFn: paymentsApi.accounts })

export const usePaymentCharges = (accountId) => useQuery({
  queryKey: ['payments', 'charges', accountId], queryFn: () => paymentsApi.charges(accountId), enabled: Boolean(accountId),
})

export const useAccountPayments = (accountId) => useQuery({
  queryKey: ['payments', 'account-payments', accountId],
  queryFn: () => paymentsApi.accountPayments(accountId),
  enabled: Boolean(accountId),
})

export const useMissingPaymentAccounts = () =>
  useQuery({ queryKey: ['payments', 'missing-accounts'], queryFn: paymentsApi.missingAccounts })

export const usePayments = (from, to) => useQuery({
  queryKey: ['payments', 'list', from, to], queryFn: () => paymentsApi.payments(from, to), enabled: Boolean(from && to),
})

export const usePaymentActions = () => ({
  register: useAppMutation(paymentsApi.register, { success: 'Pago registrado', invalidate: PAYMENT_KEYS }),
  void: useAppMutation(paymentsApi.void, { success: 'Pago anulado', invalidate: PAYMENT_KEYS }),
  saveAccount: useAppMutation(paymentsApi.saveAccount, {
    success: (_data, variables) => (variables.id ? 'Cuenta actualizada' : 'Cuenta abierta'), invalidate: PAYMENT_KEYS,
  }),
  enroll: useAppMutation(paymentsApi.enroll, {
    success: (_data, variables) => (variables.pay_now ? 'Cuenta de pagos abierta y pago registrado' : 'Cuenta de pagos abierta'),
    invalidate: PAYMENT_KEYS,
  }),
  openAccounts: useAppMutation(paymentsApi.openAccounts, {
    success: (count) => (count === 1 ? 'Cuenta abierta' : `${count} cuentas abiertas`),
    invalidate: PAYMENT_KEYS,
  }),
  adjustCharge: useAppMutation(paymentsApi.adjustCharge, { success: 'Cuota ajustada', invalidate: PAYMENT_KEYS }),
  saveSettings: useAppMutation(paymentsApi.saveSettings, { success: 'Criterios guardados', invalidate: PAYMENT_KEYS }),
  saveServiceType: useAppMutation(paymentsApi.saveServiceType, { success: 'Servicio guardado', invalidate: PAYMENT_KEYS }),
})
