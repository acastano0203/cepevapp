-- ============================================================================
-- CEPEV · 24_vehicle_documents.sql · SOAT, poliza todo riesgo y servicio
--                                    publico
--
--   Agrega a public.vehicles:
--     service_type       -> 'Particular' | 'Publico'
--     soat_expiry        -> vencimiento del SOAT (obligatorio al guardar)
--     insurance_expiry   -> vencimiento de la poliza todo riesgo (opcional)
--     public_service_file      -> ruta en Storage de la planilla de servicio
--     public_service_file_name -> nombre original del archivo
--     public_service_uploaded_at
--
--   Alertas: un documento esta "Por vencer" cuando le quedan 30 dias o
--   menos, y "Vencido" desde el dia siguiente a su fecha.
--
--   Cambios:
--     vehicle_document_status          -> NUEVA: estado de un vencimiento
--     v_fleet_status                   -> expone los campos y las alertas
--     vehicle_upsert                   -> la firma suma p_service_type,
--                                         p_soat_expiry, p_insurance_expiry
--     vehicle_set_public_service_file  -> NUEVA: guarda o quita la planilla
--     Storage: bucket privado "vehicle-documents" con sus politicas
--
--   Ejecutar DESPUES de 23_vehicle_ownership.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas
--    Las fichas que ya existian quedan como particulares y sin SOAT: la
--    tarjeta las muestra con alerta hasta que se complete la fecha.
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists service_type               text not null default 'Particular',
  add column if not exists soat_expiry                date,
  add column if not exists insurance_expiry           date,
  add column if not exists public_service_file        text,
  add column if not exists public_service_file_name   text,
  add column if not exists public_service_uploaded_at timestamptz;

alter table public.vehicles drop constraint if exists vehicles_service_type_valid;
alter table public.vehicles add constraint vehicles_service_type_valid
  check (service_type in ('Particular', 'Publico'));

comment on column public.vehicles.service_type        is 'Particular o Publico (servicio publico)';
comment on column public.vehicles.soat_expiry         is 'Fecha de vencimiento del SOAT';
comment on column public.vehicles.insurance_expiry    is 'Fecha de vencimiento de la poliza todo riesgo';
comment on column public.vehicles.public_service_file is 'Ruta en el bucket vehicle-documents de la planilla de servicio publico';


-- ---------------------------------------------------------------------------
-- 2) Estado de un vencimiento
-- ---------------------------------------------------------------------------
create or replace function public.vehicle_document_status(p_expiry date)
returns text
language sql stable
set search_path = public
as $fn$
  select case
    when p_expiry is null                        then 'Sin registrar'
    when p_expiry <  public.cepev_today()        then 'Vencido'
    when p_expiry <= public.cepev_today() + 30   then 'Por vencer'
    else 'Vigente'
  end;
$fn$;


-- ---------------------------------------------------------------------------
-- 3) Vista con documentos y alertas (columnas nuevas al final)
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
     or p.license_expiry < public.cepev_today())) as driver_license_invalid,

  -- Documentos del vehiculo
  v.service_type,
  v.soat_expiry,
  public.vehicle_document_status(v.soat_expiry)      as soat_status,
  v.insurance_expiry,
  public.vehicle_document_status(v.insurance_expiry) as insurance_status,
  v.public_service_file,
  v.public_service_file_name,
  v.public_service_uploaded_at,
  (
    public.vehicle_document_status(v.soat_expiry) <> 'Vigente'
    or public.vehicle_document_status(v.insurance_expiry) in ('Vencido', 'Por vencer')
    or (v.service_type = 'Publico' and v.public_service_file is null)
  ) as documents_alert
from public.vehicles v
left join public.people p on p.id = v.driver_id
left join public.people o on o.id = v.owner_id;

alter view public.v_fleet_status set (security_invoker = on);
revoke all on public.v_fleet_status from anon;
grant select on public.v_fleet_status to authenticated;


-- ---------------------------------------------------------------------------
-- 4) vehicle_upsert con tipo de servicio y vencimientos
--    La firma cambia: se elimina la anterior para no dejar dos versiones.
-- ---------------------------------------------------------------------------
drop function if exists public.vehicle_upsert(
  uuid, text, text, text, integer, text, integer, integer, integer, date,
  public.vehicle_status, uuid, text, uuid, text, text
);

create or replace function public.vehicle_upsert(
  p_id               uuid,
  p_plate            text,
  p_type             text,
  p_brand            text,
  p_year             integer,
  p_color            text,
  p_capacity         integer,
  p_odometer         integer,
  p_next_km          integer,
  p_next_date        date,
  p_status           public.vehicle_status,
  p_driver           uuid,
  p_ownership        text default 'CEPEV',
  p_owner            uuid default null,
  p_owner_name       text default null,
  p_owner_phone      text default null,
  p_service_type     text default 'Particular',
  p_soat_expiry      date default null,
  p_insurance_expiry date default null
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
  v_service     text := coalesce(nullif(trim(p_service_type), ''), 'Particular');
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

  --------------------------------------------------- servicio y documentos
  if v_service not in ('Particular', 'Publico') then
    raise exception 'Tipo de servicio no valido: %.', v_service using errcode = 'P0001';
  end if;

  if p_soat_expiry is null then
    raise exception 'Indica la fecha de vencimiento del SOAT.' using errcode = 'P0001';
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
       ownership, owner_id, owner_name, owner_phone,
       service_type, soat_expiry, insurance_expiry)
    values
      (v_name, v_plate, trim(p_type), trim(p_brand), p_year, nullif(trim(p_color), ''),
       p_capacity, coalesce(p_odometer, 0), p_next_km,
       coalesce(p_next_date, public.cepev_today() + 90),
       coalesce(p_status, 'Disponible'), p_driver,
       v_ownership, v_owner, v_owner_name, v_owner_phone,
       v_service, p_soat_expiry, p_insurance_expiry)
    returning * into v_row;

    perform public.log_action('vehicle_create', 'vehicles', v_row.id,
      'Vehiculo registrado: ' || v_name || ' (' || v_plate || ') · ' ||
      case when v_ownership = 'CEPEV' then 'propio del CEPEV' else 'externo' end ||
      ' · servicio ' || lower(v_service));
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
           service_type      = v_service,
           soat_expiry       = p_soat_expiry,
           insurance_expiry  = p_insurance_expiry,
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
-- 5) Planilla de servicio publico
--    El archivo se sube primero a Storage desde la app; esta funcion solo
--    registra (o quita, con p_path null) la ruta en la ficha.
-- ---------------------------------------------------------------------------
create or replace function public.vehicle_set_public_service_file(
  p_id uuid, p_path text, p_file_name text default null
) returns public.vehicles
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row public.vehicles%rowtype;
begin
  perform public.assert_can_write();

  if p_path is not null and p_path not like p_id::text || '/%' then
    raise exception 'La ruta del archivo no corresponde al vehiculo.' using errcode = 'P0001';
  end if;

  update public.vehicles
     set public_service_file        = p_path,
         public_service_file_name   = case when p_path is null then null else nullif(trim(p_file_name), '') end,
         public_service_uploaded_at = case when p_path is null then null else now() end,
         updated_at                 = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'El vehiculo no existe o ya fue eliminado.' using errcode = 'P0001';
  end if;

  perform public.log_action('vehicle_update', 'vehicles', v_row.id,
    case when p_path is null
      then 'Planilla de servicio publico retirada: ' || v_row.plate
      else 'Planilla de servicio publico cargada: ' || v_row.plate end);

  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 6) Storage: bucket privado para los documentos de los vehiculos
--    Leen todos los usuarios autenticados; suben y borran quienes pueden
--    escribir (admin y coordinacion). PDF o imagen, hasta 10 MB.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-documents', 'vehicle-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vehicle_documents_read   on storage.objects;
drop policy if exists vehicle_documents_insert on storage.objects;
drop policy if exists vehicle_documents_update on storage.objects;
drop policy if exists vehicle_documents_delete on storage.objects;

create policy vehicle_documents_read on storage.objects
  for select to authenticated
  using (bucket_id = 'vehicle-documents');

create policy vehicle_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-documents' and public.can_write());

create policy vehicle_documents_update on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicle-documents' and public.can_write())
  with check (bucket_id = 'vehicle-documents' and public.can_write());

create policy vehicle_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicle-documents' and public.can_write());


-- ---------------------------------------------------------------------------
-- 7) Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'vehicle_upsert(uuid,text,text,text,integer,text,integer,integer,integer,date,public.vehicle_status,uuid,text,uuid,text,text,text,date,date)',
    'vehicle_set_public_service_file(uuid,text,text)',
    'vehicle_document_status(date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 8) Verificacion: vehiculos con documentos pendientes
-- ---------------------------------------------------------------------------
select
  plate            as placa,
  service_type     as servicio,
  soat_expiry      as soat,
  soat_status      as estado_soat,
  insurance_expiry as todo_riesgo,
  insurance_status as estado_todo_riesgo,
  public_service_file is not null as tiene_planilla
from public.v_fleet_status
where documents_alert
order by soat_expiry nulls first, plate;
