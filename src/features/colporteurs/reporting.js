export function normalizeSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
}

export function rotationStatus(rotation, today) {
  if (rotation.end_date <= today) return 'Finalizada'
  if (rotation.start_date > today) return 'Programada'
  return 'Vigente'
}

export function filterReports(rows, filters) {
  return rows.filter((row) => {
    if (filters.name && !normalizeSearch(row.full_name).includes(normalizeSearch(filters.name))) return false
    if (filters.city && row.city_label !== filters.city) return false
    if (filters.team && row.team_id !== filters.team) return false
    if (filters.min !== '' && Number(row.books_sold) < Number(filters.min)) return false
    if (filters.max !== '' && Number(row.books_sold) > Number(filters.max)) return false
    return true
  }).sort((a, b) => {
    if (filters.sort === 'books-desc') return b.books_sold - a.books_sold || a.full_name.localeCompare(b.full_name, 'es')
    if (filters.sort === 'books-asc') return a.books_sold - b.books_sold || a.full_name.localeCompare(b.full_name, 'es')
    if (filters.sort === 'name') return a.full_name.localeCompare(b.full_name, 'es') || b.report_date.localeCompare(a.report_date)
    return b.report_date.localeCompare(a.report_date) || a.full_name.localeCompare(b.full_name, 'es')
  })
}

export function summarizeReports(rows) {
  const books = rows.reduce((sum, row) => sum + Number(row.books_sold), 0)
  return {
    books,
    people: new Set(rows.map((row) => row.person_id)).size,
    reports: rows.length,
    average: rows.length ? Math.round(books / rows.length * 10) / 10 : 0,
  }
}

export const REPORT_COLUMNS = ['Fecha', 'Colportor', 'Municipio', 'Equipo al registrar', 'Libros vendidos']
export const reportValues = (row) => [row.report_date, row.full_name, row.city_label, row.team_name, Number(row.books_sold)]

export function csvCell(value) {
  if (typeof value === 'number') return String(value)
  let text = String(value ?? '')
  // Prevent spreadsheet formulas, including whitespace/control-character prefixes.
  // eslint-disable-next-line no-control-regex -- Control prefixes must not bypass CSV formula protection.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

export function reportsCsv(rows) {
  return '\uFEFF' + [REPORT_COLUMNS, ...rows.map(reportValues)]
    .map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function reportJson(rows, filters) {
  return JSON.stringify({
    periodo: { desde: filters.from, hasta: filters.to },
    filtros: filters,
    indicadores: summarizeReports(rows),
    reportes: rows.map((row) => ({
      fecha: row.report_date, colportor: row.full_name, municipio: row.city_label,
      codigo_municipio: row.municipality_code, equipo: row.team_name, libros_vendidos: Number(row.books_sold),
    })),
  }, null, 2)
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

export function reportPrintHtml(rows, filters) {
  const totals = summarizeReports(rows)
  const criteria = [
    filters.name && 'Nombre: ' + filters.name,
    filters.city && 'Municipio: ' + filters.city,
    filters.team && 'Equipo: ' + filters.teamLabel,
    filters.min !== '' && 'Mínimo: ' + filters.min,
    filters.max !== '' && 'Máximo: ' + filters.max,
  ].filter(Boolean).join(' · ') || 'Sin filtros adicionales'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de colportores</title>
<style>
@page{size:A4 landscape;margin:14mm}body{font:12px Arial,sans-serif;color:#19354d}
h1{font-size:23px}p{line-height:1.6}.kpis{display:flex;gap:24px;margin:20px 0}
table{width:100%;border-collapse:collapse}th,td{padding:8px;text-align:left;border-bottom:1px solid #ddd}
thead{display:table-header-group}tr{break-inside:avoid}th{background:#edf3f8}
small{color:#50657a}@media print{button{display:none}}button{padding:12px;margin-bottom:16px}
</style></head><body><h1>CEPEV · Reporte de colportores</h1>
<p>${escapeHtml(filters.from)} al ${escapeHtml(filters.to)}<br>${escapeHtml(criteria)}</p>
<div class="kpis"><strong>${totals.books} libros vendidos</strong><strong>${totals.people} colportores</strong>
<strong>${totals.reports} reportes</strong><strong>${totals.average} libros / reporte</strong></div>
<table><thead><tr>${REPORT_COLUMNS.map((column) => '<th>' + escapeHtml(column) + '</th>').join('')}</tr></thead>
<tbody>${rows.map((row) => '<tr>' + reportValues(row).map((value) => '<td>' + escapeHtml(value) + '</td>').join('') + '</tr>').join('')}</tbody></table>
<p><small>Municipio y equipo conservados al registrar la venta. Los reportes con cero ventas se incluyen; los días sin reporte no se cuentan como cero.</small></p>
</body></html>`
}
