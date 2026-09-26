// Run with: node tests/laundry.mjs /absolute/path/to/pglite/dist/index.js
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
    '10_people_documents', '11_cepevistas', '12_kitchen_dynamic', '13_fleet_vehicles', '15_laundry']) {
    let migration = await readFile(new URL('../supabase/' + file + '.sql', import.meta.url), 'utf8')
    // PGlite supplies gen_random_uuid natively, without the pgcrypto extension.
    migration = migration.replace('create extension if not exists "pgcrypto";', '')
    // Migration 10 inserts view columns; drop the legacy view in this fresh test DB first.
    if (file === '10_people_documents') await db.exec('drop view if exists v_colporteurs')
    await db.exec(migration)
  }
  await db.exec(await readFile(new URL('../supabase/15_laundry.sql', import.meta.url), 'utf8'))
  checks += 1 // migration rerun
  const admin = '00000000-0000-0000-0000-000000000001'
  await sql("insert into auth.users(id,email) values ($1,'laundry-test@example.invalid')", [admin])
  await sql("update profiles set role = 'admin' where id = $1", [admin])
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [admin])
  const date = await scalar('select cepev_today()::text')
  const nextDate = await scalar('select (cepev_today() + 1)::text')
  const people = []
  for (let i = 0; i < 12; i += 1) {
    people.push(await scalar(`insert into people(full_name,sex,birth_date,kind)
      values ($1,'Hombres','1990-01-01','Cepevista') returning id`, ['Persona ' + String(i).padStart(2, '0')]))
  }
  const resident = await scalar(`insert into people(full_name,sex,birth_date,kind)
    values ('Coordinador residente','Hombres','1990-01-01','Residente') returning id`)
  await sql('set role authenticated')
  await rejects('select laundry_publish($1)', [date], /cuatro lavadoras/)
  await rejects('select laundry_add($1,3,1,$2)', [date, people[0]], /cuatro lavadoras/)
  await rejects('select laundry_add($1,1,5,$2)', [date, people[0]], /cuatro lavadoras/)
  await rejects('select laundry_add(cepev_today()-1,1,1,$1)', [people[0]], /30 dias/)
  await rejects('select laundry_add(cepev_today()+31,1,1,$1)', [people[0]], /30 dias/)
  await rejects('select laundry_add($1,1,1,$2)', [date, resident], /elegible/)
  await rejects('insert into laundry_assignments(service_date,turn,machine,person_id) values ($1,1,1,$2)',
    [date, people[0]], /permission denied/)

  await sql('select laundry_set_coordinator($1,$2)', [date, resident])
  check(await scalar('select count(*)::int from laundry_assignments where machine=0'), 2)
  await sql('select laundry_add($1,1,1,$2)', [date, people[0]])
  check((await sql('select starts_at,ends_at from laundry_assignments where machine=1')).rows,
    [{ starts_at: '11:00:00', ends_at: '13:00:00' }])
  await rejects('select laundry_add($1,1,1,$2)', [date, people[1]], /ya esta asignada/)
  await rejects('select laundry_add($1,1,2,$2)', [date, people[0]], /otra asignacion/)
  await rejects('select laundry_set_coordinator($1,$2)', [date, people[0]], /otra asignacion/)
  check(await scalar('select count(*)::int from laundry_assignments where machine=0 and person_id=$1', [resident]), 2)
  check(await scalar('select laundry_autofill($1)', [date]), 7)
  check(await scalar('select laundry_autofill($1)', [date]), 0)
  check(await scalar('select count(*)::int from laundry_assignments where machine>0'), 8)
  check(await scalar('select count(*)::int from laundry_assignments where machine>0 and turn=2 and starts_at=\'15:00\' and ends_at=\'17:00\''), 4)
  await sql('select laundry_publish($1)', [date])
  check(await scalar('select bool_and(is_published) from v_laundry_assignments where service_date=$1', [date]), true)
  await sql('select laundry_autofill($1)', [date])
  check(await scalar('select count(*)::int from laundry_publications'), 1)
  // Kitchen auto-proposals must skip Laundry conflicts rather than abort.
  await sql('select kitchen_autofill($1,1)', [date])
  await rejects("select kitchen_add($1,'Almuerzo','Comedor',$2)", [date, people[0]], /lavanderia/)
  check(await scalar(`select count(*)::int from kitchen_shifts k join laundry_assignments l
    on k.person_id=l.person_id and k.service_date=l.service_date
    and k.starts_at<l.ends_at and l.starts_at<k.ends_at`), 0)

  await sql('select laundry_set_coordinator($1,null)', [date])
  check(await scalar('select count(*)::int from laundry_publications'), 0)
  await rejects('select laundry_publish($1)', [date], /coordinador/)
  await sql('select laundry_set_coordinator($1,$2)', [date, resident])
  await sql('select laundry_publish($1)', [date])
  await sql('reset role')
  await sql('update people set is_available=false where id=$1', [resident])
  check(await scalar('select count(*)::int from laundry_publications'), 0)
  check(await scalar('select count(*)::int from v_laundry_assignments where machine=0 and block_reason is not null'), 2)
  await sql('set role authenticated')
  await rejects('select laundry_publish($1)', [date], /conflicto/)

  // Kitchen first, then Laundry: exact boundary at 13:00 remains available.
  await sql("select kitchen_add($1,'Almuerzo','Comedor',$2)", [nextDate, people[10]])
  await rejects('select laundry_add($1,1,1,$2)', [nextDate, people[10]], /cocina/)
  await sql('reset role')
  const vehicle = await scalar(`insert into vehicles(name,plate,vehicle_type,brand,capacity,next_service_date,next_service_km)
    values ('Test','TEST-LAUNDRY','Bus','Test',4,cepev_today()+30,10000) returning id`)
  await sql(`insert into trips(vehicle_id,driver_id,destination_city,starts_at,ends_at)
    values ($1,$2,'Piedecuesta',($3::date+time '10:00') at time zone 'America/Bogota',
      ($3::date+time '12:00') at time zone 'America/Bogota')`, [vehicle, people[11], nextDate])
  await sql('set role authenticated')
  await rejects('select laundry_add($1,1,1,$2)', [nextDate, people[11]], /recorrido/)
  await sql('select laundry_add($1,2,1,$2)', [nextDate, people[11]])
  await sql('reset role')
  await rejects(`insert into trips(vehicle_id,driver_id,destination_city,starts_at,ends_at)
    values ($1,$2,'Piedecuesta',($3::date+time '16:00') at time zone 'America/Bogota',
      ($3::date+time '18:00') at time zone 'America/Bogota')`, [vehicle, people[11], nextDate], /lavanderia/)
  await sql(`insert into trips(vehicle_id,driver_id,destination_city,starts_at,ends_at)
    values ($1,$2,'Piedecuesta',($3::date+time '17:00') at time zone 'America/Bogota',
      ($3::date+time '18:00') at time zone 'America/Bogota')`, [vehicle, people[11], nextDate])
  checks += 1

  const team = await scalar("insert into teams(name) values ('Laundry test team') returning id")
  await sql('update people set team_id=$1 where id=$2', [team, people[9]])
  await sql(`insert into rotations(team_id,city,start_date,end_date)
    values ($1,'Bogota',$2::date,$2::date+1)`, [team, nextDate])
  await sql('set role authenticated')
  await rejects('select laundry_add($1,1,2,$2)', [nextDate, people[9]], /rotacion/)
  await rejects('select laundry_set_coordinator($1,$2)', [nextDate, people[9]], /rotacion/)
  await sql('reset role')
  await sql("update profiles set role='consulta' where id=$1", [admin])
  await sql('set role authenticated')
  check(await scalar('select count(*)::int from v_laundry_assignments') > 0, true)
  await rejects('select laundry_autofill($1)', [date], /consulta/)
  await rejects('select laundry_set_coordinator($1,$2)', [date, people[8]], /consulta/)
  await rejects('select laundry_publish($1)', [date], /consulta/)
  await rejects('select laundry_remove((select id from laundry_assignments where machine>0 limit 1))', [], /consulta/)
  await sql('reset role')
  await sql("update profiles set role='coordinador' where id=$1", [admin])
  await sql('set role authenticated')
  await sql('select laundry_set_coordinator($1,$2)', [nextDate, people[8]])
  check(await scalar('select count(*)::int from laundry_assignments where service_date=$1 and machine=0', [nextDate]), 2)
  console.log('PASS: ' + checks + ' Laundry database checks (including migration rerun, permissions, conflicts and publication).')
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
