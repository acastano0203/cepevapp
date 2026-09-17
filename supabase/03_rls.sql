-- ============================================================================
-- CEPEV · 03_rls.sql · Row Level Security
--   consulta     -> solo lectura
--   coordinador  -> lectura + escritura operativa
--   admin        -> todo, incluida la gestion de roles
-- ============================================================================

-- Las vistas respetan las politicas del usuario que consulta (PostgreSQL 15+)
alter view public.v_beds_status          set (security_invoker = on);
alter view public.v_kitchen_shifts       set (security_invoker = on);
alter view public.v_colporteur_progress  set (security_invoker = on);
alter view public.v_fleet_status         set (security_invoker = on);
alter view public.v_dashboard            set (security_invoker = on);

revoke all on public.v_beds_status, public.v_kitchen_shifts, public.v_colporteur_progress,
              public.v_fleet_status, public.v_dashboard from anon;
grant select on public.v_beds_status, public.v_kitchen_shifts, public.v_colporteur_progress,
                public.v_fleet_status, public.v_dashboard to authenticated;

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas operativas
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','teams','people','rooms','beds','stays','kitchen_shifts',
    'kitchen_publications','vehicles','trips','fuel_logs','maintenance_logs',
    'rotations','sales_reports','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Tablas operativas: leen todos los autenticados, escriben los que pueden
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'teams','people','rooms','beds','stays','kitchen_shifts','kitchen_publications',
    'vehicles','trips','fuel_logs','maintenance_logs','rotations','sales_reports'
  ] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_write())', t);

    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_write()) with check (public.can_write())', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Bitacora: lectura para todos, escritura solo desde las funciones del dominio
-- ---------------------------------------------------------------------------
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Permisos base
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
