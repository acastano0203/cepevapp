import { useEffect, useMemo, useState } from 'react'
import { Camera, Send, X } from 'lucide-react'
import { Button, Combobox, Input, QueryBoundary, Select, Textarea } from '@/components/ui'
import { useMaintenanceActions, useMaintenanceAreas, useMaintenanceRooms } from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { MAINTENANCE_TYPES, areaLabel } from '@/lib/constants'
import { cn } from '@/lib/utils'

const emptyReport = () => ({
  area_id: '',
  room_id: '',
  location_detail: '',
  report_type: 'Dano',
  priority: 'Normal',
  detail: '',
  photo: null,
})

/** Botones de opción: se leen y se tocan mejor que un desplegable en el celular. */
function Choice({ label, value, options, onChange }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold text-[#536c83]">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn('h-10 rounded-lg border px-3 text-sm font-medium transition-colors',
              value === option.value
                ? option.value === 'Urgente' ? 'border-red-300 bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]' : 'border-navy-600 bg-navy-600 text-white'
                : 'border-line bg-white text-ink-soft hover:bg-navy-50')}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Reporte de daño, reparación, mantenimiento o limpieza en cualquier área del
 * CEPEV. Si el área es un dormitorio, se puede indicar el cuarto.
 */
export function ReportForm({ onDone }) {
  const { user } = useAuth()
  const areasQuery = useMaintenanceAreas()
  const roomsQuery = useMaintenanceRooms()
  const actions = useMaintenanceActions()
  const [form, setForm] = useState(emptyReport)
  const [preview, setPreview] = useState(null)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const areas = (areasQuery.data ?? []).filter((area) => area.is_active)
  const area = areas.find((item) => item.id === form.area_id)
  const isDorm = area?.name === 'Dormitorios'
  const roomOptions = useMemo(() => (roomsQuery.data ?? []).map((room) => ({
    value: room.id, label: room.code, detail: room.building ? `Edificio ${room.building}` : undefined,
  })), [roomsQuery.data])

  // Vista previa local de la foto elegida
  useEffect(() => {
    if (!form.photo) { setPreview(null); return undefined }
    const url = URL.createObjectURL(form.photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [form.photo])

  const submit = (event) => {
    event.preventDefault()
    actions.create.mutate({ ...form, room_id: isDorm ? form.room_id : '', userId: user?.id }, {
      onSuccess: () => {
        setForm(emptyReport())
        onDone?.()
      },
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <QueryBoundary query={areasQuery} loadingLabel="Cargando áreas…">
        <Select label="Área del CEPEV *" required value={form.area_id}
          onChange={(event) => setForm((current) => ({ ...current, area_id: event.target.value, room_id: '' }))}
          placeholder="¿Dónde es?" options={areas.map((item) => ({ value: item.id, label: areaLabel(item.name) }))} />
      </QueryBoundary>
      {isDorm
        ? <Combobox label="Cuarto" value={form.room_id} options={roomOptions} placeholder="Escribe el código del cuarto"
            onChange={(roomId) => setForm((current) => ({ ...current, room_id: roomId }))} />
        : <Input label="Lugar exacto" value={form.location_detail} onChange={set('location_detail')}
            placeholder="Ej.: baño del segundo piso, puerta principal" />}
      {isDorm && (
        <Input label="Lugar exacto" className="sm:col-span-2" value={form.location_detail} onChange={set('location_detail')}
          placeholder="Ej.: ducha, ventana, camarote 3" />
      )}

      <div className="sm:col-span-2">
        <Choice label="¿Qué se necesita?" value={form.report_type} options={MAINTENANCE_TYPES}
          onChange={(value) => setForm((current) => ({ ...current, report_type: value }))} />
      </div>
      <div className="sm:col-span-2">
        <Choice label="Prioridad" value={form.priority}
          options={[{ value: 'Normal', label: 'Normal' }, { value: 'Urgente', label: 'Urgente · riesgo o no se puede usar' }]}
          onChange={(value) => setForm((current) => ({ ...current, priority: value }))} />
      </div>

      <Textarea label="Descripción *" className="sm:col-span-2" required rows={4} value={form.detail} onChange={set('detail')}
        placeholder="Qué pasó, desde cuándo y cualquier detalle que ayude a repararlo" />

      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className="text-sm font-semibold text-[#536c83]">Foto (opcional)</span>
        {preview ? (
          <div className="relative w-fit">
            <img src={preview} alt="Vista previa de la foto del reporte" className="max-h-48 rounded-lg border border-line object-cover" />
            <button type="button" aria-label="Quitar foto"
              className="absolute top-2 right-2 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              onClick={() => setForm((current) => ({ ...current, photo: null }))}>
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <label className="flex h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-navy-300 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">
            <Camera className="size-4" aria-hidden="true" /> Tomar o elegir foto
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only"
              onChange={(event) => setForm((current) => ({ ...current, photo: event.target.files?.[0] ?? null }))} />
          </label>
        )}
        <span className="text-xs text-ink-soft">JPG, PNG o WEBP de hasta 5 MB.</span>
      </div>

      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="lg" loading={actions.create.isPending}
          disabled={!form.area_id || !form.detail.trim()}>
          <Send /> Enviar reporte
        </Button>
      </div>
    </form>
  )
}
