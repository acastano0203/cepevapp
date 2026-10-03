-- ============================================================================
-- CEPEV · 26_roles_maintenance.sql · Roles nuevos y modulo de mantenimiento
--
--   1) Roles de usuario (reemplazan a admin | coordinador | consulta):
--        admin     -> opera toda la app (los coordinadores pasan a admin)
--        servidor  -> solo reporta mantenimiento y ve sus propios reportes
--        capitan   -> igual que servidor (capitanes de cuarto)
--        cepevista -> solo lectura de la app (los de consulta pasan aqui)
--
--      can_write()  -> solo admin
--      can_read()   -> admin y cepevista: las politicas de lectura que antes
--                      permitian a cualquier autenticado ahora usan esta regla,
--                      asi servidor y capitan no leen el resto de la operacion
--      can_report() -> admin, servidor y capitan
--
--   2) Mantenimiento de todo el CEPEV (no solo dormitorios):
--        maintenance_areas    -> areas del centro (configurables)
--        maintenance_reports  -> danos, reparaciones, mantenimientos y limpieza
--        bucket maintenance-photos -> una foto opcional por reporte
--      Estados: Abierto -> En proceso -> Resuelto (se puede reabrir).
--
--   Ejecutar DESPUES de 25_payments.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
--   NOTA: las politicas de lectura nuevas que se creen en migraciones futuras
--   con "using (true)" deben usar public.can_read() en su lugar.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Roles: se reconstruye el enum convirtiendo los usuarios existentes
--    coordinador -> admin · consulta -> cepevista
--    (Un valor nuevo de enum no se puede usar en la misma transaccion en que
--    se agrega; por eso se crea un tipo nuevo y se reemplaza el anterior.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'app_role' and t.typnamespace = 'public'::regnamespace
       and e.enumlabel = 'coordinador'
  ) then
    drop type if exists public.app_role_v2;
    create type public.app_role_v2 as enum ('admin', 'servidor', 'capitan', 'cepevista');

    drop policy if exists profiles_update_self on public.profiles;
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type public.app_role_v2
      using (case role::text
               when 'coordinador' then 'admin'
               when 'consulta'    then 'cepevista'
               else role::text end)::public.app_role_v2;

    drop function if exists public.current_role_name();
    drop type public.app_role;
    alter type public.app_role_v2 rename to app_role;
  end if;
end $$;

alter table public.profiles alter column role set default 'cepevista';

create or replace function public.current_role_name()
returns public.app_role
language sql stable security definer
set search_path = public
as $fn$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'cepevista'::public.app_role
  );
$fn$;

-- Escritura operativa: solo administracion
create or replace function public.can_write()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() = 'admin';
$fn$;

create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() = 'admin';
$fn$;

-- Lectura de la operacion: administracion y cepevistas (solo lectura)
create or replace function public.can_read()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() in ('admin', 'cepevista');
$fn$;

-- Reportar mantenimiento: administracion, servidores y capitanes
create or replace function public.can_report()
returns boolean
language sql stable
set search_path = public
as $fn$
  select public.current_role_name() in ('admin', 'servidor', 'capitan');
$fn$;

create or replace function public.assert_can_write()
returns void
language plpgsql stable
set search_path = public
as $fn$
begin
  if not public.can_write() then
    raise exception 'Tu perfil no puede modificar registros: se requiere un administrador.' using errcode = 'P0001';
  end if;
end;
$fn$;

grant execute on function public.current_role_name(), public.can_write(), public.is_admin(),
  public.can_read(), public.can_report() to authenticated;

-- Cada quien edita su nombre, nunca su rol
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name());


-- ---------------------------------------------------------------------------
-- 2) Lectura restringida: las politicas "using (true)" pasan a can_read()
--    Asi servidor y capitan no leen personas, pagos, cocina, etc.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and qual = 'true'
       and tablename not in ('profiles', 'maintenance_areas', 'maintenance_reports')
  loop
    execute format('alter policy %I on public.%I using (public.can_read())', p.policyname, p.tablename);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 3) Areas del CEPEV
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint maintenance_areas_name_ok check (length(trim(name)) > 0)
);

create unique index if not exists maintenance_areas_name_idx on public.maintenance_areas (lower(name));

insert into public.maintenance_areas (name, sort_order)
select v.name, v.sort_order
  from (values
    ('Dormitorios', 10), ('Cocina', 20), ('Comedor', 30), ('Banos y duchas', 40),
    ('Lavanderia', 50), ('Capilla y auditorio', 60), ('Salones de clase', 70),
    ('Oficinas', 80), ('Zonas verdes', 90), ('Parqueadero', 100), ('Porteria', 110),
    ('Red electrica', 120), ('Agua y plomeria', 130), ('Otra area', 999)
  ) as v(name, sort_order)
 where not exists (select 1 from public.maintenance_areas);


-- ---------------------------------------------------------------------------
-- 4) Reportes
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_reports (
  id               uuid primary key default gen_random_uuid(),
  area_id          uuid not null references public.maintenance_areas (id) on delete restrict,
  room_id          uuid references public.rooms (id) on delete set null,
  location_detail  text,
  report_type      text not null,
  priority         text not null default 'Normal',
  detail           text not null,
  photo_path       text,
  status           text not null default 'Abierto',
  assigned_to      text,
  resolution       text,
  cost_cop         numeric(12, 2),
  reported_by      uuid references public.profiles (id) on delete set null,
  reported_by_name text,
  reported_by_role text,
  started_at       timestamptz,
  resolved_at      timestamptz,
  resolved_by_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint maintenance_reports_type_ok
    check (report_type in ('Dano', 'Reparacion', 'Mantenimiento', 'Limpieza')),
  constraint maintenance_reports_priority_ok check (priority in ('Normal', 'Urgente')),
  constraint maintenance_reports_status_ok check (status in ('Abierto', 'En proceso', 'Resuelto')),
  constraint maintenance_reports_detail_ok check (length(trim(detail)) > 0),
  constraint maintenance_reports_cost_ok check (cost_cop is null or cost_cop >= 0)
);

create index if not exists maintenance_reports_status_idx on public.maintenance_reports (status, created_at desc);
create index if not exists maintenance_reports_reporter_idx on public.maintenance_reports (reported_by, created_at desc);

-- RLS: la operacion (admin y cepevista) ve todo; servidor y capitan, lo suyo.
-- Se escribe solo con las funciones de abajo.
do $$
declare t text;
begin
  foreach t in array array['maintenance_areas', 'maintenance_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists maintenance_areas_read on public.maintenance_areas;
create policy maintenance_areas_read on public.maintenance_areas
  for select to authenticated using (public.can_read() or public.can_report());

drop policy if exists maintenance_reports_read on public.maintenance_reports;
create policy maintenance_reports_read on public.maintenance_reports
  for select to authenticated
  using (public.can_read() or reported_by = auth.uid());

-- Vista con nombres resueltos. Respeta la RLS de quien consulta.
-- (Los nombres de area y cuarto se leen con funciones porque servidor y
-- capitan no tienen lectura directa de rooms.)
create or replace function public.maintenance_room_code(p_room uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select code from public.rooms where id = p_room;
$fn$;

drop view if exists public.v_maintenance_reports;
create view public.v_maintenance_reports with (security_invoker = on) as
select
  r.id,
  r.area_id,
  a.name as area_name,
  r.room_id,
  public.maintenance_room_code(r.room_id) as room_code,
  r.location_detail,
  r.report_type,
  r.priority,
  r.detail,
  r.photo_path,
  r.status,
  r.assigned_to,
  r.resolution,
  r.cost_cop,
  r.reported_by,
  r.reported_by_name,
  r.reported_by_role,
  r.reported_by = auth.uid() as is_mine,
  r.started_at,
  r.resolved_at,
  r.resolved_by_name,
  r.created_at,
  r.updated_at
from public.maintenance_reports r
join public.maintenance_areas a on a.id = r.area_id;

revoke all on public.v_maintenance_reports from anon;
grant select on public.v_maintenance_reports to authenticated;

-- Cuartos para el formulario de reporte (servidor y capitan no leen rooms)
create or replace function public.maintenance_rooms()
returns table (id uuid, code text, building text)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.code, r.building
    from public.rooms r
   where public.can_report() or public.can_read()
   order by r.building, r.code;
$fn$;


-- ---------------------------------------------------------------------------
-- 5) Funciones del dominio
-- ---------------------------------------------------------------------------
create or replace function public.maintenance_report_create(
  p_area uuid,
  p_type text,
  p_priority text,
  p_detail text,
  p_room uuid default null,
  p_location text default null,
  p_photo_path text default null
) returns public.maintenance_reports
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.maintenance_reports%rowtype;
  v_area public.maintenance_areas%rowtype;
begin
  if not public.can_report() then
    raise exception 'Tu perfil no puede reportar mantenimiento.' using errcode = 'P0001';
  end if;

  select * into v_area from public.maintenance_areas where id = p_area;
  if not found or not v_area.is_active then
    raise exception 'Selecciona un area del CEPEV.' using errcode = 'P0001';
  end if;
  if coalesce(p_type, '') not in ('Dano', 'Reparacion', 'Mantenimiento', 'Limpieza') then
    raise exception 'Selecciona el tipo de reporte.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_detail), '') = '' then
    raise exception 'Describe el dano o el mantenimiento que se necesita.' using errcode = 'P0001';
  end if;
  if p_room is not null and not exists (select 1 from public.rooms where id = p_room) then
    raise exception 'Cuarto no encontrado.' using errcode = 'P0001';
  end if;
  -- La foto debe estar en la carpeta de quien reporta
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> auth.uid()::text then
    raise exception 'La foto no corresponde a tu usuario.' using errcode = 'P0001';
  end if;

  insert into public.maintenance_reports (area_id, room_id, location_detail, report_type, priority, detail,
                                          photo_path, reported_by, reported_by_name, reported_by_role)
  values (p_area, p_room, nullif(trim(p_location), ''), p_type,
          case when p_priority = 'Urgente' then 'Urgente' else 'Normal' end,
          trim(p_detail), nullif(p_photo_path, ''), auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'Usuario CEPEV'),
          public.current_role_name()::text)
  returning * into v_row;

  perform public.log_action('maintenance_report', 'maintenance_reports', v_row.id,
    'Reporte de ' || lower(p_type) || ' en ' || v_area.name
      || coalesce(' (' || public.maintenance_room_code(p_room) || ')', '')
      || case when v_row.priority = 'Urgente' then ', urgente' else '' end
      || ': ' || left(v_row.detail, 120));
  return v_row;
end;
$fn$;

-- Gestion (solo administracion): estado, responsable, resolucion y costo
create or replace function public.maintenance_report_update(
  p_id uuid,
  p_status text,
  p_assigned_to text default null,
  p_resolution text default null,
  p_cost numeric default null,
  p_priority text default null
) returns public.maintenance_reports
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row public.maintenance_reports%rowtype;
  v_old public.maintenance_reports%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo la administracion gestiona los reportes de mantenimiento.' using errcode = 'P0001';
  end if;
  if coalesce(p_status, '') not in ('Abierto', 'En proceso', 'Resuelto') then
    raise exception 'Estado no valido.' using errcode = 'P0001';
  end if;
  if p_status = 'Resuelto' and coalesce(trim(p_resolution), '') = '' then
    raise exception 'Indica que se hizo para resolverlo.' using errcode = 'P0001';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'El costo no puede ser negativo.' using errcode = 'P0001';
  end if;

  select * into v_old from public.maintenance_reports where id = p_id for update;
  if not found then raise exception 'Reporte no encontrado.' using errcode = 'P0001'; end if;

  update public.maintenance_reports
     set status           = p_status,
         priority         = case when p_priority in ('Normal', 'Urgente') then p_priority else priority end,
         assigned_to      = nullif(trim(p_assigned_to), ''),
         resolution       = case when p_status = 'Resuelto' then trim(p_resolution) else nullif(trim(p_resolution), '') end,
         cost_cop         = p_cost,
         started_at       = case when p_status = 'En proceso' and v_old.status <> 'En proceso' then now()
                                 when p_status = 'Abierto' then null else started_at end,
         resolved_at      = case when p_status = 'Resuelto' then coalesce(case when v_old.status = 'Resuelto' then resolved_at end, now()) end,
         resolved_by_name = case when p_status = 'Resuelto'
                                 then coalesce((select full_name from public.profiles where id = auth.uid()), 'Usuario CEPEV') end,
         updated_at       = now()
   where id = p_id
  returning * into v_row;

  perform public.log_action('maintenance_update', 'maintenance_reports', v_row.id,
    'Reporte de mantenimiento: ' || v_old.status || ' -> ' || v_row.status
      || coalesce(' · responsable ' || v_row.assigned_to, ''));
  return v_row;
end;
$fn$;

create or replace function public.maintenance_area_save(p_id uuid, p_name text, p_active boolean default true)
returns public.maintenance_areas
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.maintenance_areas%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo la administracion configura las areas.' using errcode = 'P0001';
  end if;
  if v_name is null then raise exception 'Indica el nombre del area.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.maintenance_areas where lower(name) = lower(v_name) and (p_id is null or id <> p_id)) then
    raise exception 'Ya existe el area %.', v_name using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.maintenance_areas (name, is_active) values (v_name, coalesce(p_active, true))
    returning * into v_row;
  else
    update public.maintenance_areas set name = v_name, is_active = coalesce(p_active, is_active)
     where id = p_id returning * into v_row;
    if not found then raise exception 'Area no encontrada.' using errcode = 'P0001'; end if;
  end if;

  perform public.log_action('maintenance_area', 'maintenance_areas', v_row.id,
    'Area ' || v_row.name || case when v_row.is_active then '' else ' (inactiva)' end);
  return v_row;
end;
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'maintenance_report_create(uuid,text,text,text,uuid,text,text)',
    'maintenance_report_update(uuid,text,text,text,numeric,text)',
    'maintenance_area_save(uuid,text,boolean)',
    'maintenance_rooms()',
    'maintenance_room_code(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 6) Storage: fotos de los reportes (solo en Supabase)
--    Cada quien sube a su carpeta {uid}/...; la operacion ve todas las fotos,
--    servidor y capitan solo las suyas. Imagenes de hasta 5 MB.
--    Tambien se restringe la lectura de los documentos de vehiculos.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage: se omiten el bucket y sus politicas.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('maintenance-photos', 'maintenance-photos', false, 5242880,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
     set public = excluded.public,
         file_size_limit = excluded.file_size_limit,
         allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists maintenance_photos_read   on storage.objects;
  drop policy if exists maintenance_photos_insert on storage.objects;
  drop policy if exists maintenance_photos_delete on storage.objects;

  create policy maintenance_photos_read on storage.objects
    for select to authenticated
    using (bucket_id = 'maintenance-photos'
           and (public.can_read() or (storage.foldername(name))[1] = auth.uid()::text));

  create policy maintenance_photos_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'maintenance-photos' and public.can_report()
                and (storage.foldername(name))[1] = auth.uid()::text);

  create policy maintenance_photos_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'maintenance-photos'
           and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'vehicle_documents_read') then
    alter policy vehicle_documents_read on storage.objects
      using (bucket_id = 'vehicle-documents' and public.can_read());
  end if;
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 7) Comprobacion
-- ---------------------------------------------------------------------------
select
  (select string_agg(enumlabel, ', ' order by enumsortorder)
     from pg_enum where enumtypid = 'public.app_role'::regtype)       as roles,
  (select count(*) from public.profiles)                               as usuarios,
  to_regclass('public.v_maintenance_reports') is not null              as mantenimiento,
  (select count(*) from pg_policies where schemaname = 'public'
      and cmd = 'SELECT' and qual = 'true')                            as lecturas_abiertas;
