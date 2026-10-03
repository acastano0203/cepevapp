import { Input } from '@/components/ui'
import {
  ACCOUNT_CONCEPTS_BY_KIND,
  conceptDefaultFee,
  conceptLabel,
  conceptRateLabel,
} from '@/lib/constants'
import { addDays, cn, formatCurrency, formatDate, todayISO } from '@/lib/utils'
import { cycleCharge, dailyStayTotal, firstDueDate } from './cycles'

const longDate = (iso) => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' })

/** Selector «Mensualidad | Por días» como botones: dos opciones se leen de un vistazo. */
export function ConceptPicker({ kind, value, onChange, disabled, className }) {
  const options = ACCOUNT_CONCEPTS_BY_KIND[kind] ?? []
  if (options.length < 2) return null
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-sm font-semibold text-[#536c83]">¿Cómo paga su estadía?</span>
      <div role="radiogroup" aria-label="Concepto de pago" className="inline-flex w-fit rounded-lg border border-line bg-white p-1">
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled}
            onClick={() => onChange(option)}
            className={cn('h-9 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50',
              value === option ? 'bg-navy-600 text-white' : 'text-ink-soft hover:bg-navy-50')}>
            {conceptLabel(option)}
          </button>
        ))}
      </div>
      <span className="text-xs text-ink-soft">
        {value === 'Por dias' ? 'Estadía corta: se cobran los días entre el ingreso y la salida.' : 'Una cuota cada mes desde la fecha de ingreso.'}
      </span>
    </div>
  )
}

/**
 * Campos de la cuenta que dependen del concepto: fecha de ingreso, fecha de
 * salida (por días) y valor. Debajo, cómo se cobrará. Los usan la ficha nueva,
 * la apertura de cuentas y la edición, para que se lean igual en todas.
 */
export function ConceptFields({ kind, value, onChange, settings, entryHint, showConcept = true, conceptDisabled }) {
  const concept = value.concept
  const fee = conceptDefaultFee(settings, concept)
  const rate = value.monthly_amount === '' ? fee : Number(value.monthly_amount)
  const daily = concept === 'Por dias'
  const total = daily ? dailyStayTotal(value.entry_date, value.closed_on, rate) : null
  const first = value.entry_date ? cycleCharge(value.entry_date, 0, { concept, rate, closedOn: value.closed_on || null }) : null
  const cycles = total && first ? (first.due < value.closed_on ? 'en cuotas mensuales; la última vence el día de salida' : 'en una sola cuota que vence el día de salida') : ''

  return (
    <>
      {showConcept && (
        <ConceptPicker kind={kind} value={concept} disabled={conceptDisabled} className="sm:col-span-2 xl:col-span-3"
          onChange={(next) => onChange({ concept: next, monthly_amount: '' })} />
      )}
      <Input label="Fecha de ingreso *" type="date" required max={addDays(todayISO(), 365)}
        value={value.entry_date} onChange={(event) => onChange({ entry_date: event.target.value })}
        hint={entryHint ?? (value.entry_date && !daily
          ? `Primera cuota vence el ${longDate(firstDueDate(value.entry_date))}`
          : undefined)} />
      {daily && (
        <Input label="Fecha de salida *" type="date" required
          min={value.entry_date ? addDays(value.entry_date, 1) : undefined}
          value={value.closed_on ?? ''} onChange={(event) => onChange({ closed_on: event.target.value })}
          hint={total ? `${total.days} ${total.days === 1 ? 'día' : 'días'} de estadía` : 'Hasta cuándo se cobra'} />
      )}
      <Input label={conceptRateLabel(concept)} type="number" min="0" step="1"
        value={value.monthly_amount} onChange={(event) => onChange({ monthly_amount: event.target.value })}
        placeholder={fee ? String(fee) : 'Sin configurar'} required={!fee}
        hint={value.monthly_amount === ''
          ? (fee ? `Valor configurado: ${formatCurrency(fee)}` : 'Indica el valor o configúralo en Pagos')
          : 'Valor propio de esta persona (beca o acuerdo)'} />
      {daily && total && rate > 0 && (
        <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-ink sm:col-span-2 xl:col-span-3">
          {total.days} {total.days === 1 ? 'día' : 'días'} × {formatCurrency(rate)} = <strong>{formatCurrency(total.amount)}</strong>,
          {' '}{cycles}{first ? ` (${longDate(value.closed_on)})` : ''}.
        </p>
      )}
    </>
  )
}
