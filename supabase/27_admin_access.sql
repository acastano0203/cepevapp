-- ============================================================================
-- CEPEV · 27_admin_access.sql · Modulo administrativo: accesos por perfil
--
--   role_modules         -> que modulos ve cada perfil en el menu
--                           (servidor, capitan, cepevista; admin ve todo)
--   my_modules()         -> modulos del usuario actual
--   admin_set_role_modules(role, modules[]) -> guarda los checks de un perfil
--   admin_users()        -> usuarios con correo y perfil (solo admin)
--   admin_set_user_role(user, role)         -> cambia el perfil de un usuario
--
--   Los checks tambien gobiernan la base de datos:
--     can_read()   -> admin, o perfil con algun modulo de operacion marcado
--                     (lectura; escribir sigue siendo solo del admin)
--     can_report() -> admin, o perfil con «mantenimiento» marcado
--
--   Valores por defecto (los mismos accesos que dejo la migracion 26):
--     servidor y capitan -> mantenimiento
--     cepevista          -> todos los modulos de operacion, solo lectura
--
--   Ejecutar DESPUES de 26_roles_maintenance.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Catalogo de modulos y accesos por perfil
-- ---------------------------------------------------------------------------
create or replace function public.app_modules()
returns text[]
language sql immutable
as $fn$
  select array['inicio', 'cocina', 'lavanderia', 'vehiculos', 'alojamientos',
               'colportores', 'cepevistas', 'pagos', 'mantenimiento'];
$fn$;

create table if not exists public.role_modules (
  role       public.app_role not null,
  module     text not null,
  updated_at timestamptz not null default now(),
  primary key (role, module),
  constraint role_modules_not_admin check (role <> 'admin'),
  constraint role_modules_module_ok check (module = any (public.app_modules()))
);

comment on table public.role_modules is
  'Modulos visibles por perfil. El admin ve todo y no se registra aqui.';

insert into public.role_modules (role, module)
select v.role::public.app_role, v.module
  from (
    select 'servidor' as role, 'mantenimiento' as module
    union all select 'capitan', 'mantenimiento'
    union all select 'cepevista', m from unnest(public.app_modules()) m where m <> 'mantenimiento'
  ) v
 where not exists (select 1 from public.role_modules);

alter table public.role_modules enable row level security;
revoke all on public.role_modules from anon;
revoke insert, update, delete on public.role_modules from authenticated;
grant select on public.role_modules to authenticated;

drop policy if exists role_modules_read on public.role_modules;
create policy role_modules_read on public.role_modules
  for select to authenticated
  using (public.is_admin() or role = public.current_role_name());


-- ---------------------------------------------------------------------------
-- 2) Permisos de la base de datos derivados de los checks
-- ---------------------------------------------------------------------------
create or replace function public.has_module(p_module text)
returns boolean
language sql stable security definer
set search_path = public
as $fn$
  select public.current_role_name() = 'admin'
      or exists (select 1 from public.role_modules
                  where role = public.current_role_name() and module = p_module);
$fn$;

create or replace function public.can_read()
returns boolean
language sql stable security definer
set search_path = public
as $fn$
  select public.current_role_name() = 'admin'
      or exists (select 1 from public.role_modules
                  where role = public.current_role_name() and module <> 'mantenimiento');
$fn$;

create or replace function public.can_report()
returns boolean
language sql stable security definer
set search_path = public
as $fn$
  select public.has_module('mantenimiento');
$fn$;

create or replace function public.my_modules()
returns text[]
language sql stable security definer
set search_path = public
as $fn$
  select case when public.current_role_name() = 'admin'
              then public.app_modules() || array['administracion']
              else coalesce((select array_agg(module order by module) from public.role_modules
                              where role = public.current_role_name()), array[]::text[]) end;
$fn$;


-- ---------------------------------------------------------------------------
-- 3) Administracion (solo admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role_modules(p_role public.app_role, p_modules text[])
returns text[]
language plpgsql security definer
set search_path = public
as $fn$
declare v_bad text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador gestiona los accesos.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' then
    raise exception 'El administrador ve todos los modulos.' using errcode = 'P0001';
  end if;
  select m into v_bad from unnest(coalesce(p_modules, array[]::text[])) m
   where not (m = any (public.app_modules())) limit 1;
  if v_bad is not null then
    raise exception 'Modulo no valido: %.', v_bad using errcode = 'P0001';
  end if;

  delete from public.role_modules where role = p_role;
  insert into public.role_modules (role, module)
  select distinct p_role, m from unnest(coalesce(p_modules, array[]::text[])) m;

  perform public.log_action('admin_role_modules', 'role_modules', null,
    'Accesos del perfil ' || p_role || ': '
      || coalesce(nullif(array_to_string(p_modules, ', '), ''), 'ninguno'));
  return coalesce(p_modules, array[]::text[]);
end;
$fn$;

create or replace function public.admin_users()
returns table (id uuid, email text, full_name text, role public.app_role,
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador ve los usuarios.' using errcode = 'P0001';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.created_at, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by p.role, p.full_name;
end;
$fn$;

create or replace function public.admin_set_user_role(p_user uuid, p_role public.app_role)
returns public.profiles
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row public.profiles%rowtype;
  v_old public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador cambia perfiles.' using errcode = 'P0001';
  end if;
  select role into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuario no encontrado.' using errcode = 'P0001'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    raise exception 'No puedes quitarte el perfil de administrador a ti mismo.' using errcode = 'P0001';
  end if;
  if v_old = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Debe quedar al menos un administrador.' using errcode = 'P0001';
  end if;

  update public.profiles set role = p_role, updated_at = now() where id = p_user returning * into v_row;
  perform public.log_action('admin_user_role', 'profiles', p_user,
    'Perfil de ' || v_row.full_name || ': ' || v_old || ' -> ' || p_role);
  return v_row;
end;
$fn$;

-- Nombre y perfil se editan sin la Edge Function: no requieren la llave de
-- servicio. Correo y contrasena si (viven en auth.users).
create or replace function public.admin_update_profile(p_user uuid, p_full_name text, p_role public.app_role)
returns public.profiles
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.profiles%rowtype;
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador edita usuarios.' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'Indica el nombre completo.' using errcode = 'P0001';
  end if;
  select * into v_row from public.profiles where id = p_user;
  if not found then raise exception 'Usuario no encontrado.' using errcode = 'P0001'; end if;
  -- Las reglas de perfil (no quitarse el admin, dejar al menos uno) estan ahi
  if v_row.role <> p_role then
    perform public.admin_set_user_role(p_user, p_role);
  end if;
  if v_row.full_name is distinct from v_name then
    update public.profiles set full_name = v_name, updated_at = now() where id = p_user;
    perform public.log_action('admin_user_update', 'profiles', p_user,
      'Nombre de usuario: ' || coalesce(v_row.full_name, '') || ' -> ' || v_name);
  end if;
  select * into v_row from public.profiles where id = p_user;
  return v_row;
end;
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_modules()', 'has_module(text)', 'can_read()', 'can_report()', 'my_modules()',
    'admin_set_role_modules(public.app_role,text[])', 'admin_users()',
    'admin_set_user_role(uuid,public.app_role)', 'admin_update_profile(uuid,text,public.app_role)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 4) Comprobacion: accesos por perfil
-- ---------------------------------------------------------------------------
select role, string_agg(module, ', ' order by module) as modulos
  from public.role_modules
 group by role
 order by role;
