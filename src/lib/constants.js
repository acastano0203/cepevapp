import { BedDouble, BookOpen, Bus, GraduationCap, Hammer, House, ShieldCheck, UtensilsCrossed, WalletCards, WashingMachine } from 'lucide-react'

/**
 * Menu lateral. Agregar un modulo = agregar una entrada aqui + su ruta.
 * module = clave de public.role_modules: el administrador decide que perfiles lo ven.
 */
export const NAV_ITEMS = [
  { to: '/', module: 'inicio', label: 'Inicio', icon: House, description: 'Una mirada a la operacion del centro' },
  { to: '/cocina', module: 'cocina', label: 'Cocina', icon: UtensilsCrossed, description: 'Personas y turnos para cada comida' },
  { to: '/lavanderia', module: 'lavanderia', label: 'Lavandería', icon: WashingMachine, description: 'Cuatro lavadoras, dos turnos y coordinación diaria' },
  { to: '/vehiculos', module: 'vehiculos', label: 'Vehiculos', icon: Bus, description: 'Disponibilidad, recorridos y cuidado de la flota' },
  { to: '/alojamientos', module: 'alojamientos', label: 'Alojamientos', icon: BedDouble, description: 'Cada persona, en el lugar adecuado' },
  { to: '/colportores', module: 'colportores', label: 'Colportores', icon: BookOpen, description: 'Equipos, ciudades y resultados diarios' },
  { to: '/cepevistas', module: 'cepevistas', label: 'Cepevistas', icon: GraduationCap, description: 'Fichas de los participantes del centro' },
  { to: '/pagos', module: 'pagos', label: 'Pagos', icon: WalletCards, description: 'Mensualidades, siembras, ofrendas y pagos en especie' },
  { to: '/mantenimiento', module: 'mantenimiento', label: 'Mantenimiento', icon: Hammer, description: 'Daños, reparaciones y mantenimiento de todo el CEPEV' },
  { to: '/administracion', module: 'administracion', label: 'Administración', icon: ShieldCheck, description: 'Usuarios, perfiles y accesos a los módulos' },
]

/** Módulos que se pueden asignar a un perfil (Administración es solo del admin). */
export const ASSIGNABLE_MODULES = NAV_ITEMS.filter((item) => item.module !== 'administracion')

/** Perfiles configurables. El admin siempre ve todo. */
export const ASSIGNABLE_ROLES = ['servidor', 'capitan', 'cepevista']

/**
 * Accesos si la base aún no tiene 27_admin_access.sql: los mismos de la
 * migración 26 (servidor y capitán reportan; cepevista lee la operación).
 */
export const DEFAULT_ROLE_MODULES = {
  servidor: ['mantenimiento'],
  capitan: ['mantenimiento'],
  cepevista: ASSIGNABLE_MODULES.map((item) => item.module).filter((module) => module !== 'mantenimiento'),
}

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
  Microbus: 'Microbús',
  Automovil: 'Automóvil',
  Camion: 'Camión',
  Furgon: 'Furgón',
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

export const KITCHEN_ELIGIBLE_KINDS = ['Cepevista', 'Colportor', 'Logistica', 'Conductor', 'Administrativo']

export const SEX_GROUPS = ['Mujeres', 'Hombres']

/** Clasificación de los colportores. value = lo que guarda public.people. */
export const PERSON_CLASSIFICATIONS = [
  { value: 'Cepevista', label: 'Cepevista' },
  { value: 'Ejercito Celestial', label: 'Ejército Celestial' },
  { value: 'Colportores', label: 'Colportores' },
  { value: 'Adolescentes', label: 'Adolescentes' },
  { value: 'Servidores', label: 'Servidores' },
]

/** En cocina, estos tipos no se mezclan por genero dentro de una misma comida. */
export const KITCHEN_GENDER_KINDS = ['Cepevista', 'Colportor']

export const VEHICLE_STATUSES = ['Disponible', 'Mantenimiento', 'Fuera de servicio']

export const VEHICLE_TYPES = [
  'Bus',
  'Buseta',
  'Microbus',
  'Camioneta',
  'Automovil',
  'Campero',
  'Camion',
  'Furgon',
  'Motocicleta',
]

/** Tipo de servicio. value = lo que guarda public.vehicles.service_type. */
export const VEHICLE_SERVICE_TYPES = [
  { value: 'Particular', label: 'Particular' },
  { value: 'Publico', label: 'Servicio público' },
]

/** Estado de un vencimiento (SOAT, todo riesgo) -> tono del Badge. */
export const DOCUMENT_STATUS_TONES = {
  Vigente: 'green',
  'Por vencer': 'gold',
  Vencido: 'red',
  'Sin registrar': 'neutral',
}

/** De quien es el vehiculo. value = lo que guarda public.vehicles.ownership. */
export const VEHICLE_OWNERSHIPS = [
  { value: 'CEPEV', label: 'Propio del CEPEV' },
  { value: 'Externo', label: 'Externo · cepevista o visitante' },
]

export const ROLE_LABELS = {
  admin: 'Administrador',
  servidor: 'Servidor',
  capitan: 'Capitán',
  cepevista: 'Cepevista',
}

/* ---------------------------------------------------------------------------
 * Mantenimiento. value = lo que guarda la base (sin tilde).
 * ------------------------------------------------------------------------ */
export const MAINTENANCE_TYPES = [
  { value: 'Dano', label: 'Daño' },
  { value: 'Reparacion', label: 'Reparación' },
  { value: 'Mantenimiento', label: 'Mantenimiento' },
  { value: 'Limpieza', label: 'Limpieza' },
]

export const maintenanceTypeLabel = (value) => MAINTENANCE_TYPES.find((item) => item.value === value)?.label ?? value

export const MAINTENANCE_STATUS_TONES = { Abierto: 'red', 'En proceso': 'gold', Resuelto: 'green' }

/** Nombres de áreas con tilde para mostrar (la base las guarda sin tilde). */
export const areaLabel = (name) => ({
  'Banos y duchas': 'Baños y duchas',
  Lavanderia: 'Lavandería',
  'Otra area': 'Otra área',
  Porteria: 'Portería',
  'Red electrica': 'Red eléctrica',
  'Agua y plomeria': 'Agua y plomería',
})[name] ?? name

export const HOME_CITY = 'Piedecuesta'

/* ---------------------------------------------------------------------------
 * Pagos
 * ------------------------------------------------------------------------ */
/**
 * Concepto de pago. value = lo que guarda la base (sin tilde).
 * Cepevistas: mensualidad o por días · Colportores: siembra · Ofrenda: cualquiera.
 */
export const PAYMENT_CONCEPTS = [
  { value: 'Mensualidad', label: 'Mensualidad', hint: 'Cepevistas · por mes' },
  { value: 'Por dias', label: 'Por días', hint: 'Cepevistas · estadía corta' },
  { value: 'Siembra', label: 'Siembra', hint: 'Colportores' },
  { value: 'Ofrenda', label: 'Ofrenda', hint: 'Voluntaria, no abona a la estadía' },
]

export const conceptLabel = (value) => PAYMENT_CONCEPTS.find((item) => item.value === value)?.label ?? value ?? '—'

/** Conceptos de cuenta que admite cada tipo de persona; el primero es el de por defecto. */
export const ACCOUNT_CONCEPTS_BY_KIND = { Cepevista: ['Mensualidad', 'Por dias'], Colportor: ['Siembra'] }

/** Cuenta de pagos por defecto segun el tipo de persona. */
export const PAYMENT_CONCEPT_BY_KIND = { Cepevista: 'Mensualidad', Colportor: 'Siembra' }

/** Tipo de persona que corresponde a un concepto de cuenta. */
export const KIND_BY_CONCEPT = { Mensualidad: 'Cepevista', 'Por dias': 'Cepevista', Siembra: 'Colportor' }

/** Valor configurado para un concepto (por mes o, en «Por días», por día). */
export function conceptDefaultFee(settings, concept) {
  if (concept === 'Mensualidad') return Number(settings?.cepevista_monthly_fee) || 0
  if (concept === 'Por dias') return Number(settings?.cepevista_daily_fee) || 0
  if (concept === 'Siembra') return Number(settings?.colporteur_goal_value) || 0
  return 0
}

/** Etiqueta del valor de la cuota según el concepto. */
export const conceptRateLabel = (concept) =>
  ({ Mensualidad: 'Mensualidad', 'Por dias': 'Valor por día', Siembra: 'Siembra mensual' })[concept] ?? 'Valor'

/** «/ mes» o «/ día» para mostrar junto al valor de una cuenta. */
export const conceptRateUnit = (concept) => (concept === 'Por dias' ? 'día' : 'mes')

export const PAYMENT_METHODS = [
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Transferencia', label: 'Transferencia' },
  { value: 'Especie', label: 'En especie · servicio prestado' },
]

/** Estado de una cuenta -> tono del Badge. 'Al dia' se guarda sin tilde. */
export const PAYMENT_STATUS = {
  'En mora': { label: 'En mora', tone: 'red' },
  'Por vencer': { label: 'Por vencer', tone: 'gold' },
  Pendiente: { label: 'Pendiente', tone: 'navy' },
  'Al dia': { label: 'Al día', tone: 'green' },
  Cerrada: { label: 'Cerrada', tone: 'neutral' },
  'Sin cuenta': { label: 'Sin cuenta', tone: 'neutral' },
}

/** Estado de una cuota -> tono del Badge. */
export const CHARGE_STATUS_TONES = {
  Pagada: 'green',
  Pendiente: 'navy',
  'Por vencer': 'gold',
  Vencida: 'red',
}
