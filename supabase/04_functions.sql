-- ============================================================================
-- CEPEV · 04_functions.sql · Reglas de negocio (RPC)
-- Toda escritura sensible pasa por aqui: la app nunca decide sola.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Bitacora interna
-- ---------------------------------------------------------------------------
create or replace function public.log_action(
  p_action text, p_entity text, p_entity_id uuid, p_summary text, p_payload jsonb default null
) returns void
language plpgsql security definer
set search_path = public
as $fn$
begin
  insert into public.audit_log (actor_id, actor_name, action, entity, entity_id, summary, payload)
  values (
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), 'Sistema'),
    p_action, p_entity, p_entity_id, p_summary, p_payload
  );
end;
$fn$;

create or replace function public.assert_can_write()
returns void
language plpgsql stable
set search_path = public
as $fn$
begin
  if not public.can_write() then
    raise exception 'El perfil de consulta no puede modificar registros.' using errcode = 'P0001';
  end if;
end;
$fn$;

-- ===========================================================================
-- COCINA
-- ===========================================================================

-- Crea los 18 puestos del dia si aun no existen
create or replace function public.kitchen_ensure_day(p_date date)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_meal public.meal_type;
  v_task public.kitchen_task;
  v_start time;
  v_end   time;
  i smallint;
begin
  perform public.assert_can_write();

  foreach v_meal in array array['Desayuno','Almuerzo','Cena']::public.meal_type[] loop
    foreach v_task in array array['Preparacion','Comedor']::public.kitchen_task[] loop
      select s, e into v_start, v_end from (values
        ('Desayuno','Preparacion','05:00'::time,'07:00'::time),
        ('Desayuno','Comedor',    '06:00',      '08:00'),
        ('Almuerzo','Preparacion','10:00',      '12:30'),
        ('Almuerzo','Comedor',    '11:30',      '14:00'),
        ('Cena',    'Preparacion','16:00',      '18:00'),
        ('Cena',    'Comedor',    '17:30',      '20:00')
      ) as t(m, tk, s, e)
      where t.m = v_meal::text and t.tk = v_task::text;

      for i in 1..3 loop
        insert into public.kitchen_shifts (service_date, meal, task, position_index, starts_at, ends_at)
        values (p_date, v_meal, v_task, i, v_start, v_end)
        on conflict (service_date, meal, task, position_index) do nothing;
      end loop;
    end loop;
  end loop;
end;
$fn$;

-- Motivo por el que una persona NO puede tomar un turno (null = puede)
create or replace function public.kitchen_block_reason(p_shift uuid, p_person uuid)
returns text
language plpgsql stable
set search_path = public
as $fn$
declare
  v_shift  public.kitchen_shifts%rowtype;
  v_person public.people%rowtype;
begin
  select * into v_shift from public.kitchen_shifts where id = p_shift;
  if not found then return 'El turno no existe.'; end if;

  select * into v_person from public.people where id = p_person;
  if not found then return 'La persona no existe.'; end if;

  if not v_person.is_available then
    return 'La persona figura como no disponible.';
  end if;

  if v_person.kind not in ('Logistica', 'Conductor', 'Administrativo') then
    return 'Solo el equipo logistico, administrativo o de conduccion cubre turnos de cocina.';
  end if;

  if public.person_city_on(p_person, v_shift.service_date) <> 'Piedecuesta' then
    return 'La persona esta fuera de la sede ese dia.';
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

-- Asigna o libera un puesto
create or replace function public.kitchen_assign(p_shift uuid, p_person uuid)
returns public.kitchen_shifts
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_reason text;
  v_row public.kitchen_shifts%rowtype;
  v_name text;
begin
  perform public.assert_can_write();

  if p_person is not null then
    v_reason := public.kitchen_block_reason(p_shift, p_person);
    if v_reason is not null then
      raise exception '%', v_reason using errcode = 'P0001';
    end if;
  end if;

  update public.kitchen_shifts
     set person_id = p_person
   where id = p_shift
  returning * into v_row;

  if not found then
    raise exception 'Turno no encontrado.' using errcode = 'P0001';
  end if;

  -- Cualquier cambio devuelve el dia a borrador
  delete from public.kitchen_publications where service_date = v_row.service_date;

  select full_name into v_name from public.people where id = p_person;
  perform public.log_action(
    'kitchen_assign', 'kitchen_shifts', p_shift,
    coalesce('Cocina ' || v_row.service_date || ': ' || v_name, 'Puesto de cocina liberado')
  );
  return v_row;
end;
$fn$;

-- Propuesta automatica: reparte los puestos libres entre el personal elegible
create or replace function public.kitchen_autofill(p_date date)
returns integer
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_shift record;
  v_candidate uuid;
  v_assigned integer := 0;
begin
  perform public.assert_can_write();
  perform public.kitchen_ensure_day(p_date);

  for v_shift in
    select id from public.kitchen_shifts
     where service_date = p_date and person_id is null
     order by meal, task, position_index
  loop
    select p.id into v_candidate
      from public.people p
      left join public.kitchen_shifts k
        on k.person_id = p.id
       and k.service_date between p_date - 6 and p_date
     where p.is_available
       and p.kind in ('Logistica', 'Conductor', 'Administrativo')
       and public.kitchen_block_reason(v_shift.id, p.id) is null
     group by p.id
     order by coalesce(sum(extract(epoch from (k.ends_at - k.starts_at))), 0) asc, random()
     limit 1;

    exit when v_candidate is null;

    update public.kitchen_shifts set person_id = v_candidate where id = v_shift.id;
    v_assigned := v_assigned + 1;
  end loop;

  delete from public.kitchen_publications where service_date = p_date;
  perform public.log_action('kitchen_autofill', 'kitchen_shifts', null,
    'Propuesta de cocina generada para ' || p_date || ' (' || v_assigned || ' puestos)');
  return v_assigned;
end;
$fn$;

create or replace function public.kitchen_publish(p_date date)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_total integer;
  v_open  integer;
  v_bad   integer;
begin
  perform public.assert_can_write();

  select count(*), count(*) filter (where person_id is null)
    into v_total, v_open
    from public.kitchen_shifts where service_date = p_date;

  if v_total = 0 then
    raise exception 'No hay turnos creados para esa fecha.' using errcode = 'P0001';
  end if;

  if v_open > 0 then
    raise exception 'Faltan % puestos por cubrir.', v_open using errcode = 'P0001';
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

-- ===========================================================================
-- ALOJAMIENTO
-- ===========================================================================
create or replace function public.stay_create(
  p_person uuid, p_bed uuid, p_start date, p_end date, p_notes text default null
) returns public.stays
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_person public.people%rowtype;
  v_bed    public.beds%rowtype;
  v_room   public.rooms%rowtype;
  v_row    public.stays%rowtype;
begin
  perform public.assert_can_write();

  select * into v_person from public.people where id = p_person;
  if not found then raise exception 'Selecciona una persona valida.' using errcode = 'P0001'; end if;

  select * into v_bed from public.beds where id = p_bed;
  if not found then raise exception 'Selecciona una cama valida.' using errcode = 'P0001'; end if;

  select * into v_room from public.rooms where id = v_bed.room_id;

  if p_end <= p_start then
    raise exception 'La salida debe ser posterior a la llegada.' using errcode = 'P0001';
  end if;

  if v_bed.is_blocked then
    raise exception 'La cama esta bloqueada: %', coalesce(v_bed.blocked_reason, 'sin detalle') using errcode = 'P0001';
  end if;

  if v_room.sex <> v_person.sex then
    raise exception 'La habitacion % es de %, no corresponde al registro de la persona.',
      v_room.code, v_room.sex using errcode = 'P0001';
  end if;

  begin
    insert into public.stays (person_id, bed_id, start_date, end_date, notes, created_by)
    values (p_person, p_bed, p_start, p_end, p_notes, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'La cama o la persona ya tienen una estadia en ese periodo. Confirma primero la salida pendiente.'
      using errcode = 'P0001';
  end;

  perform public.log_action('stay_create', 'stays', v_row.id,
    'Cama ' || v_room.code || '-' || v_bed.label || ' reservada para ' || v_person.full_name);
  return v_row;
end;
$fn$;

create or replace function public.stay_check_in(p_stay uuid)
returns public.stays
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.stays%rowtype;
begin
  perform public.assert_can_write();

  select * into v_row from public.stays where id = p_stay;
  if not found then raise exception 'Estadia no encontrada.' using errcode = 'P0001'; end if;
  if v_row.status <> 'Reservado' then
    raise exception 'Solo se confirma el ingreso de una reserva vigente.' using errcode = 'P0001';
  end if;
  if v_row.start_date > public.cepev_today() then
    raise exception 'La llegada esta programada para el %.', v_row.start_date using errcode = 'P0001';
  end if;
  if v_row.end_date <= public.cepev_today() then
    raise exception 'La reserva ya vencio. Actualiza las fechas antes de confirmar.' using errcode = 'P0001';
  end if;

  update public.stays
     set status = 'Alojado', checked_in_at = now()
   where id = p_stay
  returning * into v_row;

  perform public.log_action('stay_check_in', 'stays', p_stay,
    'Ingreso confirmado: ' || (select full_name from public.people where id = v_row.person_id));
  return v_row;
end;
$fn$;

create or replace function public.stay_check_out(p_stay uuid)
returns public.stays
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.stays%rowtype;
begin
  perform public.assert_can_write();

  select * into v_row from public.stays where id = p_stay;
  if not found then raise exception 'Estadia no encontrada.' using errcode = 'P0001'; end if;
  if v_row.status <> 'Alojado' then
    raise exception 'Solo se confirma la salida de una persona alojada.' using errcode = 'P0001';
  end if;

  update public.stays
     set status = 'Finalizado',
         checked_out_at = now(),
         end_date = greatest(public.cepev_today(), start_date + 1)
   where id = p_stay
  returning * into v_row;

  perform public.log_action('stay_check_out', 'stays', p_stay,
    'Salida confirmada, cama liberada: ' || (select full_name from public.people where id = v_row.person_id));
  return v_row;
end;
$fn$;

-- ===========================================================================
-- FLOTA
-- ===========================================================================
create or replace function public.trip_create(
  p_vehicle uuid, p_driver uuid, p_city text, p_start timestamptz, p_end timestamptz
) returns public.trips
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_vehicle public.vehicles%rowtype;
  v_driver  public.people%rowtype;
  v_row     public.trips%rowtype;
begin
  perform public.assert_can_write();

  select * into v_vehicle from public.vehicles where id = p_vehicle;
  if not found then raise exception 'Selecciona un vehiculo valido.' using errcode = 'P0001'; end if;

  select * into v_driver from public.people where id = p_driver;
  if not found then raise exception 'Selecciona un conductor valido.' using errcode = 'P0001'; end if;

  if coalesce(trim(p_city), '') = '' then
    raise exception 'Indica la ciudad de destino.' using errcode = 'P0001';
  end if;
  if p_end <= p_start then
    raise exception 'El regreso debe ser posterior a la salida.' using errcode = 'P0001';
  end if;
  if v_vehicle.status <> 'Disponible' then
    raise exception 'El vehiculo esta en estado: %.', v_vehicle.status using errcode = 'P0001';
  end if;
  if v_driver.kind <> 'Conductor' or not v_driver.is_available then
    raise exception 'La persona seleccionada no esta habilitada como conductor disponible.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.kitchen_shifts k
     where k.person_id = p_driver
       and tstzrange((k.service_date + k.starts_at)::timestamptz,
                     (k.service_date + k.ends_at)::timestamptz, '[)')
           && tstzrange(p_start, p_end, '[)')
  ) then
    raise exception 'El conductor tiene un turno de cocina en ese horario.' using errcode = 'P0001';
  end if;

  begin
    insert into public.trips (vehicle_id, driver_id, destination_city, starts_at, ends_at, created_by)
    values (p_vehicle, p_driver, trim(p_city), p_start, p_end, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'El vehiculo o el conductor ya tienen una reserva que se cruza.' using errcode = 'P0001';
  end;

  perform public.log_action('trip_create', 'trips', v_row.id,
    'Recorrido reservado: ' || v_vehicle.name || ' -> ' || trim(p_city));
  return v_row;
end;
$fn$;

create or replace function public.trip_close(p_trip uuid, p_km integer, p_city text)
returns public.trips
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row     public.trips%rowtype;
  v_vehicle public.vehicles%rowtype;
begin
  perform public.assert_can_write();

  select * into v_row from public.trips where id = p_trip;
  if not found or v_row.status in ('Finalizado', 'Cancelado') then
    raise exception 'El recorrido no esta disponible para cierre.' using errcode = 'P0001';
  end if;

  select * into v_vehicle from public.vehicles where id = v_row.vehicle_id;
  if p_km is null or p_km < v_vehicle.odometer_km then
    raise exception 'El odometro no puede ser menor a % km.', v_vehicle.odometer_km using errcode = 'P0001';
  end if;

  update public.vehicles
     set odometer_km = p_km, current_city = coalesce(nullif(trim(p_city), ''), 'Piedecuesta')
   where id = v_vehicle.id;

  update public.trips
     set status = 'Finalizado', return_km = p_km, return_city = coalesce(nullif(trim(p_city), ''), 'Piedecuesta')
   where id = p_trip
  returning * into v_row;

  perform public.log_action('trip_close', 'trips', p_trip,
    'Devolucion registrada: ' || v_vehicle.name || ' (' || p_km || ' km)');
  return v_row;
end;
$fn$;

create or replace function public.fuel_register(
  p_vehicle uuid, p_liters numeric, p_amount integer, p_km integer, p_date date default null
) returns public.fuel_logs
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_vehicle public.vehicles%rowtype;
  v_row     public.fuel_logs%rowtype;
begin
  perform public.assert_can_write();

  select * into v_vehicle from public.vehicles where id = p_vehicle;
  if not found then raise exception 'Vehiculo no encontrado.' using errcode = 'P0001'; end if;
  if p_liters is null or p_liters <= 0 then
    raise exception 'Registra los litros cargados.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Registra el valor pagado.' using errcode = 'P0001';
  end if;
  if p_km is null or p_km < v_vehicle.odometer_km then
    raise exception 'El odometro no puede ser menor a % km.', v_vehicle.odometer_km using errcode = 'P0001';
  end if;

  insert into public.fuel_logs (vehicle_id, log_date, liters, amount_cop, odometer_km, created_by)
  values (p_vehicle, coalesce(p_date, public.cepev_today()), p_liters, p_amount, p_km, auth.uid())
  returning * into v_row;

  update public.vehicles set odometer_km = p_km where id = p_vehicle;

  perform public.log_action('fuel_register', 'fuel_logs', v_row.id,
    'Combustible: ' || v_vehicle.name || ' (' || p_liters || ' L)');
  return v_row;
end;
$fn$;

create or replace function public.maintenance_register(
  p_vehicle uuid, p_detail text, p_cost integer,
  p_status public.vehicle_status, p_next_date date, p_next_km integer
) returns public.maintenance_logs
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_vehicle public.vehicles%rowtype;
  v_row     public.maintenance_logs%rowtype;
begin
  perform public.assert_can_write();

  select * into v_vehicle from public.vehicles where id = p_vehicle;
  if not found then raise exception 'Vehiculo no encontrado.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_detail), '') = '' then
    raise exception 'Describe el trabajo realizado.' using errcode = 'P0001';
  end if;
  if p_next_date <= public.cepev_today() then
    raise exception 'La proxima revision debe ser una fecha futura.' using errcode = 'P0001';
  end if;
  if p_next_km <= v_vehicle.odometer_km then
    raise exception 'El proximo kilometraje debe superar los % km actuales.', v_vehicle.odometer_km using errcode = 'P0001';
  end if;

  insert into public.maintenance_logs (vehicle_id, detail, cost_cop, created_by)
  values (p_vehicle, trim(p_detail), coalesce(p_cost, 0), auth.uid())
  returning * into v_row;

  update public.vehicles
     set status = p_status, next_service_date = p_next_date, next_service_km = p_next_km
   where id = p_vehicle;

  perform public.log_action('maintenance_register', 'maintenance_logs', v_row.id,
    'Hoja de vida actualizada: ' || v_vehicle.name);
  return v_row;
end;
$fn$;

-- ===========================================================================
-- COLPORTAJE
-- ===========================================================================
create or replace function public.sale_register(p_person uuid, p_date date, p_books integer)
returns public.sales_reports
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_person public.people%rowtype;
  v_row    public.sales_reports%rowtype;
begin
  perform public.assert_can_write();

  select * into v_person from public.people where id = p_person;
  if not found or v_person.kind <> 'Colportor' then
    raise exception 'Selecciona un colportor.' using errcode = 'P0001';
  end if;
  if p_date > public.cepev_today() then
    raise exception 'No se registran reportes de fechas futuras.' using errcode = 'P0001';
  end if;
  if p_books is null or p_books < 0 then
    raise exception 'Los libros vendidos deben ser cero o mas.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.sales_reports where person_id = p_person and report_date = p_date) then
    raise exception 'Ya existe un reporte de ese dia. Usa la opcion de corregir.' using errcode = 'P0001';
  end if;

  insert into public.sales_reports (person_id, report_date, books_sold, city, team_id, created_by)
  values (p_person, p_date, p_books, public.person_city_on(p_person, p_date), v_person.team_id, auth.uid())
  returning * into v_row;

  perform public.log_action('sale_register', 'sales_reports', v_row.id,
    'Reporte diario: ' || v_person.full_name || ' (' || p_books || ' libros)');
  return v_row;
end;
$fn$;

create or replace function public.sale_correct(p_sale uuid, p_books integer, p_reason text)
returns public.sales_reports
language plpgsql security definer
set search_path = public
as $fn$
declare v_row public.sales_reports%rowtype;
begin
  perform public.assert_can_write();

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la correccion.' using errcode = 'P0001';
  end if;
  if p_books is null or p_books < 0 then
    raise exception 'Los libros vendidos deben ser cero o mas.' using errcode = 'P0001';
  end if;

  update public.sales_reports set books_sold = p_books where id = p_sale returning * into v_row;
  if not found then raise exception 'Reporte no encontrado.' using errcode = 'P0001'; end if;

  perform public.log_action('sale_correct', 'sales_reports', p_sale,
    'Reporte corregido a ' || p_books || ' libros: ' || trim(p_reason),
    jsonb_build_object('reason', trim(p_reason)));
  return v_row;
end;
$fn$;

create or replace function public.rotation_create(p_team uuid, p_city text, p_start date, p_end date)
returns public.rotations
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.rotations%rowtype;
  v_name text;
begin
  perform public.assert_can_write();

  select name into v_name from public.teams where id = p_team;
  if v_name is null then raise exception 'Selecciona un equipo valido.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_city), '') = '' then
    raise exception 'Indica la ciudad de destino.' using errcode = 'P0001';
  end if;
  if p_end <= p_start then
    raise exception 'La salida debe ser posterior al inicio.' using errcode = 'P0001';
  end if;

  begin
    insert into public.rotations (team_id, city, start_date, end_date)
    values (p_team, trim(p_city), p_start, p_end)
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'El equipo ya tiene una ciudad asignada en ese periodo.' using errcode = 'P0001';
  end;

  perform public.log_action('rotation_create', 'rotations', v_row.id,
    'Rotacion programada: ' || v_name || ' -> ' || trim(p_city));
  return v_row;
end;
$fn$;

-- ===========================================================================
-- PERSONAS
--
--   OJO: 09_colporteurs.sql reemplaza esta funcion por una version con un
--   parametro adicional (p_notes). Si vuelves a ejecutar SOLO este archivo
--   despues del 09, ejecuta tambien el 09 a continuacion: de lo contrario
--   quedarian las dos firmas y la llamada por nombre seria ambigua.
-- ===========================================================================
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
  p_available boolean default true
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

  if p_id is null then
    insert into public.people (full_name, sex, birth_date, phone, base_city, kind, team_id, daily_goal, is_available)
    values (trim(p_full_name), p_sex, p_birth_date, nullif(trim(p_phone), ''),
            coalesce(nullif(trim(p_base_city), ''), 'Piedecuesta'), p_kind, p_team,
            coalesce(p_goal, 0), coalesce(p_available, true))
    returning * into v_row;
    perform public.log_action('person_create', 'people', v_row.id, 'Persona registrada: ' || v_row.full_name);
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
           is_available = coalesce(p_available, is_available)
     where id = p_id
    returning * into v_row;

    if not found then raise exception 'Persona no encontrada.' using errcode = 'P0001'; end if;
    perform public.log_action('person_update', 'people', v_row.id, 'Ficha actualizada: ' || v_row.full_name);
  end if;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'kitchen_ensure_day(date)', 'kitchen_assign(uuid,uuid)', 'kitchen_autofill(date)',
    'kitchen_publish(date)', 'kitchen_block_reason(uuid,uuid)',
    'stay_create(uuid,uuid,date,date,text)', 'stay_check_in(uuid)', 'stay_check_out(uuid)',
    'trip_create(uuid,uuid,text,timestamptz,timestamptz)', 'trip_close(uuid,integer,text)',
    'fuel_register(uuid,numeric,integer,integer,date)',
    'maintenance_register(uuid,text,integer,public.vehicle_status,date,integer)',
    'sale_register(uuid,date,integer)', 'sale_correct(uuid,integer,text)',
    'rotation_create(uuid,text,date,date)',
    'person_upsert(uuid,text,public.sex_group,date,text,text,public.person_kind,uuid,integer,boolean)',
    'cepev_today()', 'person_city_on(uuid,date)', 'current_role_name()', 'can_write()', 'is_admin()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
