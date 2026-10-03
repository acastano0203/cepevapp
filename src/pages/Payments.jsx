import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import { LoadingState } from '@/components/ui'

const AccountsTab = lazy(() => import('@/features/payments/AccountsTab'))
const PaymentsTab = lazy(() => import('@/features/payments/PaymentsTab'))
const SettingsTab = lazy(() => import('@/features/payments/SettingsTab'))

const TABS = [
  { id: 'cuentas', label: 'Estado de cuentas' },
  { id: 'pagos', label: 'Pagos registrados' },
  { id: 'configuracion', label: 'Configuración' },
]

export default function Payments() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TABS.some((item) => item.id === searchParams.get('seccion')) ? searchParams.get('seccion') : 'cuentas'
  const setTab = (value) => {
    const next = new URLSearchParams()
    if (value !== 'cuentas') next.set('seccion', value)
    setSearchParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="Pagos" subtitle="Mensualidades de cepevistas, siembras de colportores, ofrendas y pagos en especie.">
        <TodayChip />
      </PageHeader>

      <div role="tablist" aria-label="Secciones de pagos" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={
              'relative -mb-px min-h-11 px-3 text-sm font-medium transition-colors sm:px-4 ' +
              (tab === item.id
                ? 'border-b-2 border-navy-600 text-navy-700'
                : 'border-b-2 border-transparent text-ink-soft hover:text-ink')
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<LoadingState label="Cargando sección…" />}>
        {tab === 'cuentas' && <AccountsTab />}
        {tab === 'pagos' && <PaymentsTab />}
        {tab === 'configuracion' && <SettingsTab />}
      </Suspense>
    </>
  )
}
