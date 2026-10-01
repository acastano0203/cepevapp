// Keep these windows aligned with supabase/15_laundry.sql (Colombia time).
export const LAUNDRY_MACHINES = [1, 2, 3, 4]
export const LAUNDRY_TURNS = [
  { id: 1, label: 'Turno 1', window: '11:00–13:00' },
  { id: 2, label: 'Turno 2', window: '15:00–17:00' },
]
export const LAUNDRY_CAPACITY = LAUNDRY_MACHINES.length * LAUNDRY_TURNS.length
