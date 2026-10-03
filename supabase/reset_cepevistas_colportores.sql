-- ============================================================================
-- CEPEV · reset_cepevistas_colportores.sql · Borra cepevistas y colportores
--
--   >>> IRREVERSIBLE. LEE ESTO ANTES DE EJECUTAR <<<
--   Haz una copia de seguridad antes (Supabase -> Database -> Backups).
--
--   Borra SOLO las personas de tipo Cepevista y Colportor. Residentes,
--   logistica, conductores, llegadas y administrativos NO se tocan.
--
--   Ademas de las fichas, se borra lo que depende de ellas:
--     stays (y stay_children)  -> sus estadias       (bloquean: se borran antes)
--     trips                    -> recorridos donde son conductores (bloquean)
--     sales_reports            -> reportes de colportaje   (cascada)
--     kitchen_shifts           -> turnos de cocina         (cascada)
--     laundry_assignments      -> turnos de lavanderia     (cascada)
--     payment_accounts         -> cuentas y cuotas de pago (cascada)
--   Quedan, sin la persona:
--     payments                 -> el pago conserva el nombre de quien pago
--     vehicles                 -> pierden conductor o dueno asignado
--     rooms                    -> pierden el capitan
--
--   NO se tocan: profiles ni auth.users (las cuentas de acceso), teams,
--   rotations, rooms, beds, vehicles, areas ni reportes de mantenimiento.
--
--   Uso: ejecuta primero solo el PASO 0 para ver cuanto se borra; luego el
--   archivo completo. El borrado es un solo bloque: si algo falla,
--   no se borra nada.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASO 0 · Cuanto se borra (solo consulta, no modifica nada)
-- ---------------------------------------------------------------------------
with target as (
  select id from public.people where kind::text in ('Cepevista', 'Colportor')
)
select
  (select count(*) from public.people where kind::text = 'Cepevista')                as cepevistas,
  (select count(*) from public.people where kind::text = 'Colportor')                as colportores,
  (select count(*) from public.stays s where s.person_id in (select id from target))  as estadias,
  (select count(*) from public.trips t where t.driver_id in (select id from target))  as recorridos,
  (select count(*) from public.sales_reports r where r.person_id in (select id from target)) as reportes_colportaje,
  (select count(*) from public.payment_accounts a where a.person_id in (select id from target)) as cuentas_de_pago,
  (select count(*) from public.payments p where p.person_id in (select id from target)) as pagos_que_quedan_sin_persona;


-- ---------------------------------------------------------------------------
-- PASO 1 · Borrado (una sola transaccion)
-- ---------------------------------------------------------------------------
-- Un solo bloque: el SQL Editor lo ejecuta como una sentencia, todo o nada.
do $$
declare
  v_stays  integer;
  v_trips  integer;
  v_people integer;
begin
  -- Lo que bloquea el borrado
  delete from public.stays
   where person_id in (select id from public.people where kind::text in ('Cepevista', 'Colportor'));
  get diagnostics v_stays = row_count;

  delete from public.trips
   where driver_id in (select id from public.people where kind::text in ('Cepevista', 'Colportor'));
  get diagnostics v_trips = row_count;

  -- Las fichas (el resto cae en cascada o queda sin la persona)
  delete from public.people where kind::text in ('Cepevista', 'Colportor');
  get diagnostics v_people = row_count;

  -- Rastro en la bitacora
  insert into public.audit_log (actor_id, actor_name, action, entity, summary)
  values (auth.uid(), 'SQL Editor', 'people_reset', 'people',
          'Borrado masivo: ' || v_people || ' cepevistas y colportores, '
            || v_stays || ' estadias y ' || v_trips || ' recorridos');

  raise notice 'Borrados: % personas, % estadias, % recorridos', v_people, v_stays, v_trips;
end $$;


-- ---------------------------------------------------------------------------
-- PASO 2 · Verificacion: deben quedar en cero
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.people where kind::text in ('Cepevista', 'Colportor')) as quedan_personas,
  (select count(*) from public.payment_accounts)                                     as quedan_cuentas_de_pago;
