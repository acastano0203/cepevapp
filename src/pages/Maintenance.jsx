import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Power } from 'lucide-react'
import { PageHeader, TodayChip } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Input,
  KpiCard,
  QueryBoundary,
  SearchInput,
  Select,
} from '@/components/ui'
import { ReportForm } from '@/features/maintenance/ReportForm'
import { ReportItem } from '@/features/maintenance/ReportItem'
import { useMaintenanceActions, useMaintenanceAreas, useMaintenanceReports } from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { MAINTENANCE_TYPES, areaLabel } from '@/lib/constants'
import { formatCurrency, matches, todayISO } from '@/lib/utils'

const PAGE_SIZE = 20

/** Vista del servidor y del capitán: reportar y seguir sus propios reportes. */
function ReporterView() {
  const reportsQuery = useMaintenanceReports()
  // Si el perfil también lee la operación, la consulta trae todo: aquí solo lo propio
  const reports = (reportsQuery.data ?? []).filter((report) => report.is_mine)
  const pending = reports.filter((report) => report.status !== 'Resuelto')

  return (
    <>
      <PageHeader title="Reportar mantenimiento"
        subtitle="Daños, reparaciones, mantenimiento o limpieza en cualquier área del CEPEV. La administración recibe el reporte y te informa su avance aquí." />
      <Card className="mb-5">
        <CardHeader title="Nuevo reporte" />
        <CardBody><ReportForm /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Mis reportes"
          description={`${pending.length} ${pending.length === 1 ? 'pendiente' : 'pendientes'} · ${reports.length - pending.length} resueltos`} />
        <QueryBoundary query={reportsQuery} empty="Aún no has enviado reportes.">
          <ul className="divide-y divide-[#edf1f5]">
            {reports.map((report) => <ReportItem key={report.id} report={report} />)}
          </ul>
        </QueryBoundary>
      </Card>
    </>
  )
}

/** Áreas del CEPEV (solo administración las cambia). */
function AreasCard() {
  const { isAdmin } = useAuth()
  const areasQuery = useMaintenanceAreas()
  const actions = useMaintenanceActions()
  const [name, setName] = useState('')

  return (
    <Card className="mt-5">
      <CardHeader title="Áreas del CEPEV" description="Las áreas inactivas no aparecen al reportar; sus reportes se conservan." />
      <QueryBoundary query={areasQuery}>
        <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-6">
          {(areasQuery.data ?? []).map((area) => (
            <Badge key={area.id} tone={area.is_active ? 'navy' : 'neutral'} className="gap-1.5">
              {areaLabel(area.name)}{!area.is_active && ' (inactiva)'}
              {isAdmin && (
                <button type="button" title={area.is_active ? 'Desactivar' : 'Activar'}
                  aria-label={`${area.is_active ? 'Desactivar' : 'Activar'} ${areaLabel(area.name)}`}
                  className="rounded p-0.5 hover:bg-navy-100" disabled={actions.saveArea.isPending}
                  onClick={() => actions.saveArea.mutate({ id: area.id, name: area.name, is_active: !area.is_active })}>
                  <Power className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        {isAdmin && (
          <form className="flex flex-wrap items-end gap-2 border-t border-[#edf1f5] px-4 py-4 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault()
              actions.saveArea.mutate({ name }, { onSuccess: () => setName('') })
            }}>
            <Input label="Nueva área" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Gimnasio" />
            <Button type="submit" variant="secondary" disabled={!name.trim()} loading={actions.saveArea.isPending}><Plus /> Agregar</Button>
          </form>
        )}
      </QueryBoundary>
    </Card>
  )
}

/** Vista de la operación: todos los reportes, gestión y áreas. */
function OperationView() {
  const { isAdmin, canReport } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const reportsQuery = useMaintenanceReports()
  const areasQuery = useMaintenanceAreas()
  const [reporting, setReporting] = useState(false)
  const [search, setSearch] = useState('')
  const [area, setArea] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const status = searchParams.get('vista') ?? 'pendientes'
  const setStatus = (value) => {
    setPage(1)
    const next = new URLSearchParams(searchParams)
    if (value === 'pendientes') next.delete('vista')
    else next.set('vista', value)
    setSearchParams(next, { replace: true })
  }

  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data])
  const month = todayISO().slice(0, 7)
  const totals = useMemo(() => {
    const open = reports.filter((report) => report.status === 'Abierto')
    const resolvedMonth = reports.filter((report) => report.status === 'Resuelto' && report.resolved_at?.slice(0, 7) === month)
    return {
      open: open.length,
      urgent: reports.filter((report) => report.status !== 'Resuelto' && report.priority === 'Urgente').length,
      inProgress: reports.filter((report) => report.status === 'En proceso').length,
      resolvedMonth: resolvedMonth.length,
      costMonth: resolvedMonth.reduce((sum, report) => sum + Number(report.cost_cop ?? 0), 0),
    }
  }, [month, reports])

  const rows = useMemo(() => reports
    .filter((report) => {
      if (status === 'pendientes' && report.status === 'Resuelto') return false
      if (status === 'urgentes' && (report.status === 'Resuelto' || report.priority !== 'Urgente')) return false
      if (['Abierto', 'En proceso', 'Resuelto'].includes(status) && report.status !== status) return false
      if (area && report.area_id !== area) return false
      if (type && report.report_type !== type) return false
      return matches(`${report.area_name} ${report.room_code ?? ''} ${report.location_detail ?? ''} ${report.detail} ${report.reported_by_name ?? ''} ${report.assigned_to ?? ''}`, search)
    })
    // Urgentes primero entre los pendientes; luego lo más reciente
    .sort((a, b) => (a.status === 'Resuelto') - (b.status === 'Resuelto')
      || (b.priority === 'Urgente') - (a.priority === 'Urgente')
      || b.created_at.localeCompare(a.created_at)),
  [area, reports, search, status, type])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <>
      <PageHeader title="Mantenimiento" subtitle="Daños, reparaciones, mantenimiento y limpieza de todas las áreas del CEPEV.">
        <TodayChip />
        {canReport && <Button onClick={() => setReporting(true)}><Plus /> Reportar</Button>}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Abiertos" value={totals.open} detail="Sin atender todavía" tone={totals.open ? 'red' : 'green'} onClick={() => setStatus('Abierto')} />
        <KpiCard label="Urgentes pendientes" value={totals.urgent} detail="Riesgo o área que no se puede usar" tone={totals.urgent ? 'red' : 'green'} onClick={() => setStatus('urgentes')} />
        <KpiCard label="En proceso" value={totals.inProgress} detail="Con responsable asignado" tone="gold" onClick={() => setStatus('En proceso')} />
        <KpiCard label="Resueltos este mes" value={totals.resolvedMonth}
          detail={totals.costMonth ? `Costo: ${formatCurrency(totals.costMonth)}` : 'Sin costos registrados'} tone="green" onClick={() => setStatus('Resuelto')} />
      </div>

      <Card>
        <CardHeader title="Reportes" description={`${rows.length} ${rows.length === 1 ? 'reporte' : 'reportes'} en esta vista`} />
        <div className="flex flex-wrap gap-3 border-b border-[#edf1f5] px-4 py-3 sm:px-6">
          <SearchInput placeholder="Buscar por lugar, detalle o persona" value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Select aria-label="Estado" className="w-full sm:w-44" value={status} onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: 'pendientes', label: 'Pendientes' },
              { value: 'urgentes', label: 'Urgentes pendientes' },
              { value: 'Abierto', label: 'Abiertos' },
              { value: 'En proceso', label: 'En proceso' },
              { value: 'Resuelto', label: 'Resueltos' },
              { value: 'todos', label: 'Todos' },
            ]} />
          <Select aria-label="Área" className="w-full sm:w-48" value={area} placeholder="Todas las áreas"
            onChange={(event) => { setArea(event.target.value); setPage(1) }}
            options={(areasQuery.data ?? []).map((item) => ({ value: item.id, label: areaLabel(item.name) }))} />
          <Select aria-label="Tipo" className="w-full sm:w-40" value={type} placeholder="Todos los tipos"
            onChange={(event) => { setType(event.target.value); setPage(1) }} options={MAINTENANCE_TYPES} />
        </div>
        <QueryBoundary query={reportsQuery} loadingLabel="Cargando reportes…">
          {rows.length === 0
            ? <p className="px-6 py-10 text-center text-sm text-ink-soft">
                {reports.length === 0 ? 'Aún no hay reportes de mantenimiento.' : 'No hay reportes en esta vista.'}
              </p>
            : <ul className="divide-y divide-[#edf1f5]">
                {pageRows.map((report) => <ReportItem key={report.id} report={report} canManage={isAdmin} />)}
              </ul>}
          {rows.length > PAGE_SIZE && (
            <nav aria-label="Paginación de reportes" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf1f5] px-4 py-3 text-sm sm:px-6">
              <span className="text-ink-soft">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} de {rows.length}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button>
                <Button size="sm" variant="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</Button>
              </div>
            </nav>
          )}
        </QueryBoundary>
      </Card>

      <AreasCard />

      <Dialog open={reporting} size="lg" onClose={() => setReporting(false)} title="Reportar mantenimiento"
        description="Queda abierto hasta que la administración lo gestione.">
        <ReportForm onDone={() => setReporting(false)} />
      </Dialog>
    </>
  )
}

export default function Maintenance() {
  const { reporterOnly } = useAuth()
  return reporterOnly ? <ReporterView /> : <OperationView />
}
