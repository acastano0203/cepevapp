// node tests/room_captains.mjs .room-tests.local/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const moduleUrl = pathToFileURL(process.argv[2])
const { PGlite } = await import(moduleUrl.href)
const { btree_gist } = await import(new URL('./contrib/btree_gist.js', moduleUrl).href)
const db = new PGlite({ extensions: { btree_gist } })
const sql = (text, args = []) => db.query(text, args)
const scalar = async (text, args) => Object.values((await sql(text, args)).rows[0])[0]
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++ }
const rejects = async (text, args, pattern) => { await assert.rejects(sql(text, args), pattern); checks++ }
const migrate = async (file) => {
  let text = await readFile(new URL(`../supabase/${file}.sql`, import.meta.url), 'utf8')
  text = text.replace('create extension if not exists "pgcrypto";', '')
  if (file === '10_people_documents') await db.exec('drop view if exists v_colporteurs')
  await db.exec(text)
}
const ids = {
  admin: '00000000-0000-0000-0000-000000000001',
  server: '00000000-0000-0000-0000-000000000002',
  reader: '00000000-0000-0000-0000-000000000003',
  other: '00000000-0000-0000-0000-000000000004',
}
const as = async (id) => {
  await sql('reset role')
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await sql('set role authenticated')
}
const save = async ({ id = null, code = 'R-01', sex = 'Mujeres', person = null, user = null, phone = '3001234567', stays = false, bed = null }) =>
  (await sql(`select * from room_upsert($1,$2,$3,2,$4,$5,'01',$6,$7,cepev_today()+30,$8)`,
    [id, code, sex, person, phone, stays, bed, user])).rows[0]

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
    '10_people_documents', '11_cepevistas', '17_lodging_rooms', '25_payments',
    '26_roles_maintenance', '27_admin_access', '29_room_server_captains']) await migrate(file)
  await migrate('29_room_server_captains')
  checks++
  for (const [name, id] of Object.entries(ids)) {
    await sql('insert into auth.users(id,email) values ($1,$2)', [id, `${name}@example.invalid`])
    await sql('update profiles set role = $2, full_name = $3 where id = $1',
      [id, name === 'admin' ? 'admin' : name === 'reader' ? 'cepevista' : 'servidor', name])
  }
  const person = await scalar("insert into people(full_name,sex,birth_date,kind) values ('Cepevista','Mujeres','1990-01-01','Cepevista') returning id")
  const male = await scalar("insert into people(full_name,sex,birth_date,kind) values ('Colportor','Hombres','1990-01-01','Colportor') returning id")
  await as(ids.admin)
  let candidates = (await sql('select * from room_captain_candidates()')).rows
  check(candidates.length, 4)
  check(candidates.find(c => c.user_id === ids.server).sex, null)
  check(candidates.some(c => c.user_id === ids.reader), false)
  check(candidates.some(c => c.person_id === person), true)
  check(await scalar('select count(*)::int from people'), 2) // Listing is read-only.

  const room = await save({ user: ids.server })
  check(await scalar('select count(*)::int from beds where room_id=$1', [room.id]), 4)
  check(await scalar('select captain_user_id from people where id=$1', [room.captain_id]), ids.server)
  check(await scalar('select birth_date from people where id=$1', [room.captain_id]), null)
  check(await scalar("select count(*)::int from v_beds_status where room_id=$1 and availability='Capitan'", [room.id]), 1)
  check(await scalar('select role::text from profiles where id=$1', [ids.server]), 'servidor')
  candidates = (await sql('select * from room_captain_candidates()')).rows
  check(candidates.find(c => c.user_id === ids.server).id, room.captain_id)
  check(candidates.find(c => c.user_id === ids.server).sex, 'Mujeres')
  await save({ id: room.id, user: ids.server, phone: '3007654321' })
  check(await scalar('select count(*)::int from people where captain_user_id=$1', [ids.server]), 1)
  check(await scalar('select phone from people where captain_user_id=$1', [ids.server]), '3007654321')
  await assert.rejects(save({ code: 'R-02', user: ids.server }), /otro dormitorio/); checks++
  await assert.rejects(save({ id: room.id, user: ids.server, sex: 'Hombres' }), /seccion/); checks++
  await assert.rejects(save({ id: room.id, person: male }), /seccion/); checks++
  await assert.rejects(save({ code: 'R-02', user: ids.reader }), /rol servidor/); checks++
  await assert.rejects(save({ code: 'R-02', user: ids.admin }), /rol servidor/); checks++
  await assert.rejects(save({ code: 'R-02', user: '00000000-0000-0000-0000-000000000099' }), /ya no existe/); checks++
  await assert.rejects(save({ code: 'R-02', user: ids.other, phone: '1' }), /WhatsApp/); checks++
  check(await scalar('select count(*)::int from people where captain_user_id=$1', [ids.other]), 0) // Rollback.
  await assert.rejects(save({ id: room.id, person, user: ids.server }), /no ambos/); checks++
  await rejects("insert into people(full_name,sex,kind) values ('Missing birth','Mujeres','Residente')", [], /people_birth_date_or_captain_user/)
  await rejects("insert into stays(person_id,bed_id,start_date,end_date,status) values ($1,$2,cepev_today(),cepev_today()+10,'Reservado')",
    [person, room.captain_bed_id], /reservada para el capitan/)

  // Replacing a servidor can leave them in another bed using the existing stay rules.
  await save({ id: room.id, person, stays: true, bed: '02' })
  check(await scalar("select count(*)::int from stays where person_id=$1 and status='Alojado'", [room.captain_id]), 1)
  // Switching back releases the servidor's previous bed.
  await save({ id: room.id, user: ids.server })
  check(await scalar("select count(*)::int from stays where person_id=$1 and status='Alojado'", [room.captain_id]), 0)
  check(await scalar("select count(*)::int from stays where person_id=$1 and status='Finalizado'", [room.captain_id]), 1)
  await sql("update profiles set full_name='Renamed server' where id=$1", [ids.server])
  check(await scalar('select captain_name from v_beds_status where room_id=$1 limit 1', [room.id]), 'Renamed server')

  // Role changes do not strand existing rooms, but cannot authorize new assignments.
  await sql("update profiles set role='cepevista' where id=$1", [ids.server])
  await save({ id: room.id, user: ids.server })
  check((await sql('select * from room_captain_candidates()')).rows.some(c => c.user_id === ids.server), true)
  await save({ id: room.id, person })
  await assert.rejects(save({ id: room.id, user: ids.server }), /rol servidor/); checks++
  await assert.rejects(save({ id: room.id, person: room.captain_id }), /rol servidor/); checks++

  // No expanded write permissions or Administration-directory access.
  await as(ids.other)
  await rejects('select * from room_captain_candidates()', [], /administrador/)
  await assert.rejects(save({ user: ids.other, code: 'Denied' }), /administrador/); checks++
  await as(ids.reader)
  await rejects('select * from room_captain_candidates()', [], /administrador/)
  await sql('reset role')
  await sql('set role anon')
  await rejects('select * from room_captain_candidates()', [], /permission denied/)
  await sql('reset role')
  await rejects('delete from auth.users where id=$1', [ids.server], /foreign key/)
  await migrate('29_room_server_captains')
  check(await scalar('select captain_id from rooms where id=$1', [room.id]), person)
  check(await scalar('select count(*)::int from people where captain_user_id=$1', [ids.server]), 1)
  console.log(`${checks} room captain checks passed`)
} finally {
  await db.close()
}
