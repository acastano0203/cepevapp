import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Input, QueryBoundary, Table, Td, Tr } from '@/components/ui'
import { usePaymentActions, usePaymentServiceTypes, usePaymentSettings } from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { formatCurrency, formatDateTime } from '@/lib/utils'

function CriteriaForm({ settings }) {
  const { isAdmin } = useAuth()
  const actions = usePaymentActions()
  const [form, setForm] = useState({
    cepevista_monthly_fee: String(settings?.cepevista_monthly_fee ?? 0),
    cepevista_daily_fee: String(settings?.cepevista_daily_fee ?? 0),
    colporteur_goal_value: String(settings?.colporteur_goal_value ?? 0),
    alert_days_before: String(settings?.alert_days_before ?? 5),
    apply_to_accounts: false,
  })
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = (event) => {
    event.preventDefault()
    actions.saveSettings.mutate(form)
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Input label="Mensualidad del cepevista" type="number" min="0" step="1" required disabled={!isAdmin}
        value={form.cepevista_monthly_fee} onChange={set('cepevista_monthly_fee')}
        hint={formatCurrency(form.cepevista_monthly_fee) + ' por mes'} />
      <Input label="Valor día del cepevista" type="number" min="0" step="1" required disabled={!isAdmin}
        value={form.cepevista_daily_fee} onChange={set('cepevista_daily_fee')}
        hint={formatCurrency(form.cepevista_daily_fee) + ' por día · estadías cortas'} />
      <Input label="Valor de colportaje por meta (siembra)" type="number" min="0" step="1" required disabled={!isAdmin}
        value={form.colporteur_goal_value} onChange={set('colporteur_goal_value')}
        hint={formatCurrency(form.colporteur_goal_value) + ' por mes'} />
      <Input label="Días de aviso antes del vencimiento" type="number" min="0" max="28" step="1" required disabled={!isAdmin}
        value={form.alert_days_before} onChange={set('alert_days_before')}
        hint="La cuenta pasa a «Por vencer» en esos días" />
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 xl:col-span-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.apply_to_accounts}
              onChange={(event) => setForm((current) => ({ ...current, apply_to_accounts: event.target.checked }))} />
            Aplicar los nuevos valores a las cuentas abiertas (desde su próximo ciclo)
          </label>
          <Button type="submit" loading={actions.saveSettings.isPending}>Guardar criterios</Button>
        </div>
      )}
      {settings?.updated_at && (
        <p className="text-xs text-ink-soft sm:col-span-2 xl:col-span-4">Última actualización: {formatDateTime(settings.updated_at)}</p>
      )}
    </form>
  )
}

function ServiceTypes() {
  const { isAdmin } = useAuth()
  const query = usePaymentServiceTypes()
  const actions = usePaymentActions()
  const [editing, setEditing] = useState(null)

  const submit = (event) => {
    event.preventDefault()
    actions.saveServiceType.mutate(editing, { onSuccess: () => setEditing(null) })
  }

  return (
    <Card>
      <CardHeader title="Tipos de servicio y valor hora"
        description="Un pago en especie abona horas de servicio × valor hora. Un servicio sin valor hora no se puede usar."
        action={isAdmin && (
          <Button variant="secondary" onClick={() => setEditing({ id: null, name: '', hourly_rate: '', is_active: true })}>
            <Plus /> Agregar servicio
          </Button>
        )} />
      {editing && (
        <form onSubmit={submit} className="grid gap-3 border-b border-[#edf1f5] px-4 py-4 sm:grid-cols-[2fr_1fr_auto_auto] sm:items-end sm:px-6">
          <Input label="Servicio" required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <Input label="Valor hora" type="number" min="0" step="1" required value={editing.hourly_rate}
            onChange={(event) => setEditing({ ...editing, hourly_rate: event.target.value })} />
          <label className="flex h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={editing.is_active}
              onChange={(event) => setEditing({ ...editing, is_active: event.target.checked })} />
            Activo
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" loading={actions.saveServiceType.isPending}>Guardar</Button>
          </div>
        </form>
      )}
      <QueryBoundary query={query} empty="No hay servicios configurados.">
        <Table columns={['Servicio', 'Valor hora', 'Estado', '']}>
          {(query.data ?? []).map((service) => (
            <Tr key={service.id}>
              <Td className="font-medium text-ink">{service.name}</Td>
              <Td>{Number(service.hourly_rate) > 0 ? formatCurrency(service.hourly_rate) : <Badge tone="gold">Sin valor</Badge>}</Td>
              <Td><Badge tone={service.is_active ? 'green' : 'neutral'}>{service.is_active ? 'Activo' : 'Inactivo'}</Badge></Td>
              <Td className="text-right">
                {isAdmin && (
                  <Button size="icon" variant="ghost" aria-label={`Editar ${service.name}`}
                    onClick={() => setEditing({ ...service, hourly_rate: String(service.hourly_rate) })}><Pencil /></Button>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </QueryBoundary>
    </Card>
  )
}

export default function SettingsTab() {
  const { isAdmin } = useAuth()
  const settingsQuery = usePaymentSettings()

  return (
    <div className="flex flex-col gap-5">
      {!isAdmin && (
        <p className="rounded-lg bg-navy-50 px-4 py-3 text-sm text-ink-soft">Solo la administración puede cambiar estos criterios.</p>
      )}
      <Card>
        <CardHeader title="Criterios de cobro"
          description="Valores por defecto al abrir una cuenta. Las cuotas ya generadas conservan su valor; cada cuenta puede tener un valor propio (becas o acuerdos)." />
        <CardBody>
          <QueryBoundary query={settingsQuery} loadingLabel="Cargando criterios…">
            <CriteriaForm key={settingsQuery.data?.updated_at ?? 'default'} settings={settingsQuery.data} />
          </QueryBoundary>
        </CardBody>
      </Card>
      <ServiceTypes />
    </div>
  )
}
