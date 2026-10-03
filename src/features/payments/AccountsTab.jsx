import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Eye, Pencil, Plus, UserPlus, Wallet } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  KpiCard,
  QueryBoundary,
  SearchInput,
  Select,
  Table,
  Td,
  Tr,
} from '@/components/ui'
import { useMissingPaymentAccounts, usePaymentAccounts, usePaymentSettings } from '@/hooks/useCepev'
import { PAYMENT_CONCEPTS, PAYMENT_STATUS, conceptLabel, conceptRateUnit } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import { formatCurrency, formatDate, formatNumber, matches, todayISO } from '@/lib/utils'
import { AccountDetailDialog, AccountDialog } from './AccountDialogs'
import { MissingAccountsDialog } from './MissingAccountsDialog'
import { PaymentDialog } from './PaymentDialog'

/** ?vista= del panel de inicio -> estado de la cuenta */
const VIEW_STATUS = {
  mora: 'En mora', 'por-vencer': 'Por vencer', pendientes: 'Pendiente', 'sin-cuenta': 'Sin cuenta',
}
/**
 * El estado de cuentas solo lista lo que falta por cobrar: quien debe y quien
 * no tiene cuenta. Quien está al día se consulta en «Pagos registrados».
 */
const STATUS_ORDER = ['En mora', 'Por vencer', 'Pendiente', 'Sin cuenta']
const PAGE_SIZE = 20

export default function AccountsTab() {
  const { canWrite } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const accountsQuery = usePaymentAccounts()
  const settingsQuery = usePaymentSettings()
  const missingQuery = useMissingPaymentAccounts()
  const [search, setSearch] = useState('')
  const [concept, setConcept] = useState('')
  const [modal, setModal] = useState(null)
  const [page, setPage] = useState(1)

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const status = VIEW_STATUS[searchParams.get('vista')] ?? ''
  const setStatus = (value) => {
    setPage(1)
    const next = new URLSearchParams(searchParams)
    const key = Object.keys(VIEW_STATUS).find((item) => VIEW_STATUS[item] === value)
    if (key) next.set('vista', key)
    else next.delete('vista')
    setSearchParams(next, { replace: true })
  }

  const totals = useMemo(() => {
    const by = (value) => accounts.filter((item) => item.status === value)
    const overdue = by('En mora')
    return {
      overdue: overdue.length,
      overdueAmount: overdue.reduce((sum, item) => sum + Number(item.overdue_amount), 0),
      dueSoon: by('Por vencer').length,
      pending: accounts.reduce((sum, item) => sum + Math.max(Number(item.balance), 0), 0),
      upToDate: by('Al dia').length,
    }
  }, [accounts])

  /** Quien aún no tiene cuenta también aparece en la tabla, para abrirla desde ahí. */
  const missing = useMemo(() => missingQuery.data ?? [], [missingQuery.data])
  const allRows = useMemo(() => [
    ...accounts,
    ...missing.map((row) => ({
      ...row,
      id: `sin-cuenta-${row.person_id}`,
      status: 'Sin cuenta',
      withoutAccount: true,
    })),
  ], [accounts, missing])

  const rows = useMemo(() => allRows
    .filter((item) => STATUS_ORDER.includes(item.status)
      && (!status || item.status === status)
      && (!concept || item.concept === concept)
      && matches(`${item.person_name} ${item.document_id ?? ''}`, search))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || (b.days_overdue ?? 0) - (a.days_overdue ?? 0)
      || String(a.next_due_date ?? '').localeCompare(String(b.next_due_date ?? ''))
      || a.person_name.localeCompare(b.person_name, 'es')),
  [allRows, concept, search, status])

  /** Al buscar a alguien que ya está al día, se avisa en vez de no mostrar nada. */
  const settledMatches = useMemo(() => (search
    ? allRows.filter((item) => !STATUS_ORDER.includes(item.status)
      && matches(`${item.person_name} ${item.document_id ?? ''}`, search))
    : []), [allRows, search])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const alertDays = settingsQuery.data?.alert_days_before ?? 5
  const missingCepevistas = missing.filter((row) => row.person_kind === 'Cepevista').length
  const missingColporteurs = missing.length - missingCepevistas
  const missingText = [
    missingCepevistas && `${missingCepevistas} ${missingCepevistas === 1 ? 'cepevista' : 'cepevistas'}`,
    missingColporteurs && `${missingColporteurs} ${missingColporteurs === 1 ? 'colportor' : 'colportores'}`,
  ].filter(Boolean).join(' y ')
  const openConfiguration = () => setSearchParams({ seccion: 'configuracion' }, { replace: true })
  const openPayments = () => setSearchParams({ seccion: 'pagos' }, { replace: true })
  const today = todayISO()

  return (
    <>
      {missingQuery.isError && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-[var(--color-danger-bg)] px-4 py-4 text-sm text-[var(--color-danger-fg)] sm:px-6">
          <p className="font-semibold">No se pudo consultar quién no tiene cuenta de pagos.</p>
          <p className="mt-1">
            Los cepevistas y colportores sin cuenta no aparecen en la tabla hasta resolverlo. {missingQuery.error?.message}
          </p>
        </div>
      )}

      {canWrite && missing.length > 0 && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-100 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 gap-3">
            <UserPlus className="mt-0.5 size-5 shrink-0 text-gold-700" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {missingText} {missing.length === 1 ? 'aún no tiene' : 'aún no tienen'} cuenta de pagos
              </p>
              <p className="text-sm text-ink-soft">
                Sin cuenta no se les generan cuotas ni alertas, y no se les pueden registrar pagos.
              </p>
            </div>
          </div>
          <Button variant="gold" onClick={() => setModal({ type: 'missing' })}>
            Revisar y abrir cuentas <ArrowRight />
          </Button>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="En mora" value={totals.overdue} icon={AlertTriangle}
          detail={totals.overdue ? `${formatCurrency(totals.overdueAmount)} vencido` : 'Nadie pasa un mes debiendo'}
          tone={totals.overdue ? 'red' : 'green'} onClick={() => setStatus('En mora')} />
        <KpiCard label="Por vencer" value={totals.dueSoon} detail={`Vencen en los próximos ${alertDays} días`}
          tone={totals.dueSoon ? 'gold' : 'green'} onClick={() => setStatus('Por vencer')} />
        <KpiCard label="Saldo por cobrar" value={formatCurrency(totals.pending)} icon={Wallet}
          detail="Cuotas generadas sin cubrir" onClick={() => setStatus('Pendiente')} />
        <KpiCard label="Al día" value={totals.upToDate} detail={`De ${formatNumber(accounts.length)} cuentas · ver pagos registrados`}
          tone="green" onClick={openPayments} />
      </div>

      <Card>
        <CardHeader title="Estado de cuentas · por cobrar"
          description="Solo quienes deben o aún no tienen cuenta. Quien está al día sale de esta lista; sus pagos se ven en «Pagos registrados»."
          action={canWrite && <Button onClick={() => setModal({ type: 'payment' })}><Plus /> Registrar pago</Button>} />
        <div className="flex flex-wrap gap-3 border-b border-[#edf1f5] px-4 py-3 sm:px-6">
          <SearchInput placeholder="Buscar por nombre o documento" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Select aria-label="Concepto" className="w-full sm:w-48" value={concept} onChange={(event) => { setConcept(event.target.value); setPage(1) }}
            placeholder="Todos los conceptos"
            options={PAYMENT_CONCEPTS.filter((item) => item.value !== 'Ofrenda').map((item) => ({ value: item.value, label: `${item.label} · ${item.hint}` }))} />
          <Select aria-label="Estado" className="w-full sm:w-44" value={status} onChange={(event) => setStatus(event.target.value)}
            placeholder="Todo lo pendiente" options={STATUS_ORDER.map((value) => ({ value, label: PAYMENT_STATUS[value].label }))} />
        </div>

        <QueryBoundary query={accountsQuery} loadingLabel="Calculando estado de cuentas…">
          <Table columns={['Persona', 'Concepto', 'Ingreso', 'Próximo vencimiento', 'Saldo', 'Estado', '']}>
            {pageRows.map((account) => {
              const tone = PAYMENT_STATUS[account.status] ?? { label: account.status, tone: 'neutral' }
              if (account.withoutAccount) {
                return (
                  <Tr key={account.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={account.person_name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{account.person_name}</p>
                          <p className="text-xs text-ink-soft">{account.document_id ? `${account.document_type} ${account.document_id}` : account.person_kind}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>{conceptLabel(account.concept)}<small className="block text-xs text-ink-soft">{account.person_kind}</small></Td>
                    <Td className="text-ink-soft">—</Td>
                    <Td className="text-ink-soft">—</Td>
                    <Td className="text-ink-soft">—</Td>
                    <Td><Badge tone={tone.tone}>{tone.label}</Badge></Td>
                    <Td>
                      <div className="flex justify-end">
                        {canWrite && (
                          <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'missing', only: account.person_id })}>
                            <UserPlus /> Abrir cuenta
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              }
              const days = Math.round((new Date(`${account.next_due_date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000)
              return (
                <Tr key={account.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={account.person_name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{account.person_name}</p>
                        <p className="text-xs text-ink-soft">{account.document_id ? `${account.document_type} ${account.document_id}` : account.phone ?? '—'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {conceptLabel(account.concept)}
                    <small className="block text-xs text-ink-soft">
                      {formatCurrency(account.monthly_amount)} / {conceptRateUnit(account.concept)}
                      {account.concept === 'Por dias' && account.closed_on && ` · sale ${formatDate(account.closed_on, { day: 'numeric', month: 'short' })}`}
                    </small>
                  </Td>
                  <Td>{formatDate(account.entry_date, { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                  <Td>
                    {account.status === 'Cerrada' ? '—' : formatDate(account.next_due_date, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {account.status !== 'Cerrada' && account.overdue_amount <= 0 && (
                      <small className="block text-xs text-ink-soft">{days === 0 ? 'Vence hoy' : days > 0 ? `En ${days} días` : ''}</small>
                    )}
                  </Td>
                  <Td>
                    <strong>{formatCurrency(Math.max(account.balance, 0))}</strong>
                    {account.overdue_amount > 0 && (
                      <small className="block text-xs text-[var(--color-danger-fg)]">
                        {formatCurrency(account.overdue_amount)} vencido · {account.days_overdue} días
                      </small>
                    )}
                    {account.credit > 0 && <small className="block text-xs text-ink-soft">A favor {formatCurrency(account.credit)}</small>}
                  </Td>
                  <Td><Badge tone={tone.tone}>{tone.label}</Badge></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Ver detalle de ${account.person_name}`}
                        onClick={() => setModal({ type: 'detail', account })}><Eye /></Button>
                      {canWrite && <>
                        <Button size="icon" variant="ghost" aria-label={`Editar cuenta de ${account.person_name}`}
                          onClick={() => setModal({ type: 'account', account })}><Pencil /></Button>
                        <Button size="sm" variant="subtle" onClick={() => setModal({ type: 'payment', account })}>Pagar</Button>
                      </>}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
          {rows.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-ink-soft">
              {allRows.length === 0
                ? 'Aún no hay cepevistas ni colportores registrados.'
                : search || concept || status
                  ? 'Nadie con pagos pendientes coincide con estos filtros.'
                  : 'Nadie tiene pagos pendientes: todos están al día.'}
            </p>
          )}
          {settledMatches.length > 0 && (
            <div className="border-t border-[#edf1f5] px-4 py-3 text-sm text-ink-soft sm:px-6">
              <p className="mb-2">
                {settledMatches.length === 1 ? 'Esta persona coincide' : 'Estas personas coinciden'} con la búsqueda, pero no tiene pagos pendientes:
              </p>
              <ul className="flex flex-col gap-1">
                {settledMatches.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{item.person_name}</span>
                    <Badge tone={PAYMENT_STATUS[item.status]?.tone}>{PAYMENT_STATUS[item.status]?.label ?? item.status}</Badge>
                    <button type="button" className="font-semibold text-navy-600 hover:underline"
                      onClick={() => setModal({ type: 'detail', account: item })}>Ver detalle</button>
                    {canWrite && (
                      <button type="button" className="font-semibold text-navy-600 hover:underline"
                        onClick={() => setModal({ type: 'account', account: item })}>Editar cuenta</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rows.length > PAGE_SIZE && (
            <nav aria-label="Paginación de cuentas"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf1f5] px-4 py-3 text-sm sm:px-6">
              <span className="text-ink-soft">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} de {rows.length}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft /> Anterior
                </Button>
                <span className="px-2 text-ink-soft">Página {currentPage} de {pages}</span>
                <Button size="sm" variant="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
                  Siguiente <ChevronRight />
                </Button>
              </div>
            </nav>
          )}
        </QueryBoundary>
      </Card>

      {modal?.type === 'payment' && (
        <PaymentDialog open onClose={() => setModal(null)} accounts={accounts} account={modal.account} />
      )}
      {modal?.type === 'account' && (
        <AccountDialog open onClose={() => setModal(null)} account={modal.account} />
      )}
      {modal?.type === 'detail' && (
        <AccountDetailDialog open onClose={() => setModal(null)}
          account={accounts.find((item) => item.id === modal.account.id) ?? modal.account} />
      )}
      {modal?.type === 'missing' && (
        <MissingAccountsDialog open onClose={() => setModal(null)} onConfigure={openConfiguration} only={modal.only} />
      )}
    </>
  )
}
