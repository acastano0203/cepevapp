-- ============================================================================
-- CEPEV · 06_admin.sql · Asignar roles
-- Ejecutar DESPUES de crear el usuario en Authentication -> Users
-- ============================================================================

-- 1) Ver los usuarios registrados y su rol actual
select u.email, p.full_name, p.role, p.id
  from auth.users u
  join public.profiles p on p.id = u.id
 order by u.created_at;

-- 2) Promover a administrador (cambia el correo)
update public.profiles
   set role = 'admin', full_name = 'Coordinacion CEPEV'
 where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');

-- 3) Otros roles disponibles: 'coordinador' (escribe) | 'consulta' (solo lectura)
-- update public.profiles set role = 'coordinador'
--  where id = (select id from auth.users where email = 'cocina@ejemplo.com');
