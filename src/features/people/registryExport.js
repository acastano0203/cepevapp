import { csvCell, escapeHtml } from '@/features/colporteurs/reporting'
import { PERSON_CLASSIFICATIONS } from '@/lib/constants'
import { formatDate, todayISO } from '@/lib/utils'

const classificationLabel = (value) =>
  PERSON_CLASSIFICATIONS.find((item) => item.value === value)?.label ?? value ?? 'Sin clasificar'

const documentOf = (row) => (row.document_id ? `${row.document_type ?? ''} ${row.document_id}`.trim() : '')

/**
 * Columnas de la exportación según el tipo de persona: las mismas de la grilla
 * más los datos de contacto completos. [título, valor(row)]
 */
export function registryColumns(config) {
  return [
    ['Nombre', (row) => row.full_name],
    ['Documento', documentOf],
    ['Correo', (row) => row.email ?? ''],
    ['Teléfono', (row) => row.phone ?? ''],
    ['Sexo', (row) => row.sex ?? ''],
    // AAAA-MM-DD: Excel la reconoce como fecha y la importación la necesita para crear fichas
    ['Fecha de nacimiento', (row) => row.birth_date ?? ''],
    ...(config.kind === 'Cepevista' ? [] : [['Edad', (row) => (row.age == null ? '' : Number(row.age))]]),
    ['Procedencia', (row) => row.base_city ?? ''],
    ...(config.showClassification ? [['Clasificación', (row) => classificationLabel(row.classification)]] : []),
    ...(config.showTeam ? [
      ['Equipo', (row) => row.team_name ?? 'Sin equipo'],
      ['Ciudad actual', (row) => row.current_city ?? ''],
    ] : []),
    ...(config.showGoal ? [['Meta diaria', (row) => Number(row.daily_goal ?? 0)]] : []),
    ...(config.showResults ? [
      ['Reportes', (row) => Number(row.reports_count ?? 0)],
      ['Libros vendidos', (row) => Number(row.books_total ?? 0)],
      ['Último reporte', (row) => (row.last_report_date ? formatDate(row.last_report_date, { day: 'numeric', month: 'short', year: 'numeric' }) : '')],
    ] : []),
    ...(config.showBed ? [['Alojamiento', (row) => row.current_bed ?? 'Sin alojamiento']] : []),
    ...(config.showLicense ? [
      ['Licencia número', (row) => (row.has_driver_license ? row.license_number ?? '' : 'Sin licencia')],
      ['Licencia vence', (row) => (row.has_driver_license ? row.license_expiry ?? '' : '')],
    ] : []),
    ['Estado', (row) => (row.is_available ? 'Activo' : 'Inactivo')],
  ]
}

/** CSV UTF-8 con BOM: Excel lo abre con tildes y columnas correctas. */
export function registryCsv(rows, config) {
  const columns = registryColumns(config)
  return '\uFEFF' + [columns.map(([title]) => title), ...rows.map((row) => columns.map(([, value]) => value(row)))]
    .map((line) => line.map(csvCell).join(',')).join('\r\n')
}

/** Vista imprimible: el navegador la guarda como PDF desde «Imprimir». */
export function registryPrintHtml(rows, config, criteria) {
  const columns = registryColumns(config)
  const active = rows.filter((row) => row.is_available).length
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(config.title)}</title>
<style>
@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#19354d}
h1{font-size:21px;margin:0 0 4px}p{line-height:1.5;margin:4px 0 14px}
table{width:100%;border-collapse:collapse}th,td{padding:6px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}
thead{display:table-header-group}tr{break-inside:avoid}th{background:#edf3f8;font-size:10px;text-transform:uppercase}
small{color:#50657a}
</style></head><body><h1>CEPEV · ${escapeHtml(config.title)}</h1>
<p>${escapeHtml(formatDate(todayISO(), { day: 'numeric', month: 'long', year: 'numeric' }))} · ${rows.length} ${escapeHtml(config.plural)}
(${active} activos, ${rows.length - active} inactivos)<br>${escapeHtml(criteria)}</p>
<table><thead><tr>${columns.map(([title]) => '<th>' + escapeHtml(title) + '</th>').join('')}</tr></thead>
<tbody>${rows.map((row) => '<tr>' + columns.map(([, value]) => '<td>' + escapeHtml(value(row)) + '</td>').join('') + '</tr>').join('')}</tbody></table>
<p><small>Generado desde el registro de ${escapeHtml(config.plural)}. Incluye las fichas visibles con los filtros aplicados.</small></p>
</body></html>`
}

export function downloadFile(content, mime, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Abre la vista imprimible. Devuelve false si el navegador bloqueó la ventana. */
export function openPrintView(html) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.opener = null
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  popup.setTimeout(() => popup.print(), 250)
  return true
}
