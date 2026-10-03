import { Link } from 'react-router-dom'
import { ArrowRight, WalletCards } from 'lucide-react'
import { Badge, Input, Select } from '@/components/ui'
import { usePaymentAccounts, usePaymentServiceTypes, usePaymentSettings } from '@/hooks/useCepev'
import { KIND_BY_CONCEPT, PAYMENT_METHODS, PAYMENT_STATUS, conceptDefaultFee, conceptLabel, conceptRateUnit } from '@/lib/constants'
import { formatCurrency, formatDate, todayISO } from '@/lib/utils'
import { ConceptFields } from './ConceptFields'
import { cycleCharge } from './cycles'

/** Valores iniciales de la sección de pagos de una ficha nueva. */
export const emptyEnrollment = (concept = 'Mensualidad') => ({
  concept,
  entry_date: todayISO(),
  closed_on: '',
  monthly_amount: '',
  pay_now: true,
  method: 'Efectivo',
  amount: '',
  paid_on: todayISO(),
  service_type_id: '',
  service_hours: '',
  reference: '',
})

/** Valor de la primera cuota: mensual, o días del primer tramo × valor día. */
export function firstChargeAmount(enrollment, settings) {
  const rate = enrollment.monthly_amount !== '' ? Number(enrollment.monthly_amount) : conceptDefaultFee(settings, enrollment.concept)
  if (!enrollment.entry_date) return rate
  const charge = cycleCharge(enrollment.entry_date, 0, {
    concept: enrollment.concept, rate, closedOn: enrollment.closed_on || null,
  })
  return charge?.amount ?? 0
}

/**
 * Sección «Cuenta de pagos» de la ficha nueva. La persona ya es la de la
 * ficha. El colportor siempre paga siembra; el cepevista elige mensualidad
 * o por días. El primer pago es opcional y por defecto cubre la primera cuota.
 */
export function EnrollmentFields({ value, onChange }) {
  const settingsQuery = usePaymentSettings()
  const servicesQuery = usePaymentServiceTypes()
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  const concept = value.concept
  const kind = KIND_BY_CONCEPT[concept]

  const fee = firstChargeAmount(value, settingsQuery.data)
  const services = (servicesQuery.data ?? []).filter((service) => service.is_active)
  const service = services.find((item) => item.id === value.service_type_id)
  const paid = value.method === 'Especie'
    ? Number(value.service_hours || 0) * Number(service?.hourly_rate || 0)
    : Number(value.amount === '' ? fee : value.amount)
  const difference = paid - fee

  return (
    <fieldset className="rounded-xl border border-line bg-white p-4 sm:col-span-2 xl:col-span-3">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
        <WalletCards className="size-4 text-navy-600" aria-hidden="true" />
        Cuenta de pagos{kind === 'Colportor' && <> · <Badge>{conceptLabel(concept)}</Badge></>}
      </legend>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ConceptFields kind={kind} value={value} settings={settingsQuery.data}
          onChange={(patch) => onChange({ ...value, ...patch })} />
        <label className="flex items-center gap-2 self-center text-sm font-medium text-ink">
          <input type="checkbox" checked={value.pay_now}
            onChange={(event) => onChange({ ...value, pay_now: event.target.checked })} />
          Registrar el primer pago ahora
        </label>

        {value.pay_now && (
          <>
            <Select label="Forma de pago" value={value.method} onChange={set('method')} options={PAYMENT_METHODS} />
            {value.method === 'Especie' ? (
              <>
                <Select label="Servicio prestado *" required value={value.service_type_id} onChange={set('service_type_id')}
                  placeholder="Selecciona el servicio"
                  options={services.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${formatCurrency(item.hourly_rate)}/h`,
                    disabled: Number(item.hourly_rate) <= 0,
                  }))} />
                <Input label="Horas de servicio *" type="number" min="0.5" step="0.5" max="744" required
                  value={value.service_hours} onChange={set('service_hours')} />
              </>
            ) : (
              <Input label="Valor pagado" type="number" min="1" step="1" value={value.amount} onChange={set('amount')}
                placeholder={fee ? String(fee) : ''} required={!fee}
                hint={value.amount === '' ? `Vacío = la primera cuota completa (${formatCurrency(fee)})` : undefined} />
            )}
            <Input label="Fecha del pago" type="date" max={todayISO()} value={value.paid_on} onChange={set('paid_on')} />
            {value.method === 'Transferencia' && (
              <Input label="Referencia" value={value.reference} onChange={set('reference')} placeholder="Número de comprobante" />
            )}
            {fee > 0 && paid > 0 && (
              <p className="self-center text-sm sm:col-span-2 xl:col-span-3">
                {difference === 0 && <span className="text-[var(--color-success-fg)]">Paga {formatCurrency(paid)}: cubre la primera cuota completa.</span>}
                {difference < 0 && <span className="text-gold-700">Abono de {formatCurrency(paid)}: queda debiendo {formatCurrency(-difference)} de la primera cuota.</span>}
                {difference > 0 && <span className="text-navy-700">Paga {formatCurrency(paid)}: cubre la primera cuota y deja {formatCurrency(difference)} a favor.</span>}
              </p>
            )}
          </>
        )}
      </div>
    </fieldset>
  )
}

/** En la edición de la ficha: resumen de la cuenta, sin duplicar su edición. */
export function AccountSummary({ personId }) {
  const accountsQuery = usePaymentAccounts()
  const account = (accountsQuery.data ?? []).find((item) => item.person_id === personId)
  if (accountsQuery.isPending || accountsQuery.isError) return null
  const status = account ? PAYMENT_STATUS[account.status] : PAYMENT_STATUS['Sin cuenta']

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 sm:col-span-2 xl:col-span-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <WalletCards className="size-4 text-navy-600" aria-hidden="true" />
        <span className="font-semibold text-ink">Cuenta de pagos</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {account ? (
          <span className="text-ink-soft">
            {conceptLabel(account.concept)} · {formatCurrency(account.monthly_amount)} / {conceptRateUnit(account.concept)} · ingreso {formatDate(account.entry_date, { day: 'numeric', month: 'short', year: 'numeric' })}
            {account.balance > 0 ? ` · debe ${formatCurrency(account.balance)}` : ''}
          </span>
        ) : (
          <span className="text-ink-soft">Aún no tiene cuenta abierta</span>
        )}
      </div>
      <Link to="/pagos" className="inline-flex items-center gap-1 text-sm font-semibold text-navy-600 hover:underline">
        {account ? 'Ver en Pagos' : 'Abrir en Pagos'} <ArrowRight className="size-4" />
      </Link>
    </div>
  )
}
