-- ============================================================================
-- CEPEV · 23_vehicle_ownership.sql · Propiedad del vehiculo y conductores
--                                    con licencia
--
--   Antes: todos los vehiculos se trataban como flota del CEPEV y cualquier
--          cepevista, colportor o persona del centro podia quedar a cargo o
--          conducir un recorrido, tuviera o no licencia.
--
--   Ahora:
--     - Cada vehiculo indica de quien es:
--         ownership = 'CEPEV'   -> vehiculo propio del centro
--         ownership = 'Externo' -> de un cepevista o de una persona que
--                                  llega al CEPEV
--       Para los externos se registra el propietario: una persona ya
--       registrada (owner_id) o, si no esta registrada, su nombre
--       (owner_name). El telefono de contacto es opcional.
--     - Solo pueden quedar a cargo de un vehiculo o conducir un recorrido
--       las personas con licencia de conduccion registrada y vigente
--       (21_driver_license.sql).
--
--   Cambios:
--     vehicles        -> ownership, owner_id, owner_name, owner_phone
--     v_fleet_status  -> expone la propiedad, el propietario y el estado de
--                        la licencia del conductor asignado
--     vehicle_upsert  -> la firma suma p_ownership, p_owner, p_owner_name,
--                        p_owner_phone; valida licencia del conductor
--     trip_create     -> exige licencia vigente al conductor
--
--   Ejecutar DESPUES de 22_person_classification.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Propiedad del vehiculo
--    Las fichas que ya existian son flota del centro.
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists ownership   text not null default 'CEPEV',
  add column if not exists owner_id    uuid references public.people (id) on delete set null,
  add column if not exists owner_name  text,
  add column if not exists owner_phone text;

alter table public.vehicles drop constraint if exists vehicles_ownership_valid;
alter table public.vehicles add constraint vehicles_ownership_valid
  check (ownership in ('CEPEV', 'Externo'));

-- Los propios del centro no llevan propietario; los externos si. Se revisa
-- solo en el alta y la edicion (vehicle_upsert) porque owner_id queda en null
-- si se borra la persona, y eso no debe romper la ficha.
alter table public.vehicles drop constraint if exists vehicles_owner_only_external;
alter table public.vehicles add constraint vehicles_owner_only_external
  check (ownership = 'Externo' or (owner_id is null and owner_name is null and owner_phone is null));

create index if not exists vehicles_owner_idx on public.vehicles (owner_id);

comment on column public.vehicles.ownership   is 'CEPEV (propio del centro) o Externo (cepevista o visitante)';
comment on column public.vehicles.owner_id    is 'Propietario registrado en people, para vehiculos externos';
comment on column public.vehicles.owner_name  is 'Nombre del propietario cuando no esta registrado en people';
comment on column public.vehicles.owner_phone is 'Telefono de contacto del propietario';


-- ---------------------------------------------------------------------------
-- 2) La vista suma propiedad, propietario y licencia del conductor
--    Columnas nuevas al final para que baste con "create or replace".
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
  p.kind      as driver_kind,

  -- Propiedad
  v.ownership,
  v.owner_id,
  coalesce(o.full_name, v.owner_name) as owner_display_name,
  o.kind                              as owner_kind,
  v.owner_name,
  coalesce(v.owner_phone, o.phone)    as owner_phone,

  -- Licencia del conductor asignado
  p.license_number as driver_license_number,
  p.license_expiry as driver_license_expiry,
  (p.id is not null and (not p.has_driver_license
     or p.license_expiry < public.cepev_today())) as driver_license_invalid
from public.vehicles v
left join public.people p on p.id = v.driver_id
left join public.people o on o.id = v.owner_id;

alter view public.v_fleet_status set (security_invoker = on);
revoke all on public.v_fleet_status from anon;
grant select on public.v_fleet_status to authenticated;


-- ---------------------------------------------------------------------------
-- 3) Licencia vigente: regla comun para asignar y para conducir
-- ---------------------------------------------------------------------------
create or replace function public.assert_driver_licensed(p_person uuid)
returns public.people
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_person public.people%rowtype;
begin
  select * into v_person from public.people where id = p_person;
  if not found then
    raise exception 'El conductor seleccionado no existe.' using errcode = 'P0001';
  end if;

  if not v_person.has_driver_license then
    raise exception '% no tiene licencia de conduccion registrada.', v_person.full_name
      using errcode = 'P0001';
  end if;

  if v_person.license_expiry < public.cepev_today() then
    raise exception 'La licencia de % vencio el %.', v_person.full_name,
      to_char(v_person.license_expiry, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;

  return v_person;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 4) vehicle_upsert con propiedad
--    La firma cambia: se elimina la anterior para no dejar dos versiones.
-- ---------------------------------------------------------------------------
drop function if exists public.vehicle_upsert(
  uuid, text, text, text, integer, text, integer, integer, integer, date,
  public.vehicle_status, uuid
);

create or replace function public.vehicle_upsert(
  p_id          uuid,
  p_plate       text,
  p_type        text,
  p_brand       text,
  p_year        integer,
  p_color       text,
  p_capacity    integer,
  p_odometer    integer,
  p_next_km     integer,
  p_next_date   date,
  p_status      public.vehicle_status,
  p_driver      uuid,
  p_ownership   text default 'CEPEV',
  p_owner       uuid default null,
  p_owner_name  text default null,
  p_owner_phone text default null
)
returns public.vehicles
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row         public.vehicles%rowtype;
  v_plate       text;
  v_name        text;
  v_ownership   text := coalesce(nullif(trim(p_ownership), ''), 'CEPEV');
  v_owner       uuid := p_owner;
  v_owner_name  text := nullif(trim(coalesce(p_owner_name, '')), '');
  v_owner_phone text := nullif(trim(coalesce(p_owner_phone, '')), '');
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

  ---------------------------------------------------------------- propiedad
  if v_ownership not in ('CEPEV', 'Externo') then
    raise exception 'Propiedad no valida: %.', v_ownership using errcode = 'P0001';
  end if;

  if v_ownership = 'CEPEV' then
    v_owner       := null;
    v_owner_name  := null;
    v_owner_phone := null;
  else
    if v_owner is not null then
      if not exists (select 1 from public.people where id = v_owner) then
        raise exception 'El propietario seleccionado no existe.' using errcode = 'P0001';
      end if;
      v_owner_name := null;
    elsif v_owner_name is null then
      raise exception 'Indica el propietario del vehiculo: una persona registrada o su nombre.'
        using errcode = 'P0001';
    end if;
  end if;

  --------------------------------------------------------------- conductor
  if p_driver is not null then
    perform public.assert_driver_licensed(p_driver);
  end if;

  v_name := trim(p_brand) || ' ' || trim(p_type);

  if p_id is null then
    insert into public.vehicles
      (name, plate, vehicle_type, brand, model_year, color, capacity,
       odometer_km, next_service_km, next_service_date, status, driver_id,
       ownership, owner_id, owner_name, owner_phone)
    values
      (v_name, v_plate, trim(p_type), trim(p_brand), p_year, nullif(trim(p_color), ''),
       p_capacity, coalesce(p_odometer, 0), p_next_km,
       coalesce(p_next_date, public.cepev_today() + 90),
       coalesce(p_status, 'Disponible'), p_driver,
       v_ownership, v_owner, v_owner_name, v_owner_phone)
    returning * into v_row;

    perform public.log_action('vehicle_create', 'vehicles', v_row.id,
      'Vehiculo registrado: ' || v_name || ' (' || v_plate || ') · ' ||
      case when v_ownership = 'CEPEV' then 'propio del CEPEV' else 'externo' end);
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
           ownership         = v_ownership,
           owner_id          = v_owner,
           owner_name        = v_owner_name,
           owner_phone       = v_owner_phone,
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
-- 5) trip_create: el conductor debe tener licencia vigente
--    El resto de las validaciones queda igual que en 13_fleet_vehicles.sql.
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

  if p_driver is null then
    raise exception 'Selecciona un conductor valido.' using errcode = 'P0001';
  end if;
  v_driver := public.assert_driver_licensed(p_driver);

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

  if exists (
    select 1 from public.kitchen_shifts k
     where k.person_id = p_driver
       and tstzrange((k.service_date + k.starts_at)::timestamptz,
                     (k.service_date + k.ends_at)::timestamptz, '[)')
           && tstzrange(p_start, p_end, '[)')
  ) then
    raise exception 'El conductor tiene un turno de cocina en ese horario.' using errcode = 'P0001';
  end if;

  if (v_driver.license_expiry < (p_end at time zone 'America/Bogota')::date) then
    raise exception 'La licencia de % vence antes del regreso previsto.', v_driver.full_name
      using errcode = 'P0001';
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
    'vehicle_upsert(uuid,text,text,text,integer,text,integer,integer,integer,date,public.vehicle_status,uuid,text,uuid,text,text)',
    'trip_create(uuid,uuid,text,timestamptz,timestamptz)',
    'assert_driver_licensed(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 7) Verificacion
--    Los vehiculos con conductor sin licencia vigente conviene reasignarlos.
-- ---------------------------------------------------------------------------
select
  plate                  as placa,
  ownership              as propiedad,
  owner_display_name     as propietario,
  driver_name            as conductor,
  driver_license_invalid as licencia_no_vigente
from public.v_fleet_status
order by ownership, plate;
