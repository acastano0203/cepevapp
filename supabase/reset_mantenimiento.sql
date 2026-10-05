-- ============================================================================
-- CEPEV · reset_mantenimiento.sql · Borra todos los reportes de mantenimiento
--
--   >>> IRREVERSIBLE. LEE ESTO ANTES DE EJECUTAR <<<
--   Haz una copia de seguridad antes (Supabase -> Database -> Backups).
--
--   Borra TODOS los reportes del modulo Mantenimiento (maintenance_reports),
--   en cualquier estado: Abierto, En proceso y Resuelto.
--   Ninguna otra tabla depende de ellos, asi que no hay borrados en cascada.
--
--   NO se tocan: las areas (maintenance_areas), las novedades de dormitorios
--   (room_issues), los mantenimientos de vehiculos (maintenance_logs),
--   ni las cuentas de acceso.
--
--   Fotos: este script no borra los archivos del bucket 'maintenance-photos'.
--   Supabase no deja borrarlos con SQL; se borran desde
--   Storage -> maintenance-photos (seleccionar todo -> Delete).
--
--   Uso: ejecuta primero solo el PASO 0 para ver cuanto se borra; luego el
--   archivo completo. El borrado es un solo bloque: si algo falla,
--   no se borra nada.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Cuanto se borra (solo consulta, no modifica nada)
-- ---------------------------------------------------------------------------
select
  count(*)                                         as total_reportes,
  count(*) filter (where status = 'Abierto')       as abiertos,
  count(*) filter (where status = 'En proceso')    as en_proceso,
  count(*) filter (where status = 'Resuelto')      as resueltos,
  count(*) filter (where photo_path is not null)   as con_foto
from public.maintenance_reports;


-- ---------------------------------------------------------------------------
-- PASO 1 · Borrado (una sola transaccion)
-- ---------------------------------------------------------------------------
do $$
declare
  v_reports integer;
begin
  delete from public.maintenance_reports;
  get diagnostics v_reports = row_count;

  -- Rastro en la bitacora
  insert into public.audit_log (actor_id, actor_name, action, entity, summary)
  values (auth.uid(), 'SQL Editor', 'maintenance_reset', 'maintenance_reports',
          'Borrado masivo: ' || v_reports || ' reportes de mantenimiento');

  raise notice 'Borrados: % reportes de mantenimiento', v_reports;
end $$;


-- ---------------------------------------------------------------------------
-- PASO 2 · Verificacion: debe quedar en cero
-- ---------------------------------------------------------------------------
select count(*) as quedan_reportes from public.maintenance_reports;
