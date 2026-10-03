import { useMemo, useState } from 'react'
import { Ban } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Input,
  KpiCard,
  QueryBoundary,
  SearchInput,
  Select,
  Table,
  Td,
  Tr,
} from '@/components/ui'
import { usePaymentActions, usePayments } from '@/hooks/useCepev'
import { PAYMENT_CONCEPTS, PAYMENT_METHODS, conceptLabel } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { formatCurrency, formatDate, matches, todayISO } from '@/lib/utils'

const monthStart = () => `${todayISO().slice(0, 8)}01`
const CONCEPT_TONES = { Mensualidad: 'navy', 'Por dias': 'navy', Siembra: 'gold', Ofrenda: 'green' }

export default function PaymentsTab() {
  const { canWrite } = useAuth()
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(todayISO)
  const [concept, setConcept] = useState('')
  const [method, setMethod] = useState('')
  const [search, setSearch] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const paymentsQuery = usePayments(from, to)
  const actions = usePaymentActions()

  const rows = useMemo(() => (paymentsQuery.data ?? []).filter((payment) =>
    (showVoided || !payment.is_voided)
    && (!concept || payment.concept === concept)
    && (!method || payment.method === method)
    && matches(`${payment.person_name ?? ''} ${payment.reference ?? ''}`, search)),
  [concept, method, paymentsQuery.data, search, showVoided])

  const totals = useMemo(() => {
    const valid = (paymentsQuery.data ?? []).filter((payment) => !payment.is_voided)
    const sum = (filter) => valid.filter(filter).reduce((total, payment) => total + Number(payment.amount), 0)
    return {
      stay: sum((payment) => payment.concept !== 'Ofrenda' && payment.method !== 'Especie'),
      inKind: sum((payment) => payment.method === 'Especie'),
      inKindHours: valid.filter((payment) => payment.method === 'Especie').reduce((total, payment) => total + Number(payment.service_hours), 0),
      offerings: sum((payment) => payment.concept === 'Ofrenda'),
      count: valid.length,
    }
  }, [paymentsQuery.data])

  const submitVoid = (event) => {
    event.preventDefault()
    actions.void.mutate(voiding, { onSuccess: () => setVoiding(null) })
  }

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Recaudo de estadías" value={formatCurrency(totals.stay)} detail="Mensualidades y siembras en dinero"
          onClick={() => { setConcept(''); setMethod('') }} />
        <KpiCard label="Pagos en especie" value={formatCurrency(totals.inKind)} tone="gold"
          detail={`${totals.inKindHours} horas de servicio`} onClick={() => setMethod('Especie')} />
        <KpiCard label="Ofrendas" value={formatCurrency(totals.offerings)} tone="green"
          detail="No abonan a la estadía" onClick={() => setConcept('Ofrenda')} />
        <KpiCard label="Pagos registrados" value={totals.count} detail="Sin contar anulados" />
      </div>

      <Card>
        <CardHeader title="Pagos registrados" description="Los pagos no se borran. Un error se corrige anulando el pago con su motivo." />
        <div className="flex flex-wrap items-end gap-3 border-b border-[#edf1f5] px-4 py-3 sm:px-6">
          <Input label="Desde" type="date" className="w-full sm:w-40" value={from} max={to} onChange={(event) => setFrom(event.target.value || monthStart())} />
          <Input label="Hasta" type="date" className="w-full sm:w-40" value={to} min={from} max={todayISO()} onChange={(event) => setTo(event.target.value || todayISO())} />
          <Select aria-label="Concepto" className="w-full sm:w-44" value={concept} onChange={(event) => setConcept(event.target.value)}
            placeholder="Todos los conceptos" options={PAYMENT_CONCEPTS} />
          <Select aria-label="Forma de pago" className="w-full sm:w-44" value={method} onChange={(event) => setMethod(event.target.value)}
            placeholder="Todas las formas" options={PAYMENT_METHODS.map((item) => ({ value: item.value, label: item.value }))} />
          <SearchInput placeholder="Persona o referencia" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="flex h-11 items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={showVoided} onChange={(event) => setShowVoided(event.target.checked)} />
            Mostrar anulados
          </label>
        </div>
        <QueryBoundary query={paymentsQuery} loadingLabel="Cargando pagos…">
          <Table columns={['Fecha', 'Persona', 'Concepto', 'Forma', 'Valor', 'Detalle', '']}>
            {rows.map((payment) => (
              <Tr key={payment.id} className={payment.is_voided ? 'opacity-60' : undefined}>
                <Td>{formatDate(payment.paid_on, { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                <Td>{payment.person_name ?? 'Anónimo'}</Td>
                <Td><Badge tone={CONCEPT_TONES[payment.concept]}>{conceptLabel(payment.concept)}</Badge></Td>
                <Td>{payment.method}</Td>
                <Td className={payment.is_voided ? 'line-through' : 'font-semibold'}>{formatCurrency(payment.amount)}</Td>
                <Td className="max-w-64 text-xs text-ink-soft">
                  {payment.method === 'Especie' && <span className="block">{payment.service_hours} h de {payment.service_type_name} × {formatCurrency(payment.hourly_rate)}</span>}
                  {payment.reference && <span className="block">Ref. {payment.reference}</span>}
                  {payment.is_voided
                    ? <span className="block text-[var(--color-danger-fg)]">Anulado: {payment.voided_reason}</span>
                    : payment.notes && <span className="block">{payment.notes}</span>}
                  <span className="block">Registró: {payment.created_by_name ?? '—'}</span>
                </Td>
                <Td className="text-right">
                  {canWrite && !payment.is_voided && (
                    <Button size="sm" variant="ghost" onClick={() => setVoiding({ id: payment.id, reason: '', payment })}>
                      <Ban /> Anular
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
          {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-ink-soft">No hay pagos en este periodo.</p>}
        </QueryBoundary>
      </Card>

      <Dialog open={Boolean(voiding)} size="sm" onClose={() => { if (!actions.void.isPending) setVoiding(null) }}
        title="Anular pago"
        description={voiding ? `${voiding.payment.person_name ?? 'Anónimo'} · ${formatCurrency(voiding.payment.amount)} · ${conceptLabel(voiding.payment.concept)}` : ''}
        footer={<>
          <Button variant="secondary" disabled={actions.void.isPending} onClick={() => setVoiding(null)}>Cancelar</Button>
          <Button variant="danger" type="submit" form="void-form" disabled={!voiding?.reason.trim()} loading={actions.void.isPending}>Anular pago</Button>
        </>}>
        <form id="void-form" onSubmit={submitVoid}>
          <Input label="Motivo de la anulación" required value={voiding?.reason ?? ''}
            onChange={(event) => setVoiding({ ...voiding, reason: event.target.value })}
            hint="El saldo de la cuenta se recalcula. Queda registrado en la bitácora." />
        </form>
      </Dialog>
    </>
  )
}
