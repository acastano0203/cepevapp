import { BookOpen, GraduationCap } from 'lucide-react'

/**
 * Configuración por tipo de persona.
 *
 * Todo el módulo de registro (formulario + grilla + borrado) es genérico:
 * para dar de alta un tipo nuevo basta con agregar una entrada aquí y una
 * ruta que renderice <PeopleRegistry kind="..." />.
 */
export const REGISTRY_CONFIG = {
  Colportor: {
    kind: 'Colportor',
    singular: 'colportor',
    plural: 'colportores',
    articleOne: 'un colportor',
    title: 'Registro de colportores',
    icon: BookOpen,
    // Campos propios de este tipo
    showTeam: true,
    showGoal: true,
    showResults: true,
    showBed: false,
    defaultGoal: 10,
    goalLabel: 'Meta diaria (libros)',
    metrics: {
      totalLabel: 'Colportores registrados',
      extraLabel: 'Meta diaria del equipo',
      extraDetail: 'Suma de metas de los activos',
    },
  },

  Cepevista: {
    kind: 'Cepevista',
    singular: 'cepevista',
    plural: 'cepevistas',
    articleOne: 'un cepevista',
    title: 'Registro de cepevistas',
    icon: GraduationCap,
    showTeam: false,
    showGoal: false,
    showResults: false,
    showBed: true,
    defaultGoal: 0,
    metrics: {
      totalLabel: 'Cepevistas registrados',
      extraLabel: 'Con alojamiento',
      extraDetail: 'Cama asignada actualmente',
    },
  },
}

export const getRegistryConfig = (kind) => REGISTRY_CONFIG[kind] ?? REGISTRY_CONFIG.Colportor
