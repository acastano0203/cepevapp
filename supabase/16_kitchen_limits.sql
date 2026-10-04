-- ============================================================================
-- CEPEV · 16_kitchen_limits.sql · Minimo y maximo de servidores por comida
--
--   Cada comida (Desayuno, Almuerzo, Cena) tiene un cupo propio:
--     minimo -> lo que hace falta para poder publicar el dia
--     maximo -> tope de personas en la grilla de esa comida
--   El cupo se edita desde el formulario de asignacion y aplica a todos los
--   dias.
--
--   Cambios:
--     kitchen_meal_limits  -> NUEVA tabla: un cupo por comida
--     kitchen_set_limits   -> NUEVA: guarda el cupo de una comida
--     kitchen_add          -> rechaza a quien exceda el maximo de la comida
--     kitchen_autofill     -> la propuesta completa cada comida hasta su
--                             minimo, repartiendo entre preparacion y comedor
--                             (antes: 3 por tarea fijos)
--     kitchen_publish      -> exige que cada comida este entre minimo y maximo
--
--   Ejecutar DESPUES de 15_kitchen_gender.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta; los cupos
--   ya guardados se conservan.
--
--   NOTA: si mas adelante vuelves a correr 12_kitchen_dynamic.sql, ese script
--   recrea kitchen_add, kitchen_autofill y kitchen_publish sin el cupo; en ese
--   caso vuelve a ejecutar 15 y este archivo despues.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Cupo por comida
-- ---------------------------------------------------------------------------
create table if not exists public.kitchen_meal_limits (
  meal        public.meal_type primary key,
  min_people  smallint not null default 4,
  max_people  smallint not null default 8,
  updated_at  timestamptz not null default now(),
  constraint kitchen_meal_limits_ok
    check (min_people >= 1 and max_people >= min_people and max_people <= 999)
);

insert into public.kitchen_meal_limits (meal)
values ('Desayuno'), ('Almuerzo'), ('Cena')
on conflict (meal) do nothing;

alter table public.kitchen_meal_limits enable row level security;
revoke all on public.kitchen_meal_limits from anon;

drop policy if exists kitchen_meal_limits_read on public.kitchen_meal_limits;
create policy kitchen_meal_limits_read on public.kitchen_meal_limits
  for select to authenticated using (true);

grant select on public.kitchen_meal_limits to authenticated;


-- ---------------------------------------------------------------------------
-- 2) Guardar el cupo de una comida
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_set_limits(
  p_meal public.meal_type,
  p_min  integer,
  p_max  integer
)
returns public.kitchen_meal_limits
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row public.kitchen_meal_limits%rowtype;
begin
  perform public.assert_can_write();

  if p_min is null or p_min < 1 then
    raise exception 'El minimo debe ser al menos 1 servidor.' using errcode = 'P0001';
  end if;
  if p_max is null or p_max < p_min then
    raise exception 'El maximo no puede ser menor que el minimo.' using errcode = 'P0001';
  end if;
  if p_max > 999 then
    raise exception 'El maximo no puede pasar de 999 servidores.' using errcode = 'P0001';
  end if;

  insert into public.kitchen_meal_limits (meal, min_people, max_people, updated_at)
  values (p_meal, p_min, p_max, now())
  on conflict (meal) do update
    set min_people = excluded.min_people,
        max_people = excluded.max_people,
        updated_at = now()
  returning * into v_row;

  perform public.log_action('kitchen_set_limits', 'kitchen_meal_limits', null,
    'Cupo de ' || p_meal || ': minimo ' || p_min || ', maximo ' || p_max);
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 3) Agregar: igual que en 12, mas el tope de la comida
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_add(
  p_date   date,
  p_meal   public.meal_type,
  p_task   public.kitchen_task,
  p_person uuid
)
returns public.kitchen_shifts
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row    public.kitchen_shifts%rowtype;
  v_reason text;
  v_pos    smallint;
  v_start  time;
  v_end    time;
  v_name   text;
  v_max    smallint;
  v_have   integer;
begin
  perform public.assert_can_write();

  if p_person is null then
    raise exception 'Elige a la persona que va a participar.' using errcode = 'P0001';
  end if;

  select full_name into v_name from public.people where id = p_person;
  if v_name is null then
    raise exception 'La persona no existe.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.kitchen_shifts
     where service_date = p_date and meal = p_meal and person_id = p_person
  ) then
    raise exception '% ya esta en la grilla de %.', v_name, p_meal using errcode = 'P0001';
  end if;

  select max_people into v_max from public.kitchen_meal_limits where meal = p_meal;
  select count(*) into v_have
    from public.kitchen_shifts where service_date = p_date and meal = p_meal;

  if v_max is not null and v_have >= v_max then
    raise exception '% ya tiene su maximo de % servidores.', p_meal, v_max using errcode = 'P0001';
  end if;

  select coalesce(max(position_index), 0) + 1 into v_pos
    from public.kitchen_shifts
   where service_date = p_date and meal = p_meal and task = p_task;

  if v_pos > 999 then
    raise exception 'Se alcanzo el maximo de puestos para esa comida.' using errcode = 'P0001';
  end if;

  select w.starts_at, w.ends_at into v_start, v_end
    from public.kitchen_slot_window(p_meal, p_task) w;

  insert into public.kitchen_shifts (service_date, meal, task, position_index, starts_at, ends_at, person_id)
  values (p_date, p_meal, p_task, v_pos, v_start, v_end, p_person)
  returning * into v_row;

  v_reason := public.kitchen_block_reason(v_row.id, p_person);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  -- Cualquier cambio devuelve el dia a borrador
  delete from public.kitchen_publications where service_date = p_date;

  perform public.log_action(
    'kitchen_add', 'kitchen_shifts', v_row.id,
    'Cocina ' || p_date || ' · ' || p_meal || ': entra ' || v_name
  );
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 4) Propuesta automatica: completa cada comida hasta su minimo
--    Reparte entre preparacion y comedor (va a la tarea con menos gente) y
--    prioriza a quien menos horas de cocina lleva en los ultimos 7 dias.
--    La regla de genero la aplica kitchen_block_reason (ver 15).
-- ---------------------------------------------------------------------------
drop function if exists public.kitchen_autofill(date, integer);

create or replace function public.kitchen_autofill(p_date date)
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
  v_prep      integer;
  v_serve     integer;
  v_target    integer;
  v_added     integer := 0;
  v_start     time;
  v_end       time;
begin
  perform public.assert_can_write();

  foreach v_meal in array array['Desayuno','Almuerzo','Cena']::public.meal_type[] loop

    select coalesce((select min_people from public.kitchen_meal_limits where meal = v_meal), 1)
      into v_target;

    select count(*) filter (where task = 'Preparacion'),
           count(*) filter (where task = 'Comedor')
      into v_prep, v_serve
      from public.kitchen_shifts
     where service_date = p_date and meal = v_meal;
    v_have := v_prep + v_serve;

    for v_candidate in
      select p.id
        from public.people p
        left join public.kitchen_shifts k
          on k.person_id = p.id
         and k.service_date between p_date - 6 and p_date
       where p.is_available
         and p.kind::text in
             ('Logistica', 'Conductor', 'Administrativo', 'Cepevista', 'Colportor')
         and not exists (
           select 1 from public.kitchen_shifts k2
            where k2.service_date = p_date and k2.meal = v_meal and k2.person_id = p.id
         )
       group by p.id
       order by coalesce(sum(extract(epoch from (k.ends_at - k.starts_at))), 0) asc, random()
    loop
      exit when v_have >= v_target;

      v_task := case when v_prep <= v_serve then 'Preparacion' else 'Comedor' end::public.kitchen_task;

      select w.starts_at, w.ends_at into v_start, v_end
        from public.kitchen_slot_window(v_meal, v_task) w;

      select coalesce(max(position_index), 0) + 1 into v_pos
        from public.kitchen_shifts
       where service_date = p_date and meal = v_meal and task = v_task;

      insert into public.kitchen_shifts
        (service_date, meal, task, position_index, starts_at, ends_at, person_id)
      values (p_date, v_meal, v_task, v_pos, v_start, v_end, v_candidate)
      returning id into v_new;

      if public.kitchen_block_reason(v_new, v_candidate) is null then
        v_have  := v_have + 1;
        v_added := v_added + 1;
        if v_task = 'Preparacion' then v_prep := v_prep + 1; else v_serve := v_serve + 1; end if;
      else
        delete from public.kitchen_shifts where id = v_new;
      end if;
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


-- ---------------------------------------------------------------------------
-- 5) Publicar: cada comida dentro de su cupo y sin conflictos
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_publish(p_date date)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_total integer;
  v_short text;
  v_over  text;
  v_bad   integer;
begin
  perform public.assert_can_write();

  select count(*) into v_total
    from public.kitchen_shifts where service_date = p_date;

  if v_total = 0 then
    raise exception 'Todavia no hay nadie asignado en ese dia.' using errcode = 'P0001';
  end if;

  with counts as (
    select m, coalesce(l.min_people, 1) as lo, l.max_people as hi,
           (select count(*) from public.kitchen_shifts k
             where k.service_date = p_date and k.meal = m) as n
      from unnest(array['Desayuno','Almuerzo','Cena']::public.meal_type[]) as t(m)
      left join public.kitchen_meal_limits l on l.meal = t.m
  )
  select string_agg(case when n < lo then m || ' (' || n || ' de ' || lo || ')' end, ', ' order by m),
         string_agg(case when n > hi then m || ' (' || n || ' de ' || hi || ')' end, ', ' order by m)
    into v_short, v_over
    from counts;

  if v_short is not null then
    raise exception 'No llegan al minimo de servidores: %.', v_short using errcode = 'P0001';
  end if;
  if v_over is not null then
    raise exception 'Pasan del maximo de servidores: %.', v_over using errcode = 'P0001';
  end if;

  select count(*) into v_bad
    from public.kitchen_shifts k
   where k.service_date = p_date
     and public.kitchen_block_reason(k.id, k.person_id) is not null;

  if v_bad > 0 then
    raise exception 'Hay % asignaciones con conflicto. Resuelvelas antes de publicar.', v_bad using errcode = 'P0001';
  end if;

  insert into public.kitchen_publications (service_date, published_by)
  values (p_date, auth.uid())
  on conflict (service_date) do update set published_at = now(), published_by = auth.uid();

  perform public.log_action('kitchen_publish', 'kitchen_publications', null,
    'Calendario de cocina publicado para ' || p_date);
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 6) Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'kitchen_set_limits(public.meal_type,integer,integer)',
    'kitchen_add(date,public.meal_type,public.kitchen_task,uuid)',
    'kitchen_autofill(date)',
    'kitchen_publish(date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 7) Verificacion: el cupo vigente de cada comida
-- ---------------------------------------------------------------------------
select meal, min_people as minimo, max_people as maximo
  from public.kitchen_meal_limits
 order by meal;
