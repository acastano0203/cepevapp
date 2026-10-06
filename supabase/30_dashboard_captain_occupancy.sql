-- CEPEV - Dashboard occupancy includes assigned captain beds.
-- Run after 29_room_server_captains.sql. Safe to repeat.
-- Matches the occupied-bed rule in Alojamientos and OperationsBoard.
-- All other dashboard calculations and access permissions are preserved.
begin;

create or replace view public.v_dashboard as
select
  (select count(*) from public.beds)                                            as beds_total,
  (select count(*) from public.v_beds_status where availability in ('Ocupada', 'Capitan'))    as beds_occupied,
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
     where kind = 'Colportor')::int                                             as books_goal_7d,
  (select count(*)
     from unnest(array['Desayuno','Almuerzo','Cena']::public.meal_type[]) as t(m)
    where not exists (
      select 1 from public.kitchen_shifts k
       where k.service_date = public.cepev_today() and k.meal = m
    ))::int                                                                     as kitchen_meals_missing_today;

alter view public.v_dashboard set (security_invoker = on);
revoke all on public.v_dashboard from anon;
grant select on public.v_dashboard to authenticated;
notify pgrst, 'reload schema';
commit;
