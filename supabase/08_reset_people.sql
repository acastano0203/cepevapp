-- ============================================================================
-- CEPEV · 08_reset_people.sql · Limpieza de la tabla de personas
--
--   >>> LEE ESTO ANTES DE EJECUTAR <<<
--
--   La tabla public.people no se puede vaciar sola: otras cuatro tablas la
--   referencian y dos de ellas bloquean el borrado.
--
--     stays          -> on delete restrict   BLOQUEA (hay que borrar antes)
--     trips (driver) -> on delete restrict   BLOQUEA (hay que borrar antes)
--     sales_reports  -> on delete cascade    se borran solos
--     kitchen_shifts -> on delete set null   el puesto queda libre
--
--   Por eso el script, tal como esta, TAMBIEN BORRA estadias, recorridos y
--   reportes de colportaje. Si solo quieres limpiar una parte, usa alguna de
--   las variantes comentadas al final del archivo.
--
--   NO se tocan: rooms, beds, vehicles, teams, rotations, profiles ni las
--   cuentas de acceso (auth.users). Podras seguir entrando a la aplicacion.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Que hay cargado y cuanto arrastra
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.people)                                as personas,
  (select count(*) from public.people where kind = 'Residente')       as residentes,
  (select count(*) from public.people where kind = 'Colportor')       as colportores,
  (select count(*) from public.people where kind = 'Logistica')       as logistica,
  (select count(*) from public.people where kind = 'Conductor')       as conductores,
  (select count(*) from public.people where kind = 'Llegada')         as llegadas,
  (select count(*) from public.stays)                                 as estadias_a_borrar,
  (select count(*) from public.trips)                                 as recorridos_a_borrar,
  (select count(*) from public.sales_reports)                         as reportes_a_borrar,
  (select count(*) from public.kitchen_shifts where person_id is not null) as turnos_que_quedaran_libres;


-- ---------------------------------------------------------------------------
-- PASO 1 · Borrar lo que bloquea (estadias y recorridos)
-- ---------------------------------------------------------------------------
delete from public.stays;
delete from public.trips;


-- ---------------------------------------------------------------------------
-- PASO 2 · Liberar los turnos de cocina
--   El on delete set null ya lo haria, pero hacerlo explicito deja claro
--   que la parrilla de cocina se conserva y solo se vacian los nombres.
-- ---------------------------------------------------------------------------
update public.kitchen_shifts set person_id = null where person_id is not null;
delete from public.kitchen_publications;


-- ---------------------------------------------------------------------------
-- PASO 3 · Borrar las personas
--   Los reportes de colportaje se van en cascada.
-- ---------------------------------------------------------------------------
delete from public.people;


-- ---------------------------------------------------------------------------
-- PASO 4 · Verificacion
--   Esperado: todo en cero salvo los turnos de cocina, que siguen existiendo
--   pero sin nadie asignado.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.people)                                as personas,
  (select count(*) from public.stays)                                 as estadias,
  (select count(*) from public.trips)                                 as recorridos,
  (select count(*) from public.sales_reports)                         as reportes,
  (select count(*) from public.kitchen_shifts)                        as turnos_totales,
  (select count(*) from public.kitchen_shifts where person_id is not null) as turnos_asignados,
  (select count(*) from public.beds)                                  as camas_intactas,
  (select count(*) from public.vehicles)                              as vehiculos_intactos;


-- ============================================================================
-- VARIANTES (comentadas) · limpiezas mas quirurgicas
-- ============================================================================

-- A) Borrar solo las personas SIN movimientos
--    (sin estadias, recorridos, reportes ni turnos). Es la opcion segura para
--    depurar registros de prueba sin perder historial.
-- delete from public.people p
--  where not exists (select 1 from public.stays s          where s.person_id = p.id)
--    and not exists (select 1 from public.trips t          where t.driver_id = p.id)
--    and not exists (select 1 from public.sales_reports sr where sr.person_id = p.id)
--    and not exists (select 1 from public.kitchen_shifts k where k.person_id = p.id);

-- B) Borrar un solo tipo de persona (ej. los residentes de prueba):
-- delete from public.stays
--  where person_id in (select id from public.people where kind = 'Residente');
-- delete from public.people where kind = 'Residente';

-- C) Borrar una persona concreta por nombre:
-- delete from public.stays
--  where person_id in (select id from public.people where full_name = 'Nombre Apellido');
-- delete from public.trips
--  where driver_id in (select id from public.people where full_name = 'Nombre Apellido');
-- delete from public.people where full_name = 'Nombre Apellido';

-- D) Dar de baja sin borrar (conserva el historial completo):
-- update public.people set is_available = false where kind = 'Residente';

-- E) Borrar tambien el rastro en la bitacora:
-- delete from public.audit_log
--  where action in ('person_create', 'person_update', 'stay_create',
--                   'stay_check_in', 'stay_check_out', 'sale_register', 'sale_correct');

-- F) VACIADO TOTAL para poder volver a ejecutar 05_seed.sql
--    Necesario porque el seed vuelve a insertar habitaciones y vehiculos, y
--    rooms.code / vehicles.plate son unicos: sin esto fallaria por duplicados.
--    El orden importa: primero lo que referencia, despues lo referenciado.
-- delete from public.stays;
-- delete from public.trips;
-- delete from public.fuel_logs;
-- delete from public.maintenance_logs;
-- delete from public.sales_reports;
-- delete from public.kitchen_publications;
-- delete from public.kitchen_shifts;
-- delete from public.beds;
-- delete from public.rooms;
-- delete from public.vehicles;
-- delete from public.people;
-- delete from public.rotations;
-- delete from public.teams;
