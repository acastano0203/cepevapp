// Run with: node tests/admin_access.mjs /absolute/path/to/pglite/dist/index.js
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
  servidor: '00000000-0000-0000-0000-000000000002',
  capitan: '00000000-0000-0000-0000-000000000003',
  cepevista: '00000000-0000-0000-0000-000000000004',
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
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  for (const file of ['01_schema', '02_views', '03_rls', '04_functions', '09_colporteurs',
    '10_people_documents', '11_cepevistas', '25_payments', '26_roles_maintenance', '27_admin_access']) await migrate(file)
  await migrate('27_admin_access')
  checks += 1 // migracion repetible

  for (const [who, id] of Object.entries(ids)) {
    await sql('insert into auth.users(id,email) values ($1,$2)', [id, who + '@example.invalid'])
    await sql('update profiles set role = $2 where id = $1', [id, who])
  }
  await sql(`insert into people(full_name,sex,birth_date,kind) values ('Persona Uno','Mujeres','1990-01-01','Residente')`)
  const area = await scalar("select id from maintenance_areas where name = 'Cocina'")

  // Valores por defecto: los mismos accesos de la migracion 26
  check((await sql('select role::text, count(*)::int as n from role_modules group by role order by role')).rows,
    [{ role: 'capitan', n: 1 }, { role: 'cepevista', n: 8 }, { role: 'servidor', n: 1 }])
  await as('admin')
  check((await scalar('select my_modules()')).length, 10)
  await as('servidor')
  check(await scalar('select my_modules()'), ['mantenimiento'])
  check(await scalar('select count(*)::int from people'), 0)
  check(await scalar('select can_report()'), true)
  await as('cepevista')
  check(await scalar('select count(*)::int from people'), 1)
  check(await scalar('select can_report()'), false)
  await rejects("select maintenance_report_create($1, 'Dano', 'Normal', 'x')", [area], /no puede reportar/)
  // Cada perfil ve sus propios accesos, no los de otros
  check(await scalar('select count(*)::int from role_modules'), 8)

  // Solo el admin administra
  await as('servidor')
  await rejects("select admin_set_role_modules('servidor', array['cocina'])", [], /administrador/)
  await rejects('select * from admin_users()', [], /administrador/)
  await rejects("select admin_set_user_role($1, 'admin')", [ids.servidor], /administrador/)
  await rejects("insert into role_modules(role, module) values ('servidor', 'cocina')", [], /permission denied/)

  // Los checks gobiernan la lectura y el reporte
  await as('admin')
  await rejects("select admin_set_role_modules('admin', array['cocina'])", [], /todos los modulos/)
  await rejects("select admin_set_role_modules('servidor', array['finanzas'])", [], /no valido/)
  await sql("select admin_set_role_modules('servidor', array['cocina', 'mantenimiento'])")
  await sql("select admin_set_role_modules('cepevista', array['mantenimiento'])")
  await sql("select admin_set_role_modules('capitan', array[]::text[])")
  await as('servidor')
  check(await scalar('select my_modules()'), ['cocina', 'mantenimiento'])
  check(await scalar('select count(*)::int from people'), 1) // ahora lee la operacion
  await rejects("select payment_settings_save(1, 1, 5)", [], /administracion/) // pero no escribe
  await as('cepevista')
  check(await scalar('select count(*)::int from people'), 0)
  check(await scalar('select can_report()'), true)
  await sql("select maintenance_report_create($1, 'Dano', 'Normal', 'Puerta rota')", [area])
  await as('capitan')
  check(await scalar('select my_modules()'), [])
  await rejects("select maintenance_report_create($1, 'Dano', 'Normal', 'x')", [area], /no puede reportar/)

  // Usuarios y perfiles
  await as('admin')
  check((await sql('select email, role::text from admin_users() order by email')).rows.map((r) => r.email + ':' + r.role),
    ['admin@example.invalid:admin', 'capitan@example.invalid:capitan', 'cepevista@example.invalid:cepevista', 'servidor@example.invalid:servidor'])
  await rejects("select admin_set_user_role($1, 'cepevista')", [ids.admin], /a ti mismo/)
  // Nombre y perfil sin la Edge Function
  await rejects("select admin_update_profile($1, 'Yo', 'cepevista')", [ids.admin], /a ti mismo/)
  await rejects("select admin_update_profile($1, '  ', 'capitan')", [ids.capitan], /nombre/)
  await sql("select admin_update_profile($1, 'Capitan Renombrado', 'servidor')", [ids.capitan])
  check(await scalar("select full_name || ':' || role from profiles where id = $1", [ids.capitan]), 'Capitan Renombrado:servidor')
  await sql("select admin_update_profile($1, 'Capitan Renombrado', 'capitan')", [ids.capitan])
  await sql("select admin_set_user_role($1, 'capitan')", [ids.cepevista])
  check(await scalar('select role::text from profiles where id = $1', [ids.cepevista]), 'capitan')
  await sql("select admin_set_user_role($1, 'admin')", [ids.servidor])
  await as('servidor') // ahora es admin
  await sql("select admin_set_user_role($1, 'cepevista')", [ids.admin])
  await rejects("select admin_set_user_role($1, 'cepevista')", [ids.servidor], /a ti mismo/)
  await sql('reset role')
  check(await scalar("select count(*)::int from audit_log where action like 'admin_%'") >= 6, true)

  console.log(`admin access: ${checks} checks passed`)
} finally {
  await db.close()
}
