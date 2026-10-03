-- ============================================================================
-- CEPEV · 25_payments.sql · Modulo de pagos
--
--   Conceptos de pago:
--     Mensualidad -> la paga un cepevista por su estadia, por mes
--     Por dias    -> la paga un cepevista de estadia corta: dias x valor dia
--     Siembra     -> la paga un colportor (valor de colportaje por meta)
--     Ofrenda     -> voluntaria; persona opcional, no genera ni salda deuda
--
--   Formas de pago: Efectivo, Transferencia o Especie. En especie la persona
--   presta un servicio: horas x valor hora del tipo de servicio. Solo abona a
--   la estadia (mensualidad o siembra), nunca a una ofrenda.
--
--   Ciclos: cada cuenta tiene una fecha de ingreso. El ciclo k va de
--   ingreso + k meses a ingreso + (k + 1) meses: 30 o 31 dias segun el mes
--   (28 o 29 en febrero). La fecha final del ciclo es la fecha limite de su
--   cuota. Regla del centro: nadie puede pasar un mes debiendo; una cuota
--   sin cubrir despues de su fecha limite deja la cuenta EN MORA.
--
--   Por dias: exige fecha de salida. Cada ciclo cobra los dias de estadia que
--   caen en el (hasta la salida) x valor dia, y vence al terminar el ciclo o en
--   la fecha de salida, lo que ocurra primero. Una estadia corta es una sola
--   cuota que vence el dia de salida.
--
--   Los abonos se aplican a las cuotas mas antiguas primero. Un pago mayor a
--   la deuda queda como saldo a favor para las cuotas siguientes.
--
--   Tablas nuevas:
--     payment_settings       -> criterios (mensualidad, valor por meta, alertas)
--     payment_service_types  -> tipos de servicio y valor hora
--     payment_accounts       -> cuenta de cada cepevista o colportor
--     payment_charges        -> cuota de cada ciclo, con el valor vigente al
--                               generarse (cambiar la tarifa no reescribe historia)
--     payments               -> pagos; se anulan, no se borran
--
--   Toda escritura pasa por funciones del dominio y queda en audit_log.
--
--   Ejecutar DESPUES de 24_vehicle_documents.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Configuracion de criterios (una sola fila)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_settings (
  id                    boolean primary key default true check (id),
  cepevista_monthly_fee numeric(12, 2) not null default 0 check (cepevista_monthly_fee >= 0),
  colporteur_goal_value numeric(12, 2) not null default 0 check (colporteur_goal_value >= 0),
  alert_days_before     smallint not null default 5 check (alert_days_before between 0 and 28),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

alter table public.payment_settings
  add column if not exists cepevista_daily_fee numeric(12, 2) not null default 0;
alter table public.payment_settings drop constraint if exists payment_settings_daily_fee_ok;
alter table public.payment_settings add constraint payment_settings_daily_fee_ok check (cepevista_daily_fee >= 0);

comment on table public.payment_settings is
  'Criterios de cobro: mensualidad del cepevista, valor de colportaje por meta y dias de aviso.';

insert into public.payment_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.payment_service_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  hourly_rate numeric(12, 2) not null default 0 check (hourly_rate >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists payment_service_types_name_idx
  on public.payment_service_types (lower(name));

insert into public.payment_service_types (name)
select v.name
  from (values ('Cocina'), ('Aseo'), ('Lavanderia'), ('Mantenimiento'), ('Conduccion')) as v(name)
 where not exists (select 1 from public.payment_service_types);


-- ---------------------------------------------------------------------------
-- 2) Cuentas, cuotas y pagos
-- ---------------------------------------------------------------------------
create table if not exists public.payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null unique references public.people (id) on delete cascade,
  concept        text not null,
  entry_date     date not null,
  monthly_amount numeric(12, 2) not null check (monthly_amount >= 0),
  closed_on      date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint payment_accounts_closed_ok check (closed_on is null or closed_on > entry_date)
);

-- Los checks con nombre se recrean: la migracion se aplica sobre bases que ya la tenian
alter table public.payment_accounts drop constraint if exists payment_accounts_concept_check;
alter table public.payment_accounts drop constraint if exists payment_accounts_concept_ok;
alter table public.payment_accounts add constraint payment_accounts_concept_ok
  check (concept in ('Mensualidad', 'Por dias', 'Siembra'));
alter table public.payment_accounts drop constraint if exists payment_accounts_daily_exit_ok;
alter table public.payment_accounts add constraint payment_accounts_daily_exit_ok
  check (concept <> 'Por dias' or closed_on is not null);

comment on column public.payment_accounts.monthly_amount is
  'Valor de la cuota: por mes (Mensualidad, Siembra) o por dia (Por dias).';
comment on column public.payment_accounts.entry_date is
  'Fecha de ingreso: inicia el primer ciclo. Cada cuota vence un mes calendario despues de iniciar su ciclo.';
comment on column public.payment_accounts.closed_on is
  'Fecha de salida: no se generan ciclos que empiecen en o despues de esta fecha.';

create table if not exists public.payment_charges (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.payment_accounts (id) on delete cascade,
  period_index  integer not null check (period_index >= 0),
  period_start  date not null,
  due_date      date not null,
  amount        numeric(12, 2) not null check (amount >= 0),
  adjust_reason text,
  created_at    timestamptz not null default now(),
  constraint payment_charges_dates_ok check (due_date > period_start),
  unique (account_id, period_index)
);

create index if not exists payment_charges_due_idx on public.payment_charges (due_date);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid references public.people (id) on delete set null,
  payer_name      text,
  account_id      uuid references public.payment_accounts (id) on delete set null,
  concept         text not null,
  method          text not null check (method in ('Efectivo', 'Transferencia', 'Especie')),
  amount          numeric(12, 2) not null check (amount > 0),
  paid_on         date not null,
  service_type_id uuid references public.payment_service_types (id) on delete restrict,
  service_hours   numeric(6, 2) check (service_hours is null or service_hours > 0),
  hourly_rate     numeric(12, 2),
  reference       text,
  notes           text,
  voided_at       timestamptz,
  voided_reason   text,
  voided_by       uuid references public.profiles (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint payments_in_kind_ok check (
    (method = 'Especie') = (service_type_id is not null and service_hours is not null and hourly_rate is not null)
  ),
  constraint payments_offering_ok check (concept <> 'Ofrenda' or (method <> 'Especie' and account_id is null)),
  constraint payments_stay_account_ok check (concept = 'Ofrenda' or account_id is not null or person_id is null)
);

alter table public.payments drop constraint if exists payments_concept_check;
alter table public.payments drop constraint if exists payments_concept_ok;
alter table public.payments add constraint payments_concept_ok
  check (concept in ('Mensualidad', 'Por dias', 'Siembra', 'Ofrenda'));

create index if not exists payments_paid_on_idx on public.payments (paid_on desc);
create index if not exists payments_account_idx on public.payments (account_id) where voided_at is null;
create index if not exists payments_person_idx on public.payments (person_id);


-- ---------------------------------------------------------------------------
-- 3) RLS: leen todos los autenticados; se escribe solo con las funciones
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['payment_settings', 'payment_service_types', 'payment_accounts',
                           'payment_charges', 'payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 4) Ciclos
-- ---------------------------------------------------------------------------
-- Inicio del ciclo k: siempre se cuenta desde la fecha de ingreso (no
-- encadenado), asi un ingreso el 31 vuelve al 31 en los meses que lo tienen.
create or replace function public.payment_period_start(p_entry date, p_index integer)
returns date
language sql immutable
as $fn$
  select (p_entry + make_interval(months => p_index))::date;
$fn$;

-- Genera las cuotas de los ciclos ya iniciados que falten. Es idempotente y
-- deterministica: cualquier usuario autenticado puede invocarla al abrir el
-- modulo para que el estado de cuentas este al dia.
create or replace function public.payment_sync_charges(p_account uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_today date := public.cepev_today();
  v_count integer;
begin
  insert into public.payment_charges (account_id, period_index, period_start, due_date, amount)
  select a.id, k,
         public.payment_period_start(a.entry_date, k),
         c.due_date,
         case when a.concept = 'Por dias'
              then a.monthly_amount * (c.due_date - public.payment_period_start(a.entry_date, k))
              else a.monthly_amount end
    from public.payment_accounts a
   cross join lateral generate_series(
           0,
           (extract(year from age(v_today, a.entry_date)) * 12
            + extract(month from age(v_today, a.entry_date)))::int + 1
         ) as k
   -- Por dias: el ultimo tramo termina y vence en la fecha de salida
   cross join lateral (
     select case when a.concept = 'Por dias'
                 then least(public.payment_period_start(a.entry_date, k + 1), a.closed_on)
                 else public.payment_period_start(a.entry_date, k + 1) end as due_date
   ) c
   where (p_account is null or a.id = p_account)
     and a.entry_date <= v_today
     and public.payment_period_start(a.entry_date, k) <= v_today
     and (a.closed_on is null or public.payment_period_start(a.entry_date, k) < a.closed_on)
  on conflict (account_id, period_index) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 5) Vistas
-- ---------------------------------------------------------------------------
drop view if exists public.v_payment_accounts;
drop view if exists public.v_payment_charges;
drop view if exists public.v_payments;

-- Cuotas con lo abonado a cada una (las mas antiguas se cubren primero)
create view public.v_payment_charges with (security_invoker = on) as
with paid as (
  select account_id, sum(amount) as total
    from public.payments
   where voided_at is null and account_id is not null
   group by account_id
),
ordered as (
  select ch.*,
         coalesce(sum(ch.amount) over (
           partition by ch.account_id order by ch.period_index
           rows between unbounded preceding and 1 preceding), 0) as covered_before
    from public.payment_charges ch
),
applied as (
  select o.*,
         least(o.amount, greatest(0, coalesce(paid.total, 0) - o.covered_before)) as paid_amount
    from ordered o
    left join paid on paid.account_id = o.account_id
)
select
  c.id,
  c.account_id,
  a.person_id,
  p.full_name as person_name,
  a.concept,
  c.period_index,
  c.period_start,
  c.due_date,
  c.amount,
  c.adjust_reason,
  c.paid_amount,
  c.amount - c.paid_amount as pending_amount,
  case
    when c.amount - c.paid_amount = 0 then 'Pagada'
    when public.cepev_today() > c.due_date then 'Vencida'
    when c.due_date - public.cepev_today() <= s.alert_days_before then 'Por vencer'
    else 'Pendiente'
  end as status
from applied c
join public.payment_accounts a on a.id = c.account_id
join public.people p on p.id = a.person_id
cross join public.payment_settings s;

-- Estado de cuenta de cada cepevista o colportor
create view public.v_payment_accounts with (security_invoker = on) as
with charges as (
  select account_id,
         sum(amount)                                              as charged_total,
         sum(pending_amount) filter (where status = 'Vencida')    as overdue_amount,
         min(due_date)       filter (where status = 'Vencida')    as overdue_since,
         min(due_date)       filter (where pending_amount > 0)    as next_due_date,
         bool_or(status = 'Por vencer')                           as due_soon,
         max(period_index)                                        as last_period
    from public.v_payment_charges
   group by account_id
),
paid as (
  select account_id, sum(amount) as paid_total, max(paid_on) as last_paid_on
    from public.payments
   where voided_at is null and account_id is not null
   group by account_id
)
select
  a.id,
  a.person_id,
  p.full_name   as person_name,
  p.kind        as person_kind,
  p.document_type,
  p.document_id,
  p.phone,
  a.concept,
  a.entry_date,
  a.monthly_amount,
  a.closed_on,
  a.notes,
  coalesce(c.charged_total, 0)                           as charged_total,
  coalesce(pd.paid_total, 0)                             as paid_total,
  coalesce(c.charged_total, 0) - coalesce(pd.paid_total, 0) as balance,
  greatest(0, coalesce(pd.paid_total, 0) - coalesce(c.charged_total, 0)) as credit,
  coalesce(c.overdue_amount, 0)                          as overdue_amount,
  c.overdue_since,
  case when c.overdue_since is not null
       then public.cepev_today() - c.overdue_since end   as days_overdue,
  coalesce(c.next_due_date,
           case when a.concept = 'Por dias'
                then least(public.payment_period_start(a.entry_date, coalesce(c.last_period + 1, 0) + 1), a.closed_on)
                else public.payment_period_start(a.entry_date, coalesce(c.last_period + 1, 0) + 1) end) as next_due_date,
  pd.last_paid_on,
  case
    when a.closed_on is not null and a.closed_on <= public.cepev_today()
         and coalesce(c.charged_total, 0) <= coalesce(pd.paid_total, 0) then 'Cerrada'
    when coalesce(c.overdue_amount, 0) > 0 then 'En mora'
    when coalesce(c.due_soon, false) then 'Por vencer'
    when coalesce(c.charged_total, 0) > coalesce(pd.paid_total, 0) then 'Pendiente'
    else 'Al dia'
  end as status
from public.payment_accounts a
join public.people p on p.id = a.person_id
left join charges c on c.account_id = a.id
left join paid pd on pd.account_id = a.id;

-- Pagos con los nombres resueltos
create view public.v_payments with (security_invoker = on) as
select
  pm.id,
  pm.person_id,
  coalesce(p.full_name, pm.payer_name) as person_name,
  p.kind as person_kind,
  pm.account_id,
  pm.concept,
  pm.method,
  pm.amount,
  pm.paid_on,
  pm.service_type_id,
  st.name as service_type_name,
  pm.service_hours,
  pm.hourly_rate,
  pm.reference,
  pm.notes,
  pm.voided_at,
  pm.voided_reason,
  pm.voided_at is not null as is_voided,
  pr.full_name as created_by_name,
  pm.created_at
from public.payments pm
left join public.people p on p.id = pm.person_id
left join public.payment_service_types st on st.id = pm.service_type_id
left join public.profiles pr on pr.id = pm.created_by;

revoke all on public.v_payment_charges, public.v_payment_accounts, public.v_payments from anon;
grant select on public.v_payment_charges, public.v_payment_accounts, public.v_payments to authenticated;


-- ---------------------------------------------------------------------------
-- 6) Configuracion (solo administracion)
-- ---------------------------------------------------------------------------
drop function if exists public.payment_settings_save(numeric, numeric, integer, boolean);
create or replace function public.payment_settings_save(
  p_cepevista_fee numeric,
  p_colporteur_goal_value numeric,
  p_alert_days integer,
  p_apply_to_accounts boolean default false,
  p_cepevista_daily_fee numeric default null
) returns public.payment_settings
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row     public.payment_settings%rowtype;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo la administracion puede cambiar los criterios de pago.' using errcode = 'P0001';
  end if;
  if p_cepevista_fee is null or p_cepevista_fee < 0
     or p_colporteur_goal_value is null or p_colporteur_goal_value < 0
     or coalesce(p_cepevista_daily_fee, 0) < 0 then
    raise exception 'Los valores de cobro no pueden ser negativos.' using errcode = 'P0001';
  end if;
  if p_alert_days is null or p_alert_days not between 0 and 28 then
    raise exception 'Los dias de aviso deben estar entre 0 y 28.' using errcode = 'P0001';
  end if;

  update public.payment_settings
     set cepevista_monthly_fee = p_cepevista_fee,
         colporteur_goal_value = p_colporteur_goal_value,
         cepevista_daily_fee   = coalesce(p_cepevista_daily_fee, cepevista_daily_fee),
         alert_days_before     = p_alert_days,
         updated_at            = now(),
         updated_by            = auth.uid()
   where id
  returning * into v_row;

  -- Las cuotas ya generadas conservan su valor: se materializan antes del
  -- cambio y la nueva tarifa rige para los ciclos siguientes.
  if coalesce(p_apply_to_accounts, false) then
    perform public.payment_sync_charges();
    update public.payment_accounts
       set monthly_amount = case concept when 'Mensualidad' then p_cepevista_fee
                                         when 'Por dias' then v_row.cepevista_daily_fee
                                         else p_colporteur_goal_value end,
           updated_at = now()
     where closed_on is null or closed_on > public.cepev_today();
    get diagnostics v_updated = row_count;
  end if;

  perform public.log_action('payment_settings', 'payment_settings', null,
    'Criterios de pago actualizados'
      || case when v_updated > 0 then ' (aplicados a ' || v_updated || ' cuentas)' else '' end,
    jsonb_build_object('cepevista_monthly_fee', p_cepevista_fee,
                       'colporteur_goal_value', p_colporteur_goal_value,
                       'cepevista_daily_fee', v_row.cepevista_daily_fee,
                       'alert_days_before', p_alert_days));
  return v_row;
end;
$fn$;

create or replace function public.payment_service_type_save(
  p_id uuid,
  p_name text,
  p_hourly_rate numeric,
  p_active boolean default true
) returns public.payment_service_types
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.payment_service_types%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo la administracion puede cambiar los tipos de servicio.' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'Indica el nombre del servicio.' using errcode = 'P0001';
  end if;
  if p_hourly_rate is null or p_hourly_rate < 0 then
    raise exception 'El valor hora no puede ser negativo.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_service_types
              where lower(name) = lower(v_name) and (p_id is null or id <> p_id)) then
    raise exception 'Ya existe un servicio llamado %.', v_name using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.payment_service_types (name, hourly_rate, is_active)
    values (v_name, p_hourly_rate, coalesce(p_active, true))
    returning * into v_row;
  else
    update public.payment_service_types
       set name = v_name, hourly_rate = p_hourly_rate,
           is_active = coalesce(p_active, is_active), updated_at = now()
     where id = p_id
    returning * into v_row;
    if not found then raise exception 'Servicio no encontrado.' using errcode = 'P0001'; end if;
  end if;

  perform public.log_action('payment_service_type', 'payment_service_types', v_row.id,
    'Servicio ' || v_row.name || ': valor hora ' || v_row.hourly_rate
      || case when v_row.is_active then '' else ' (inactivo)' end);
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 7) Cuentas
-- ---------------------------------------------------------------------------
-- Valor por defecto de la cuota segun el concepto
create or replace function public.payment_default_amount(p_concept text)
returns numeric
language plpgsql stable
set search_path = public
as $fn$
declare v_amount numeric;
begin
  select case p_concept when 'Mensualidad' then cepevista_monthly_fee
                        when 'Por dias' then cepevista_daily_fee
                        else colporteur_goal_value end
    into v_amount from public.payment_settings;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'Configura primero el valor de la % en Pagos -> Configuracion, o indica el valor de la cuota.',
      case p_concept when 'Mensualidad' then 'mensualidad' when 'Por dias' then 'estadia por dia'
                     else 'siembra por meta' end
      using errcode = 'P0001';
  end if;
  return v_amount;
end;
$fn$;

drop function if exists public.payment_account_save(uuid, uuid, date, numeric, date, text);
create or replace function public.payment_account_save(
  p_id uuid,
  p_person uuid,
  p_entry_date date,
  p_monthly_amount numeric default null,
  p_closed_on date default null,
  p_notes text default null,
  p_concept text default null
) returns public.payment_accounts
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row     public.payment_accounts%rowtype;
  v_old     public.payment_accounts%rowtype;
  v_kind    text;
  v_name    text;
  v_concept text;
  v_amount  numeric;
begin
  perform public.assert_can_write();

  select kind::text, full_name into v_kind, v_name from public.people where id = p_person;
  if not found then raise exception 'Persona no encontrada.' using errcode = 'P0001'; end if;
  if v_kind not in ('Cepevista', 'Colportor') then
    raise exception 'Solo los cepevistas y colportores tienen cuenta de pagos.' using errcode = 'P0001';
  end if;
  -- Colportor: siempre siembra. Cepevista: mensualidad (por defecto) o por dias
  v_concept := case v_kind when 'Colportor' then 'Siembra' else coalesce(nullif(p_concept, ''), 'Mensualidad') end;
  if v_kind = 'Cepevista' and v_concept not in ('Mensualidad', 'Por dias') then
    raise exception 'Un cepevista paga por mensualidad o por dias.' using errcode = 'P0001';
  end if;
  if v_kind = 'Colportor' and coalesce(nullif(p_concept, ''), 'Siembra') <> 'Siembra' then
    raise exception 'Un colportor paga siembra.' using errcode = 'P0001';
  end if;
  if v_concept = 'Por dias' and p_closed_on is null then
    raise exception 'Indica la fecha de salida: la estadia por dias se cobra hasta esa fecha.' using errcode = 'P0001';
  end if;

  if p_entry_date is null then
    raise exception 'Indica la fecha de ingreso.' using errcode = 'P0001';
  end if;
  if p_entry_date > public.cepev_today() + 365 then
    raise exception 'La fecha de ingreso no puede ser posterior a un ano.' using errcode = 'P0001';
  end if;
  if p_closed_on is not null and p_closed_on <= p_entry_date then
    raise exception 'La fecha de salida debe ser posterior a la de ingreso.' using errcode = 'P0001';
  end if;
  if p_monthly_amount is not null and p_monthly_amount < 0 then
    raise exception 'El valor de la cuota no puede ser negativo.' using errcode = 'P0001';
  end if;
  v_amount := coalesce(p_monthly_amount, public.payment_default_amount(v_concept));

  if p_id is null then
    if exists (select 1 from public.payment_accounts where person_id = p_person) then
      raise exception '% ya tiene una cuenta de pagos.', v_name using errcode = 'P0001';
    end if;
    insert into public.payment_accounts (person_id, concept, entry_date, monthly_amount, closed_on, notes)
    values (p_person, v_concept, p_entry_date, v_amount, p_closed_on, nullif(trim(p_notes), ''))
    returning * into v_row;

    perform public.log_action('payment_account_create', 'payment_accounts', v_row.id,
      'Cuenta de ' || lower(v_concept) || ' abierta: ' || v_name || ' (ingreso ' || p_entry_date || ')');
  else
    select * into v_old from public.payment_accounts where id = p_id for update;
    if not found then raise exception 'Cuenta no encontrada.' using errcode = 'P0001'; end if;
    if v_old.person_id <> p_person then
      raise exception 'La cuenta pertenece a otra persona.' using errcode = 'P0001';
    end if;

    -- Materializa los ciclos vigentes con la tarifa anterior
    perform public.payment_sync_charges(p_id);

    if v_old.entry_date <> p_entry_date or v_old.concept <> v_concept
       or (v_concept = 'Por dias' and (v_old.closed_on is distinct from p_closed_on
                                       or v_old.monthly_amount <> v_amount)) then
      -- Los ciclos dependen de la fecha de ingreso y del concepto (y, por dias,
      -- de la salida y el valor dia): se recalculan
      delete from public.payment_charges where account_id = p_id;
    elsif p_closed_on is not null then
      delete from public.payment_charges where account_id = p_id and period_start >= p_closed_on;
    end if;

    update public.payment_accounts
       set concept        = v_concept,
           entry_date     = p_entry_date,
           monthly_amount = v_amount,
           closed_on      = p_closed_on,
           notes          = nullif(trim(p_notes), ''),
           updated_at     = now()
     where id = p_id
    returning * into v_row;

    perform public.log_action('payment_account_update', 'payment_accounts', v_row.id,
      'Cuenta actualizada: ' || v_name
        || case when v_old.entry_date <> p_entry_date
                then ' (ingreso ' || v_old.entry_date || ' -> ' || p_entry_date || ', ciclos recalculados)'
                else '' end
        || case when v_old.concept <> v_concept then ' (' || v_old.concept || ' -> ' || v_concept || ')' else '' end,
      jsonb_build_object('concept', v_concept, 'monthly_amount', v_amount, 'closed_on', p_closed_on));
  end if;

  perform public.payment_sync_charges(v_row.id);
  return v_row;
end;
$fn$;

-- Abre la cuenta de los cepevistas y colportores que aun no la tienen.
-- Fecha de ingreso: primera estadia registrada o, si no hay, la fecha de su ficha.
create or replace function public.payment_accounts_bootstrap()
returns integer
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_count integer;
  v_fee   numeric;
  v_goal  numeric;
begin
  perform public.assert_can_write();
  select cepevista_monthly_fee, colporteur_goal_value into v_fee, v_goal from public.payment_settings;

  if exists (select 1 from public.people p
              where p.kind::text = 'Cepevista' and coalesce(v_fee, 0) <= 0
                and not exists (select 1 from public.payment_accounts a where a.person_id = p.id))
     or exists (select 1 from public.people p
              where p.kind::text = 'Colportor' and coalesce(v_goal, 0) <= 0
                and not exists (select 1 from public.payment_accounts a where a.person_id = p.id)) then
    raise exception 'Configura la mensualidad y el valor de siembra por meta antes de abrir las cuentas.'
      using errcode = 'P0001';
  end if;

  insert into public.payment_accounts (person_id, concept, entry_date, monthly_amount)
  select p.id,
         case p.kind::text when 'Cepevista' then 'Mensualidad' else 'Siembra' end,
         coalesce((select min(s.start_date) from public.stays s
                    where s.person_id = p.id and s.status <> 'Cancelado'),
                  (p.created_at at time zone 'America/Bogota')::date),
         case p.kind::text when 'Cepevista' then v_fee else v_goal end
    from public.people p
   where p.kind::text in ('Cepevista', 'Colportor')
     and not exists (select 1 from public.payment_accounts a where a.person_id = p.id);
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.payment_sync_charges();
    perform public.log_action('payment_accounts_bootstrap', 'payment_accounts', null,
      v_count || ' cuentas de pago abiertas automaticamente');
  end if;
  return v_count;
end;
$fn$;

-- Cepevistas y colportores sin cuenta, con la fecha de ingreso sugerida y su
-- origen, para revisarlos antes de abrir las cuentas.
drop view if exists public.v_payment_missing_accounts;
create view public.v_payment_missing_accounts with (security_invoker = on) as
select
  p.id                                                         as person_id,
  p.full_name                                                  as person_name,
  p.kind::text                                                 as person_kind,
  p.document_type,
  p.document_id,
  case p.kind::text when 'Cepevista' then 'Mensualidad' else 'Siembra' end as concept,
  coalesce(fs.first_stay, (p.created_at at time zone 'America/Bogota')::date) as suggested_entry_date,
  case when fs.first_stay is not null then 'Primera estadia' else 'Registro de la ficha' end as entry_source,
  case p.kind::text when 'Cepevista' then s.cepevista_monthly_fee else s.colporteur_goal_value end as default_amount
from public.people p
cross join public.payment_settings s
left join lateral (
  select min(st.start_date) as first_stay
    from public.stays st
   where st.person_id = p.id and st.status <> 'Cancelado'
) fs on true
where p.kind::text in ('Cepevista', 'Colportor')
  and not exists (select 1 from public.payment_accounts a where a.person_id = p.id);

revoke all on public.v_payment_missing_accounts from anon;
grant select on public.v_payment_missing_accounts to authenticated;

-- Abre varias cuentas revisadas en una sola operacion: todas o ninguna.
-- p_items: [{ "person_id": uuid, "entry_date": "AAAA-MM-DD", "monthly_amount": numero | null,
--             "concept": "Mensualidad" | "Por dias" | null, "closed_on": "AAAA-MM-DD" | null }]
create or replace function public.payment_accounts_open(p_items jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_item  jsonb;
  v_count integer := 0;
  v_name  text;
begin
  perform public.assert_can_write();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Selecciona al menos una persona.' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select full_name into v_name from public.people where id = (v_item ->> 'person_id')::uuid;
    begin
      perform public.payment_account_save(
        null,
        (v_item ->> 'person_id')::uuid,
        (v_item ->> 'entry_date')::date,
        nullif(v_item ->> 'monthly_amount', '')::numeric,
        nullif(v_item ->> 'closed_on', '')::date,
        null,
        v_item ->> 'concept');
    exception when sqlstate 'P0001' then
      raise exception '%: %', coalesce(v_name, 'Persona'), sqlerrm using errcode = 'P0001';
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- Ajuste de una cuota (beca, descuento o correccion). Exige motivo.
create or replace function public.payment_charge_adjust(p_charge uuid, p_amount numeric, p_reason text)
returns public.payment_charges
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row public.payment_charges%rowtype;
  v_old numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo la administracion puede ajustar cuotas.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'El valor de la cuota no puede ser negativo.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo del ajuste.' using errcode = 'P0001';
  end if;

  select amount into v_old from public.payment_charges where id = p_charge for update;
  if not found then raise exception 'Cuota no encontrada.' using errcode = 'P0001'; end if;

  update public.payment_charges
     set amount = p_amount, adjust_reason = trim(p_reason)
   where id = p_charge
  returning * into v_row;

  perform public.log_action('payment_charge_adjust', 'payment_charges', v_row.id,
    'Cuota ajustada de ' || v_old || ' a ' || p_amount || ': ' || trim(p_reason));
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 8) Pagos
-- ---------------------------------------------------------------------------
create or replace function public.payment_register(
  p_person uuid,
  p_concept text,
  p_method text,
  p_amount numeric,
  p_paid_on date,
  p_service_type uuid default null,
  p_hours numeric default null,
  p_reference text default null,
  p_notes text default null,
  p_payer_name text default null
) returns public.payments
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row     public.payments%rowtype;
  v_account public.payment_accounts%rowtype;
  v_service public.payment_service_types%rowtype;
  v_name    text;
  v_amount  numeric := p_amount;
  v_rate    numeric;
begin
  perform public.assert_can_write();

  if p_concept is null or p_concept not in ('Mensualidad', 'Por dias', 'Siembra', 'Ofrenda') then
    raise exception 'Concepto de pago no valido.' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('Efectivo', 'Transferencia', 'Especie') then
    raise exception 'Forma de pago no valida.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on > public.cepev_today() then
    raise exception 'La fecha del pago no puede ser futura.' using errcode = 'P0001';
  end if;
  if p_paid_on < public.cepev_today() - 400 then
    raise exception 'La fecha del pago es demasiado antigua.' using errcode = 'P0001';
  end if;

  if p_person is not null then
    select full_name into v_name from public.people where id = p_person;
    if not found then raise exception 'Persona no encontrada.' using errcode = 'P0001'; end if;
  end if;

  if p_concept = 'Ofrenda' then
    if p_method = 'Especie' then
      raise exception 'El pago en especie solo abona a la estadia (mensualidad o siembra).' using errcode = 'P0001';
    end if;
  else
    if p_person is null then
      raise exception 'Selecciona la persona que paga.' using errcode = 'P0001';
    end if;
    select * into v_account from public.payment_accounts where person_id = p_person;
    if not found then
      raise exception '% no tiene cuenta de pagos. Abrela con su fecha de ingreso.', v_name using errcode = 'P0001';
    end if;
    if v_account.concept <> p_concept then
      raise exception 'La cuenta de % es de %, no de %.', v_name, lower(v_account.concept), lower(p_concept)
        using errcode = 'P0001';
    end if;
  end if;

  if p_method = 'Especie' then
    select * into v_service from public.payment_service_types where id = p_service_type;
    if not found or not v_service.is_active then
      raise exception 'Selecciona un tipo de servicio activo.' using errcode = 'P0001';
    end if;
    if v_service.hourly_rate <= 0 then
      raise exception 'El servicio % no tiene valor hora configurado.', v_service.name using errcode = 'P0001';
    end if;
    if p_hours is null or p_hours <= 0 or p_hours > 744 then
      raise exception 'Indica las horas de servicio prestadas.' using errcode = 'P0001';
    end if;
    v_rate   := v_service.hourly_rate;
    v_amount := round(p_hours * v_rate, 2);
  elsif v_amount is null or v_amount <= 0 then
    raise exception 'El valor del pago debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  -- Ciclos vigentes al dia antes de abonar
  if v_account.id is not null then
    perform public.payment_sync_charges(v_account.id);
  end if;

  insert into public.payments (person_id, payer_name, account_id, concept, method, amount, paid_on,
                               service_type_id, service_hours, hourly_rate, reference, notes, created_by)
  values (p_person,
          coalesce(v_name, nullif(trim(p_payer_name), '')),
          v_account.id, p_concept, p_method, v_amount, p_paid_on,
          case when p_method = 'Especie' then v_service.id end,
          case when p_method = 'Especie' then p_hours end,
          v_rate,
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid())
  returning * into v_row;

  perform public.log_action('payment_register', 'payments', v_row.id,
    p_concept || ' registrada: ' || coalesce(v_row.payer_name, 'Anonimo') || ' · ' || v_amount
      || ' (' || lower(p_method)
      || case when p_method = 'Especie' then ', ' || p_hours || ' h de ' || v_service.name else '' end || ')');
  return v_row;
end;
$fn$;

-- Alta desde la ficha de la persona: abre la cuenta y, si se indica, registra
-- el primer pago. Todo o nada. El concepto sale del tipo de persona.
-- p_payment: { method, amount, paid_on, service_type_id, service_hours, reference } | null
-- Sin amount (y no en especie), el pago cubre la primera cuota completa.
drop function if exists public.payment_enroll(uuid, date, numeric, jsonb);
create or replace function public.payment_enroll(
  p_person uuid,
  p_entry_date date,
  p_monthly_amount numeric default null,
  p_payment jsonb default null,
  p_concept text default null,
  p_closed_on date default null
) returns public.payment_accounts
language plpgsql security definer
set search_path = public
as $fn$
declare v_account public.payment_accounts%rowtype;
begin
  v_account := public.payment_account_save(null, p_person, p_entry_date, p_monthly_amount,
                                           p_closed_on, null, p_concept);

  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    perform public.payment_register(
      p_person,
      v_account.concept,
      p_payment ->> 'method',
      coalesce(nullif(p_payment ->> 'amount', '')::numeric,
               case when p_payment ->> 'method' <> 'Especie'
                    then (select amount from public.payment_charges
                           where account_id = v_account.id and period_index = 0)
                         end,
               case when p_payment ->> 'method' <> 'Especie' then v_account.monthly_amount end),
      coalesce(nullif(p_payment ->> 'paid_on', '')::date, public.cepev_today()),
      nullif(p_payment ->> 'service_type_id', '')::uuid,
      nullif(p_payment ->> 'service_hours', '')::numeric,
      p_payment ->> 'reference');
  end if;
  return v_account;
end;
$fn$;

create or replace function public.payment_void(p_id uuid, p_reason text)
returns public.payments
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.payments%rowtype;
begin
  perform public.assert_can_write();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la anulacion.' using errcode = 'P0001';
  end if;

  update public.payments
     set voided_at = now(), voided_reason = trim(p_reason), voided_by = auth.uid()
   where id = p_id and voided_at is null
  returning * into v_row;
  if not found then
    raise exception 'El pago no existe o ya fue anulado.' using errcode = 'P0001';
  end if;

  perform public.log_action('payment_void', 'payments', v_row.id,
    'Pago anulado: ' || coalesce(v_row.payer_name, 'Anonimo') || ' · ' || v_row.amount || ' · ' || trim(p_reason));
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 9) Permisos de ejecucion
-- ---------------------------------------------------------------------------
revoke all on function public.payment_sync_charges(uuid) from public, anon;
revoke all on function public.payment_settings_save(numeric, numeric, integer, boolean, numeric) from public, anon;
revoke all on function public.payment_service_type_save(uuid, text, numeric, boolean) from public, anon;
revoke all on function public.payment_account_save(uuid, uuid, date, numeric, date, text, text) from public, anon;
revoke all on function public.payment_accounts_bootstrap() from public, anon;
revoke all on function public.payment_accounts_open(jsonb) from public, anon;
revoke all on function public.payment_charge_adjust(uuid, numeric, text) from public, anon;
revoke all on function public.payment_register(uuid, text, text, numeric, date, uuid, numeric, text, text, text) from public, anon;
revoke all on function public.payment_enroll(uuid, date, numeric, jsonb, text, date) from public, anon;
revoke all on function public.payment_void(uuid, text) from public, anon;

grant execute on function public.payment_sync_charges(uuid) to authenticated;
grant execute on function public.payment_settings_save(numeric, numeric, integer, boolean, numeric) to authenticated;
grant execute on function public.payment_service_type_save(uuid, text, numeric, boolean) to authenticated;
grant execute on function public.payment_account_save(uuid, uuid, date, numeric, date, text, text) to authenticated;
grant execute on function public.payment_accounts_bootstrap() to authenticated;
grant execute on function public.payment_accounts_open(jsonb) to authenticated;
grant execute on function public.payment_charge_adjust(uuid, numeric, text) to authenticated;
grant execute on function public.payment_register(uuid, text, text, numeric, date, uuid, numeric, text, text, text) to authenticated;
grant execute on function public.payment_enroll(uuid, date, numeric, jsonb, text, date) to authenticated;
grant execute on function public.payment_void(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 10) Comprobacion
-- ---------------------------------------------------------------------------
select
  to_regclass('public.v_payment_accounts') is not null as cuentas,
  to_regclass('public.v_payments') is not null         as pagos,
  exists (select 1 from public.payment_settings)        as configuracion;
