-- ============================================================================
-- CEPEV · 13_fleet_vehicles.sql · Ficha completa del vehiculo y su ABM
--
--   Antes: los vehiculos solo se podian crear a mano en la base. La ficha
--          guardaba nombre, placa, ciudad, estado, odometro, capacidad y los
--          datos de la proxima revision.
--
--   Ahora: la ficha suma tipo de vehiculo, marca, año, color y conductor
--          asignado, y el modulo de Vehiculos puede crear, editar y eliminar
--          desde la aplicacion.
--
--   Cambios:
--     vehicles         -> vehicle_type, brand, model_year, color, driver_id
--     v_fleet_status   -> expone los campos nuevos y el nombre del conductor
--     vehicle_upsert   -> NUEVA: crea o actualiza la ficha con validaciones
--     vehicle_delete   -> NUEVA: borrado protegido (recorridos = historial)
--     trip_create      -> el conductor del recorrido ya no tiene que ser
--                         kind = 'Conductor': vale el mismo grupo de arriba
--
--   El conductor asignado puede ser cepevista, colportor o personal del
--   centro (logistica, conduccion o administracion). Es opcional: un vehiculo
--   puede estar sin conductor fijo y seguir reservandose por recorrido.
--
--   Ejecutar DESPUES de 12_kitchen_dynamic.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Campos nuevos de la ficha
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists vehicle_type text,
  add column if not exists brand        text,
  add column if not exists model_year   smallint,
  add column if not exists color        text,
  add column if not exists driver_id    uuid references public.people (id) on delete set null;

-- Las fichas que ya existian no tenian estos datos: se marcan como pendientes
-- en lugar de inventarlos, para que se vean y se completen desde la app.
update public.vehicles set vehicle_type = 'Bus'           where vehicle_type is null;
update public.vehicles set brand        = 'Sin registrar' where brand        is null;

alter table public.vehicles
  alter column vehicle_type set not null,
  alter column brand        set not null;

alter table public.vehicles drop constraint if exists vehicles_model_year_ok;
alter table public.vehicles add constraint vehicles_model_year_ok
  check (model_year is null or model_year between 1950 and 2100);

create index if not exists vehicles_driver_idx on public.vehicles (driver_id);


-- ---------------------------------------------------------------------------
-- 2) La vista suma los campos nuevos y resuelve el conductor
--    Las columnas nuevas van al final: asi basta con "create or replace" y
--    v_dashboard, que depende de esta vista, no hay que tocarlo.
-- ---------------------------------------------------------------------------
create or replace view public.v_fleet_status as
select
  v.id,
  v.name,
  v.plate,
  v.current_city,
  v.status,
  v.odometer_km,
  v.capacity,
  v.next_service_date,
  v.next_service_km,
  v.created_at,
  v.updated_at,
  (v.next_service_date <= public.cepev_today() + 7 or v.odometer_km >= v.next_service_km) as service_due,
  exists (
    select 1 from public.trips tr
     where tr.vehicle_id = v.id
       and tr.status in ('Reservado', 'En ruta')
       and tstzrange(tr.starts_at, tr.ends_at, '[)') && tstzrange(
             public.cepev_today()::timestamptz,
             (public.cepev_today() + 1)::timestamptz, '[)')
  ) as busy_today,
  v.vehicle_type,
  v.brand,
  v.model_year,
  v.color,
  v.driver_id,
  p.full_name as driver_name,
  p.kind      as driver_kind
from public.vehicles v
left join public.people p on p.id = v.driver_id;


-- ---------------------------------------------------------------------------
-- 3) Crear o actualizar la ficha de un vehiculo
--    p_id null = alta. El nombre visible se arma solo con marca y tipo, para
--    no pedir un dato que ya esta contenido en los otros dos.
-- ---------------------------------------------------------------------------
create or replace function public.vehicle_upsert(
  p_id        uuid,
  p_plate     text,
  p_type      text,
  p_brand     text,
  p_year      integer,
  p_color     text,
  p_capacity  integer,
  p_odometer  integer,
  p_next_km   integer,
  p_next_date date,
  p_status    public.vehicle_status,
  p_driver    uuid
)
returns public.vehicles
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row    public.vehicles%rowtype;
  v_plate  text;
  v_name   text;
  v_driver public.people%rowtype;
begin
  perform public.assert_can_write();

  v_plate := upper(regexp_replace(coalesce(p_plate, ''), '\s+', '', 'g'));
  if length(v_plate) < 4 then
    raise exception 'La placa es obligatoria.' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_type), '') = '' then
    raise exception 'Indica el tipo de vehiculo.' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_brand), '') = '' then
    raise exception 'Indica la marca del vehiculo.' using errcode = 'P0001';
  end if;

  if coalesce(p_capacity, 0) < 1 then
    raise exception 'La capacidad debe ser de al menos un pasajero.' using errcode = 'P0001';
  end if;

  if coalesce(p_odometer, 0) < 0 then
    raise exception 'El kilometraje no puede ser negativo.' using errcode = 'P0001';
  end if;

  if coalesce(p_next_km, 0) <= 0 then
    raise exception 'Indica el kilometraje del proximo mantenimiento.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.vehicles where plate = v_plate and id is distinct from p_id) then
    raise exception 'Ya hay un vehiculo registrado con la placa %.', v_plate using errcode = 'P0001';
  end if;

  if p_driver is not null then
    select * into v_driver from public.people where id = p_driver;
    if not found then
      raise exception 'El conductor seleccionado no existe.' using errcode = 'P0001';
    end if;
    if v_driver.kind::text not in
         ('Cepevista', 'Colportor', 'Logistica', 'Conductor', 'Administrativo') then
      raise exception 'Solo cepevistas, colportores y personal del centro pueden quedar a cargo de un vehiculo.'
        using errcode = 'P0001';
    end if;
  end if;

  v_name := trim(p_brand) || ' ' || trim(p_type);

  if p_id is null then
    insert into public.vehicles
      (name, plate, vehicle_type, brand, model_year, color, capacity,
       odometer_km, next_service_km, next_service_date, status, driver_id)
    values
      (v_name, v_plate, trim(p_type), trim(p_brand), p_year, nullif(trim(p_color), ''),
       p_capacity, coalesce(p_odometer, 0), p_next_km,
       coalesce(p_next_date, public.cepev_today() + 90),
       coalesce(p_status, 'Disponible'), p_driver)
    returning * into v_row;

    perform public.log_action('vehicle_create', 'vehicles', v_row.id,
      'Vehiculo registrado: ' || v_name || ' (' || v_plate || ')');
  else
    update public.vehicles
       set name              = v_name,
           plate             = v_plate,
           vehicle_type      = trim(p_type),
           brand             = trim(p_brand),
           model_year        = p_year,
           color             = nullif(trim(p_color), ''),
           capacity          = p_capacity,
           odometer_km       = coalesce(p_odometer, odometer_km),
           next_service_km   = p_next_km,
           next_service_date = coalesce(p_next_date, next_service_date),
           status            = coalesce(p_status, status),
           driver_id         = p_driver,
           updated_at        = now()
     where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'El vehiculo no existe o ya fue eliminado.' using errcode = 'P0001';
    end if;

    perform public.log_action('vehicle_update', 'vehicles', v_row.id,
      'Ficha actualizada: ' || v_name || ' (' || v_plate || ')');
  end if;

  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 4) Borrado protegido
--    Los recorridos son historial y bloquean el borrado; con p_force (solo
--    admin) se arrastran. Combustible y mantenimientos caen en cascada.
-- ---------------------------------------------------------------------------
create or replace function public.vehicle_delete(p_id uuid, p_force boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row         public.vehicles%rowtype;
  v_trips       int;
  v_open_trips  int;
  v_fuel        int;
  v_maintenance int;
begin
  perform public.assert_can_write();

  select * into v_row from public.vehicles where id = p_id;
  if not found then
    raise exception 'El vehiculo no existe o ya fue eliminado.' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where status in ('Reservado', 'En ruta'))
    into v_trips, v_open_trips
    from public.trips where vehicle_id = p_id;

  select count(*) into v_fuel        from public.fuel_logs        where vehicle_id = p_id;
  select count(*) into v_maintenance from public.maintenance_logs where vehicle_id = p_id;

  if v_open_trips > 0 then
    raise exception 'El vehiculo tiene % recorrido(s) sin cerrar. Cierralos antes de eliminarlo.',
      v_open_trips using errcode = 'P0001';
  end if;

  if v_trips > 0 and not coalesce(p_force, false) then
    raise exception
      'No se puede eliminar % porque tiene historial: % recorridos, % cargas de combustible y % mantenimientos. Marcalo como fuera de servicio para conservar la informacion.',
      v_row.plate, v_trips, v_fuel, v_maintenance
      using errcode = 'P0001';
  end if;

  if coalesce(p_force, false) and not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar un vehiculo con historial.' using errcode = 'P0001';
  end if;

  -- fuel_logs y maintenance_logs son on delete cascade; trips es restrict.
  delete from public.trips    where vehicle_id = p_id;
  delete from public.vehicles where id = p_id;

  perform public.log_action(
    'vehicle_delete', 'vehicles', p_id,
    'Vehiculo eliminado: ' || v_row.name || ' (' || v_row.plate || ')',
    jsonb_build_object(
      'placa',          v_row.plate,
      'forzado',        coalesce(p_force, false),
      'recorridos',     v_trips,
      'combustible',    v_fuel,
      'mantenimientos', v_maintenance
    )
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 5) Quien puede conducir un recorrido
--    Antes solo las personas con kind = 'Conductor'. Ahora vale el mismo
--    grupo que puede quedar a cargo de un vehiculo, para que los recorridos
--    los pueda hacer tambien un cepevista o un colportor. El resto de las
--    validaciones (vehiculo disponible, cruces de reserva y turnos de cocina)
--    queda igual que en 04_functions.sql.
-- ---------------------------------------------------------------------------
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

  if not v_driver.is_available then
    raise exception 'La persona seleccionada figura como no disponible.' using errcode = 'P0001';
  end if;

  if v_driver.kind::text not in
       ('Cepevista', 'Colportor', 'Logistica', 'Conductor', 'Administrativo') then
    raise exception 'Los residentes y las llegadas no pueden conducir un recorrido.' using errcode = 'P0001';
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


-- ---------------------------------------------------------------------------
-- 6) Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'vehicle_upsert(uuid,text,text,text,integer,text,integer,integer,integer,date,public.vehicle_status,uuid)',
    'vehicle_delete(uuid,boolean)',
    'trip_create(uuid,uuid,text,timestamptz,timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 7) Verificacion
--    Las fichas que venian de antes quedan con marca "Sin registrar": son
--    las que conviene completar desde el modulo de Vehiculos.
-- ---------------------------------------------------------------------------
select
  plate         as placa,
  vehicle_type  as tipo,
  brand         as marca,
  model_year    as anio,
  color,
  capacity      as pasajeros,
  odometer_km   as kilometraje,
  next_service_km as proximo_mantenimiento,
  driver_id is not null as tiene_conductor
from public.vehicles
order by plate;
