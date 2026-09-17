-- ============================================================================
-- CEPEV · 05_seed.sql · Datos de ejemplo (opcional)
-- Ejecutalo solo si quieres arrancar con el escenario de demostracion.
-- Es idempotente: si ya hay personas cargadas, no hace nada.
-- ============================================================================

do $$
declare
  v_team_esperanza uuid;
  v_team_camino    uuid;
  v_room           uuid;
  v_bed            uuid;
  v_person         uuid;
  v_sex            public.sex_group;
  v_names          text[] := array['Ana','Luis','Marta','Jose','Elena','David','Sara','Juan','Rosa','Pablo','Lucia','Andres','Pedro','Laura','Felipe','Diana','Carlos','Sofia','Valentina','Daniel','Camila','Mateo','Isabel','Samuel'];
  v_last           text[] := array['Torres','Ramirez','Diaz','Rojas','Mora','Gil','Leon','Perez','Silva','Vera','Ruiz','Nieto','Luna','Castro','Arias','Cruz','Pena','Rios','Gomez','Suarez','Herrera','Moreno','Vargas','Castillo'];
  i integer;
  j integer;
  v_today date := public.cepev_today();
begin
  if exists (select 1 from public.people limit 1) then
    raise notice 'La base ya tiene personas: se omite el seed.';
    return;
  end if;

  ---------------------------------------------------------------------------
  -- Equipos
  ---------------------------------------------------------------------------
  insert into public.teams (name) values ('Esperanza')
    on conflict (name) do update set is_active = true
    returning id into v_team_esperanza;

  insert into public.teams (name) values ('Camino')
    on conflict (name) do update set is_active = true
    returning id into v_team_camino;

  ---------------------------------------------------------------------------
  -- Habitaciones y camas: 70 habitaciones x 6 camas = 420
  ---------------------------------------------------------------------------
  for i in 1..70 loop
    v_sex := (case when i % 2 = 0 then 'Hombres' else 'Mujeres' end)::public.sex_group;
    insert into public.rooms (code, building, sex)
    values (
      case when i <= 35 then 'A-' else 'B-' end || (100 + case when i <= 35 then i else i - 35 end),
      case when i <= 35 then 'A' else 'B' end,
      v_sex
    ) returning id into v_room;

    for j in 1..6 loop
      insert into public.beds (room_id, label, is_blocked, blocked_reason)
      values (v_room, lpad(j::text, 2, '0'), (i = 70 and j >= 3),
              case when (i = 70 and j >= 3) then 'Mantenimiento de colchones' end);
    end loop;
  end loop;

  ---------------------------------------------------------------------------
  -- Personal logistico y conductores (18)
  ---------------------------------------------------------------------------
  for i in 1..18 loop
    insert into public.people (full_name, sex, birth_date, phone, kind, is_available)
    values (
      v_names[i] || ' ' || v_last[i],
      (case when i % 2 = 0 then 'Hombres' else 'Mujeres' end)::public.sex_group,
      date '1992-04-12' - (i * 40),
      '30000' || lpad(i::text, 5, '0'),
      (case when i in (8, 12, 17) then 'Conductor' else 'Logistica' end)::public.person_kind,
      true
    );
  end loop;

  ---------------------------------------------------------------------------
  -- Residentes (336) con cama asignada
  ---------------------------------------------------------------------------
  for i in 1..336 loop
    v_sex := (case when (i / 6) % 2 = 0 then 'Mujeres' else 'Hombres' end)::public.sex_group;

    insert into public.people (full_name, sex, birth_date, kind)
    values (
      v_names[1 + (i % 24)] || ' ' || v_last[1 + ((i / 6) % 24)] || ' ' || lpad(i::text, 3, '0'),
      v_sex, date '1999-06-15' - (i * 3), 'Residente'
    ) returning id into v_person;

    select b.id into v_bed
      from public.beds b
      join public.rooms r on r.id = b.room_id
     where r.sex = v_sex
       and not b.is_blocked
       and not exists (select 1 from public.stays s
                        where s.bed_id = b.id and s.status in ('Reservado', 'Alojado'))
     order by r.code, b.label
     limit 1;

    exit when v_bed is null;

    insert into public.stays (person_id, bed_id, start_date, end_date, status, checked_in_at)
    values (v_person, v_bed, v_today - 10, v_today + 20, 'Alojado', now() - interval '10 days');
  end loop;

  ---------------------------------------------------------------------------
  -- Llegadas sin cama asignada
  ---------------------------------------------------------------------------
  insert into public.people (full_name, sex, birth_date, phone, kind) values
    ('Mariana Gomez',  'Mujeres', date '2000-03-19', '3000000099', 'Llegada'),
    ('Santiago Ruiz',  'Hombres', date '1995-11-02', '3000000098', 'Llegada');

  ---------------------------------------------------------------------------
  -- Colportores (12) con meta diaria
  ---------------------------------------------------------------------------
  for i in 1..12 loop
    insert into public.people (full_name, sex, birth_date, phone, base_city, kind, team_id, daily_goal)
    values (
      v_names[i] || ' ' || v_last[25 - i],
      (case when i % 2 = 0 then 'Hombres' else 'Mujeres' end)::public.sex_group,
      date '1997-05-22' - (i * 60),
      '30010' || lpad(i::text, 5, '0'),
      case when i <= 6 then 'Bucaramanga' when i <= 10 then 'Cucuta' else 'Piedecuesta' end,
      'Colportor',
      case when i <= 6 then v_team_esperanza when i <= 10 then v_team_camino else null end,
      10
    );
  end loop;

  ---------------------------------------------------------------------------
  -- Rotaciones vigentes
  ---------------------------------------------------------------------------
  insert into public.rotations (team_id, city, start_date, end_date) values
    (v_team_esperanza, 'Bucaramanga', v_today - 9, v_today + 11),
    (v_team_camino,    'Cucuta',      v_today - 9, v_today + 21);

  ---------------------------------------------------------------------------
  -- Vehiculos
  ---------------------------------------------------------------------------
  insert into public.vehicles (name, plate, current_city, status, odometer_km, capacity, next_service_date, next_service_km) values
    ('Van 01',        'DEMO-101', 'Piedecuesta',  'Disponible',         82450, 12, v_today + 1,  90000),
    ('Van 02',        'DEMO-102', 'Bucaramanga',  'Disponible',         83950, 12, v_today + 35, 91500),
    ('Van 03',        'DEMO-103', 'Piedecuesta',  'Mantenimiento',      85450, 12, v_today,      85000),
    ('Bus 01',        'DEMO-104', 'Piedecuesta',  'Disponible',         86950, 40, v_today + 35, 94500),
    ('Camioneta 01',  'DEMO-105', 'Piedecuesta',  'Disponible',         88450, 12, v_today + 35, 96000),
    ('Van 04',        'DEMO-106', 'Piedecuesta',  'Disponible',         89950, 12, v_today + 35, 97500),
    ('Bus 02',        'DEMO-107', 'Piedecuesta',  'Disponible',         91450, 40, v_today + 35, 99000);

  insert into public.maintenance_logs (vehicle_id, detail, cost_cop)
  select id, 'Revision de frenos en taller', 280000 from public.vehicles where plate = 'DEMO-103';

  ---------------------------------------------------------------------------
  -- Reportes de colportaje de los ultimos 4 dias
  ---------------------------------------------------------------------------
  for i in 1..4 loop
    insert into public.sales_reports (person_id, report_date, books_sold, city, team_id)
    select p.id, v_today - i, 6 + ((row_number() over (order by p.full_name)) % 5)::int,
           public.person_city_on(p.id, v_today - i), p.team_id
      from public.people p
     where p.kind = 'Colportor';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Turnos de cocina para la semana en curso (18 puestos por dia)
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

-- Cubre parcialmente el dia de hoy para que el panel muestre pendientes reales
with candidatos as (
  select id, row_number() over (order by full_name) as rn
    from public.people where kind in ('Logistica', 'Conductor')
), puestos as (
  select id, row_number() over (order by meal, task, position_index) as rn
    from public.kitchen_shifts
   where service_date = public.cepev_today()
)
update public.kitchen_shifts k
   set person_id = c.id
  from puestos p join candidatos c on c.rn = p.rn
 where k.id = p.id and p.rn <= 13;
