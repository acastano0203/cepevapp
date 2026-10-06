/**
 * Importación del registro de personas desde el CSV que genera «Excel» en
 * Cepevistas o Colportores (también si se editó y se guardó desde Excel).
 *
 * Sin dependencias: se prueba con node (tests/import_people.mjs).
 */

export const CLASSIFICATIONS = ['Cepevista', 'Ejercito Celestial', 'Colportores', 'Adolescentes', 'Servidores']

export const normalizeKey = (text = '') => String(text)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

/** Columnas que se leen (por título, sin importar tildes ni mayúsculas). El resto se ignora. */
const HEADERS = {
  nombre: 'full_name',
  documento: 'document',
  correo: 'email',
  telefono: 'phone',
  sexo: 'sex',
  'fecha de nacimiento': 'birth_date',
  procedencia: 'base_city',
  clasificacion: 'classification',
  equipo: 'team',
  'meta diaria': 'daily_goal',
  'licencia numero': 'license_number',
  'licencia vence': 'license_expiry',
  estado: 'status',
}

/** Columnas que se exportan pero no se importan (se calculan o viven en otros módulos). */
export const IGNORED_HEADERS = ['Edad', 'Ciudad actual', 'Reportes', 'Libros vendidos', 'Último reporte', 'Alojamiento']

/** Excel guarda «CSV UTF-8» o «CSV» en ANSI (Windows-1252): se detecta. */
export function decodeCsv(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '')
  return new TextDecoder('windows-1252').decode(buffer)
}

/** CSV con comillas; el separador es coma o punto y coma (Excel en español usa «;»). */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1 } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((line) => line.some((value) => value.trim() !== ''))
}

/** La exportación antepone «'» a lo que Excel tomaría como fórmula (p. ej. +57…). */
const clean = (value) => {
  const text = String(value ?? '').trim()
  return /^'[=+@\-\s]/.test(text) ? text.slice(1).trim() : text
}

/** AAAA-MM-DD, DD/MM/AAAA o DD-MM-AAAA (Excel suele reescribir las fechas al guardar). */
export function parseDate(value) {
  const text = clean(value)
  if (!text) return null
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  let [year, month, day] = match ? [match[1], match[2], match[3]] : []
  if (!match) {
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (!match) return undefined
    ;[day, month, year] = [match[1], match[2], match[3]]
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? undefined : iso
}

function parseDocument(value) {
  const text = clean(value).toUpperCase()
  if (!text) return { type: '', id: '' }
  if (/^\d+(?:[.,]\d+)?E\+?\d+$/.test(text)) return { error: 'el documento quedó en notación científica (formatea la columna como texto en Excel)' }
  const match = text.match(/^(CC|TI|CE|PA)\s*[-:]?\s*(.+)$/)
  const id = (match ? match[2] : text).replace(/[\s.-]/g, '')
  return { type: match ? match[1] : 'CC', id }
}

const parseSex = (value) => {
  const key = normalizeKey(clean(value))
  if (['mujeres', 'mujer', 'f', 'femenino'].includes(key)) return 'Mujeres'
  if (['hombres', 'hombre', 'm', 'masculino'].includes(key)) return 'Hombres'
  return key ? undefined : null
}

const parseStatus = (value) => {
  const key = normalizeKey(clean(value))
  if (['activo', 'activa', 'si', 'true', '1'].includes(key)) return true
  if (['inactivo', 'inactiva', 'no', 'false', '0'].includes(key)) return false
  return key ? undefined : null
}

/** Tipo según las columnas: «Equipo» o «Meta diaria» solo existen en colportores. */
export function detectKind(headers) {
  const keys = headers.map(normalizeKey)
  if (keys.includes('equipo') || keys.includes('meta diaria')) return 'Colportor'
  if (keys.includes('licencia numero') || keys.includes('alojamiento')) return 'Cepevista'
  return null
}

/**
 * Convierte el CSV en filas listas para guardar, cruzándolas con las fichas
 * existentes (por documento y, si no, por correo). En una actualización solo
 * cambia lo que trae el archivo: el resto se toma de la ficha actual.
 *
 * existing: filas de v_people_registry de ese tipo · teams: [{ id, name, base_name }]
 * Devuelve [{ line, action: 'crear' | 'actualizar' | 'error', errors, warnings, label, payload }]
 */
export function buildImport(records, { kind, existing = [], teams = [] }) {
  const [headerRow = [], ...lines] = records
  const columns = headerRow.map((title) => HEADERS[normalizeKey(title)] ?? null)
  if (!columns.includes('full_name') || !columns.includes('document')) {
    return { error: 'El archivo no tiene las columnas «Nombre» y «Documento». Usa el archivo que genera el botón Excel.', rows: [] }
  }
  const byDocument = new Map(existing.filter((row) => row.document_id).map((row) => [`${row.document_type}|${row.document_id}`, row]))
  const byEmail = new Map(existing.filter((row) => row.email).map((row) => [row.email.toLowerCase(), row]))
  const teamByName = new Map(teams.flatMap((team) => [
    [normalizeKey(team.base_name ?? team.name), team],
    [normalizeKey(team.name), team],
  ]))
  const seen = new Set()

  const rows = lines.map((cells, index) => {
    const line = index + 2
    const raw = Object.fromEntries(columns.map((key, i) => [key, cells[i] ?? '']).filter(([key]) => key))
    const has = (key) => key in raw
    const errors = []
    const warnings = []

    const fullName = clean(raw.full_name)
    if (!fullName) errors.push('falta el nombre')
    const document = parseDocument(raw.document)
    if (document.error) errors.push(document.error)
    else if (!document.id) errors.push('falta el documento')
    else if (!/^[A-Z0-9]{5,20}$/.test(document.id)) errors.push('documento no válido')
    const docKey = `${document.type}|${document.id}`
    if (document.id && seen.has(docKey)) errors.push('documento repetido en el archivo')
    seen.add(docKey)

    const email = has('email') ? clean(raw.email).toLowerCase() : undefined
    const current = (document.id && byDocument.get(docKey)) || (email && byEmail.get(email)) || null
    const base = current ? {
      id: current.id, full_name: current.full_name, sex: current.sex, birth_date: current.birth_date,
      phone: current.phone ?? '', base_city: current.base_city ?? '', team_id: current.team_id ?? '',
      daily_goal: current.daily_goal ?? 0, is_available: current.is_available ?? true, notes: current.notes ?? '',
      document_type: current.document_type, document_id: current.document_id, email: current.email ?? '',
      has_driver_license: current.has_driver_license ?? false, license_number: current.license_number ?? '',
      license_expiry: current.license_expiry ?? '', classification: current.classification ?? '',
    } : {
      id: null, full_name: '', sex: '', birth_date: '', phone: '', base_city: 'Piedecuesta', team_id: '',
      daily_goal: kind === 'Colportor' ? 10 : 0, is_available: true, notes: '', document_type: '', document_id: '',
      email: '', has_driver_license: false, license_number: '', license_expiry: '', classification: '',
    }
    const payload = { ...base, kind, full_name: fullName || base.full_name, document_type: document.type, document_id: document.id }

    if (email !== undefined) payload.email = email
    if (has('phone')) payload.phone = clean(raw.phone)
    if (has('base_city') && clean(raw.base_city)) payload.base_city = clean(raw.base_city)

    if (has('sex')) {
      const sex = parseSex(raw.sex)
      if (sex === undefined) errors.push('sexo no válido (Mujeres u Hombres)')
      else if (sex) payload.sex = sex
    }
    if (!payload.sex) errors.push('falta el sexo')

    if (has('birth_date')) {
      const birth = parseDate(raw.birth_date)
      if (birth === undefined) errors.push('fecha de nacimiento no válida')
      else if (birth) payload.birth_date = birth
    }
    if (!payload.birth_date) errors.push('falta la fecha de nacimiento')

    if (has('classification')) {
      const key = normalizeKey(clean(raw.classification))
      const value = CLASSIFICATIONS.find((item) => normalizeKey(item) === key)
      if (value) payload.classification = value
      else if (key && key !== 'sin clasificar') errors.push('clasificación no válida')
    }
    if (!payload.classification) errors.push('falta la clasificación')

    if (has('status')) {
      const status = parseStatus(raw.status)
      if (status === undefined) errors.push('estado no válido (Activo o Inactivo)')
      else if (status !== null) payload.is_available = status
    }

    if (kind === 'Colportor' && has('team')) {
      const name = normalizeKey(clean(raw.team))
      if (!name || name === 'sin equipo') payload.team_id = ''
      else if (teamByName.has(name)) payload.team_id = teamByName.get(name).id
      else warnings.push(`equipo «${clean(raw.team)}» no existe: se conserva el actual`)
    }
    if (kind === 'Colportor' && has('daily_goal') && clean(raw.daily_goal) !== '') {
      const goal = Number(clean(raw.daily_goal).replace(',', '.'))
      if (!Number.isInteger(goal) || goal < 0) errors.push('meta diaria no válida')
      else payload.daily_goal = goal
    }

    if (kind === 'Cepevista' && has('license_number')) {
      const number = clean(raw.license_number)
      if (!number || normalizeKey(number) === 'sin licencia') {
        payload.has_driver_license = false
        payload.license_number = ''
        payload.license_expiry = ''
      } else {
        payload.has_driver_license = true
        payload.license_number = number.replace(/[\s.-]/g, '').toUpperCase()
        const expiry = has('license_expiry') ? parseDate(raw.license_expiry) : payload.license_expiry || null
        if (!expiry) errors.push('falta o no es válida la fecha de vencimiento de la licencia')
        else payload.license_expiry = expiry
      }
    }

    return {
      line,
      label: fullName || '(sin nombre)',
      action: errors.length ? 'error' : current ? 'actualizar' : 'crear',
      errors,
      warnings,
      payload,
    }
  })
  return { rows }
}
