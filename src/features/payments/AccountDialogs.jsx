import { useState } from 'react'
import { Badge, Button, Dialog, Input, QueryBoundary, Table, Td, Textarea, Tr } from '@/components/ui'
import {
  useAccountPayments,
  usePaymentActions,
  usePaymentCharges,
  usePaymentSettings,
} from '@/hooks/useCepev'
import { CHARGE_STATUS_TONES, PAYMENT_STATUS, conceptLabel, conceptRateUnit } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { addDays, formatCurrency, formatDate } from '@/lib/utils'
import { ConceptFields } from './ConceptFields'

/**
 * Edita la cuenta de pagos de un cepevista o colportor. Las cuentas nuevas se
 * abren desde la ficha o desde «Revisar y abrir cuentas».
 */
export function AccountDialog({ open, onClose, account }) {
  const actions = usePaymentActions()
  const settingsQuery = usePaymentSettings()
  const [form, setForm] = useState(() => ({
    id: account.id,
    person_id: account.person_id,
    concept: account.concept,
    entry_date: account.entry_date,
    monthly_amount: String(account.monthly_amount),
    closed_on: account.closed_on ?? '',
    notes: account.notes ?? '',
  }))
  const patch = (values) => setForm((current) => ({ ...current, ...values }))

  const daily = form.concept === 'Por dias'
  const recalculates = account.entry_date !== form.entry_date || account.concept !== form.concept
    || (daily && ((account.closed_on ?? '') !== form.closed_on || Number(account.monthly_amount) !== Number(form.monthly_amount)))
  const rateChanged = !recalculates && form.monthly_amount !== '' && Number(form.monthly_amount) !== Number(account.monthly_amount)
  const pending = actions.saveAccount.isPending

  const close = () => { if (!pending) onClose() }
  const submit = (event) => {
    event.preventDefault()
    actions.saveAccount.mutate(form, { onSuccess: onClose })
  }

  return (
    <Dialog open={open} onClose={close} title={`Cuenta de ${account.person_name}`}
      description={`${account.person_kind} · ${conceptLabel(account.concept)}`}
      footer={<>
        <Button variant="secondary" disabled={pending} onClick={close}>Cancelar</Button>
        <Button type="submit" form="account-form" disabled={!form.entry_date || (daily && !form.closed_on)} loading={pending}>
          Guardar cambios
        </Button>
      </>}>
      <form id="account-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <ConceptFields kind={account.person_kind} value={form} settings={settingsQuery.data} onChange={patch} />
        {!daily && (
          <Input label="Fecha de salida" type="date" min={addDays(form.entry_date, 1)} value={form.closed_on}
            onChange={(event) => patch({ closed_on: event.target.value })}
            hint="No se generan ciclos desde esta fecha. La deuda pendiente se conserva." />
        )}
        <Textarea label="Observaciones" className="sm:col-span-2" value={form.notes}
          onChange={(event) => patch({ notes: event.target.value })} placeholder="Beca, acuerdo de pago…" />
        {recalculates && (
          <p role="alert" className="rounded-lg bg-gold-100 px-3 py-3 text-sm text-gold-700 sm:col-span-2">
            Este cambio recalcula todas las cuotas y descarta sus ajustes. Los pagos se conservan y se vuelven a aplicar.
          </p>
        )}
        {rateChanged && (
          <p className="rounded-lg bg-navy-50 px-3 py-3 text-sm text-ink-soft sm:col-span-2">
            El nuevo valor rige desde el próximo ciclo; las cuotas ya generadas conservan su valor.
          </p>
        )}
      </form>
    </Dialog>
  )
}

/** Cuotas y pagos de una cuenta. La administración puede ajustar una cuota. */
export function AccountDetailDialog({ open, onClose, account }) {
  const { isAdmin } = useAuth()
  const actions = usePaymentActions()
  const chargesQuery = usePaymentCharges(account?.id)
  const paymentsQuery = useAccountPayments(account?.id)
  const [adjusting, setAdjusting] = useState(null)

  const submitAdjust = (event) => {
    event.preventDefault()
    actions.adjustCharge.mutate(adjusting, { onSuccess: () => setAdjusting(null) })
  }

  if (!account) return null
  const status = PAYMENT_STATUS[account.status] ?? { label: account.status, tone: 'neutral' }

  return (
    <Dialog open={open} onClose={() => { if (!actions.adjustCharge.isPending) onClose() }} size="lg"
      title={account.person_name}
      description={`${conceptLabel(account.concept)} · ingreso ${formatDate(account.entry_date, { day: 'numeric', month: 'long', year: 'numeric' })} · ${formatCurrency(account.monthly_amount)} por ${conceptRateUnit(account.concept)}${account.closed_on ? ` · salida ${formatDate(account.closed_on, { day: 'numeric', month: 'long' })}` : ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span>Saldo: <strong>{formatCurrency(Math.max(account.balance, 0))}</strong></span>
        {account.credit > 0 && <span>· A favor: <strong>{formatCurrency(account.credit)}</strong></span>}
        {account.overdue_amount > 0 && (
          <span className="text-[var(--color-danger-fg)]">· {formatCurrency(account.overdue_amount)} vencido hace {account.days_overdue} días</span>
        )}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-ink">Cuotas por ciclo</h3>
      <QueryBoundary query={chargesQuery} empty="Aún no inicia el primer ciclo.">
        <Table columns={['Ciclo', 'Vence', 'Cuota', 'Abonado', 'Estado', '']}>
          {(chargesQuery.data ?? []).map((charge) => (
            <Tr key={charge.id}>
              <Td>{formatDate(charge.period_start)} – {formatDate(charge.due_date)}</Td>
              <Td>{formatDate(charge.due_date, { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
              <Td>
                {formatCurrency(charge.amount)}
                {charge.adjust_reason && <small className="block text-xs text-ink-soft">Ajuste: {charge.adjust_reason}</small>}
              </Td>
              <Td>{formatCurrency(charge.paid_amount)}</Td>
              <Td><Badge tone={CHARGE_STATUS_TONES[charge.status]}>{charge.status}</Badge></Td>
              <Td className="text-right">
                {isAdmin && (
                  <Button size="sm" variant="ghost"
                    onClick={() => setAdjusting({ id: charge.id, amount: String(charge.amount), reason: charge.adjust_reason ?? '' })}>
                    Ajustar
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </QueryBoundary>

      <h3 className="mt-5 mb-2 text-sm font-semibold text-ink">Pagos</h3>
      <QueryBoundary query={paymentsQuery} empty="Sin pagos registrados.">
        <Table columns={['Fecha', 'Forma', 'Valor', 'Detalle']}>
          {(paymentsQuery.data ?? []).map((payment) => (
            <Tr key={payment.id} className={payment.is_voided ? 'opacity-60' : undefined}>
              <Td>{formatDate(payment.paid_on, { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
              <Td>{payment.method}</Td>
              <Td className={payment.is_voided ? 'line-through' : undefined}>{formatCurrency(payment.amount)}</Td>
              <Td className="text-xs text-ink-soft">
                {payment.method === 'Especie' && `${payment.service_hours} h de ${payment.service_type_name} · `}
                {payment.reference && `Ref. ${payment.reference} · `}
                {payment.is_voided ? `Anulado: ${payment.voided_reason}` : payment.notes}
              </Td>
            </Tr>
          ))}
        </Table>
      </QueryBoundary>

      {adjusting && (
        <form onSubmit={submitAdjust} className="mt-5 grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Input label="Nuevo valor de la cuota" type="number" min="0" step="1" required value={adjusting.amount}
            onChange={(event) => setAdjusting({ ...adjusting, amount: event.target.value })} />
          <Input label="Motivo" required value={adjusting.reason} placeholder="Beca, descuento, corrección…"
            onChange={(event) => setAdjusting({ ...adjusting, reason: event.target.value })} />
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setAdjusting(null)}>Cancelar</Button>
            <Button type="submit" disabled={!adjusting.reason.trim()} loading={actions.adjustCharge.isPending}>Guardar</Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
