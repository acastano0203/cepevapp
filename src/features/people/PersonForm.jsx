import { Save, X } from 'lucide-react'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { SEX_GROUPS } from '@/lib/constants'
import { todayISO } from '@/lib/utils'

export const DOCUMENT_TYPES = [
  { value: 'CC', label: 'CC · Cédula de ciudadanía' },
  { value: 'TI', label: 'TI · Tarjeta de identidad' },
  { value: 'CE', label: 'CE · Cédula de extranjería' },
  { value: 'PA', label: 'PA · Pasaporte' },
]

/** Ficha vacía. Se mapea 1:1 con las columnas de public.people. */
export function emptyPerson(config) {
  return {
    id: null,
    full_name: '',
    document_type: 'CC',
    document_id: '',
    email: '',
    sex: 'Mujeres',
    birth_date: '',
    phone: '',
    base_city: 'Piedecuesta',
    team_id: '',
    daily_goal: config?.defaultGoal ?? 0,
    is_available: true,
    notes: '',
  }
}

/** Convierte una fila de v_people_registry en los valores del formulario. */
export function toFormValues(row) {
  return {
    id: row.id,
    full_name: row.full_name ?? '',
    document_type: row.document_type ?? 'CC',
    document_id: row.document_id ?? '',
    email: row.email ?? '',
    sex: row.sex ?? 'Mujeres',
    birth_date: row.birth_date ?? '',
    phone: row.phone ?? '',
    base_city: row.base_city ?? 'Piedecuesta',
    team_id: row.team_id ?? '',
    daily_goal: row.daily_goal ?? 0,
    is_available: row.is_available ?? true,
    notes: row.notes ?? '',
  }
}

/**
 * Formulario de alta y edición. Se usa dentro de la fila de la tabla
 * (escritorio) y dentro de la tarjeta (móvil): el mismo componente, sin
 * duplicar validaciones ni etiquetas.
 *
 * Los campos propios de cada tipo de persona se muestran según `config`.
 */
export function PersonForm({ value, onChange, onSubmit, onCancel, teams = [], saving, config }) {
  const update = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  const isNew = !value.id

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
      className="rounded-xl border border-navy-200 bg-navy-50/40 p-4 sm:p-5"
    >
      <p className="mb-4 text-xs font-bold tracking-[0.13em] text-navy-500 uppercase">
        {isNew ? `Nuevo ${config.singular}` : `Editando: ${value.full_name || 'sin nombre'}`}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Input
          label="Nombre completo *"
          required
          autoFocus
          className="sm:col-span-2 xl:col-span-1"
          value={value.full_name}
          onChange={update('full_name')}
          placeholder="Nombres y apellidos"
        />
        <Select
          label="Tipo de documento *"
          required
          value={value.document_type}
          onChange={update('document_type')}
          options={DOCUMENT_TYPES}
        />
        <Input
          label="Número de documento *"
          required
          inputMode="numeric"
          value={value.document_id}
          onChange={update('document_id')}
          placeholder="1098765432"
          hint="Sin puntos ni espacios"
        />
        <Input
          label="Correo electrónico *"
          type="email"
          required
          className="sm:col-span-2 xl:col-span-1"
          value={value.email}
          onChange={update('email')}
          placeholder="nombre@correo.com"
        />
        <Select
          label="Sexo *"
          required
          value={value.sex}
          onChange={update('sex')}
          hint="Determina la sección de alojamiento"
          options={SEX_GROUPS.map((item) => ({ value: item, label: item }))}
        />
        <Input
          label="Fecha de nacimiento *"
          type="date"
          required
          max={todayISO()}
          value={value.birth_date}
          onChange={update('birth_date')}
        />
        <Input
          label="Teléfono"
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={update('phone')}
          placeholder="300 000 0000"
        />
        <Input
          label="Ciudad de procedencia"
          value={value.base_city}
          onChange={update('base_city')}
          hint={config.showTeam ? 'Si su equipo tiene rotación, esta se impone' : undefined}
        />

        {config.showTeam && (
          <Select
            label="Equipo"
            value={value.team_id}
            onChange={update('team_id')}
            placeholder="Sin equipo asignado"
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
          />
        )}

        {config.showGoal && (
          <Input
            label={config.goalLabel ?? 'Meta diaria'}
            type="number"
            min="0"
            step="1"
            value={value.daily_goal}
            onChange={update('daily_goal')}
          />
        )}

        <Select
          label="Estado"
          value={value.is_available ? 'activo' : 'inactivo'}
          onChange={(event) => onChange({ ...value, is_available: event.target.value === 'activo' })}
          options={[
            { value: 'activo', label: 'Activo' },
            { value: 'inactivo', label: 'Inactivo' },
          ]}
        />

        <Textarea
          label="Observaciones"
          className="sm:col-span-2 xl:col-span-3"
          value={value.notes}
          onChange={update('notes')}
          placeholder="Notas internas de la coordinación (opcional)"
        />
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          <X />
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          <Save />
          {isNew ? `Registrar ${config.singular}` : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
