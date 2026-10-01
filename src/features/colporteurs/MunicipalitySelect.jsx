import { useState } from 'react'
import { Input, Select } from '@/components/ui'
import catalog from '@/data/colombia-municipalities.json'
import { normalizeSearch } from './reporting'

export const municipalityLabel = (item) => item.name + ' (' + item.department + ')'
export const MUNICIPALITIES = [...catalog].sort((a, b) => municipalityLabel(a).localeCompare(municipalityLabel(b), 'es'))
export const MUNICIPALITY_BY_CODE = new Map(MUNICIPALITIES.map((item) => [item.code, item]))

export function MunicipalitySelect({ value, onChange, label = 'Municipio de destino', disabled = false }) {
  const [search, setSearch] = useState('')
  const filtered = MUNICIPALITIES.filter((item) => item.code === value
    || normalizeSearch(municipalityLabel(item)).includes(normalizeSearch(search)))
  return <div className="grid gap-3 sm:col-span-2">
    <Input label="Buscar municipio o departamento" type="search" value={search} disabled={disabled}
      placeholder="Ejemplo: Medellín o Antioquia" onChange={(event) => setSearch(event.target.value)} />
    <Select label={label} required value={value ?? ''} onChange={onChange} disabled={disabled}
      placeholder="Selecciona un municipio" hint={filtered.length + ' opciones. El departamento distingue municipios con el mismo nombre.'}
      options={filtered.map((item) => ({ value: item.code, label: municipalityLabel(item) }))} />
  </div>
}
