import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { filterReports, summarizeReports, reportsCsv, reportJson, reportPrintHtml, rotationStatus, normalizeSearch } from '../src/features/colporteurs/reporting.js'

let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1 }
const filters = { from: '2026-01-01', to: '2026-01-31', name: '', city: '', team: '', min: '', max: '', sort: 'date' }
const reports = [
  { id: '1', person_id: 'a', full_name: 'María Pérez', report_date: '2026-01-02', books_sold: 0, city_label: 'Cali', team_id: 't1', team_name: 'Cali' },
  { id: '2', person_id: 'a', full_name: 'María Pérez', report_date: '2026-01-03', books_sold: 12, city_label: 'Bogotá', team_id: 't1', team_name: 'Bogotá' },
  { id: '3', person_id: 'b', full_name: 'José Gómez', report_date: '2026-01-04', books_sold: 5, city_label: 'Cali', team_id: 't2', team_name: 'Cali' },
]
check(normalizeSearch('Medellín'), 'medellin')
check(summarizeReports(reports), { books: 17, people: 2, reports: 3, average: 5.7 })
check(summarizeReports([]), { books: 0, people: 0, reports: 0, average: 0 })
check(filterReports(reports, { ...filters, name: 'maria', min: '0', max: '0' }).map((r) => r.id), ['1'])
check(filterReports(reports, { ...filters, city: 'Cali', min: '1' }).map((r) => r.id), ['3'])
check(filterReports(reports, { ...filters, team: 't1', sort: 'books-desc' }).map((r) => r.id), ['2', '1'])
check(JSON.parse(reportJson(reports, filters)).indicadores.books, 17)
check(reportsCsv(reports).startsWith('\uFEFF'), true)
check(reportsCsv([{ ...reports[0], full_name: '=HYPERLINK("bad")' }]).includes("'=HYPERLINK"), true)
check(reportsCsv([{ ...reports[0], full_name: ' \t+cmd' }]).includes("' \t+cmd"), true)
check(reportsCsv([{ ...reports[0], full_name: 'Nombre, "citado"\nsegunda línea' }]).includes('""citado""'), true)
check(reportPrintHtml([{ ...reports[0], full_name: '<script>bad()</script>' }], filters).includes('<script>bad()'), false)
check(reportPrintHtml(reports, filters).includes('17 libros vendidos'), true)
check(rotationStatus({ start_date: '2026-01-01', end_date: '2026-01-02' }, '2026-01-02'), 'Finalizada')
check(rotationStatus({ start_date: '2026-01-02', end_date: '2026-01-03' }, '2026-01-02'), 'Vigente')
check(rotationStatus({ start_date: '2026-01-03', end_date: '2026-01-04' }, '2026-01-02'), 'Programada')
const catalog = JSON.parse(await readFile(new URL('../src/data/colombia-municipalities.json', import.meta.url)))
check(catalog.length, 1122)
check(catalog.filter((row) => row.type === 'MUNICIPIO').length, 1103)
check(new Set(catalog.map((row) => row.code)).size, 1122)
check(catalog.find((row) => row.code === '05001').name, 'Medellín')

const moduleUrl = pathToFileURL(process.argv[2])
const { PGlite } = await import(moduleUrl.href)
const { btree_gist } = await import(new URL('./contrib/btree_gist.js', moduleUrl).href)
const db = new PGlite({ extensions: { btree_gist } })
const sql = (query, args = []) => db.query(query, args)
const scalar = async (query, args) => Object.values((await sql(query, args)).rows[0])[0]
const rejects = async (query, args, pattern) => { await assert.rejects(sql(query, args), pattern); checks += 1 }
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  for (const file of ['01_schema','02_views','03_rls','04_functions','09_colporteurs','10_people_documents',
    '11_cepevistas','12_kitchen_dynamic','13_fleet_vehicles','15_laundry']) {
    let migration = await readFile(new URL('../supabase/' + file + '.sql', import.meta.url), 'utf8')
    migration = migration.replace('create extension if not exists "pgcrypto";', '')
    // Legacy migration 10 changes view column order.
    if (file === '10_people_documents') await db.exec('drop view if exists v_colporteurs')
    await db.exec(migration)
  }
  const legacyTeam = await scalar("insert into teams(name) values ('Equipo anterior') returning id")
  const admin = '00000000-0000-0000-0000-000000000016'
  await sql("insert into auth.users(id,email) values ($1,'colporteur-test@example.invalid')", [admin])
  await sql("update profiles set role='admin' where id=$1", [admin])
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [admin])
  const person = await scalar(`insert into people(full_name,sex,birth_date,kind,base_city,team_id)
    values ('Persona de prueba','Hombres','1990-01-01','Colportor','Origen diferente',$1) returning id`, [legacyTeam])
  await sql('select sale_register($1,cepev_today()-2,3)', [person])
  const migration = await readFile(new URL('../supabase/16_colporteur_teams_reports.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration)
  checks += 1
  check(await scalar('select count(*)::int from colombia_municipalities'), 1122)
  check(await scalar('select team_name_snapshot from sales_reports where person_id=$1', [person]), 'Equipo anterior')
  check(await scalar('select city from sales_reports where person_id=$1', [person]), 'Origen diferente')
  await sql('set role authenticated')
  await rejects("select colporteur_team_save('invalid')", [], /municipio/)
  await sql("select colporteur_team_save('05001',$1)", [legacyTeam])
  check(await scalar('select name from teams where id=$1', [legacyTeam]), 'Medellín (Antioquia)')
  await rejects("select colporteur_team_save('05001')", [], /Ya existe/)
  const team = await scalar("select (colporteur_team_save('76001')).id")
  await sql('select colporteur_assign_team($1,$2)', [person, team])
  check(await scalar('select person_city_on($1,cepev_today())', [person]), 'Santiago De Cali')
  const rotation = await scalar("select (colporteur_rotation_save($1,'11001',cepev_today(),cepev_today()+7)).id", [team])
  check(await scalar('select current_city from v_colporteur_progress where person_id=$1', [person]), 'Bogotá, D.C.')
  check(await scalar('select team_name from v_colporteur_progress where person_id=$1', [person]), 'Bogotá, D.C. (Bogotá, D.C.)')
  check(await scalar('select team_name from v_people_registry where id=$1', [person]), 'Bogotá, D.C. (Bogotá, D.C.)')
  await rejects("select colporteur_rotation_save($1,'05001',cepev_today()+2,cepev_today()+8)", [team], /periodo/)
  await rejects("select colporteur_rotation_save($1,'05001',cepev_today()+2,cepev_today()+2)", [team], /posterior/)
  await rejects("select colporteur_rotation_save($1,'00000',cepev_today()+8,cepev_today()+9)", [team], /municipio/)
  const future = await scalar("select (colporteur_rotation_save($1,'05001',cepev_today()+7,cepev_today()+10)).id", [team])
  check(await scalar('select team_municipality_on($1,cepev_today()+7)', [team]), '05001')
  check(await scalar('select team_municipality_on($1,cepev_today()+10)', [team]), '76001')
  await rejects('select colporteur_rotation_cancel($1)', [rotation], /futuras/)
  await sql('select colporteur_rotation_cancel($1)', [future])
  check(await scalar('select count(*)::int from rotations where id=$1', [future]), 0)
  const sale = await scalar('select (sale_register($1,cepev_today(),12)).id', [person])
  check(await scalar('select municipality_code from sales_reports where id=$1', [sale]), '11001')
  await sql("select colporteur_rotation_save($1,'05001',cepev_today(),cepev_today()+7,$2)", [team, rotation])
  check(await scalar('select municipality_code from sales_reports where id=$1', [sale]), '11001')
  check(await scalar('select team_name_snapshot from sales_reports where id=$1', [sale]), 'Bogotá, D.C. (Bogotá, D.C.)')
  await sql('select colporteur_assign_team($1,$2)', [person, legacyTeam])
  check(await scalar('select team_id from sales_reports where id=$1', [sale]), team)
  await sql("select sale_correct($1,15,'Correccion de prueba')", [sale])
  check(await scalar('select books_sold from v_colporteur_report_rows where id=$1', [sale]), 15)
  check(await scalar('select city_label from v_colporteur_report_rows where id=$1', [sale]), 'Bogotá, D.C. (Bogotá, D.C.)')
  await sql('select colporteur_assign_team($1,null)', [person])
  check(await scalar('select team_id from people where id=$1', [person]), null)

  await sql('select colporteur_assign_team($1,$2)', [person, legacyTeam])
  await rejects('select laundry_add(cepev_today(),1,1,$1)', [person], /fuera de Piedecuesta/)
  await rejects("select kitchen_add(cepev_today(),'Desayuno','Comedor',$1)", [person], /fuera de Piedecuesta/)
  await sql("select colporteur_team_save('68547',$1)", [legacyTeam])
  await sql('select laundry_add(cepev_today(),1,1,$1)', [person])
  check(await scalar('select block_reason from v_laundry_assignments where person_id=$1', [person]), null)
  await sql("select colporteur_team_save('05001',$1)", [legacyTeam])
  check((await scalar('select block_reason from v_laundry_assignments where person_id=$1', [person])).includes('fuera de Piedecuesta'), true)
  await sql('select colporteur_assign_team($1,null)', [person])
  await rejects('update colombia_municipalities set name=$1 where code=$2', ['Fake','05001'], /permission denied/)
  await sql('reset role')
  await db.exec(migration) // also re-runnable once assignments, sales, and rotations exist
  checks += 1
  check(await scalar('select team_name_snapshot from sales_reports where id=$1', [sale]), 'Bogotá, D.C. (Bogotá, D.C.)')
  await sql("update profiles set role='consulta' where id=$1", [admin])
  await sql('set role authenticated')
  check(await scalar('select count(*)::int from v_colporteur_report_rows'), 2)
  await rejects("select colporteur_team_save('05002')", [], /consulta/)
  await rejects('select colporteur_assign_team($1,$2)', [person, team], /consulta/)
  await rejects("select colporteur_rotation_save($1,'05001',cepev_today()+8,cepev_today()+10)", [team], /consulta/)
  await rejects('select colporteur_rotation_cancel($1)', [rotation], /consulta/)
  await sql('reset role')
  await sql("update profiles set role='coordinador' where id=$1", [admin])
  await sql('set role authenticated')
  await sql('select colporteur_assign_team($1,$2)', [person, team])
  check(await scalar('select team_id from people where id=$1', [person]), team)
  console.log('PASS: ' + checks + ' Colporteurs checks (catalog, filters, exports, migration rerun, assignments, history, overlaps, permissions).')
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
