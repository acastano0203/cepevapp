import { BedDouble, BookOpen, Bus, GraduationCap, House, UtensilsCrossed } from 'lucide-react'

/** Menu lateral. Agregar un modulo = agregar una entrada aqui + su ruta. */
export const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: House, description: 'Una mirada a la operacion del centro' },
  { to: '/cocina', label: 'Cocina', icon: UtensilsCrossed, description: 'Personas y turnos para cada comida' },
  { to: '/vehiculos', label: 'Vehiculos', icon: Bus, description: 'Disponibilidad, recorridos y cuidado de la flota' },
  { to: '/alojamientos', label: 'Alojamientos', icon: BedDouble, description: 'Cada persona, en el lugar adecuado' },
  { to: '/colportores', label: 'Colportores', icon: BookOpen, description: 'Equipos, ciudades y resultados diarios' },
  { to: '/cepevistas', label: 'Cepevistas', icon: GraduationCap, description: 'Fichas de los participantes del centro' },
]

/** Etiquetas con tilde para los valores del enum (la base los guarda sin tilde). */
export const LABELS = {
  Logistica: 'Logística',
  Preparacion: 'Preparación',
  Administrativo: 'Administrativo',
  Conductor: 'Conductor',
  Colportor: 'Colportor',
  Residente: 'Residente',
  Llegada: 'Llegada',
  Comedor: 'Comedor',
  Desayuno: 'Desayuno',
  Almuerzo: 'Almuerzo',
  Cena: 'Cena',
}

export const label = (value) => LABELS[value] ?? value ?? '—'

export const MEALS = ['Desayuno', 'Almuerzo', 'Cena']
export const TASKS = ['Preparacion', 'Comedor']

export const MEAL_WINDOW = {
  Desayuno: '05:00 – 08:00',
  Almuerzo: '10:00 – 14:00',
  Cena: '16:00 – 20:00',
}

export const PERSON_KINDS = [
  'Residente',
  'Logistica',
  'Conductor',
  'Colportor',
  'Llegada',
  'Administrativo',
  'Cepevista',
]

export const KITCHEN_ELIGIBLE_KINDS = ['Logistica', 'Conductor', 'Administrativo']

export const SEX_GROUPS = ['Mujeres', 'Hombres']

export const VEHICLE_STATUSES = ['Disponible', 'Mantenimiento', 'Fuera de servicio']

export const ROLE_LABELS = {
  admin: 'Administrador',
  coordinador: 'Coordinación',
  consulta: 'Consulta · Solo lectura',
}

export const HOME_CITY = 'Piedecuesta'
