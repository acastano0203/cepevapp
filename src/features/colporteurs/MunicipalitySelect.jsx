import { Combobox } from '@/components/ui'
import catalog from '@/data/colombia-municipalities.json'

export const municipalityLabel = (item) => item.name + ' (' + item.department + ')'
export const MUNICIPALITIES = [...catalog].sort((a, b) => municipalityLabel(a).localeCompare(municipalityLabel(b), 'es'))
export const MUNICIPALITY_BY_CODE = new Map(MUNICIPALITIES.map((item) => [item.code, item]))

const OPTIONS = MUNICIPALITIES.map((item) => ({
  value: item.code,
  label: municipalityLabel(item),
  detail: item.type === 'MUNICIPIO' ? undefined : item.type.toLowerCase(),
}))

/**
 * Un solo campo: se escribe el municipio o el departamento y se elige de la
 * lista desplegada. Mantiene la firma de onChange(event) de los formularios.
 */
export function MunicipalitySelect({ value, onChange, label = 'Municipio de destino', disabled = false }) {
  return (
    <Combobox label={label} className="sm:col-span-2" required disabled={disabled}
      value={value ?? ''} onChange={(code) => onChange({ target: { value: code } })}
      options={OPTIONS} placeholder="Escribe el municipio o el departamento, por ejemplo Medellín o Antioquia"
      emptyText="Ningún municipio coincide"
      hint="El departamento distingue municipios con el mismo nombre." />
  )
}
