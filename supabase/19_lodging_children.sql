-- ============================================================================
-- CEPEV · 19_lodging_children.sql · Niños que duermen con su padre o madre
--
--   Los niños de 5 años o menos no ocupan cama propia: duermen en la cama
--   del adulto que los acompaña. Al asignar la cama se pregunta si la
--   persona trae hijos de esa edad y, si es asi, quedan registrados en la
--   misma estadia (nombre y edad).
--
--   Cambios:
--     stay_children -> NUEVA tabla: niños de una estadia (0 a 5 años)
--     stay_create   -> recibe p_children (lista JSON de {full_name, age}) y
--                      los guarda junto con la reserva, en una sola operacion
--
--   Ejemplo de p_children:
--     [{"full_name": "Sofia Perez", "age": 3}, {"full_name": "Juan Perez", "age": 1}]
--
--   Ejecutar DESPUES de 17_lodging_rooms.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Niños de cada estadia
--    Caen en cascada con la estadia.
-- ---------------------------------------------------------------------------
create table if not exists public.stay_children (
  id         uuid primary key default gen_random_uuid(),
  stay_id    uuid not null references public.stays (id) on delete cascade,
  full_name  text not null,
  age        smallint not null,
  created_at timestamptz not null default now(),
  constraint stay_children_age_ok check (age between 0 and 5),
  constraint stay_children_name_ok check (length(trim(full_name)) > 0)
);

create index if not exists stay_children_stay_idx on public.stay_children (stay_id);

alter table public.stay_children enable row level security;
revoke all on public.stay_children from anon;

drop policy if exists stay_children_read on public.stay_children;
create policy stay_children_read on public.stay_children
  for select to authenticated using (true);

-- Solo se escribe a traves de stay_create
grant select on public.stay_children to authenticated;


-- ---------------------------------------------------------------------------
-- 2) Reservar cama, con los niños que duermen en ella
--    Igual que en 04_functions.sql, mas p_children.
-- ---------------------------------------------------------------------------
drop function if exists public.stay_create(uuid, uuid, date, date, text);

create or replace function public.stay_create(
  p_person   uuid,
  p_bed      uuid,
  p_start    date,
  p_end      date,
  p_notes    text  default null,
  p_children jsonb default null
) returns public.stays
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_person public.people%rowtype;
  v_bed    public.beds%rowtype;
  v_room   public.rooms%rowtype;
  v_row    public.stays%rowtype;
  v_child  jsonb;
  v_name   text;
  v_age    integer;
  v_kids   text[] := '{}';
begin
  perform public.assert_can_write();

  select * into v_person from public.people where id = p_person;
  if not found then raise exception 'Selecciona una persona valida.' using errcode = 'P0001'; end if;

  select * into v_bed from public.beds where id = p_bed;
  if not found then raise exception 'Selecciona una cama valida.' using errcode = 'P0001'; end if;

  select * into v_room from public.rooms where id = v_bed.room_id;

  if p_end <= p_start then
    raise exception 'La salida debe ser posterior a la llegada.' using errcode = 'P0001';
  end if;

  if v_bed.is_blocked then
    raise exception 'La cama esta bloqueada: %', coalesce(v_bed.blocked_reason, 'sin detalle') using errcode = 'P0001';
  end if;

  if v_room.sex <> v_person.sex then
    raise exception 'La habitacion % es de %, no corresponde al registro de la persona.',
      v_room.code, v_room.sex using errcode = 'P0001';
  end if;

  if p_children is not null and jsonb_typeof(p_children) <> 'array' then
    raise exception 'La lista de niños no es valida.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_children, '[]'::jsonb)) > 3 then
    raise exception 'Una cama admite como maximo 3 niños con el adulto.' using errcode = 'P0001';
  end if;

  begin
    insert into public.stays (person_id, bed_id, start_date, end_date, notes, created_by)
    values (p_person, p_bed, p_start, p_end, p_notes, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'La cama o la persona ya tienen una estadia en ese periodo. Confirma primero la salida pendiente.'
      using errcode = 'P0001';
  end;

  for v_child in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_child ->> 'full_name', ''));
    if v_name = '' then
      raise exception 'Indica el nombre de cada niño.' using errcode = 'P0001';
    end if;

    begin
      v_age := (v_child ->> 'age')::integer;
    exception when others then
      v_age := null;
    end;
    if v_age is null or v_age < 0 or v_age > 5 then
      raise exception 'La edad de % debe estar entre 0 y 5 años para dormir con el adulto.', v_name
        using errcode = 'P0001';
    end if;

    insert into public.stay_children (stay_id, full_name, age)
    values (v_row.id, v_name, v_age);
    v_kids := v_kids || (v_name || ' (' || v_age || ')');
  end loop;

  perform public.log_action('stay_create', 'stays', v_row.id,
    'Cama ' || v_room.code || '-' || v_bed.label || ' reservada para ' || v_person.full_name
      || case when cardinality(v_kids) > 0
              then ' con ' || array_to_string(v_kids, ', ') || ' en la misma cama'
              else '' end);
  return v_row;
end;
$fn$;

revoke all on function public.stay_create(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.stay_create(uuid, uuid, date, date, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 3) Verificacion: estadias vigentes con niños
-- ---------------------------------------------------------------------------
select p.full_name as adulto, r.code as dormitorio, b.label as cama,
       string_agg(c.full_name || ' (' || c.age || ')', ', ') as ninos
  from public.stay_children c
  join public.stays s  on s.id = c.stay_id
  join public.people p on p.id = s.person_id
  join public.beds b   on b.id = s.bed_id
  join public.rooms r  on r.id = b.room_id
 where s.status in ('Reservado', 'Alojado')
 group by p.full_name, r.code, b.label
 order by r.code, b.label;
