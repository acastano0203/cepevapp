import { useMemo, useState } from 'react'
import { Download, Printer, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardHeader, Input, KpiCard, QueryBoundary, Select, Table, Td, Tr } from '@/components/ui'
import { useColporteurReports } from '@/hooks/useCepev'
import { addDays, formatNumber, todayISO } from '@/lib/utils'
import { filterReports, summarizeReports, reportsCsv, reportJson, reportPrintHtml } from './reporting'

const defaults = () => ({ from: addDays(todayISO(), -6), to: todayISO(), name: '', city: '', team: '', min: '', max: '', sort: 'date' })
const PAGE_SIZE = 50

function download(content, mime, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ReportsTab() {
  const [filters, setFilters] = useState(defaults)
  const [page, setPage] = useState(0)
  const [format, setFormat] = useState('csv')
  const validDates = Boolean(filters.from && filters.to && filters.from <= filters.to && filters.to <= todayISO())
  const validBooks = (filters.min === '' || (Number.isInteger(Number(filters.min)) && Number(filters.min) >= 0))
    && (filters.max === '' || (Number.isInteger(Number(filters.max)) && Number(filters.max) >= 0))
    && (filters.min === '' || filters.max === '' || Number(filters.min) <= Number(filters.max))
  const query = useColporteurReports(filters.from, filters.to, validDates)
  const allRows = useMemo(() => query.data ?? [], [query.data])
  const rows = useMemo(() => validBooks ? filterReports(allRows, filters) : [], [allRows, filters, validBooks])
  const totals = summarizeReports(rows)
  const cities = [...new Set(allRows.map((row) => row.city_label))].sort((a, b) => a.localeCompare(b, 'es'))
  const teams = [...new Map(allRows.filter((row) => row.team_id).map((row) => [row.team_id, row.team_name])).entries()]
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)
  const activePage = Math.min(page, lastPage)
  const visible = rows.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)
  const update = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }))
    setPage(0)
  }
  const ready = validDates && validBooks && query.isSuccess && !query.isFetching
  const exportRows = () => {
    if (!ready || !rows.length) return
    const filename = 'colportores_' + filters.from + '_' + filters.to
    if (format === 'csv') download(reportsCsv(rows), 'text/csv;charset=utf-8', filename + '.csv')
    if (format === 'json') download(reportJson(rows, filters), 'application/json;charset=utf-8', filename + '.json')
    if (format === 'pdf') {
      const popup = window.open('', '_blank')
      if (!popup) { toast.error('Permite las ventanas emergentes para imprimir o guardar el PDF.'); return }
      popup.opener = null
      popup.document.write(reportPrintHtml(rows, {
        ...filters, teamLabel: teams.find(([id]) => id === filters.team)?.[1] ?? '',
      }))
      popup.document.close()
      popup.focus()
      popup.setTimeout(() => popup.print(), 250)
    }
  }
  return <>
    <Card className="mb-5">
      <CardHeader title="Reportes" description="Filtra las ventas registradas. Los indicadores y la exportación muestran todos los resultados del filtro." />
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Input label="Desde" type="date" required max={filters.to || todayISO()} value={filters.from} onChange={update('from')} />
        <Input label="Hasta" type="date" required min={filters.from} max={todayISO()} value={filters.to} onChange={update('to')} />
        <Input label="Nombre del colportor" type="search" placeholder="Buscar por nombre" value={filters.name} onChange={update('name')} />
        <Select label="Municipio de la venta" value={filters.city} onChange={update('city')} placeholder="Todos los municipios"
          options={cities.map((city) => ({ value: city, label: city }))} />
        <Select label="Equipo" value={filters.team} onChange={update('team')} placeholder="Todos los equipos"
          options={teams.map(([id, name]) => ({ value: id, label: name }))} />
        <Input label="Mínimo de libros por reporte" type="number" min="0" step="1" value={filters.min} onChange={update('min')} placeholder="Sin mínimo" />
        <Input label="Máximo de libros por reporte" type="number" min="0" step="1" value={filters.max} onChange={update('max')} placeholder="Sin máximo" />
        <Select label="Ordenar por" value={filters.sort} onChange={update('sort')} options={[
          { value: 'date', label: 'Fecha más reciente' }, { value: 'books-desc', label: 'Más libros vendidos' },
          { value: 'books-asc', label: 'Menos libros vendidos' }, { value: 'name', label: 'Nombre' },
        ]} />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
          <Button variant="ghost" onClick={() => { setFilters(defaults()); setPage(0) }}><RotateCcw /> Limpiar filtros</Button>
          <span className="text-xs text-ink-soft">Los filtros de libros se aplican a cada reporte diario.</span>
        </div>
      </div>
    </Card>
    {!validDates ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Elige un periodo válido, con fecha final hasta hoy.</p>
      : !validBooks ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">El mínimo y máximo deben ser positivos o cero, y el máximo no puede ser menor al mínimo.</p>
      : <QueryBoundary query={query}>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Libros vendidos" value={formatNumber(totals.books)} detail="Total del filtro" />
          <KpiCard label="Colportores" value={formatNumber(totals.people)} detail="Con reportes en este filtro" />
          <KpiCard label="Reportes registrados" value={formatNumber(totals.reports)} detail="Incluye reportes con cero ventas" />
          <KpiCard label="Libros por reporte" value={totals.average.toLocaleString('es-CO')} detail="Promedio de los reportes filtrados" />
        </div>
        <Card>
          <CardHeader title="Detalle de ventas" description="Se conserva el municipio y equipo registrados en cada venta."
            action={<div className="flex flex-wrap items-end gap-2">
              <Select label="Formato de exportación" value={format} onChange={(event) => setFormat(event.target.value)} options={[
                { value: 'csv', label: 'CSV (Excel)' }, { value: 'pdf', label: 'Imprimir / guardar PDF' }, { value: 'json', label: 'JSON' },
              ]} />
              <Button disabled={!ready || !rows.length} onClick={exportRows}>
                {format === 'pdf' ? <Printer /> : <Download />} {format === 'pdf' ? 'Imprimir / PDF' : 'Exportar'}
              </Button>
            </div>} />
          <Table columns={['Fecha', 'Colportor', 'Municipio', 'Equipo al registrar', 'Libros vendidos']}>
            {visible.map((row) => <Tr key={row.id}>
              <Td>{row.report_date}</Td><Td><strong>{row.full_name}</strong></Td>
              <Td>{row.city_label}</Td><Td>{row.team_name}</Td><Td><Badge>{formatNumber(row.books_sold)}</Badge></Td>
            </Tr>)}
          </Table>
          {!rows.length && <p className="p-8 text-center text-sm text-ink-soft">No hay reportes con estos filtros. Prueba otro periodo o limpia los filtros.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm">
            <span>{rows.length ? activePage * PAGE_SIZE + 1 : 0}–{Math.min((activePage + 1) * PAGE_SIZE, rows.length)} de {formatNumber(rows.length)} reportes. Exportar incluye todos.</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Anterior</Button>
              <Button variant="secondary" disabled={activePage >= lastPage} onClick={() => setPage(activePage + 1)}>Siguiente</Button>
            </div>
          </div>
        </Card>
      </QueryBoundary>}
  </>
}
