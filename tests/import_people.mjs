// Run with: node tests/import_people.mjs
import assert from 'node:assert/strict'
import { buildImport, decodeCsv, detectKind, parseCsv, parseDate } from '../src/features/admin/importPeople.js'

let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1 }

// Fechas: ISO, dd/mm/aaaa y dd-mm-aaaa; inválidas -> undefined
check(parseDate('1995-03-07'), '1995-03-07')
check(parseDate('7/3/1995'), '1995-03-07')
check(parseDate('07-03-1995'), '1995-03-07')
check(parseDate('31/02/1995'), undefined)
check(parseDate(''), null)

// CSV exportado por la app: comas, comillas, BOM, prefijo anti-fórmula
const exported = '\uFEFF' + [
  '"Nombre","Documento","Correo","Teléfono","Sexo","Fecha de nacimiento","Procedencia","Clasificación","Alojamiento","Licencia número","Licencia vence","Estado"',
  '"Ana Pérez","CC 1098765432","ana@x.co","\'+57 300","Mujeres","1995-03-07","Bucaramanga","Ejército Celestial","A-1 / 2","Sin licencia","","Activo"',
  '"Luis Díaz","CC 1012345678","luis@x.co","3001234567","Hombres","2001-11-30","Piedecuesta","Servidores","Sin alojamiento","L12345","2027-01-05","Inactivo"',
].join('\r\n')
const records = parseCsv(decodeCsv(new TextEncoder().encode(exported)))
check(records.length, 3)
check(detectKind(records[0]), 'Cepevista')

const existing = [{
  id: 'p1', full_name: 'Ana Perez', sex: 'Mujeres', birth_date: '1995-03-07', phone: '', base_city: 'Girón',
  team_id: null, daily_goal: 0, is_available: true, notes: 'Nota que no se debe perder', document_type: 'CC',
  document_id: '1098765432', email: 'ana@x.co', has_driver_license: false, classification: null,
}]
const { rows } = buildImport(records, { kind: 'Cepevista', existing })
check(rows.map((row) => row.action), ['actualizar', 'crear'])
check(rows[0].payload.id, 'p1')
check(rows[0].payload.notes, 'Nota que no se debe perder') // lo que el archivo no trae se conserva
check(rows[0].payload.phone, '+57 300')
check(rows[0].payload.classification, 'Ejercito Celestial')
check(rows[0].payload.base_city, 'Bucaramanga')
check([rows[1].payload.is_available, rows[1].payload.has_driver_license, rows[1].payload.license_expiry], [false, true, '2027-01-05'])

// Re-guardado en Excel en español: «;», ANSI y fechas d/m/aaaa
const ansi = Uint8Array.from([...'Nombre;Documento;Correo;Sexo;Fecha de nacimiento;Clasificación;Equipo;Meta diaria;Estado\r\nJosé Ruiz;CC 1055555555;jose@x.co;Hombres;5/1/1999;Colportores;Bucaramanga (Santander);12;Activo\r\nSin Correo;CC 1066666666;;Hombres;1/1/2000;Colportores;Equipo X;10;Activo\r\n;1.09877E+09;a@b.co;Otro;99/99/1999;Nada;;-1;Quizás']
  .map((char) => char.charCodeAt(0)))
const colRecords = parseCsv(decodeCsv(ansi))
check(detectKind(colRecords[0]), 'Colportor')
const teams = [{ id: 't1', name: 'Bucaramanga (Santander)', base_name: 'Bucaramanga (Santander)' }]
const col = buildImport(colRecords, { kind: 'Colportor', teams }).rows
check(col[0].label, 'José Ruiz')
check([col[0].action, col[0].payload.team_id, col[0].payload.daily_goal, col[0].payload.birth_date], ['crear', 't1', 12, '1999-01-05'])
check(col[1].action, 'error')
check(col[1].errors, ['falta el correo'])
check(col[1].warnings.length, 1) // equipo inexistente: aviso, no error
check(col[2].errors.length >= 6, true)
check(col[2].errors.some((error) => error.includes('notación científica')), true)

// Archivo sin las columnas mínimas
check(Boolean(buildImport([['Hola', 'Mundo']], { kind: 'Cepevista' }).error), true)

console.log(`import people: ${checks} checks passed`)
