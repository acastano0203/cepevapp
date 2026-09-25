import { supabase, runQuery } from './supabase'
import { addDays, todayISO } from './utils'

/* ===========================================================================
 * Panel de inicio
 * ======================================================================== */
export const dashboardApi = {
  counters: () => runQuery(supabase.from('v_dashboard').select('*').maybeSingle()),

  audit: (limit = 8) =>
    runQuery(
      supabase
        .from('audit_log')
        .select('id, occurred_at, actor_name, action, summary')
        .order('occurred_at', { ascending: false })
        .limit(limit),
    ),
}

/* ===========================================================================
 * Personas y equipos
 * ======================================================================== */
export const peopleApi = {
  list: (filters = {}) => {
    let query = supabase
      .from('people')
      .select('id, full_name, sex, birth_date, phone, base_city, kind, team_id, daily_goal, is_available, teams(name)')
      .order('full_name')

    if (filters.kind) query = query.eq('kind', filters.kind)
    if (filters.kinds?.length) query = query.in('kind', filters.kinds)
    if (filters.available) query = query.eq('is_available', true)
    return runQuery(query)
  },

  teams: () => runQuery(supabase.from('teams').select('id, name').eq('is_active', true).order('name')),

  /** Grilla de registro: sirve para cualquier tipo de persona. */
  registry: (kind) =>
    runQuery(
      supabase.from('v_people_registry').select('*').eq('kind', kind).order('full_name'),
    ),

  upsert: (payload) =>
    runQuery(
      supabase.rpc('person_upsert', {
        p_id: payload.id ?? null,
        p_full_name: payload.full_name,
        p_sex: payload.sex,
        p_birth_date: payload.birth_date,
        p_phone: payload.phone ?? null,
        p_base_city: payload.base_city ?? 'Piedecuesta',
        p_kind: payload.kind,
        p_team: payload.team_id || null,
        p_goal: Number(payload.daily_goal ?? 0),
        p_available: payload.is_available ?? true,
        p_notes: payload.notes ?? null,
        p_document_type: payload.document_type || null,
        p_document_id: payload.document_id || null,
        p_email: payload.email || null,
      }),
    ),

  remove: ({ id, force = false }) =>
    runQuery(supabase.rpc('person_delete', { p_id: id, p_force: force })),

  setAvailability: ({ id, available }) =>
    runQuery(supabase.rpc('person_set_availability', { p_id: id, p_available: available })),
}

/* ===========================================================================
 * Cocina
 * ======================================================================== */
export const kitchenApi = {
  day: (date) =>
    runQuery(
      supabase
        .from('v_kitchen_shifts')
        .select('*')
        .eq('service_date', date)
        .order('meal')
        .order('task')
        .order('position_index'),
    ),

  week: (startDate) =>
    runQuery(
      supabase
        .from('v_kitchen_shifts')
        .select('service_date, person_id, is_published')
        .gte('service_date', startDate)
        .lte('service_date', addDays(startDate, 6)),
    ),

  /** Cupo de servidores (minimo y maximo) de cada comida. */
  limits: () =>
    runQuery(supabase.from('kitchen_meal_limits').select('meal, min_people, max_people')),

  setLimits: ({ meal, min, max }) =>
    runQuery(supabase.rpc('kitchen_set_limits', { p_meal: meal, p_min: min, p_max: max })),

  /** La propuesta completa cada comida hasta su minimo de servidores. */
  autofill: (date) => runQuery(supabase.rpc('kitchen_autofill', { p_date: date })),
  publish: (date) => runQuery(supabase.rpc('kitchen_publish', { p_date: date })),

  /** Suma una persona a la grilla de una comida. Los puestos no tienen tope. */
  add: ({ date, meal, task, personId }) =>
    runQuery(
      supabase.rpc('kitchen_add', {
        p_date: date,
        p_meal: meal,
        p_task: task,
        p_person: personId,
      }),
    ),

  /**
   * Suma varias personas a la misma comida y tarea. Sigue con las demás si el
   * servidor rechaza a alguna, y devuelve quiénes entraron y quiénes no.
   */
  addMany: async ({ date, meal, task, people }) => {
    const added = []
    const failed = []
    for (const person of people) {
      try {
        await kitchenApi.add({ date, meal, task, personId: person.id })
        added.push(person)
      } catch (error) {
        failed.push({ person, message: error.message })
      }
    }
    if (!added.length && failed.length) {
      throw new Error(failed.map((f) => `${f.person.full_name}: ${f.message}`).join(' · '))
    }
    return { meal, added, failed }
  },

  /** Quita de la grilla los puestos seleccionados. */
  remove: async ({ shiftIds }) => {
    const ids = Array.isArray(shiftIds) ? shiftIds : [shiftIds]
    for (const id of ids) {
      await runQuery(supabase.rpc('kitchen_remove', { p_shift: id }))
    }
    return ids.length
  },
}

/* ===========================================================================
 * Alojamientos
 * ======================================================================== */
export const lodgingApi = {
  beds: () =>
    runQuery(
      supabase
        .from('v_beds_status')
        .select('*')
        .order('room_code')
        .order('bed_label'),
    ),

  stays: (limit = 30) =>
    runQuery(
      supabase
        .from('stays')
        .select('id, start_date, end_date, status, checked_in_at, people(id, full_name), stay_children(full_name, age), beds(label, rooms!room_id(code))')
        .order('created_at', { ascending: false })
        .limit(limit),
    ),

  /** Reservas y estadías vigentes: sirven para saber qué camas están libres en unas fechas. */
  activeStays: () =>
    runQuery(
      supabase.from('stays').select('id, bed_id, person_id, start_date, end_date, stay_children(full_name, age)').in('status', ['Reservado', 'Alojado']),
    ),

  pendingCheckouts: () =>
    runQuery(
      supabase
        .from('stays')
        .select('id, start_date, end_date, status, people(id, full_name), stay_children(full_name, age), beds(label, rooms!room_id(code))')
        .eq('status', 'Alojado')
        .lte('end_date', todayISO())
        .order('end_date'),
    ),

  arrivalsWithoutBed: async () => {
    const people = await runQuery(
      supabase.from('people').select('id, full_name, sex, birth_date, kind').eq('kind', 'Llegada').order('full_name'),
    )
    const active = await runQuery(
      supabase.from('stays').select('person_id').in('status', ['Reservado', 'Alojado']),
    )
    const busy = new Set(active.map((row) => row.person_id))
    return people.filter((person) => !busy.has(person.id))
  },

  createStay: (payload) =>
    runQuery(
      supabase.rpc('stay_create', {
        p_person: payload.person_id,
        p_bed: payload.bed_id,
        p_start: payload.start_date,
        p_end: payload.end_date,
        p_notes: payload.notes ?? null,
        // Niños de 5 años o menos que duermen en la misma cama del adulto
        p_children: payload.has_children ? payload.children.map((child) => ({ full_name: child.full_name.trim(), age: Number(child.age) })) : null,
      }),
    ),

  checkIn: (stayId) => runQuery(supabase.rpc('stay_check_in', { p_stay: stayId })),
  checkOut: (stayId) => runQuery(supabase.rpc('stay_check_out', { p_stay: stayId })),

  /** Crea o edita un dormitorio; el servidor ajusta sus camas al número pedido. */
  saveRoom: (payload) =>
    runQuery(
      supabase.rpc('room_upsert', {
        p_id: payload.id ?? null,
        p_code: payload.code,
        p_sex: payload.sex,
        p_bunks: Number(payload.bunks),
        p_captain: payload.captain_id || null,
        p_captain_phone: payload.captain_phone,
        p_captain_bed: payload.captain_bed || '01',
        // Solo cuenta al cambiar de capitán: si el anterior se queda y en qué cama
        p_old_captain_stays: Boolean(payload.old_captain_stays),
        p_old_captain_bed: payload.old_captain_stays ? payload.old_captain_bed || null : null,
        p_old_captain_end: payload.old_captain_stays ? payload.old_captain_end || null : null,
      }),
    ),

  /** Novedades de los dormitorios (mantenimiento, quejas…), las más recientes primero. */
  roomIssues: () =>
    runQuery(
      supabase
        .from('room_issues')
        .select('id, room_id, category, priority, detail, status, reported_by_name, resolution, resolved_at, resolved_by_name, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
    ),

  createRoomIssue: (payload) =>
    runQuery(
      supabase.rpc('room_issue_create', {
        p_room: payload.room_id,
        p_category: payload.category,
        p_detail: payload.detail,
        p_priority: payload.priority,
      }),
    ),

  resolveRoomIssue: ({ id, resolution }) =>
    runQuery(supabase.rpc('room_issue_resolve', { p_issue: id, p_resolution: resolution || null })),

  reopenRoomIssue: (id) => runQuery(supabase.rpc('room_issue_reopen', { p_issue: id })),

  deleteRoom: ({ id, force = false }) => runQuery(supabase.rpc('room_delete', { p_id: id, p_force: force })),
}

/* ===========================================================================
 * Flota
 * ======================================================================== */
export const fleetApi = {
  vehicles: () => runQuery(supabase.from('v_fleet_status').select('*').order('name')),

  trips: (limit = 25) =>
    runQuery(
      supabase
        .from('trips')
        .select('id, destination_city, starts_at, ends_at, status, return_km, vehicles(id, name, odometer_km), people(id, full_name)')
        .order('starts_at', { ascending: false })
        .limit(limit),
    ),

  fuel: (limit = 12) =>
    runQuery(
      supabase
        .from('fuel_logs')
        .select('id, log_date, liters, amount_cop, odometer_km, vehicles(name)')
        .order('log_date', { ascending: false })
        .limit(limit),
    ),

  maintenance: (limit = 12) =>
    runQuery(
      supabase
        .from('maintenance_logs')
        .select('id, log_date, detail, cost_cop, vehicles(name)')
        .order('log_date', { ascending: false })
        .limit(limit),
    ),

  /** Alta y edicion de la ficha del vehiculo. Sin id, crea. */
  saveVehicle: (payload) =>
    runQuery(
      supabase.rpc('vehicle_upsert', {
        p_id: payload.id || null,
        p_plate: payload.plate,
        p_type: payload.vehicle_type,
        p_brand: payload.brand,
        p_year: payload.model_year ? Number(payload.model_year) : null,
        p_color: payload.color || null,
        p_capacity: Number(payload.capacity),
        p_odometer: Number(payload.odometer_km ?? 0),
        p_next_km: Number(payload.next_service_km),
        p_next_date: payload.next_service_date || null,
        p_status: payload.status,
        p_driver: payload.driver_id || null,
      }),
    ),

  deleteVehicle: ({ id, force = false }) =>
    runQuery(supabase.rpc('vehicle_delete', { p_id: id, p_force: force })),

  createTrip: (payload) =>
    runQuery(
      supabase.rpc('trip_create', {
        p_vehicle: payload.vehicle_id,
        p_driver: payload.driver_id,
        p_city: payload.destination_city,
        p_start: new Date(payload.starts_at).toISOString(),
        p_end: new Date(payload.ends_at).toISOString(),
      }),
    ),

  closeTrip: (payload) =>
    runQuery(
      supabase.rpc('trip_close', {
        p_trip: payload.id,
        p_km: Number(payload.return_km),
        p_city: payload.return_city,
      }),
    ),

  registerFuel: (payload) =>
    runQuery(
      supabase.rpc('fuel_register', {
        p_vehicle: payload.vehicle_id,
        p_liters: Number(payload.liters),
        p_amount: Number(payload.amount_cop),
        p_km: Number(payload.odometer_km),
        p_date: payload.log_date ?? null,
      }),
    ),

  registerMaintenance: (payload) =>
    runQuery(
      supabase.rpc('maintenance_register', {
        p_vehicle: payload.vehicle_id,
        p_detail: payload.detail,
        p_cost: Number(payload.cost_cop ?? 0),
        p_status: payload.status,
        p_next_date: payload.next_service_date,
        p_next_km: Number(payload.next_service_km),
      }),
    ),
}

/* ===========================================================================
 * Colportaje
 * ======================================================================== */
export const colporteurApi = {
  progress: () => runQuery(supabase.from('v_colporteur_progress').select('*').order('full_name')),

  salesRange: (from, to) =>
    runQuery(
      supabase
        .from('sales_reports')
        .select('id, person_id, report_date, books_sold, city, people(full_name), teams(name)')
        .gte('report_date', from)
        .lte('report_date', to)
        .order('report_date', { ascending: false }),
    ),

  rotations: () =>
    runQuery(
      supabase
        .from('rotations')
        .select('id, city, start_date, end_date, teams(id, name)')
        .order('start_date'),
    ),

  registerSale: (payload) =>
    runQuery(
      supabase.rpc('sale_register', {
        p_person: payload.person_id,
        p_date: payload.report_date,
        p_books: Number(payload.books_sold),
      }),
    ),

  correctSale: (payload) =>
    runQuery(
      supabase.rpc('sale_correct', {
        p_sale: payload.id,
        p_books: Number(payload.books_sold),
        p_reason: payload.reason,
      }),
    ),

  createRotation: (payload) =>
    runQuery(
      supabase.rpc('rotation_create', {
        p_team: payload.team_id,
        p_city: payload.city,
        p_start: payload.start_date,
        p_end: payload.end_date,
      }),
    ),
}
