-- ============================================================================
-- CEPEV · 07_reset_kitchen.sql · Limpieza del modulo de Cocina
--
--   LISTO PARA EJECUTAR TAL CUAL. Al terminar deja:
--     - kitchen_publications vacia   (ningun dia publicado)
--     - kitchen_shifts con la parrilla de la semana en curso, sin asignar
--
--   Tablas involucradas (ninguna otra depende de ellas, asi que no se tocan
--   alojamientos, flota ni colportaje):
--     public.kitchen_shifts        -> los puestos, 18 por dia
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
  count(*)                      as puestos,
  count(k.person_id)            as asignados,
  count(*) - count(k.person_id) as libres,
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
-- PASO 3 · Regenerar la parrilla de la semana en curso
--   18 puestos por dia: 3 comidas x 2 tareas x 3 personas, todos sin asignar.
--   Para cubrirlos, usa "Generar propuesta" en la aplicacion.
-- ---------------------------------------------------------------------------
insert into public.kitchen_shifts (service_date, meal, task, position_index, starts_at, ends_at)
select d::date, tpl.meal::public.meal_type, tpl.task::public.kitchen_task, pos, tpl.s, tpl.e
from generate_series(public.cepev_today(), public.cepev_today() + 6, interval '1 day') d
cross join (values
  ('Desayuno','Preparacion','05:00'::time,'07:00'::time),
  ('Desayuno','Comedor',    '06:00',      '08:00'),
  ('Almuerzo','Preparacion','10:00',      '12:30'),
  ('Almuerzo','Comedor',    '11:30',      '14:00'),
  ('Cena',    'Preparacion','16:00',      '18:00'),
  ('Cena',    'Comedor',    '17:30',      '20:00')
) as tpl(meal, task, s, e)
cross join generate_series(1, 3) as pos
on conflict (service_date, meal, task, position_index) do nothing;


-- ---------------------------------------------------------------------------
-- PASO 4 · Verificacion
--   Esperado: 126 turnos totales (7 dias x 18), 0 asignados, 0 publicados.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.kitchen_shifts)                          as turnos_totales,
  (select count(*) from public.kitchen_shifts where person_id is not null) as turnos_asignados,
  (select count(*) from public.kitchen_publications)                    as dias_publicados,
  (select min(service_date) from public.kitchen_shifts)                 as primer_dia,
  (select max(service_date) from public.kitchen_shifts)                 as ultimo_dia;


-- ============================================================================
-- VARIANTES (comentadas) · para limpiezas parciales
-- ============================================================================

-- A) Solo liberar las asignaciones, conservando la parrilla existente:
-- update public.kitchen_shifts set person_id = null;
-- delete from public.kitchen_publications;

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
--  where action in ('kitchen_assign', 'kitchen_autofill', 'kitchen_publish');
