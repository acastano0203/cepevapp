-- ============================================================================
-- CEPEV · reset_equipos_rotaciones.sql · Deja colportaje sin equipos
--
--   >>> IRREVERSIBLE. LEE ESTO ANTES DE EJECUTAR <<<
--   Haz una copia de seguridad antes (Supabase -> Database -> Backups).
--
--   LISTO PARA EJECUTAR TAL CUAL. Al terminar deja:
--     - teams vacia       (ningun equipo)
--     - rotations vacia   (ninguna rotacion, ni historica ni futura)
--     - colportores sin equipo asignado (people.team_id = null)
--
--   Se conserva, sin el equipo:
--     sales_reports  -> los reportes quedan; antes de borrar se guarda el
--                       nombre del equipo en team_name_snapshot para que el
--                       historial lo siga mostrando
--   Efecto secundario:
--     laundry_publications -> el trigger de rotaciones quita las
--                       publicaciones de lavanderia futuras de esos equipos;
--                       hay que volver a publicar la lavanderia
--
--   NO se tocan: personas, cocina, alojamientos, vehiculos, pagos ni
--   mantenimiento.
--
--   Para volver a armar los equipos usa la aplicacion (Colportores -> pestana
--   de equipos: primero el equipo, luego sus rotaciones).
--
--   Uso: ejecuta primero solo el PASO 0 para ver cuanto se borra; luego el
--   archivo completo. El borrado es un solo bloque: si algo falla,
--   no se borra nada.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Cuanto se borra (solo consulta, no modifica nada)
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.teams)                                   as equipos,
  (select count(*) from public.rotations)                               as rotaciones,
  (select count(*) from public.people where team_id is not null)        as personas_con_equipo,
  (select count(*) from public.sales_reports where team_id is not null) as reportes_con_equipo;


-- ---------------------------------------------------------------------------
-- PASO 1 · Borrado (una sola transaccion)
-- ---------------------------------------------------------------------------
-- Un solo bloque: el SQL Editor lo ejecuta como una sentencia, todo o nada.
do $$
declare
  v_people integer;
  v_rot    integer;
  v_teams  integer;
begin
  -- Congelar el nombre del equipo en los reportes historicos
  update public.sales_reports s
     set team_name_snapshot = coalesce(t.name, 'Sin equipo')
    from public.teams t
   where s.team_id = t.id and s.team_name_snapshot is null;

  -- Soltar a las personas de su equipo
  update public.people set team_id = null where team_id is not null;
  get diagnostics v_people = row_count;

  delete from public.rotations;
  get diagnostics v_rot = row_count;

  -- sales_reports.team_id queda en null (on delete set null)
  delete from public.teams;
  get diagnostics v_teams = row_count;

  -- Rastro en la bitacora
  insert into public.audit_log (actor_id, actor_name, action, entity, summary)
  values (auth.uid(), 'SQL Editor', 'teams_reset', 'teams',
          'Borrado masivo: ' || v_teams || ' equipos, ' || v_rot
            || ' rotaciones y ' || v_people || ' personas sin equipo');

  raise notice 'Borrados: % equipos, % rotaciones; % personas sin equipo',
    v_teams, v_rot, v_people;
end $$;


-- ---------------------------------------------------------------------------
-- PASO 2 · Verificacion: deben quedar en cero
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.teams)                            as quedan_equipos,
  (select count(*) from public.rotations)                        as quedan_rotaciones,
  (select count(*) from public.people where team_id is not null) as quedan_personas_con_equipo;
