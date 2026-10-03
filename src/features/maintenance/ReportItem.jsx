import { useState } from 'react'
import { ImageIcon, MapPin, Settings2 } from 'lucide-react'
import { Badge, Button, Dialog, Input, Select, Textarea } from '@/components/ui'
import { useMaintenanceActions, useMaintenancePhoto } from '@/hooks/useCepev'
import { MAINTENANCE_STATUS_TONES, areaLabel, maintenanceTypeLabel } from '@/lib/constants'
import { formatCurrency, formatDateTime, relativeTime } from '@/lib/utils'

function Photo({ path }) {
  const query = useMaintenancePhoto(path)
  if (!path) return null
  if (!query.data) {
    return <span className="flex size-20 items-center justify-center rounded-lg bg-navy-50 text-navy-300"><ImageIcon className="size-5" /></span>
  }
  return (
    <a href={query.data} target="_blank" rel="noreferrer" className="shrink-0" title="Ver foto completa">
      <img src={query.data} alt="Foto del reporte" className="size-20 rounded-lg border border-line object-cover" />
    </a>
  )
}

/** Gestión del reporte (solo administración): estado, responsable, resolución y costo. */
function ManageDialog({ report, onClose }) {
  const actions = useMaintenanceActions()
  const [form, setForm] = useState({
    id: report.id,
    status: report.status === 'Abierto' ? 'En proceso' : report.status,
    priority: report.priority,
    assigned_to: report.assigned_to ?? '',
    resolution: report.resolution ?? '',
    cost_cop: report.cost_cop ?? '',
  })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const pending = actions.update.isPending
  const submit = (event) => {
    event.preventDefault()
    actions.update.mutate(form, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={() => { if (!pending) onClose() }} title="Gestionar reporte"
      description={`${areaLabel(report.area_name)}${report.room_code ? ` · ${report.room_code}` : ''} · ${maintenanceTypeLabel(report.report_type)}`}
      footer={<>
        <Button variant="secondary" disabled={pending} onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="maintenance-manage" loading={pending}
          disabled={form.status === 'Resuelto' && !form.resolution.trim()}>Guardar</Button>
      </>}>
      <form id="maintenance-manage" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Select label="Estado" value={form.status} onChange={set('status')}
          options={['Abierto', 'En proceso', 'Resuelto'].map((value) => ({ value, label: value }))} />
        <Select label="Prioridad" value={form.priority} onChange={set('priority')}
          options={[{ value: 'Normal', label: 'Normal' }, { value: 'Urgente', label: 'Urgente' }]} />
        <Input label="Responsable" className="sm:col-span-2" value={form.assigned_to} onChange={set('assigned_to')}
          placeholder="Quién lo atiende: persona, servidor o proveedor" />
        <Textarea label={form.status === 'Resuelto' ? 'Qué se hizo *' : 'Notas de la gestión'} className="sm:col-span-2"
          required={form.status === 'Resuelto'} value={form.resolution} onChange={set('resolution')} />
        <Input label="Costo (opcional)" type="number" min="0" step="1" value={form.cost_cop} onChange={set('cost_cop')}
          hint={form.cost_cop !== '' ? formatCurrency(form.cost_cop) : 'Materiales o mano de obra'} />
        {form.status === 'Abierto' && report.status !== 'Abierto' && (
          <p className="self-end text-sm text-gold-700">El reporte se reabre y vuelve a quedar pendiente.</p>
        )}
      </form>
    </Dialog>
  )
}

/** Un reporte en la lista. La administración lo gestiona desde aquí. */
export function ReportItem({ report, canManage }) {
  const [managing, setManaging] = useState(false)
  const where = [areaLabel(report.area_name), report.room_code, report.location_detail].filter(Boolean).join(' · ')

  return (
    <li className="flex gap-4 px-4 py-4 sm:px-6">
      <Photo path={report.photo_path} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={MAINTENANCE_STATUS_TONES[report.status]}>{report.status}</Badge>
          {report.priority === 'Urgente' && <Badge tone="red">Urgente</Badge>}
          <Badge tone="neutral">{maintenanceTypeLabel(report.report_type)}</Badge>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <MapPin className="size-4 shrink-0 text-navy-500" aria-hidden="true" />
          <span className="min-w-0 truncate">{where}</span>
        </p>
        <p className="mt-1 text-sm whitespace-pre-line text-ink">{report.detail}</p>
        <p className="mt-2 text-xs text-ink-soft" title={formatDateTime(report.created_at)}>
          Reportó {report.reported_by_name ?? 'Usuario'} · {relativeTime(report.created_at)}
          {report.assigned_to && ` · Responsable: ${report.assigned_to}`}
        </p>
        {report.status === 'Resuelto' && report.resolution && (
          <p className="mt-2 rounded-lg bg-[var(--color-success-bg)] px-3 py-2 text-xs text-[var(--color-success-fg)]">
            <strong>Resuelto</strong>{report.resolved_by_name && ` por ${report.resolved_by_name}`}: {report.resolution}
            {report.cost_cop != null && ` · ${formatCurrency(report.cost_cop)}`}
          </p>
        )}
        {report.status !== 'Resuelto' && report.resolution && (
          <p className="mt-2 text-xs text-ink-soft">Nota: {report.resolution}</p>
        )}
      </div>
      {canManage && (
        <div className="shrink-0">
          <Button size="sm" variant="secondary" onClick={() => setManaging(true)}>
            <Settings2 /> Gestionar
          </Button>
        </div>
      )}
      {managing && <ManageDialog report={report} onClose={() => setManaging(false)} />}
    </li>
  )
}
