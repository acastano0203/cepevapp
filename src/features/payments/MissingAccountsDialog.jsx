import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck, Info } from 'lucide-react'
import { Badge, Button, Dialog, QueryBoundary } from '@/components/ui'
import { useMissingPaymentAccounts, usePaymentActions, usePaymentSettings } from '@/hooks/useCepev'
import { conceptDefaultFee, conceptLabel } from '@/lib/constants'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ConceptFields } from './ConceptFields'
import { previewAccount } from './cycles'

const longDate = (iso) => formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' })

function Outcome({ preview }) {
  if (!preview) return null
  if (preview.started === 0) {
    return (
      <Badge tone="navy">
        <CalendarCheck className="size-3" /> Su primera cuota ({formatCurrency(preview.firstAmount)}) vence el {longDate(preview.firstDue)}
      </Badge>
    )
  }
  if (preview.overdue > 0) {
    return (
      <Badge tone="red">
        <AlertTriangle className="size-3" />
        Quedará en mora: {preview.overdue} {preview.overdue === 1 ? 'cuota vencida' : 'cuotas vencidas'}
        {preview.overdueAmount > 0 && ` (${formatCurrency(preview.overdueAmount)})`}
      </Badge>
    )
  }
  return <Badge tone="gold">Debe la cuota actual · vence el {longDate(preview.nextDue)}</Badge>
}

/** Valores de la fila: lo sugerido por el servidor más lo que el usuario cambió. */
function rowValues(row, edit) {
  const concept = edit.concept ?? row.concept
  return {
    ...row,
    selected: edit.selected ?? true,
    concept,
    entry_date: edit.entry_date ?? row.suggested_entry_date,
    closed_on: edit.closed_on ?? '',
    monthly_amount: edit.monthly_amount ?? '',
  }
}

/**
 * Revisión antes de abrir cuentas: por persona se ve la fecha de ingreso
 * sugerida y su origen, el concepto (el cepevista puede pagar por mes o por
 * días), el valor y cómo quedará la cuenta hoy.
 */
export function MissingAccountsDialog({ open, onClose, onConfigure, only }) {
  const query = useMissingPaymentAccounts()
  const settingsQuery = usePaymentSettings()
  const actions = usePaymentActions()
  const [edits, setEdits] = useState({})
  const pending = actions.openAccounts.isPending
  const settings = settingsQuery.data

  const rows = useMemo(() => (query.data ?? [])
    .filter((row) => !only || row.person_id === only)
    .map((row) => rowValues(row, edits[row.person_id] ?? {})), [edits, only, query.data])

  const update = (personId, patch) =>
    setEdits((current) => ({ ...current, [personId]: { ...current[personId], ...patch } }))

  const rateOf = (row) => (row.monthly_amount === '' ? conceptDefaultFee(settings, row.concept) : Number(row.monthly_amount))
  const previewOf = (row) => previewAccount(row.entry_date, {
    concept: row.concept, rate: rateOf(row), closedOn: row.closed_on || null,
  })

  const chosen = rows.filter((row) => row.selected)
  const invalid = chosen.filter((row) => !row.entry_date || !(rateOf(row) >= 0) || (row.monthly_amount === '' && !rateOf(row))
    || (row.concept === 'Por dias' && (!row.closed_on || row.closed_on <= row.entry_date)))
  const inArrears = chosen.filter((row) => (previewOf(row)?.overdue ?? 0) > 0).length
  const missingFee = chosen.some((row) => row.monthly_amount === '' && !conceptDefaultFee(settings, row.concept))
  const allSelected = rows.length > 0 && chosen.length === rows.length

  const submit = () => actions.openAccounts.mutate(chosen, { onSuccess: onClose })

  return (
    <Dialog open={open} size="lg" onClose={() => { if (!pending) onClose() }}
      title={only ? `Abrir cuenta de ${rows[0]?.person_name ?? 'pagos'}` : 'Personas sin cuenta de pagos'}
      description="Sin cuenta no se generan cuotas ni alertas de mora, y no se le pueden registrar pagos. Revisa la fecha de ingreso de cada persona antes de abrirla."
      footer={<>
        <Button variant="secondary" disabled={pending} onClick={onClose}>Cancelar</Button>
        <Button disabled={chosen.length === 0 || invalid.length > 0} loading={pending} onClick={submit}>
          {chosen.length === 1 ? 'Abrir 1 cuenta' : `Abrir ${chosen.length} cuentas`}
        </Button>
      </>}>
      <QueryBoundary query={query} loadingLabel="Buscando personas sin cuenta…"
        empty="Todos los cepevistas y colportores tienen cuenta de pagos.">
        <div className="mb-4 flex gap-3 rounded-lg bg-navy-50 px-3 py-3 text-sm text-ink-soft">
          <Info className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
          <p>
            La <strong className="text-ink">fecha de ingreso</strong> inicia el primer ciclo: cada cuota vence un mes después.
            Un cepevista <strong className="text-ink">por días</strong> paga los días hasta su salida, que es cuando vence su cuota.
            Se sugiere la primera estadía registrada en Alojamientos o, si no tiene, la fecha en que se creó su ficha.
          </p>
        </div>

        {missingFee && (
          <p role="alert" className="mb-4 rounded-lg bg-gold-100 px-3 py-3 text-sm text-gold-700">
            Falta configurar el valor de algún concepto. Escribe el valor en cada persona o{' '}
            <button type="button" className="font-semibold underline" onClick={onConfigure}>ve a Configuración</button>.
          </p>
        )}

        {!only && (
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={allSelected}
              onChange={(event) => setEdits((current) => Object.fromEntries(rows.map((row) =>
                [row.person_id, { ...current[row.person_id], selected: event.target.checked }])))} />
            Seleccionar todos ({rows.length})
          </label>
        )}

        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const fromStay = row.entry_source === 'Primera estadia'
            const changed = row.entry_date !== row.suggested_entry_date
            return (
              <li key={row.person_id}
                className={cn('rounded-xl border p-4 transition', row.selected ? 'border-line bg-white' : 'border-dashed border-line bg-[#f9fbfd] opacity-60')}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={row.selected}
                    onChange={(event) => update(row.person_id, { selected: event.target.checked })} />
                  <span className="min-w-0">
                    <strong className="block text-ink">{row.person_name}</strong>
                    <small className="text-xs text-ink-soft">
                      {row.person_kind} · {conceptLabel(row.concept)}{row.document_id && ` · ${row.document_type} ${row.document_id}`}
                    </small>
                  </span>
                </label>
                {row.selected && (
                  <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                    <ConceptFields kind={row.person_kind} value={row} settings={settings}
                      onChange={(patch) => update(row.person_id, patch)}
                      entryHint={changed
                        ? `Sugerida: ${longDate(row.suggested_entry_date)}`
                        : fromStay ? 'Tomada de su primera estadía' : 'Tomada del registro de su ficha: confírmala'} />
                    <div className="sm:col-span-2"><Outcome preview={previewOf(row)} /></div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {inArrears > 0 && (
          <p className="mt-4 text-sm text-[var(--color-danger-fg)]">
            {inArrears === 1 ? '1 persona quedará' : `${inArrears} personas quedarán`} en mora al abrir la cuenta.
            Si ya pagaron por fuera de la app, registra esos pagos después o ajusta la fecha de ingreso.
          </p>
        )}
      </QueryBoundary>
    </Dialog>
  )
}
