-- ============================================================================
-- CEPEV · 18_reset_lodging.sql · Limpieza del modulo de Alojamientos
--
--   LISTO PARA EJECUTAR TAL CUAL. Borra los datos de ejemplo del seed
--   (70 habitaciones A-101..B-135 con 6 camas cada una) y al terminar deja:
--     - stays vacia  (ninguna reserva ni estadia, ni vigente ni historica)
--     - beds vacia   (ninguna cama)
--     - rooms vacia  (ningun dormitorio)
--
--   Para volver a cargar los dormitorios usa "Nuevo dormitorio" en la
--   aplicacion (requiere 17_lodging_rooms.sql).
--
--   Orden de borrado: stays apunta a beds con "on delete restrict", asi que
--   va primero; beds cae en cascada con rooms.
--
--   NO se tocan personas, cocina, vehiculos ni colportaje. Las personas que
--   estaban alojadas vuelven a quedar sin cama (las "Llegada" aparecen otra
--   vez en "Llegadas pendientes").
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Que hay cargado ahora mismo
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.rooms)                                          as dormitorios,
  (select count(*) from public.beds)                                           as camas,
  (select count(*) from public.stays)                                          as estadias,
  (select count(*) from public.stays where status in ('Reservado', 'Alojado')) as estadias_vigentes;


-- ---------------------------------------------------------------------------
-- PASO 1 · Vaciar estadias, camas y dormitorios
-- ---------------------------------------------------------------------------
delete from public.stays;
delete from public.beds;
delete from public.rooms;


-- ---------------------------------------------------------------------------
-- PASO 2 · Verificacion: todo en cero
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.rooms) as dormitorios,
  (select count(*) from public.beds)  as camas,
  (select count(*) from public.stays) as estadias;
