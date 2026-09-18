-- ============================================================================
-- CEPEV · 09_colporteurs.sql · Modulo de registro de colportores
--
--   Los colportores viven en public.people con kind = 'Colportor'.
--   Este script agrega lo que faltaba para la gestion completa:
--
--     v_colporteurs            -> vista de la grilla, con equipo y dependencias
--     person_delete            -> borrado protegido (no destruye historial)
--     person_set_availability  -> baja logica (activar / desactivar)
--
--   Crear y editar ya estaban resueltos por public.person_upsert (04_functions).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Vista de la grilla
--   Incluye contadores de dependencias para que la interfaz sepa, sin hacer
--   consultas extra, si una persona se puede borrar o si conviene desactivarla.
-- ---------------------------------------------------------------------------
create or replace view public.v_colporteurs as
select
  p.id,
  p.full_name,
  p.sex,
  p.birth_date,
  date_part('year', age(p.birth_date))::int as age,
  p.phone,
  p.base_city,
  p.team_id,
  t.name  as team_name,
  p.daily_goal,
  p.is_available,
  p.notes,
  p.created_at,
  public.person_city_on(p.id, public.cepev_today()) as current_city,

  (select count(*)   from public.sales_reports sr where sr.person_id = p.id)::int as reports_count,
  (select coalesce(sum(sr.books_sold), 0)
     from public.sales_reports sr where sr.person_id = p.id)::int                 as books_total,
  (select max(sr.report_date)
     from public.sales_reports sr where sr.person_id = p.id)                      as last_report_date,
  (select count(*)   from public.stays s  where s.person_id = p.id)::int          as stays_count,
  (select count(*)   from public.trips tr where tr.driver_id = p.id)::int         as trips_count,

  -- Se puede borrar sin perder informacion solo si no tiene historial
  not exists (select 1 from public.sales_reports sr where sr.person_id = p.id)
  and not exists (select 1 from public.stays s     where s.person_id = p.id)
  and not exists (select 1 from public.trips tr    where tr.driver_id = p.id) as can_delete
from public.people p
left join public.teams t on t.id = p.team_id
where p.kind = 'Colportor';

alter view public.v_colporteurs set (security_invoker = on);
revoke all on public.v_colporteurs from anon;
grant select on public.v_colporteurs to authenticated;


-- ---------------------------------------------------------------------------
-- Crear / editar: se amplia person_upsert con el campo de observaciones.
--   Se elimina primero la firma anterior: dejar las dos versiones haria
--   ambigua la llamada por parametros con nombre desde PostgREST.
-- ---------------------------------------------------------------------------
drop function if exists public.person_upsert(
  uuid, text, public.sex_group, date, text, text, public.person_kind, uuid, integer, boolean
);

create or replace function public.person_upsert(
  p_id uuid,
  p_full_name text,
  p_sex public.sex_group,
  p_birth_date date,
  p_phone text,
  p_base_city text,
  p_kind public.person_kind,
  p_team uuid default null,
  p_goal integer default 0,
  p_available boolean default true,
  p_notes text default null
) returns public.people
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.people%rowtype;
begin
  perform public.assert_can_write();

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Indica el nombre completo.' using errcode = 'P0001';
  end if;
  if p_birth_date is null or p_birth_date >= public.cepev_today() then
    raise exception 'Revisa la fecha de nacimiento.' using errcode = 'P0001';
  end if;
  if date_part('year', age(p_birth_date)) < 14 then
    raise exception 'La persona debe tener al menos 14 anos.' using errcode = 'P0001';
  end if;
  if coalesce(p_goal, 0) < 0 then
    raise exception 'La meta diaria no puede ser negativa.' using errcode = 'P0001';
  end if;

  -- Nombre duplicado dentro de la misma funcion: avisa, no bloquea por error tipografico
  if exists (
    select 1 from public.people
     where lower(full_name) = lower(trim(p_full_name))
       and kind = p_kind
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'Ya existe otra persona registrada como % con el nombre %.',
      p_kind, trim(p_full_name) using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.people (full_name, sex, birth_date, phone, base_city, kind,
                               team_id, daily_goal, is_available, notes)
    values (trim(p_full_name), p_sex, p_birth_date, nullif(trim(p_phone), ''),
            coalesce(nullif(trim(p_base_city), ''), 'Piedecuesta'), p_kind, p_team,
            coalesce(p_goal, 0), coalesce(p_available, true), nullif(trim(p_notes), ''))
    returning * into v_row;
    perform public.log_action('person_create', 'people', v_row.id,
      'Persona registrada: ' || v_row.full_name || ' (' || v_row.kind || ')');
  else
    update public.people
       set full_name    = trim(p_full_name),
           sex          = p_sex,
           birth_date   = p_birth_date,
           phone        = nullif(trim(p_phone), ''),
           base_city    = coalesce(nullif(trim(p_base_city), ''), base_city),
           kind         = p_kind,
           team_id      = p_team,
           daily_goal   = coalesce(p_goal, daily_goal),
           is_available = coalesce(p_available, is_available),
           notes        = nullif(trim(p_notes), '')
     where id = p_id
    returning * into v_row;

    if not found then raise exception 'Persona no encontrada.' using errcode = 'P0001'; end if;
    perform public.log_action('person_update', 'people', v_row.id,
      'Ficha actualizada: ' || v_row.full_name);
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.person_upsert(
  uuid, text, public.sex_group, date, text, text, public.person_kind, uuid, integer, boolean, text
) from public, anon;
grant execute on function public.person_upsert(
  uuid, text, public.sex_group, date, text, text, public.person_kind, uuid, integer, boolean, text
) to authenticated;


-- ---------------------------------------------------------------------------
-- Borrado protegido
--   Sin p_force, se niega a borrar a quien tenga historial y explica por que.
--   Con p_force (solo admin), arrastra reportes, estadias y recorridos.
-- ---------------------------------------------------------------------------
create or replace function public.person_delete(p_id uuid, p_force boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_person  public.people%rowtype;
  v_reports int;
  v_stays   int;
  v_trips   int;
  v_shifts  int;
begin
  perform public.assert_can_write();

  select * into v_person from public.people where id = p_id;
  if not found then
    raise exception 'La persona no existe o ya fue eliminada.' using errcode = 'P0001';
  end if;

  select count(*) into v_reports from public.sales_reports where person_id = p_id;
  select count(*) into v_stays   from public.stays         where person_id = p_id;
  select count(*) into v_trips   from public.trips         where driver_id = p_id;
  select count(*) into v_shifts  from public.kitchen_shifts where person_id = p_id;

  if (v_reports + v_stays + v_trips) > 0 and not coalesce(p_force, false) then
    raise exception
      'No se puede eliminar a % porque tiene historial: % reportes, % estadias y % recorridos. Desactivalo para conservar la informacion.',
      v_person.full_name, v_reports, v_stays, v_trips
      using errcode = 'P0001';
  end if;

  if coalesce(p_force, false) and not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar a una persona con historial.' using errcode = 'P0001';
  end if;

  -- kitchen_shifts.person_id es on delete set null: los turnos quedan libres.
  -- sales_reports es on delete cascade. stays y trips son restrict: van antes.
  delete from public.stays where person_id = p_id;
  delete from public.trips where driver_id = p_id;
  delete from public.people where id = p_id;

  perform public.log_action(
    'person_delete', 'people', p_id,
    'Persona eliminada: ' || v_person.full_name ||
      case when v_shifts > 0 then ' (' || v_shifts || ' turnos de cocina liberados)' else '' end,
    jsonb_build_object(
      'full_name', v_person.full_name,
      'kind',      v_person.kind,
      'forzado',   coalesce(p_force, false),
      'reportes',  v_reports,
      'estadias',  v_stays,
      'recorridos', v_trips
    )
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- Baja logica: conserva todo el historial y lo saca de las listas operativas
-- ---------------------------------------------------------------------------
create or replace function public.person_set_availability(p_id uuid, p_available boolean)
returns public.people
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.people%rowtype;
begin
  perform public.assert_can_write();

  update public.people
     set is_available = coalesce(p_available, true)
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Persona no encontrada.' using errcode = 'P0001';
  end if;

  perform public.log_action(
    'person_availability', 'people', p_id,
    case when v_row.is_available then 'Persona reactivada: ' else 'Persona desactivada: ' end
      || v_row.full_name
  );
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- Permisos de ejecucion
-- ---------------------------------------------------------------------------
revoke all on function public.person_delete(uuid, boolean)            from public, anon;
revoke all on function public.person_set_availability(uuid, boolean)  from public, anon;
grant execute on function public.person_delete(uuid, boolean)           to authenticated;
grant execute on function public.person_set_availability(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------------------------
select count(*) as colportores_registrados from public.v_colporteurs;
