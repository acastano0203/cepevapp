import { useMemo, useState } from 'react'
import { Button, Combobox, Dialog, Input, QueryBoundary, Select, Textarea } from '@/components/ui'
import { usePaymentActions, usePaymentServiceTypes, usePeople } from '@/hooks/useCepev'
import { KIND_BY_CONCEPT, PAYMENT_CONCEPTS, PAYMENT_METHODS, PAYMENT_STATUS, conceptLabel, label } from '@/lib/constants'
import { formatCurrency, formatDate, todayISO } from '@/lib/utils'

const emptyForm = (account) => ({
  concept: account?.concept ?? 'Mensualidad',
  person_id: account?.person_id ?? '',
  payer_name: '',
  method: 'Efectivo',
  amount: account && account.balance > 0 ? String(account.balance) : '',
  service_type_id: '',
  service_hours: '',
  paid_on: todayISO(),
  reference: '',
  notes: '',
})

/**
 * Registro de un pago. Mensualidad y siembra abonan a la cuenta de la persona;
 * la ofrenda es voluntaria y no cambia el saldo. En especie, el valor sale de
 * las horas por el valor hora del servicio (lo recalcula el servidor).
 */
export function PaymentDialog({ open, onClose, accounts = [], account }) {
  const actions = usePaymentActions()
  const servicesQuery = usePaymentServiceTypes()
  const peopleQuery = usePeople()
  const [form, setForm] = useState(() => emptyForm(account))
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const isOffering = form.concept === 'Ofrenda'
  const kind = KIND_BY_CONCEPT[form.concept]
  const inKind = form.method === 'Especie'
  const selected = accounts.find((item) => item.person_id === form.person_id)
  const services = (servicesQuery.data ?? []).filter((service) => service.is_active)
  const service = services.find((item) => item.id === form.service_type_id)
  const inKindAmount = service ? Number(form.service_hours || 0) * Number(service.hourly_rate) : 0

  /**
   * Mensualidad o por días -> cepevistas · Siembra -> colportores · Ofrenda -> cualquiera.
   * Quien aún no tiene cuenta aparece deshabilitado: el servidor rechazaría el pago.
   * Un cepevista se puede elegir con cualquiera de sus dos conceptos: al
   * elegirlo, el concepto pasa a ser el de su cuenta.
   */
  const personOptions = useMemo(() => {
    const byPerson = new Map(accounts.map((item) => [item.person_id, item]))
    return (peopleQuery.data ?? [])
      .filter((person) => isOffering || person.kind === kind)
      .map((person) => {
        const item = byPerson.get(person.id)
        const document = item?.document_id ? `${item.document_type} ${item.document_id}` : null
        if (isOffering) {
          return { value: person.id, label: person.full_name, detail: [label(person.kind), document].filter(Boolean).join(' · ') }
        }
        const accountOk = item && KIND_BY_CONCEPT[item.concept] === kind
        return {
          value: person.id,
          label: person.full_name,
          detail: accountOk
            ? [kind === 'Cepevista' ? conceptLabel(item.concept) : null, PAYMENT_STATUS[item.status]?.label ?? item.status,
                item.balance > 0 ? `debe ${formatCurrency(item.balance)}` : null, document].filter(Boolean).join(' · ')
            : 'Sin cuenta de pagos: ábrela en «Revisar y abrir cuentas»',
          disabled: !accountOk,
        }
      })
  }, [accounts, isOffering, kind, peopleQuery.data])

  /** Al elegir a alguien, el valor sugerido es su saldo pendiente. */
  const choosePerson = (personId) => setForm((current) => {
    const item = accounts.find((row) => row.person_id === personId)
    const suggest = !isOffering && item && item.balance > 0 && (!current.amount || current.amount === current.suggested)
    return {
      ...current,
      person_id: personId,
      concept: !isOffering && item ? item.concept : current.concept,
      amount: suggest ? String(item.balance) : current.amount,
      suggested: suggest ? String(item.balance) : current.suggested,
    }
  })
  const withoutAccount = isOffering ? 0 : personOptions.filter((option) => option.disabled).length

  const changeConcept = (event) => {
    const concept = event.target.value
    setForm((current) => ({
      ...current,
      concept,
      person_id: concept === 'Ofrenda' || KIND_BY_CONCEPT[concept] === KIND_BY_CONCEPT[current.concept] ? current.person_id : '',
      method: concept === 'Ofrenda' && current.method === 'Especie' ? 'Efectivo' : current.method,
    }))
  }

  const close = () => {
    if (actions.register.isPending) return
    onClose()
  }

  const submit = (event) => {
    event.preventDefault()
    actions.register.mutate(form, { onSuccess: onClose })
  }

  const ready = isOffering
    ? (inKind ? false : Number(form.amount) > 0)
    : Boolean(form.person_id) && (inKind ? Boolean(service) && Number(form.service_hours) > 0 : Number(form.amount) > 0)

  return (
    <Dialog open={open} onClose={close} title="Registrar pago"
      description="Queda en la bitácora. Un pago no se borra: si hay un error, se anula con su motivo."
      footer={<>
        <Button variant="secondary" disabled={actions.register.isPending} onClick={close}>Cancelar</Button>
        <Button type="submit" form="payment-form" disabled={!ready} loading={actions.register.isPending}>Registrar pago</Button>
      </>}>
      <form id="payment-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Select label="Concepto" value={form.concept} onChange={changeConcept} disabled={Boolean(account)}
          options={PAYMENT_CONCEPTS.map((item) => ({ value: item.value, label: `${item.label} · ${item.hint}` }))} />
        <Input label="Fecha del pago" type="date" required max={todayISO()} value={form.paid_on} onChange={set('paid_on')} />

        <QueryBoundary query={peopleQuery} loadingLabel="Cargando personas…">
          {isOffering ? (
            <>
              <Combobox label="Persona (opcional)" value={form.person_id} onChange={choosePerson}
                placeholder="Escribe el nombre o déjalo vacío" options={personOptions} />
              <Input label="Nombre de quien ofrenda" value={form.payer_name} onChange={set('payer_name')}
                disabled={Boolean(form.person_id)} placeholder="Opcional · visitante, iglesia…" />
            </>
          ) : (
            <Combobox key={kind} label={kind === 'Cepevista' ? 'Cepevista' : 'Colportor'} className="sm:col-span-2"
              value={form.person_id} onChange={choosePerson} disabled={Boolean(account)} required
              placeholder={kind === 'Cepevista' ? 'Escribe el nombre del cepevista' : 'Escribe el nombre del colportor'}
              options={personOptions} emptyText="Nadie coincide con ese nombre o documento"
              hint={personOptions.length === 0
                ? `No hay ${kind === 'Cepevista' ? 'cepevistas' : 'colportores'} registrados.`
                : withoutAccount > 0
                  ? `${withoutAccount} sin cuenta de pagos: ábrelas en «Revisar y abrir cuentas» para registrarles pagos.`
                  : undefined} />
          )}
        </QueryBoundary>

        {selected && !isOffering && (
          <div className="rounded-lg bg-navy-50 px-3 py-3 text-sm text-ink sm:col-span-2">
            {selected.balance > 0
              ? <>Debe <strong>{formatCurrency(selected.balance)}</strong>
                  {selected.overdue_amount > 0 && <> · <span className="text-[var(--color-danger-fg)]">{formatCurrency(selected.overdue_amount)} vencido desde el {formatDate(selected.overdue_since)}</span></>}
                </>
              : <>Al día{selected.credit > 0 && <> · saldo a favor {formatCurrency(selected.credit)}</>}</>}
            <span className="block text-xs text-ink-soft">Próximo vencimiento: {formatDate(selected.next_due_date, { day: 'numeric', month: 'long' })}</span>
          </div>
        )}

        <Select label="Forma de pago" value={form.method} onChange={set('method')}
          options={PAYMENT_METHODS.map((item) => ({ ...item, disabled: isOffering && item.value === 'Especie' }))}
          hint={isOffering ? 'El pago en especie solo abona a la estadía.' : undefined} />

        {inKind ? (
          <QueryBoundary query={servicesQuery}>
            <Select label="Servicio prestado" value={form.service_type_id} onChange={set('service_type_id')} required
              placeholder="Selecciona el servicio"
              options={services.map((item) => ({
                value: item.id,
                label: `${item.name} · ${formatCurrency(item.hourly_rate)}/h`,
                disabled: Number(item.hourly_rate) <= 0,
              }))} />
            <Input label="Horas de servicio" type="number" min="0.5" step="0.5" max="744" required
              value={form.service_hours} onChange={set('service_hours')}
              hint={service ? `Abona ${formatCurrency(inKindAmount)}` : 'Valor = horas × valor hora'} />
          </QueryBoundary>
        ) : (
          <Input label="Valor" type="number" min="1" step="1" required value={form.amount} onChange={set('amount')}
            hint={Number(form.amount) > 0 ? formatCurrency(form.amount) : undefined} />
        )}

        {form.method === 'Transferencia' && (
          <Input label="Referencia" value={form.reference} onChange={set('reference')} placeholder="Número de comprobante" />
        )}
        <Textarea label="Observaciones" className="sm:col-span-2" value={form.notes} onChange={set('notes')} />
      </form>
    </Dialog>
  )
}
