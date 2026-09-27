-- CEPEV: Laundry. Run after 13_fleet_vehicles.sql; reset scripts are optional.
-- Re-runnable, transactional migration. All times are America/Bogota.
begin;

create table if not exists public.laundry_assignments (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  turn integer not null check (turn in (1, 2)),
  -- 0 = coordinator; 1..4 = washing machines.
  machine integer not null check (machine between 0 and 4),
  person_id uuid not null references public.people(id) on delete cascade,
  starts_at time generated always as (case turn when 1 then time '11:00' else time '15:00' end) stored,
  ends_at time generated always as (case turn when 1 then time '13:00' else time '17:00' end) stored,
  created_at timestamptz not null default now(),
  unique (service_date, turn, machine),
  unique (service_date, turn, person_id)
);
create index if not exists laundry_person_date_idx on public.laundry_assignments(person_id, service_date);

create table if not exists public.laundry_publications (
  service_date date primary key,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null
);

alter table public.laundry_assignments enable row level security;
alter table public.laundry_publications enable row level security;
drop policy if exists laundry_read on public.laundry_assignments;
create policy laundry_read on public.laundry_assignments for select to authenticated using (true);
drop policy if exists laundry_read on public.laundry_publications;
create policy laundry_read on public.laundry_publications for select to authenticated using (true);
-- Mutations must pass through role-checked RPCs.
revoke all on public.laundry_assignments, public.laundry_publications from public, anon, authenticated;
grant select on public.laundry_assignments, public.laundry_publications to authenticated;

create or replace function public.laundry_assert_date(p_date date)
returns void language plpgsql set search_path = public as $fn$
begin
  if p_date is null or p_date < public.cepev_today() or p_date > public.cepev_today() + 30 then
    raise exception 'Elige una fecha entre hoy y los proximos 30 dias.';
  end if;
end;
$fn$;

-- Serialize scheduling writes across all three modules, including publication.
-- Volatile validation queries below see the preceding committed operation.
create or replace function public.laundry_schedule_lock()
returns trigger language plpgsql set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(150025);
  return null;
end;
$fn$;

drop trigger if exists laundry_schedule_lock on public.laundry_assignments;
create trigger laundry_schedule_lock before insert or update or delete on public.laundry_assignments
for each statement execute function public.laundry_schedule_lock();
drop trigger if exists laundry_schedule_lock on public.kitchen_shifts;
create trigger laundry_schedule_lock before insert or update or delete on public.kitchen_shifts
for each statement execute function public.laundry_schedule_lock();
drop trigger if exists laundry_schedule_lock on public.trips;
create trigger laundry_schedule_lock before insert or update or delete on public.trips
for each statement execute function public.laundry_schedule_lock();

create or replace function public.laundry_block_reason(
  p_date date, p_turn integer, p_machine integer, p_person uuid, p_ignore uuid default null
) returns text language plpgsql set search_path = public as $fn$
declare
  v_person public.people%rowtype;
  v_start time := case p_turn when 1 then time '11:00' else time '15:00' end;
  v_end time := case p_turn when 1 then time '13:00' else time '17:00' end;
begin
  select * into v_person from public.people where id = p_person;
  if not found then return 'La persona no existe.'; end if;
  if not v_person.is_available then return 'La persona figura como no disponible.'; end if;
  if p_machine > 0 and v_person.kind::text not in ('Cepevista','Colportor','Logistica','Conductor','Administrativo') then
    return 'La persona no pertenece al personal elegible para lavanderia.';
  end if;
  if exists (
    select 1 from public.rotations r where r.team_id = v_person.team_id
      and p_date >= r.start_date and p_date < r.end_date and r.city <> 'Piedecuesta'
  ) then return 'Su equipo esta de rotacion en otra ciudad ese dia.'; end if;
  if exists (
    select 1 from public.laundry_assignments l where l.service_date = p_date and l.turn = p_turn
      and l.person_id = p_person and (p_ignore is null or l.id <> p_ignore)
  ) then return 'Ya tiene otra asignacion de lavanderia en ese turno.'; end if;
  if exists (
    select 1 from public.kitchen_shifts k where k.service_date = p_date and k.person_id = p_person
      and k.starts_at < v_end and v_start < k.ends_at
  ) then return 'Tiene un turno de cocina que se cruza en ese horario.'; end if;
  if exists (
    select 1 from public.trips t where t.driver_id = p_person and t.status in ('Reservado','En ruta')
      and t.starts_at < ((p_date + v_end) at time zone 'America/Bogota')
      and ((p_date + v_start) at time zone 'America/Bogota') < t.ends_at
  ) then return 'Tiene un recorrido asignado en ese horario.'; end if;
  return null;
end;
$fn$;

create or replace function public.laundry_validate_assignment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_reason text;
begin
  perform public.laundry_assert_date(new.service_date);
  v_reason := public.laundry_block_reason(new.service_date, new.turn, new.machine, new.person_id, new.id);
  if v_reason is not null then raise exception '%', v_reason; end if;
  return new;
end;
$fn$;
drop trigger if exists laundry_validate on public.laundry_assignments;
create trigger laundry_validate before insert or update on public.laundry_assignments
for each row execute function public.laundry_validate_assignment();

create or replace function public.laundry_unpublish()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op <> 'INSERT' then
    delete from public.laundry_publications where service_date = old.service_date;
  end if;
  if tg_op <> 'DELETE' then
    delete from public.laundry_publications where service_date = new.service_date;
  end if;
  return null;
end;
$fn$;
drop trigger if exists laundry_unpublish on public.laundry_assignments;
create trigger laundry_unpublish after insert or update or delete on public.laundry_assignments
for each row execute function public.laundry_unpublish();

-- Enforce conflicts when Kitchen or Fleet is booked after Laundry.
create or replace function public.laundry_check_other_schedule()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_table_name = 'kitchen_shifts' then
    if exists (
      select 1 from public.laundry_assignments l
      where l.person_id = new.person_id and l.service_date = new.service_date
        and l.starts_at < new.ends_at and new.starts_at < l.ends_at
    ) then raise exception 'Tiene una asignacion de lavanderia en ese horario.'; end if;
  else
    if new.status in ('Reservado','En ruta') and exists (
      select 1 from public.laundry_assignments l where l.person_id = new.driver_id
        and new.starts_at < ((l.service_date + l.ends_at) at time zone 'America/Bogota')
        and ((l.service_date + l.starts_at) at time zone 'America/Bogota') < new.ends_at
    ) then raise exception 'El conductor tiene una asignacion de lavanderia en ese horario.'; end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists laundry_check on public.kitchen_shifts;
create trigger laundry_check before insert or update on public.kitchen_shifts
for each row execute function public.laundry_check_other_schedule();
drop trigger if exists laundry_check on public.trips;
create trigger laundry_check before insert or update on public.trips
for each row execute function public.laundry_check_other_schedule();

create or replace function public.laundry_add(p_date date, p_turn integer, p_machine integer, p_person uuid)
returns public.laundry_assignments language plpgsql security definer set search_path = public as $fn$
declare v_row public.laundry_assignments%rowtype;
begin
  perform public.assert_can_write();
  perform pg_advisory_xact_lock(150025);
  perform public.laundry_assert_date(p_date);
  if p_machine is null or p_machine not between 1 and 4 or p_turn is null or p_turn not in (1,2) then
    raise exception 'Selecciona una de las cuatro lavadoras y uno de los dos turnos.';
  end if;
  if exists (select 1 from public.laundry_assignments where service_date = p_date and turn = p_turn and machine = p_machine) then
    raise exception 'La lavadora ya esta asignada en ese turno.';
  end if;
  insert into public.laundry_assignments(service_date, turn, machine, person_id)
  values (p_date, p_turn, p_machine, p_person) returning * into v_row;
  perform public.log_action('laundry_add', 'laundry_assignments', v_row.id,
    'Lavanderia ' || p_date || ': lavadora ' || p_machine || ', turno ' || p_turn);
  return v_row;
end;
$fn$;

create or replace function public.laundry_remove(p_shift uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_row public.laundry_assignments%rowtype;
begin
  perform public.assert_can_write();
  perform pg_advisory_xact_lock(150025);
  select * into v_row from public.laundry_assignments where id = p_shift;
  if not found then raise exception 'La asignacion ya no existe.'; end if;
  perform public.laundry_assert_date(v_row.service_date);
  if v_row.machine = 0 then raise exception 'Usa la asignacion de coordinador para cambiar ambos turnos.'; end if;
  delete from public.laundry_assignments where id = p_shift;
  perform public.log_action('laundry_remove', 'laundry_assignments', p_shift,
    'Cupo de lavanderia liberado para ' || v_row.service_date);
end;
$fn$;

create or replace function public.laundry_set_coordinator(p_date date, p_person uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform public.assert_can_write();
  perform pg_advisory_xact_lock(150025);
  perform public.laundry_assert_date(p_date);
  -- Atomic replacement: any conflict rolls back the old coordinator's removal.
  delete from public.laundry_assignments where service_date = p_date and machine = 0;
  if p_person is not null then
    insert into public.laundry_assignments(service_date, turn, machine, person_id)
    values (p_date, 1, 0, p_person), (p_date, 2, 0, p_person);
  end if;
  perform public.log_action('laundry_coordinator', 'laundry_assignments', null,
    'Coordinacion de lavanderia actualizada para ' || p_date);
end;
$fn$;

create or replace function public.laundry_autofill(p_date date)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_turn integer; v_machine integer; v_person uuid; v_added integer := 0;
begin
  perform public.assert_can_write();
  perform pg_advisory_xact_lock(150025);
  perform public.laundry_assert_date(p_date);
  for v_turn in 1..2 loop
    for v_machine in 1..4 loop
      if exists (select 1 from public.laundry_assignments where service_date = p_date and turn = v_turn and machine = v_machine) then
        continue;
      end if;
      select p.id into v_person from public.people p
      where p.is_available and p.kind::text in ('Cepevista','Colportor','Logistica','Conductor','Administrativo')
        and public.laundry_block_reason(p_date, v_turn, v_machine, p.id) is null
      order by (select count(*) from public.laundry_assignments l where l.person_id = p.id
        and l.service_date between p_date - 6 and p_date), p.full_name, p.id
      limit 1;
      if v_person is not null then
        insert into public.laundry_assignments(service_date, turn, machine, person_id)
        values (p_date, v_turn, v_machine, v_person);
        v_added := v_added + 1;
      end if;
    end loop;
  end loop;
  perform public.log_action('laundry_autofill', 'laundry_assignments', null,
    'Propuesta de lavanderia ' || p_date || ': ' || v_added || ' cupos');
  return v_added;
end;
$fn$;

create or replace function public.laundry_publish(p_date date)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform public.assert_can_write();
  perform pg_advisory_xact_lock(150025);
  perform public.laundry_assert_date(p_date);
  if (select count(*) from public.laundry_assignments where service_date = p_date and machine > 0) <> 8 then
    raise exception 'Completa las cuatro lavadoras en ambos turnos antes de publicar.';
  end if;
  if (select count(*) from public.laundry_assignments where service_date = p_date and machine = 0) <> 2
    or (select count(distinct person_id) from public.laundry_assignments where service_date = p_date and machine = 0) <> 1 then
    raise exception 'Asigna manualmente un coordinador para ambos turnos.';
  end if;
  if exists (
    select 1 from public.laundry_assignments l where service_date = p_date
      and public.laundry_block_reason(l.service_date, l.turn, l.machine, l.person_id, l.id) is not null
  ) then raise exception 'Resuelve las asignaciones con conflicto antes de publicar.'; end if;
  insert into public.laundry_publications(service_date, published_by)
  values (p_date, auth.uid()) on conflict (service_date)
  do update set published_at = now(), published_by = auth.uid();
  perform public.log_action('laundry_publish', 'laundry_publications', null,
    'Calendario de lavanderia publicado para ' || p_date);
end;
$fn$;

-- Availability/kind/team and rotation changes invalidate affected publications.
create or replace function public.laundry_people_changed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(150025);
  delete from public.laundry_publications lp where lp.service_date >= public.cepev_today()
    and exists (select 1 from public.laundry_assignments l where l.service_date = lp.service_date and l.person_id = new.id);
  return null;
end;
$fn$;
drop trigger if exists laundry_people_changed on public.people;
create trigger laundry_people_changed after update of is_available, kind, team_id on public.people
for each row execute function public.laundry_people_changed();

create or replace function public.laundry_rotations_changed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(150025);
  if tg_op <> 'INSERT' then
    delete from public.laundry_publications lp where lp.service_date >= public.cepev_today()
      and lp.service_date >= old.start_date and lp.service_date < old.end_date
      and exists (select 1 from public.laundry_assignments l join public.people p on p.id = l.person_id
        where l.service_date = lp.service_date and p.team_id = old.team_id);
  end if;
  if tg_op <> 'DELETE' then
    delete from public.laundry_publications lp where lp.service_date >= public.cepev_today()
      and lp.service_date >= new.start_date and lp.service_date < new.end_date
      and exists (select 1 from public.laundry_assignments l join public.people p on p.id = l.person_id
        where l.service_date = lp.service_date and p.team_id = new.team_id);
  end if;
  return null;
end;
$fn$;
drop trigger if exists laundry_rotations_changed on public.rotations;
create trigger laundry_rotations_changed after insert or update or delete on public.rotations
for each row execute function public.laundry_rotations_changed();

create or replace view public.v_laundry_assignments with (security_invoker = on) as
select l.*, p.full_name as person_name, p.kind as person_kind, p.is_available,
  (lp.service_date is not null) as is_published,
  public.laundry_block_reason(l.service_date, l.turn, l.machine, l.person_id, l.id) as block_reason
from public.laundry_assignments l
join public.people p on p.id = l.person_id
left join public.laundry_publications lp on lp.service_date = l.service_date;
revoke all on public.v_laundry_assignments from public, anon, authenticated;
grant select on public.v_laundry_assignments to authenticated;

do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'laundry_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  end loop;
end;
$permissions$;
grant execute on function public.laundry_block_reason(date,integer,integer,uuid,uuid),
  public.laundry_add(date,integer,integer,uuid), public.laundry_remove(uuid),
  public.laundry_set_coordinator(date,uuid), public.laundry_autofill(date),
  public.laundry_publish(date) to authenticated;

-- Keep Kitchen publication and proposals aware of Laundry bookings.
create or replace function public.kitchen_block_reason(p_shift uuid, p_person uuid)
returns text
language plpgsql stable
set search_path = public
as $fn$
declare
  v_shift  public.kitchen_shifts%rowtype;
  v_person public.people%rowtype;
  v_city   text;
begin
  select * into v_shift from public.kitchen_shifts where id = p_shift;
  if not found then return 'El turno no existe.'; end if;

  select * into v_person from public.people where id = p_person;
  if not found then return 'La persona no existe.'; end if;

  if not v_person.is_available then
    return 'La persona figura como no disponible.';
  end if;

  if v_person.kind::text not in
       ('Logistica', 'Conductor', 'Administrativo', 'Cepevista', 'Colportor') then
    return 'Los residentes y las llegadas no cubren turnos de cocina.';
  end if;

  -- Fuera de la sede = su equipo esta de rotacion en otra ciudad ese dia.
  -- Antes se comparaba person_city_on(), que cuando no hay rotacion cae en
  -- people.base_city; pero ese campo es la CIUDAD DE PROCEDENCIA, no donde
  -- esta la persona, asi que dejaba fuera de cocina a todo el que no hubiera
  -- nacido en Piedecuesta (practicamente todos los cepevistas).
  select r.city into v_city
    from public.rotations r
    join public.people pe on pe.team_id = r.team_id
   where pe.id = p_person
     and v_shift.service_date >= r.start_date
     and v_shift.service_date <  r.end_date
   limit 1;

  if v_city is not null and v_city <> 'Piedecuesta' then
    return 'Su equipo esta de rotacion en ' || v_city || ' ese dia.';
  end if;

  if exists (
    select 1 from public.kitchen_shifts k
     where k.person_id = p_person
       and k.service_date = v_shift.service_date
       and k.id <> v_shift.id
       and k.starts_at < v_shift.ends_at
       and v_shift.starts_at < k.ends_at
  ) then
    return 'Ya tiene otro turno de cocina que se cruza en ese horario.';
  end if;

  if exists (
    select 1 from public.trips t
     where t.driver_id = p_person
       and t.status in ('Reservado', 'En ruta')
       and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(
             (v_shift.service_date + v_shift.starts_at)::timestamptz,
             (v_shift.service_date + v_shift.ends_at)::timestamptz, '[)')
  ) then
    return 'Tiene un recorrido asignado en ese horario.';
  end if;

  if exists (
    select 1 from public.laundry_assignments l
    where l.person_id = p_person and l.service_date = v_shift.service_date
      and l.starts_at < v_shift.ends_at and v_shift.starts_at < l.ends_at
  ) then return 'Tiene una asignacion de lavanderia en ese horario.'; end if;

  return null;
end;
$fn$;
create or replace function public.kitchen_autofill(p_date date, p_per_task integer default 3)
returns integer
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_meal      public.meal_type;
  v_task      public.kitchen_task;
  v_candidate uuid;
  v_new       uuid;
  v_pos       smallint;
  v_have      integer;
  v_added     integer := 0;
  v_start     time;
  v_end       time;
begin
  perform public.assert_can_write();

  if p_per_task is null or p_per_task < 1 then
    raise exception 'La propuesta necesita al menos un puesto por tarea.' using errcode = 'P0001';
  end if;

  foreach v_meal in array array['Desayuno','Almuerzo','Cena']::public.meal_type[] loop
    foreach v_task in array array['Preparacion','Comedor']::public.kitchen_task[] loop

      select w.starts_at, w.ends_at into v_start, v_end
        from public.kitchen_slot_window(v_meal, v_task) w;

      select count(*), coalesce(max(position_index), 0)
        into v_have, v_pos
        from public.kitchen_shifts
       where service_date = p_date and meal = v_meal and task = v_task;

      for v_candidate in
        select p.id
          from public.people p
          left join public.kitchen_shifts k
            on k.person_id = p.id
           and k.service_date between p_date - 6 and p_date
         where p.is_available
           and not exists (
             select 1 from public.laundry_assignments l
             where l.person_id = p.id and l.service_date = p_date
               and l.starts_at < v_end and v_start < l.ends_at
           )
           and p.kind::text in
               ('Logistica', 'Conductor', 'Administrativo', 'Cepevista', 'Colportor')
           and not exists (
             select 1 from public.kitchen_shifts k2
              where k2.service_date = p_date and k2.meal = v_meal and k2.person_id = p.id
           )
         group by p.id
         order by coalesce(sum(extract(epoch from (k.ends_at - k.starts_at))), 0) asc, random()
      loop
        exit when v_have >= p_per_task;

        v_pos := v_pos + 1;
        insert into public.kitchen_shifts
          (service_date, meal, task, position_index, starts_at, ends_at, person_id)
        values (p_date, v_meal, v_task, v_pos, v_start, v_end, v_candidate)
        returning id into v_new;

        if public.kitchen_block_reason(v_new, v_candidate) is null then
          v_have  := v_have + 1;
          v_added := v_added + 1;
        else
          delete from public.kitchen_shifts where id = v_new;
          v_pos := v_pos - 1;
        end if;
      end loop;

    end loop;
  end loop;

  if v_added > 0 then
    delete from public.kitchen_publications where service_date = p_date;
  end if;

  perform public.log_action('kitchen_autofill', 'kitchen_shifts', null,
    'Propuesta de cocina generada para ' || p_date || ' (' || v_added || ' puestos)');
  return v_added;
end;
$fn$;
-- Delivered on commit so PostgREST discovers the new view and RPCs together.
notify pgrst, 'reload schema';
commit;
