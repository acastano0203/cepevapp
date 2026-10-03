// Run with: node tests/payments.mjs /absolute/path/to/pglite/dist/index.js
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
const row = async (query, args) => (await sql(query, args)).rows[0]
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1 }
const rejects = async (query, args, pattern) => {
  await assert.rejects(sql(query, args), pattern)
  checks += 1
}
const asUser = () => sql('set role authenticated')
const asOwner = () => sql('reset role')
const setRole = async (role) => {
  await asOwner()
  await sql('update profiles set role = $1 where id = $2', [role, admin])
  await asUser()
}
const account = (person) => row(`select status, charged_total::float as charged, paid_total::float as paid,
  balance::float as balance, overdue_amount::float as overdue, credit::float as credit, days_overdue
  from v_payment_accounts where person_id = $1`, [person])
const person = (name, kind) => scalar(`insert into people(full_name,sex,birth_date,kind)
  values ($1,'Mujeres','1995-05-05',$2) returning id`, [name, kind])

const admin = '00000000-0000-0000-0000-000000000001'
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
    '10_people_documents', '11_cepevistas', '25_payments']) {
    let migration = await readFile(new URL('../supabase/' + file + '.sql', import.meta.url), 'utf8')
    migration = migration.replace('create extension if not exists "pgcrypto";', '')
    if (file === '10_people_documents') await db.exec('drop view if exists v_colporteurs')
    await db.exec(migration)
  }
  await db.exec(await readFile(new URL('../supabase/25_payments.sql', import.meta.url), 'utf8'))
  checks += 1 // migration rerun
  check(await scalar('select count(*)::int from payment_settings'), 1)
  check(await scalar('select count(*)::int from payment_service_types'), 5)

  await sql("insert into auth.users(id,email) values ($1,'payments-test@example.invalid')", [admin])
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [admin])

  // Ciclos: un mes calendario desde la fecha de ingreso (30 o 31 dias)
  check(await scalar("select payment_period_start('2026-04-10', 1)::text"), '2026-05-10')
  check(await scalar("select payment_period_start('2026-05-10', 1) - '2026-05-10'::date"), 31)
  check(await scalar("select payment_period_start('2026-04-10', 1) - '2026-04-10'::date"), 30)
  check(await scalar("select payment_period_start('2026-01-31', 1)::text"), '2026-02-28')
  check(await scalar("select payment_period_start('2026-01-31', 2)::text"), '2026-03-31')

  const ana = await person('Ana Cepevista', 'Cepevista')
  const beto = await person('Beto Colportor', 'Colportor')
  const carla = await person('Carla Cepevista', 'Cepevista')
  const resident = await person('Residente', 'Residente')
  const today = await scalar('select cepev_today()::text')

  // Permisos de configuracion
  await setRole('coordinador')
  await rejects('select payment_settings_save(300000, 50000, 5)', [], /administracion/)
  await rejects("select payment_service_type_save(null, 'Pintura', 1000)", [], /administracion/)
  await rejects('select payment_accounts_bootstrap()', [], /Configura/)
  await rejects('select payment_account_save(null, $1, cepev_today())', [ana], /Configura primero/)
  await setRole('admin')
  await rejects('select payment_settings_save(-1, 50000, 5)', [], /negativos/)
  await rejects('select payment_settings_save(1, 1, 40)', [], /dias de aviso/)
  await sql('select payment_settings_save(300000, 50000, 5)')
  const cocina = await scalar("select id from payment_service_types where name = 'Cocina'")
  const aseo = await scalar("select id from payment_service_types where name = 'Aseo'")
  await sql("select payment_service_type_save($1, 'Cocina', 10000, true)", [cocina])
  await rejects("select payment_service_type_save(null, 'cocina', 1)", [], /Ya existe/)
  await rejects('insert into payments(concept,method,amount,paid_on) values ($1,$2,1,cepev_today())',
    ['Ofrenda', 'Efectivo'], /permission denied/)

  // Cuenta en mora: ingreso hace un mes y 3 dias -> la primera cuota vencio hace 3 dias
  await setRole('coordinador')
  await rejects('select payment_account_save(null, $1, cepev_today())', [resident], /cepevistas y colportores/)
  const anaAccount = await scalar(`select (payment_account_save(null, $1,
    (cepev_today() - interval '1 month' - interval '3 days')::date)).id`, [ana])
  await rejects('select payment_account_save(null, $1, cepev_today())', [ana], /ya tiene/)
  check(await scalar('select count(*)::int from payment_charges where account_id = $1', [anaAccount]), 2)
  check(await account(ana), { status: 'En mora', charged: 600000, paid: 0, balance: 600000,
    overdue: 300000, credit: 0, days_overdue: 3 })
  check(await scalar('select payment_sync_charges()'), 0) // idempotente

  // Abonos parciales, en especie y validaciones
  await rejects("select payment_register($1, 'Siembra', 'Efectivo', 1000, cepev_today())", [ana], /es de mensualidad/)
  await rejects("select payment_register($1, 'Mensualidad', 'Efectivo', 0, cepev_today())", [ana], /mayor que cero/)
  await rejects("select payment_register($1, 'Mensualidad', 'Efectivo', 1, cepev_today() + 1)", [ana], /futura/)
  await rejects("select payment_register($1, 'Mensualidad', 'Efectivo', 1, cepev_today())", [carla], /no tiene cuenta/)
  await rejects("select payment_register(null, 'Mensualidad', 'Efectivo', 1, cepev_today())", [], /Selecciona la persona/)
  const cash = await scalar(`select (payment_register($1, 'Mensualidad', 'Transferencia', 200000,
    cepev_today(), null, null, 'TRX-1')).id`, [ana])
  check((await account(ana)).overdue, 100000)
  check((await account(ana)).status, 'En mora')
  await rejects("select payment_register($1, 'Mensualidad', 'Especie', null, cepev_today(), $2, 5)", [ana, aseo], /valor hora/)
  await rejects("select payment_register($1, 'Mensualidad', 'Especie', null, cepev_today(), $2, 0)", [ana, cocina], /horas/)
  await rejects("select payment_register(null, 'Ofrenda', 'Especie', null, cepev_today(), $1, 2)", [cocina], /estadia/)
  const inKind = await row(`select amount::float, hourly_rate::float from payment_register($1, 'Mensualidad', 'Especie',
    999, cepev_today(), $2, 10)`, [ana, cocina])
  check(inKind, { amount: 100000, hourly_rate: 10000 })
  check(await account(ana), { status: 'Pendiente', charged: 600000, paid: 300000, balance: 300000,
    overdue: 0, credit: 0, days_overdue: null })
  check((await sql('select status from v_payment_charges where account_id = $1 order by period_index',
    [anaAccount])).rows.map((r) => r.status), ['Pagada', 'Pendiente'])

  // Ofrendas: persona opcional, no afectan el saldo
  await sql("select payment_register(null, 'Ofrenda', 'Efectivo', 20000, cepev_today(), null, null, null, null, 'Visitante')")
  await sql("select payment_register($1, 'Ofrenda', 'Efectivo', 5000, cepev_today())", [ana])
  check((await account(ana)).balance, 300000)
  check(await scalar("select person_name from v_payments where concept = 'Ofrenda' and person_id is null"), 'Visitante')

  // Anular devuelve la deuda
  await rejects('select payment_void($1, $2)', [cash, ' '], /motivo/)
  await sql("select payment_void($1, 'Transferencia rechazada')", [cash])
  await rejects("select payment_void($1, 'otra vez')", [cash], /ya fue anulado/)
  check((await account(ana)).overdue, 200000)
  check(await scalar('select is_voided from v_payments where id = $1', [cash]), true)

  // Saldo a favor
  await sql("select payment_register($1, 'Mensualidad', 'Efectivo', 900000, cepev_today())", [ana])
  check(await account(ana), { status: 'Al dia', charged: 600000, paid: 1000000, balance: -400000,
    overdue: 0, credit: 400000, days_overdue: null })

  // Por vencer: la primera cuota vence en 3 dias (aviso configurado en 5)
  const betoAccount = await scalar(`select (payment_account_save(null, $1,
    (cepev_today() - interval '1 month' + interval '3 days')::date)).id`, [beto])
  check(await row('select status, concept from v_payment_accounts where person_id = $1', [beto]),
    { status: 'Por vencer', concept: 'Siembra' })
  check(await scalar('select monthly_amount::float from payment_accounts where id = $1', [betoAccount]), 50000)

  // Cambio de tarifa: las cuotas generadas conservan su valor
  await setRole('admin')
  await sql('select payment_settings_save(350000, 60000, 5, true)')
  check(await scalar('select max(amount)::float from payment_charges where account_id = $1', [anaAccount]), 300000)
  check(await scalar('select monthly_amount::float from payment_accounts where id = $1', [anaAccount]), 350000)

  // Ajuste de cuota (beca) solo con motivo
  const firstBeto = await scalar('select id from payment_charges where account_id = $1 and period_index = 0', [betoAccount])
  await rejects("select payment_charge_adjust($1, 0, '')", [firstBeto], /motivo/)
  await sql("select payment_charge_adjust($1, 0, 'Beca del primer mes')", [firstBeto])
  check((await row('select status from v_payment_accounts where person_id = $1', [beto])).status, 'Al dia')

  // Cambiar la fecha de ingreso recalcula los ciclos; cerrar la cuenta los detiene
  await setRole('coordinador')
  await sql("select payment_account_save($1, $2, (cepev_today() - interval '3 months')::date, 60000)", [betoAccount, beto])
  check(await scalar('select count(*)::int from payment_charges where account_id = $1', [betoAccount]), 4)
  check(await scalar('select count(*)::int from payment_charges where account_id = $1 and adjust_reason is not null', [betoAccount]), 0)
  await sql(`select payment_account_save($1, $2, (cepev_today() - interval '3 months')::date, 60000,
    (cepev_today() - interval '1 month')::date)`, [betoAccount, beto])
  check(await scalar('select count(*)::int from payment_charges where account_id = $1', [betoAccount]), 2)
  await rejects('select payment_account_save($1, $2, cepev_today(), 1, cepev_today())', [betoAccount, beto], /posterior/)

  // Apertura masiva: fecha de ingreso tomada de la primera estadia
  await asOwner()
  const room = await scalar("insert into rooms(code,sex) values ('P-1','Mujeres') returning id")
  const bed = await scalar("insert into beds(room_id,label) values ($1,'1') returning id", [room])
  await sql(`insert into stays(person_id,bed_id,start_date,end_date,status)
    values ($1,$2,cepev_today() - 10,cepev_today() + 30,'Alojado')`, [carla, bed])
  const dani = await person('Dani Colportor', 'Colportor')
  await asUser()
  check((await sql(`select person_name, concept, entry_source, default_amount::float as amount,
    suggested_entry_date = cepev_today() - 10 as from_stay
    from v_payment_missing_accounts order by person_name`)).rows, [
    { person_name: 'Carla Cepevista', concept: 'Mensualidad', entry_source: 'Primera estadia', amount: 350000, from_stay: true },
    { person_name: 'Dani Colportor', concept: 'Siembra', entry_source: 'Registro de la ficha', amount: 60000, from_stay: false },
  ])
  // Apertura revisada: todas o ninguna, el error nombra a la persona
  await rejects(`select payment_accounts_open(jsonb_build_array(
    jsonb_build_object('person_id', $1::text, 'entry_date', (cepev_today() - 10)::text),
    jsonb_build_object('person_id', $2::text, 'entry_date', (cepev_today() + 400)::text)))`, [carla, dani], /Dani Colportor: .*un ano/)
  check(await scalar('select count(*)::int from v_payment_missing_accounts'), 2)
  await rejects("select payment_accounts_open('[]'::jsonb)", [], /al menos una/)
  check(await scalar(`select payment_accounts_open(jsonb_build_array(
    jsonb_build_object('person_id', $1::text, 'entry_date', cepev_today()::text, 'monthly_amount', 45000)))`, [dani]), 1)
  check(await scalar('select monthly_amount::float from payment_accounts where person_id = $1', [dani]), 45000)
  check(await scalar('select payment_accounts_bootstrap()'), 1)
  check(await scalar('select payment_accounts_bootstrap()'), 0)
  check(await scalar('select count(*)::int from v_payment_missing_accounts'), 0)
  check(await row(`select entry_date::text, monthly_amount::float, status from v_payment_accounts
    where person_id = $1`, [carla]),
  { entry_date: await scalar("select (cepev_today() - 10)::text"), monthly_amount: 350000, status: 'Pendiente' })

  // Alta desde la ficha: cuenta + primer pago, todo o nada
  const eva = await person('Eva Cepevista', 'Cepevista')
  await rejects(`select payment_enroll($1, cepev_today(), null,
    jsonb_build_object('method', 'Efectivo', 'amount', 0))`, [eva], /mayor que cero/)
  check(await scalar('select count(*)::int from payment_accounts where person_id = $1', [eva]), 0)
  await sql(`select payment_enroll($1, cepev_today(), 320000,
    jsonb_build_object('method', 'Transferencia', 'amount', 200000, 'reference', 'TRX-9'))`, [eva])
  check(await account(eva), { status: 'Pendiente', charged: 320000, paid: 200000, balance: 120000,
    overdue: 0, credit: 0, days_overdue: null })
  check(await scalar("select concept || ' ' || reference from payments where person_id = $1", [eva]), 'Mensualidad TRX-9')
  const fede = await person('Fede Colportor', 'Colportor')
  await sql("select payment_enroll($1, cepev_today(), null, jsonb_build_object('method', 'Efectivo'))", [fede])
  check((await account(fede)).status, 'Al dia')
  check((await row('select concept, monthly_amount::float as amount from v_payment_accounts where person_id = $1', [fede])),
    { concept: 'Siembra', amount: 60000 })

  // Por dias: estadia corta = una cuota (dias x valor dia) que vence el dia de salida
  await setRole('admin')
  await sql('select payment_settings_save(350000, 60000, 5, false, 15000)')
  check(await scalar('select cepevista_daily_fee::float from payment_settings'), 15000)
  await setRole('coordinador')
  const gabi = await person('Gabi Cepevista', 'Cepevista')
  await rejects("select payment_account_save(null, $1, cepev_today(), null, null, null, 'Por dias')", [gabi], /fecha de salida/)
  await rejects("select payment_account_save(null, $1, cepev_today(), null, null, null, 'Siembra')", [gabi], /mensualidad o por dias/)
  await rejects("select payment_account_save(null, $1, cepev_today(), null, null, null, 'Por dias')", [fede], /siembra/)
  await sql(`select payment_enroll($1, cepev_today() - 2, null, jsonb_build_object('method', 'Efectivo'),
    'Por dias', cepev_today() + 8)`, [gabi])
  check(await row(`select period_start::text = (cepev_today() - 2)::text as start_ok,
    due_date = cepev_today() + 8 as due_ok, amount::float from payment_charges
    join payment_accounts a on a.id = account_id where a.person_id = $1`, [gabi]),
  { start_ok: true, due_ok: true, amount: 150000 })
  check((await account(gabi)).status, 'Al dia') // el primer pago cubrio los 10 dias
  check(await scalar("select concept from payments where person_id = $1", [gabi]), 'Por dias')
  await rejects("select payment_register($1, 'Mensualidad', 'Efectivo', 1, cepev_today())", [gabi], /es de por dias/)
  // Estadia larga por dias: se corta en ciclos mensuales y el ultimo tramo vence en la salida
  const gabiAccount = await scalar('select id from payment_accounts where person_id = $1', [gabi])
  await sql(`select payment_account_save($1, $2, (cepev_today() - interval '1 month' - interval '5 days')::date,
    10000, (cepev_today() + 10), null, 'Por dias')`, [gabiAccount, gabi])
  check((await sql(`select (due_date - period_start) as days, amount::float from payment_charges
    where account_id = $1 order by period_index`, [gabiAccount])).rows.map((r) => [r.days, r.amount]),
  await (async () => {
    const entry = "(cepev_today() - interval '1 month' - interval '5 days')::date"
    const first = await scalar(`select payment_period_start(${entry}, 1) - ${entry}`)
    const last = await scalar(`select (cepev_today() + 10) - payment_period_start(${entry}, 1)`)
    return [[first, first * 10000], [last, last * 10000]]
  })())
  // Cambiar a mensualidad recalcula las cuotas
  await sql(`select payment_account_save($1, $2, (cepev_today() - 2), 350000, null, null, 'Mensualidad')`, [gabiAccount, gabi])
  check(await scalar('select amount::float from payment_charges where account_id = $1', [gabiAccount]), 350000)

  // Consulta: lee y sincroniza, pero no escribe
  await setRole('consulta')
  check(await scalar('select count(*)::int from v_payment_accounts'), 7)
  check(await scalar('select payment_sync_charges()'), 0)
  await rejects("select payment_register($1, 'Mensualidad', 'Efectivo', 1, cepev_today())", [ana], /consulta/)
  await rejects("select payment_void((select id from payments limit 1), 'x')", [], /consulta/)
  await rejects('select payment_accounts_bootstrap()', [], /consulta/)
  await asOwner()
  check(await scalar("select count(*)::int from audit_log where action like 'payment%'") >= 10, true)

  console.log(`payments: ${checks} checks passed (today ${today})`)
} finally {
  await db.close()
}
