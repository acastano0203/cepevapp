-- ============================================================================
-- CEPEV · 14_reset_fleet.sql · Limpieza del modulo de Vehiculos
--
--   LISTO PARA EJECUTAR TAL CUAL. Al terminar deja:
--     - vehicles vacia          (ninguna ficha de vehiculo)
--     - trips vacia             (ningun recorrido, ni historico ni abierto)
--     - fuel_logs vacia         (ninguna carga de combustible)
--     - maintenance_logs vacia  (ninguna entrada de hoja de vida)
--
--   Para volver a cargar la flota usa "Nuevo vehiculo" en la aplicacion.
--
--   Tablas involucradas y su orden de borrado (las tres primeras dependen de
--   vehicles, asi que van antes):
--     public.fuel_logs         -> cargas de combustible
--     public.maintenance_logs  -> hoja de vida tecnica
--     public.trips             -> recorridos reservados y cerrados
--     public.vehicles          -> las fichas
--
--   NO se tocan personas, cocina, alojamientos ni colportaje.
--
--   Al final del archivo hay variantes comentadas por si necesitas una
--   limpieza parcial en lugar del vaciado completo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Que hay cargado ahora mismo
-- ---------------------------------------------------------------------------
select
  v.plate                                          as placa,
  v.name                                           as vehiculo,
  v.status                                         as estado,
  (select count(*) from public.trips t
    where t.vehicle_id = v.id)                     as recorridos,
  (select count(*) from public.trips t
    where t.vehicle_id = v.id
      and t.status in ('Reservado', 'En ruta'))    as recorridos_abiertos,
  (select count(*) from public.fuel_logs f
    where f.vehicle_id = v.id)                     as cargas_combustible,
  (select count(*) from public.maintenance_logs m
    where m.vehicle_id = v.id)                     as mantenimientos
from public.vehicles v
order by v.plate;


-- ---------------------------------------------------------------------------
-- PASO 1 · Vaciar lo que cuelga de los vehiculos
--   Se usa DELETE y no TRUNCATE: trips apunta a vehicles con "on delete
--   restrict", y TRUNCATE se niega a tocar una tabla referenciada aunque la
--   que la referencia ya este vacia.
-- ---------------------------------------------------------------------------
delete from public.fuel_logs;
delete from public.maintenance_logs;
delete from public.trips;


-- ---------------------------------------------------------------------------
-- PASO 2 · Vaciar las fichas
-- ---------------------------------------------------------------------------
delete from public.vehicles;


-- ---------------------------------------------------------------------------
-- PASO 3 · Verificacion
--   Esperado: todo en cero.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.vehicles)          as vehiculos,
  (select count(*) from public.trips)             as recorridos,
  (select count(*) from public.fuel_logs)         as cargas_combustible,
  (select count(*) from public.maintenance_logs)  as mantenimientos;


-- ============================================================================
-- VARIANTES (comentadas) · para limpiezas parciales
-- ============================================================================

-- A) Borrar un solo vehiculo con todo su historial (respeta las reglas de
--    negocio: avisa si tiene recorridos sin cerrar). Requiere ser admin:
-- select public.vehicle_delete(
--   (select id from public.vehicles where plate = 'ABC123'), true);

-- B) Conservar las fichas y borrar solo el historial:
-- delete from public.fuel_logs;
-- delete from public.maintenance_logs;
-- delete from public.trips;

-- C) Cerrar de una vez los recorridos abiertos, sin borrar nada:
-- update public.trips set status = 'Cancelado'
--  where status in ('Reservado', 'En ruta');

-- D) Borrar tambien el rastro del modulo en la bitacora
--    (por defecto se conserva como historial de lo ocurrido):
-- delete from public.audit_log
--  where action in ('vehicle_create', 'vehicle_update', 'vehicle_delete',
--                   'trip_create', 'trip_close', 'fuel_register',
--                   'maintenance_register');
