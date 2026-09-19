-- ============================================================================
-- CEPEV · 07_reset_kitchen.sql · Limpieza del modulo de Cocina
--
--   LISTO PARA EJECUTAR TAL CUAL. Al terminar deja:
--     - kitchen_publications vacia   (ningun dia publicado)
--     - kitchen_shifts vacia         (ninguna comida con equipo)
--
--   Desde 12_kitchen_dynamic.sql un puesto existe solo cuando alguien lo
--   ocupa: no hay parrilla vacia que regenerar. Para volver a armar los
--   equipos usa "Asignar" o "Generar propuesta" en la aplicacion.
--
--   Tablas involucradas (ninguna otra depende de ellas, asi que no se tocan
--   alojamientos, flota ni colportaje):
--     public.kitchen_shifts        -> una fila por persona y comida
--     public.kitchen_publications  -> los dias aprobados y publicados
--
--   Al final del archivo hay variantes comentadas por si algun dia necesitas
--   una limpieza parcial en lugar del vaciado completo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Que hay cargado ahora mismo
-- ---------------------------------------------------------------------------
select
  k.service_date,
  count(*)                      as participantes,
  count(distinct k.meal)        as comidas_con_equipo,
  (kp.service_date is not null) as publicado
from public.kitchen_shifts k
left join public.kitchen_publications kp on kp.service_date = k.service_date
group by k.service_date, kp.service_date
order by k.service_date;


-- ---------------------------------------------------------------------------
-- PASO 1 · Vaciar las publicaciones
-- ---------------------------------------------------------------------------
truncate table public.kitchen_publications;


-- ---------------------------------------------------------------------------
-- PASO 2 · Vaciar los turnos
-- ---------------------------------------------------------------------------
truncate table public.kitchen_shifts;


-- ---------------------------------------------------------------------------
-- PASO 3 · (ya no hace falta regenerar nada)
--   El modulo arranca vacio y la grilla de cada comida se llena desde la
--   aplicacion. Si quieres dejar la semana propuesta de una vez, ejecuta:
--
--     select public.kitchen_autofill(d::date, 3)
--       from generate_series(public.cepev_today(),
--                            public.cepev_today() + 6, interval '1 day') d;
--
--   El segundo parametro es cuanta gente quieres por tarea (preparacion y
--   comedor) en cada comida: ponlo en el numero que necesites.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- PASO 4 · Verificacion
--   Esperado: todo en cero mientras no vuelvas a armar los equipos.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.kitchen_shifts)       as participaciones,
  (select count(*) from public.kitchen_publications) as dias_publicados,
  (select min(service_date) from public.kitchen_shifts) as primer_dia,
  (select max(service_date) from public.kitchen_shifts) as ultimo_dia;


-- ============================================================================
-- VARIANTES (comentadas) · para limpiezas parciales
-- ============================================================================

-- A) Vaciar solo un dia, conservando el resto de la semana:
-- delete from public.kitchen_shifts       where service_date = public.cepev_today();
-- delete from public.kitchen_publications where service_date = public.cepev_today();

-- B) Limpiar un rango de fechas concreto:
-- delete from public.kitchen_publications
--  where service_date between date '2026-09-01' and date '2026-09-30';
-- delete from public.kitchen_shifts
--  where service_date between date '2026-09-01' and date '2026-09-30';

-- C) Limpiar solo el pasado, conservando hoy y los dias futuros:
-- delete from public.kitchen_publications where service_date < public.cepev_today();
-- delete from public.kitchen_shifts       where service_date < public.cepev_today();

-- D) Borrar tambien el rastro del modulo en la bitacora
--    (por defecto se conserva como historial de lo ocurrido):
-- delete from public.audit_log
--  where action in ('kitchen_add', 'kitchen_remove', 'kitchen_autofill', 'kitchen_publish');
