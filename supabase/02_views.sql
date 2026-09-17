-- ============================================================================
-- CEPEV · 02_views.sql · Funciones de apoyo y vistas de lectura
-- ============================================================================

-- Fecha operativa del centro (zona horaria de Colombia)
create or replace function public.cepev_today()
returns date
language sql stable
as $fn$
  select (now() at time zone 'America/Bogota')::date;
$fn$;

-- Ciudad efectiva de una persona en una fecha (rotacion del equipo o ciudad base)
create or replace function public.person_city_on(p_person uuid, p_date date)
returns text
language sql stable
set search_path = public
as $fn$
  select coalesce(
    (select r.city
       from public.rotations r
       join public.people pe on pe.team_id = r.team_id
      where pe.id = p_person
        and p_date >= r.start_date
        and p_date <  r.end_date
      limit 1),
    (select base_city from public.people where id = p_person)
  );
$fn$;

-- Rol del usuario autenticado (security definer: evita recursion con RLS)
create or replace function public.current_role_name()
returns public.app_role
language sql stable security definer
set search_path = public
as $fn$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'consulta'::public.app_role
  );
$fn$;

create or replace function public.can_write()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() in ('admin', 'coordinador');
$fn$;

create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() = 'admin';
$fn$;

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------

-- Estado actual de cada cama
create or replace view public.v_beds_status as
select
  b.id                as bed_id,
  b.label             as bed_label,
  b.is_blocked,
  b.blocked_reason,
  r.id                as room_id,
  r.code              as room_code,
  r.building,
  r.sex,
  s.id                as stay_id,
  s.status            as stay_status,
  s.start_date,
  s.end_date,
  p.id                as person_id,
  p.full_name         as person_name,
  case
    when b.is_blocked then 'Bloqueada'
    when s.id is not null then 'Ocupada'
    else 'Libre'
  end as availability
from public.beds b
join public.rooms r on r.id = b.room_id
left join public.stays s
  on s.bed_id = b.id
 and s.status in ('Reservado', 'Alojado')
 and public.cepev_today() >= s.start_date
 and public.cepev_today() <  s.end_date
left join public.people p on p.id = s.person_id;

-- Turnos de cocina con nombre de la persona
create or replace view public.v_kitchen_shifts as
select
  k.id,
  k.service_date,
  k.meal,
  k.task,
  k.position_index,
  k.starts_at,
  k.ends_at,
  k.person_id,
  p.full_name  as person_name,
  p.kind       as person_kind,
  p.is_available,
  (kp.service_date is not null) as is_published
from public.kitchen_shifts k
left join public.people p on p.id = k.person_id
left join public.kitchen_publications kp on kp.service_date = k.service_date;

-- Progreso de colportores (ultimos 7 dias y acumulado del mes)
create or replace view public.v_colporteur_progress as
select
  p.id                as person_id,
  p.full_name,
  p.daily_goal,
  t.name              as team_name,
  public.person_city_on(p.id, public.cepev_today()) as current_city,
  coalesce(sum(sr.books_sold) filter (
    where sr.report_date >= public.cepev_today() - 6), 0)::int as books_last_7d,
  coalesce(sum(sr.books_sold) filter (
    where date_trunc('month', sr.report_date) = date_trunc('month', public.cepev_today())), 0)::int as books_month,
  count(sr.id) filter (
    where sr.report_date >= public.cepev_today() - 6)::int as reports_last_7d,
  max(sr.report_date) as last_report_date
from public.people p
left join public.teams t on t.id = p.team_id
left join public.sales_reports sr on sr.person_id = p.id
where p.kind = 'Colportor'
group by p.id, p.full_name, p.daily_goal, t.name;

-- Alertas de flota
create or replace view public.v_fleet_status as
select
  v.*,
  (v.next_service_date <= public.cepev_today() + 7 or v.odometer_km >= v.next_service_km) as service_due,
  exists (
    select 1 from public.trips tr
     where tr.vehicle_id = v.id
       and tr.status in ('Reservado', 'En ruta')
       and tstzrange(tr.starts_at, tr.ends_at, '[)') && tstzrange(
             public.cepev_today()::timestamptz,
             (public.cepev_today() + 1)::timestamptz, '[)')
  ) as busy_today
from public.vehicles v;

-- Indicadores del panel de inicio
create or replace view public.v_dashboard as
select
  (select count(*) from public.beds)                                            as beds_total,
  (select count(*) from public.v_beds_status where availability = 'Ocupada')    as beds_occupied,
  (select count(*) from public.v_beds_status where availability = 'Libre')      as beds_free,
  (select count(*) from public.v_beds_status where availability = 'Bloqueada')  as beds_blocked,
  (select count(*) from public.kitchen_shifts
     where service_date = public.cepev_today())                                 as kitchen_slots_today,
  (select count(*) from public.kitchen_shifts
     where service_date = public.cepev_today() and person_id is not null)       as kitchen_filled_today,
  (select count(*) from public.v_fleet_status
     where status = 'Disponible' and not busy_today)                            as vehicles_available,
  (select count(*) from public.v_fleet_status where service_due)                as vehicles_service_due,
  (select count(*) from public.trips where status in ('Reservado', 'En ruta'))  as trips_active,
  (select count(*) from public.people p
     where p.kind = 'Llegada'
       and not exists (select 1 from public.stays s
                        where s.person_id = p.id and s.status in ('Reservado', 'Alojado'))) as arrivals_pending,
  (select count(*) from public.stays
     where status = 'Alojado' and end_date <= public.cepev_today())             as checkouts_pending,
  (select count(*) from public.people p
     where p.kind = 'Colportor'
       and not exists (select 1 from public.sales_reports sr
                        where sr.person_id = p.id and sr.report_date = public.cepev_today())) as sales_missing_today,
  (select coalesce(sum(books_sold), 0) from public.sales_reports
     where report_date >= public.cepev_today() - 6)::int                        as books_last_7d,
  (select coalesce(sum(daily_goal), 0) * 7 from public.people
     where kind = 'Colportor')::int                                             as books_goal_7d;
