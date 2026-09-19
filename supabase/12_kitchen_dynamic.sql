-- ============================================================================
-- CEPEV · 12_kitchen_dynamic.sql · Cocina con N puestos por comida
--
--   Antes: cada dia nacia con una parrilla fija de 18 puestos vacios
--          (3 comidas x 2 tareas x 3 posiciones) que habia que ir cubriendo.
--
--   Ahora: un puesto existe solo cuando alguien lo ocupa. Se agregan de a uno
--          con "Asignar" y se retiran con "Quitar", sin tope de 3 por tarea.
--          Cepevistas y colportores pasan a ser personal elegible para cocina;
--          a los colportores los sigue cuidando la regla de rotacion, que los
--          bloquea los dias en que su equipo esta en otra ciudad.
--
--   Cambios:
--     kitchen_shifts        -> position_index admite hasta 999 por tarea,
--                              person_id pasa a not null y on delete cascade
--     kitchen_block_reason  -> acepta tambien kind 'Cepevista' y 'Colportor', y
--                              solo bloquea por ciudad si hay rotacion de equipo
--     kitchen_assign        -> se elimina: asignar es agregar, no llenar un hueco
--     kitchen_add           -> NUEVA: agrega una participacion a una comida
--     kitchen_remove        -> NUEVA: retira una participacion
--     kitchen_slot_window   -> NUEVA: horario estandar de cada comida/tarea
--     kitchen_autofill      -> rellena hasta N por tarea en lugar de cubrir huecos
--     kitchen_publish       -> exige equipo en cada comida, ya no "cero libres"
--     kitchen_ensure_day    -> se elimina: no hay puestos vacios que crear
--     v_dashboard           -> nueva columna kitchen_meals_missing_today
--
--   Ejecutar DESPUES de 11_cepevistas.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
--
--   NOTA: si mas adelante vuelves a correr 04_functions.sql, ese script
--   recrea kitchen_ensure_day y la version vieja de autofill/publish; en ese
--   caso vuelve a ejecutar este archivo despues.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Sin tope de 3 puestos por tarea
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.kitchen_shifts'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%position_index%'
  loop
    execute format('alter table public.kitchen_shifts drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.kitchen_shifts
  add constraint kitchen_shifts_position_ok
  check (position_index between 1 and 999);


-- ---------------------------------------------------------------------------
-- 2) Los puestos vacios dejan de existir
--    En el modelo nuevo una fila ES una participacion; las filas sin persona
--    solo serian ruido en la grilla.
-- ---------------------------------------------------------------------------
delete from public.kitchen_shifts where person_id is null;

-- Al borrar a una persona sus participaciones se van con ella. Antes quedaban
-- como puestos libres (on delete set null), algo que este modelo ya no admite;
-- person_delete sigue funcionando igual, solo cambia el rastro que deja.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.kitchen_shifts'::regclass
     and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.kitchen_shifts'::regclass
                            and attname = 'person_id')];
  if c is not null then
    execute format('alter table public.kitchen_shifts drop constraint %I', c);
  end if;
end $$;

alter table public.kitchen_shifts
  alter column person_id set not null,
  add constraint kitchen_shifts_person_fk
    foreign key (person_id) references public.people (id) on delete cascade;

-- Ya no hay puestos vacios que crear ni que "liberar": se agregan y se quitan.
drop function if exists public.kitchen_ensure_day(date);
drop function if exists public.kitchen_assign(uuid, uuid);


-- ---------------------------------------------------------------------------
-- 3) Horario estandar de cada comida y tarea
--    Una sola definicion, usada por kitchen_add y kitchen_autofill.
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_slot_window(
  p_meal public.meal_type,
  p_task public.kitchen_task,
  out starts_at time,
  out ends_at   time
)
language sql immutable
set search_path = public
as $fn$
  select t.s, t.e
    from (values
      ('Desayuno','Preparacion','05:00'::time,'07:00'::time),
      ('Desayuno','Comedor',    '06:00',      '08:00'),
      ('Almuerzo','Preparacion','10:00',      '12:30'),
      ('Almuerzo','Comedor',    '11:30',      '14:00'),
      ('Cena',    'Preparacion','16:00',      '18:00'),
      ('Cena',    'Comedor',    '17:30',      '20:00')
    ) as t(m, tk, s, e)
   where t.m = p_meal::text and t.tk = p_task::text;
$fn$;


-- ---------------------------------------------------------------------------
-- 4) Quien puede cubrir cocina: se suman los cepevistas
-- ---------------------------------------------------------------------------
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

  return null;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 5) Agregar una participacion a una comida
--    La fila se inserta y enseguida se valida: si la regla la rechaza, la
--    excepcion deshace el insert y nada queda a medias.
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
-- 6) Quitar una participacion de la grilla
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_remove(p_shift uuid)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.kitchen_shifts%rowtype;
  v_name text;
begin
  perform public.assert_can_write();

  delete from public.kitchen_shifts where id = p_shift returning * into v_row;
  if not found then
    raise exception 'El puesto ya no existe.' using errcode = 'P0001';
  end if;

  delete from public.kitchen_publications where service_date = v_row.service_date;

  select full_name into v_name from public.people where id = v_row.person_id;
  perform public.log_action(
    'kitchen_remove', 'kitchen_shifts', p_shift,
    'Cocina ' || v_row.service_date || ' · ' || v_row.meal || ': sale ' || coalesce(v_name, 'un participante')
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 7) Propuesta automatica: completa hasta N participantes por tarea
--    Prioriza a quien menos horas de cocina lleva en los ultimos 7 dias.
-- ---------------------------------------------------------------------------
drop function if exists public.kitchen_autofill(date);

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


-- ---------------------------------------------------------------------------
-- 8) Publicar: ya no se exige "cero puestos libres" (no existen), sino que
--    ninguna comida se quede sin equipo y que no haya cruces.
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_publish(p_date date)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_total   integer;
  v_missing text;
  v_bad     integer;
begin
  perform public.assert_can_write();

  select count(*) into v_total
    from public.kitchen_shifts where service_date = p_date;

  if v_total = 0 then
    raise exception 'Todavia no hay nadie asignado en ese dia.' using errcode = 'P0001';
  end if;

  select string_agg(m::text, ', ' order by m) into v_missing
    from unnest(array['Desayuno','Almuerzo','Cena']::public.meal_type[]) as t(m)
   where not exists (
     select 1 from public.kitchen_shifts k
      where k.service_date = p_date and k.meal = m
   );

  if v_missing is not null then
    raise exception 'Falta equipo en: %.', v_missing using errcode = 'P0001';
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
-- 9) Panel de inicio: comidas de hoy que se quedaron sin equipo
--    kitchen_slots_today y kitchen_filled_today se conservan (ahora son
--    iguales entre si) para no romper nada que ya las lea.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 10) Permisos de ejecucion de las funciones nuevas
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'kitchen_add(date,public.meal_type,public.kitchen_task,uuid)',
    'kitchen_remove(uuid)',
    'kitchen_autofill(date,integer)',
    'kitchen_publish(date)',
    'kitchen_block_reason(uuid,uuid)',
    'kitchen_slot_window(public.meal_type,public.kitchen_task)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 11) Verificacion
--    Esperado: ninguna fila sin persona y el conteo por comida del dia de hoy.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.kitchen_shifts where person_id is null) as puestos_vacios,
  (select count(*) from public.kitchen_shifts
    where service_date = public.cepev_today())                         as participantes_hoy,
  (select kitchen_meals_missing_today from public.v_dashboard)         as comidas_sin_equipo;
