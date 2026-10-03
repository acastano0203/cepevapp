// Run with: node tests/maintenance.mjs /absolute/path/to/pglite/dist/index.js
// PGlite is a temporary test tool, not an application dependency.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const moduleUrl = pathToFileURL(process.argv[2])
const { PGlite } = await import(moduleUrl.href)
const { btree_gist } = await import(new URL('./contrib/btree_gist.js', moduleUrl).href)
const db = new PGlite({ extensions: { btree_gist } })
const sql = (query, args = []) => db.query(query, args)
const scalar = async (query, args) => Object.values((await sql(query, args)).rows[0])[0]
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1 }
const rejects = async (query, args, pattern) => {
  await assert.rejects(sql(query, args), pattern)
  checks += 1
}
const migrate = async (file) => {
  let migration = await readFile(new URL('../supabase/' + file + '.sql', import.meta.url), 'utf8')
  migration = migration.replace('create extension if not exists "pgcrypto";', '')
  if (file === '10_people_documents') await db.exec('drop view if exists v_colporteurs')
  await db.exec(migration)
}
const ids = {
  admin: '00000000-0000-0000-0000-000000000001',
  coordinador: '00000000-0000-0000-0000-000000000002',
  consulta: '00000000-0000-0000-0000-000000000003',
  servidor: '00000000-0000-0000-0000-000000000004',
  capitan: '00000000-0000-0000-0000-000000000005',
}
const as = async (who) => {
  await sql('reset role')
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [ids[who]])
  await sql('set role authenticated')
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  for (const file of ['01_schema', '02_views', '03_rls', '04_functions', '09_colporteurs',
    '10_people_documents', '11_cepevistas', '25_payments']) await migrate(file)

  // Usuarios con los roles anteriores
  for (const [who, id] of Object.entries(ids)) {
    await sql('insert into auth.users(id,email) values ($1,$2)', [id, who + '@example.invalid'])
  }
  await sql("update profiles set role = 'admin' where id = $1", [ids.admin])
  await sql("update profiles set role = 'coordinador' where id = $1", [ids.coordinador])
  await sql("update profiles set full_name = 'Capitan Uno' where id = $1", [ids.capitan])
  await sql(`insert into people(full_name,sex,birth_date,kind) values ('Persona Uno','Mujeres','1990-01-01','Residente')`)
  const room = await scalar("insert into rooms(code,sex) values ('A-101','Mujeres') returning id")

  await migrate('26_roles_maintenance')
  await migrate('26_roles_maintenance')
  checks += 1 // migracion repetible

  // 1) Conversion de roles
  check((await sql('select id::text, role::text from profiles order by id')).rows.map((r) => r.role),
    ['admin', 'admin', 'cepevista', 'cepevista', 'cepevista'])
  check(await scalar("select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.app_role'::regtype"),
    'admin,servidor,capitan,cepevista')
  await sql("update profiles set role = 'servidor' where id = $1", [ids.servidor])
  await sql("update profiles set role = 'capitan' where id = $1", [ids.capitan])
  await sql("insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000009','nuevo@example.invalid')")
  check(await scalar("select role::text from profiles where id = '00000000-0000-0000-0000-000000000009'"), 'cepevista')
  check(await scalar("select count(*)::int from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'"), 0)

  // 2) Lectura: la operacion la ven admin y cepevista; servidor y capitan no
  await as('consulta')
  check(await scalar('select count(*)::int from people'), 1)
  await rejects("select payment_settings_save(1, 1, 5)", [], /administracion/)
  await rejects("select payment_account_save(null, (select id from people limit 1), current_date)", [], /administrador/)
  await as('servidor')
  check(await scalar('select count(*)::int from people'), 0)
  check(await scalar('select count(*)::int from rooms'), 0)
  check(await scalar('select count(*)::int from audit_log'), 0)
  check(await scalar('select count(*)::int from maintenance_areas') > 10, true)
  check(await scalar('select count(*)::int from maintenance_rooms()'), 1)
  await as('coordinador') // ahora es admin
  check(await scalar('select can_write()'), true)

  // 3) Reportes
  const area = await scalar("select id from maintenance_areas where name = 'Cocina'")
  const dorms = await scalar("select id from maintenance_areas where name = 'Dormitorios'")
  await as('consulta')
  await rejects("select maintenance_report_create($1, 'Dano', 'Normal', 'Fuga')", [area], /no puede reportar/)
  await as('servidor')
  await rejects("select maintenance_report_create($1, 'Robo', 'Normal', 'x')", [area], /tipo/)
  await rejects("select maintenance_report_create($1, 'Dano', 'Normal', '  ')", [area], /Describe/)
  await rejects("select maintenance_report_create($1, 'Dano', 'Normal', 'x', null, null, 'otro-usuario/foto.jpg')", [area], /foto/)
  const mine = await scalar(`select (maintenance_report_create($1, 'Dano', 'Urgente', 'Fuga en el lavaplatos',
    null, 'Lavaplatos grande', $2)).id`, [area, ids.servidor + '/fuga.jpg'])
  await as('capitan')
  const captainReport = await scalar(`select (maintenance_report_create($1, 'Mantenimiento', 'Normal', 'Bombillo fundido', $2)).id`, [dorms, room])
  check(await scalar('select count(*)::int from v_maintenance_reports'), 1)
  check(await scalar('select room_code || reported_by_name || reported_by_role || is_mine from v_maintenance_reports'), 'A-101Capitan UnocapitantrueX'.replace('X', ''))
  await rejects("select maintenance_report_update($1, 'Resuelto', null, 'listo')", [captainReport], /administracion/)
  await rejects("insert into maintenance_reports(area_id, report_type, detail) values ($1, 'Dano', 'x')", [area], /permission denied/)
  await as('servidor')
  check(await scalar('select count(*)::int from v_maintenance_reports'), 1)
  check(await scalar('select count(*)::int from v_maintenance_reports where id = $1', [captainReport]), 0)

  // 4) Gestion por administracion
  await as('admin')
  check(await scalar('select count(*)::int from v_maintenance_reports'), 2)
  await sql("select maintenance_report_update($1, 'En proceso', 'Plomero Juan')", [mine])
  check(await scalar('select started_at is not null and assigned_to = $2 from maintenance_reports where id = $1', [mine, 'Plomero Juan']), true)
  await rejects("select maintenance_report_update($1, 'Resuelto', 'Plomero Juan', '  ')", [mine], /que se hizo/)
  await rejects("select maintenance_report_update($1, 'Resuelto', 'Plomero Juan', 'ok', -1)", [mine], /negativo/)
  await sql("select maintenance_report_update($1, 'Resuelto', 'Plomero Juan', 'Cambio de sifon', 45000)", [mine])
  check(await scalar("select status || resolved_by_name || cost_cop::int from maintenance_reports where id = $1", [mine]), 'Resueltoadmin45000')
  await sql("select maintenance_report_update($1, 'Abierto')", [mine])
  check(await scalar('select resolved_at is null and started_at is null from maintenance_reports where id = $1', [mine]), true)
  await sql("select maintenance_area_save(null, 'Gimnasio')")
  await rejects("select maintenance_area_save(null, 'gimnasio')", [], /Ya existe/)
  await as('capitan')
  await rejects("select maintenance_area_save(null, 'Piscina')", [], /administracion/)
  await as('admin')
  check(await scalar("select count(*)::int from audit_log where action like 'maintenance%'") >= 5, true)

  console.log(`maintenance: ${checks} checks passed`)
} finally {
  await db.close()
}
