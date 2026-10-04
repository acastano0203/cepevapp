-- ============================================================================
-- CEPEV · 17_lodging_rooms.sql · Dormitorios, camarotes y capitan desde la app
--
--   Antes: las habitaciones y sus camas solo existian por el seed
--          (70 habitaciones x 6 camas) y no se podian crear ni editar.
--
--   Ahora: el modulo de Alojamientos crea, edita y elimina dormitorios. Se
--          indica el nombre, la seccion (Mujeres u Hombres), el numero de
--          camarotes y el capitan o capitana que queda a cargo: un cepevista
--          o colportor de la misma seccion, con su WhatsApp.
--
--   Camarotes: cada camarote tiene dos camas, inferior y superior. Las camas
--   se numeran solas: 01 inferior y 02 superior (camarote 1), 03 inferior y
--   04 superior (camarote 2)... La 01 queda por defecto para el capitan.
--
--   Cambios:
--     beds            -> level: 'Inferior' o 'Superior'
--     rooms           -> captain_id (cepevista o colportor), captain_phone,
--                        captain_bed_id
--     v_beds_status   -> disponibilidad 'Capitan', datos del capitan y nivel
--     room_upsert     -> NUEVA: crea o actualiza el dormitorio, ajusta sus
--                        camarotes y fija la cama del capitan
--     room_delete     -> NUEVA: borrado protegido (las estadias son historial)
--     stays           -> trigger: la cama del capitan no se puede reservar
--
--   Reglas al editar:
--     - Subir el numero de camarotes agrega camarotes nuevos al final.
--     - Bajarlo retira los ultimos camarotes completos, solo si sus dos camas
--       nunca tuvieron estadias y ninguna es la del capitan.
--     - La seccion no se puede cambiar con personas alojadas o reservadas.
--     - La cama del capitan debe estar libre de reservas vigentes.
--     - El capitan es un cepevista o colportor de la misma seccion.
--
--   Cambio de capitan (una sola operacion):
--     - El nuevo capitan deja su cama anterior: su reserva vigente se cierra
--       (Finalizado si ya habia llegado, Cancelado si aun no) y esa cama
--       queda libre. Asi nunca queda ocupando dos camas.
--     - El capitan anterior deja el dormitorio o se queda en una cama del
--       mismo dormitorio (por defecto, la que libero el nuevo capitan), con
--       una estadia 'Alojado' desde hoy.
--
--   Ejecutar DESPUES de 16_kitchen_limits.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Nivel de cada cama dentro del camarote
--    Las camas que ya existian toman el nivel por su numero: impar inferior,
--    par superior.
-- ---------------------------------------------------------------------------
alter table public.beds add column if not exists level text;

update public.beds
   set level = case
                 when label ~ '^\d+$' and label::integer % 2 = 0 then 'Superior'
                 else 'Inferior'
               end
 where level is null;

alter table public.beds alter column level set default 'Inferior';
alter table public.beds alter column level set not null;
alter table public.beds drop constraint if exists beds_level_ok;
alter table public.beds add constraint beds_level_ok check (level in ('Inferior', 'Superior'));


-- ---------------------------------------------------------------------------
-- 2) Capitan del dormitorio
--   captain_id apunta a la ficha del cepevista o colportor; el nombre sale
--   de ahi. captain_phone es el WhatsApp de contacto (se precarga con el
--   telefono de la ficha y se puede corregir).
-- ---------------------------------------------------------------------------
alter table public.rooms add column if not exists captain_id     uuid
  references public.people (id) on delete set null;
alter table public.rooms add column if not exists captain_phone  text;
alter table public.rooms add column if not exists captain_bed_id uuid
  references public.beds (id) on delete set null;


-- ---------------------------------------------------------------------------
-- 3) Estado de cada cama: la del capitan aparece como 'Capitan'
--    Las columnas nuevas van al final para poder reemplazar la vista.
--    El nombre del capitan se toma de su ficha en people.
-- ---------------------------------------------------------------------------
create or replace view public.v_beds_status
with (security_invoker = on) as
select
  b.id                as bed_id,
  b.label             as bed_label,
  b.is_blocked,
  b.blocked_reason,
  r.id                as room_id,
  r.code              as room_code,
  r.building,
  r.sex,
  s.id                as stay_id,
  s.status            as stay_status,
  s.start_date,
  s.end_date,
  p.id                as person_id,
  p.full_name         as person_name,
  case
    when b.is_blocked then 'Bloqueada'
    when r.captain_bed_id = b.id then 'Capitan'
    when s.id is not null then 'Ocupada'
    else 'Libre'
  end as availability,
  cp.full_name        as captain_name,
  r.captain_phone,
  coalesce(r.captain_bed_id = b.id, false) as is_captain_bed,
  r.captain_id,
  b.level             as bed_level
from public.beds b
join public.rooms r on r.id = b.room_id
left join public.people cp on cp.id = r.captain_id
left join public.stays s
  on s.bed_id = b.id
 and s.status in ('Reservado', 'Alojado')
 and public.cepev_today() >= s.start_date
 and public.cepev_today() <  s.end_date
left join public.people p on p.id = s.person_id;

grant select on public.v_beds_status to authenticated;

-- Una version anterior de este script guardaba el nombre como texto libre
alter table public.rooms drop column if exists captain_name;


-- ---------------------------------------------------------------------------
-- 4) La cama del capitan no admite reservas
-- ---------------------------------------------------------------------------
create or replace function public.stays_guard_captain_bed()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_code    text;
  v_captain text;
begin
  if new.status in ('Reservado', 'Alojado') then
    select r.code, p.full_name into v_code, v_captain
      from public.rooms r
      left join public.people p on p.id = r.captain_id
     where r.captain_bed_id = new.bed_id;
    if found then
      raise exception 'Esa cama de % esta reservada para el capitan (%).',
        v_code, coalesce(v_captain, 'sin asignar') using errcode = 'P0001';
    end if;

    -- Un capitan ya tiene su cama: no puede ocupar otra
    select r.code, p.full_name into v_code, v_captain
      from public.rooms r
      join public.people p on p.id = r.captain_id
     where r.captain_id = new.person_id;
    if found then
      raise exception '% es capitan de % y ya tiene su cama ahi. Cambia primero el capitan de ese dormitorio.',
        v_captain, v_code using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists stays_guard_captain_bed on public.stays;
create trigger stays_guard_captain_bed
  before insert or update of bed_id, status on public.stays
  for each row execute function public.stays_guard_captain_bed();


-- ---------------------------------------------------------------------------
-- 5) Crear o actualizar un dormitorio
--    p_id null = alta. p_bunks es el numero de camarotes (2 camas cada uno).
--    p_captain_bed es la etiqueta de la cama del capitan ('01' por defecto).
--    Al cambiar de capitan:
--      p_old_captain_stays  true = el capitan anterior se queda en el cuarto
--      p_old_captain_bed    etiqueta de la cama donde se queda
--      p_old_captain_end    salida tentativa de esa estadia
-- ---------------------------------------------------------------------------
drop function if exists public.room_upsert(uuid, text, public.sex_group, integer);
drop function if exists public.room_upsert(uuid, text, public.sex_group, integer, text, text, text);
drop function if exists public.room_upsert(uuid, text, public.sex_group, integer, uuid, text, text);
drop function if exists public.room_upsert(uuid, text, public.sex_group, integer, uuid, text, text, boolean, text, date);

create or replace function public.room_upsert(
  p_id                uuid,
  p_code              text,
  p_sex               public.sex_group,
  p_bunks             integer,
  p_captain           uuid,
  p_captain_phone     text,
  p_captain_bed       text    default '01',
  p_old_captain_stays boolean default false,
  p_old_captain_bed   text    default null,
  p_old_captain_end   date    default null
)
returns public.rooms
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row         public.rooms%rowtype;
  v_code        text;
  v_captain     public.people%rowtype;
  v_phone       text;
  v_captain_bed text := coalesce(nullif(trim(p_captain_bed), ''), '01');
  v_bed         uuid;
  v_target      integer;
  v_last        integer;
  v_active      integer;
  v_blocking    text;
  v_old_captain public.people%rowtype;
  v_changed     boolean := false;
  v_stay        public.stays%rowtype;
  v_freed_bed   uuid;
  v_freed_end   date;
  v_old_bed     public.beds%rowtype;
  v_old_end     date;
  v_today       date := public.cepev_today();
  v_note        text := '';
begin
  perform public.assert_can_write();

  v_code := trim(coalesce(p_code, ''));
  if v_code = '' then
    raise exception 'Indica el nombre del dormitorio.' using errcode = 'P0001';
  end if;

  if p_sex is null then
    raise exception 'Indica si el dormitorio es de Mujeres o de Hombres.' using errcode = 'P0001';
  end if;

  if p_bunks is null or p_bunks < 1 then
    raise exception 'El dormitorio debe tener al menos un camarote.' using errcode = 'P0001';
  end if;
  if p_bunks > 50 then
    raise exception 'Un dormitorio no puede tener mas de 50 camarotes.' using errcode = 'P0001';
  end if;
  v_target := p_bunks * 2;

  if p_captain is null then
    raise exception 'Elige el capitan o capitana del dormitorio.' using errcode = 'P0001';
  end if;

  select * into v_captain from public.people where id = p_captain;
  if not found then
    raise exception 'El capitan seleccionado no existe.' using errcode = 'P0001';
  end if;
  if v_captain.kind::text not in ('Cepevista', 'Colportor') then
    raise exception '% no es cepevista ni colportor; el capitan debe ser uno de ellos.', v_captain.full_name
      using errcode = 'P0001';
  end if;
  if v_captain.sex <> p_sex then
    raise exception '% es de la seccion %; el dormitorio es de %.', v_captain.full_name, v_captain.sex, p_sex
      using errcode = 'P0001';
  end if;

  -- Sin WhatsApp propio se usa el telefono de la ficha
  v_phone := regexp_replace(coalesce(nullif(trim(p_captain_phone), ''), v_captain.phone, ''), '\D', '', 'g');
  if length(v_phone) < 7 or length(v_phone) > 15 then
    raise exception 'El WhatsApp del capitan debe tener entre 7 y 15 digitos.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.rooms where lower(code) = lower(v_code) and id is distinct from p_id) then
    raise exception 'Ya existe un dormitorio llamado %.', v_code using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.rooms (code, sex, captain_id, captain_phone)
    values (v_code, p_sex, p_captain, v_phone)
    returning * into v_row;

    insert into public.beds (room_id, label, level)
    select v_row.id, lpad(n::text, 2, '0'), case when n % 2 = 0 then 'Superior' else 'Inferior' end
      from generate_series(1, v_target) as n;

  else
    select * into v_row from public.rooms where id = p_id for update;
    if not found then
      raise exception 'El dormitorio no existe o ya fue eliminado.' using errcode = 'P0001';
    end if;

    if v_row.captain_id is distinct from p_captain then
      v_changed := true;
      if v_row.captain_id is not null then
        select * into v_old_captain from public.people where id = v_row.captain_id;
      end if;
    end if;

    -- Cambio de seccion: no puede dejar a nadie en la seccion equivocada
    if v_row.sex <> p_sex then
      select count(*) into v_active
        from public.stays s join public.beds b on b.id = s.bed_id
       where b.room_id = p_id and s.status in ('Reservado', 'Alojado');
      if v_active > 0 then
        raise exception 'No se puede cambiar % a %: tiene % estadia(s) vigentes o reservadas.',
          v_row.code, p_sex, v_active using errcode = 'P0001';
      end if;
    end if;

    update public.rooms
       set code = v_code, sex = p_sex, captain_id = p_captain, captain_phone = v_phone
     where id = p_id
    returning * into v_row;

    select coalesce(max(case when label ~ '^\d+$' then label::integer end), 0)
      into v_last
      from public.beds where room_id = p_id;

    if v_target > v_last then
      -- Camarotes nuevos al final de la numeracion
      insert into public.beds (room_id, label, level)
      select p_id, lpad(n::text, 2, '0'), case when n % 2 = 0 then 'Superior' else 'Inferior' end
        from generate_series(v_last + 1, v_target) as n;

    elsif v_target < v_last then
      -- Se retiran los ultimos camarotes completos: todas las camas por
      -- encima del nuevo total, siempre que ninguna tenga historial ni sea
      -- la del capitan.
      select string_agg(b.label, ', ' order by b.label) into v_blocking
        from public.beds b
       where b.room_id = p_id
         and b.label ~ '^\d+$' and b.label::integer > v_target
         and (b.label = v_captain_bed
              or exists (select 1 from public.stays s where s.bed_id = b.id));

      if v_blocking is not null then
        raise exception 'No se pueden retirar esos camarotes de %: las camas % tienen estadias registradas o son la del capitan.',
          v_code, v_blocking using errcode = 'P0001';
      end if;

      delete from public.beds b
       where b.room_id = p_id
         and b.label ~ '^\d+$' and b.label::integer > v_target;
    end if;
  end if;

  -- El nuevo capitan no puede quedar en dos camas: se cierra su reserva vigente
  for v_stay in
    select * from public.stays
     where person_id = p_captain
       and status in ('Reservado', 'Alojado')
       and end_date > v_today
  loop
    if v_stay.status = 'Reservado' and v_stay.start_date > v_today then
      update public.stays set status = 'Cancelado', updated_at = now() where id = v_stay.id;
    else
      update public.stays
         set status = 'Finalizado',
             checked_out_at = now(),
             end_date = greatest(v_today, start_date + 1),
             updated_at = now()
       where id = v_stay.id;
    end if;

    -- Si la cama liberada es de este cuarto, queda disponible para el capitan anterior
    if exists (select 1 from public.beds where id = v_stay.bed_id and room_id = v_row.id) then
      v_freed_bed := v_stay.bed_id;
      v_freed_end := v_stay.end_date;
    end if;
    v_note := v_note || '; ' || v_captain.full_name || ' deja su cama anterior';
  end loop;

  -- Cama del capitan
  select id into v_bed
    from public.beds
   where room_id = v_row.id and label = v_captain_bed;
  if v_bed is null then
    raise exception 'La cama % no existe en %.', v_captain_bed, v_code using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.stays
     where bed_id = v_bed and status in ('Reservado', 'Alojado')
  ) then
    raise exception 'La cama % de % tiene una reserva vigente; elige otra para el capitan.',
      v_captain_bed, v_code using errcode = 'P0001';
  end if;

  update public.rooms set captain_bed_id = v_bed where id = v_row.id
  returning * into v_row;

  -- Capitan anterior
  if v_changed and v_old_captain.id is not null then
    if coalesce(p_old_captain_stays, false) then
      if v_old_captain.sex <> p_sex then
        raise exception '% es de la seccion %; no puede quedarse en un dormitorio de %.',
          v_old_captain.full_name, v_old_captain.sex, p_sex using errcode = 'P0001';
      end if;

      select * into v_old_bed
        from public.beds
       where room_id = v_row.id
         and label = coalesce(nullif(trim(p_old_captain_bed), ''),
                              (select label from public.beds where id = v_freed_bed));
      if not found then
        raise exception 'Elige la cama donde se queda %.', v_old_captain.full_name using errcode = 'P0001';
      end if;
      if v_old_bed.id = v_bed then
        raise exception 'La cama % es la del nuevo capitan; elige otra para %.', v_old_bed.label, v_old_captain.full_name
          using errcode = 'P0001';
      end if;
      if v_old_bed.is_blocked then
        raise exception 'La cama % esta bloqueada.', v_old_bed.label using errcode = 'P0001';
      end if;

      v_old_end := coalesce(p_old_captain_end, v_freed_end, v_today + 30);
      if v_old_end <= v_today then
        raise exception 'La salida de % debe ser posterior a hoy.', v_old_captain.full_name using errcode = 'P0001';
      end if;

      begin
        insert into public.stays (person_id, bed_id, start_date, end_date, status, checked_in_at, created_by, notes)
        values (v_old_captain.id, v_old_bed.id, v_today, v_old_end, 'Alojado', now(), auth.uid(),
                'Deja de ser capitan de ' || v_code)
        returning * into v_stay;
      exception when exclusion_violation then
        raise exception 'La cama % ya esta ocupada en esas fechas o % ya tiene otra estadia.',
          v_old_bed.label, v_old_captain.full_name using errcode = 'P0001';
      end;

      v_note := v_note || '; ' || v_old_captain.full_name || ' se queda en la cama ' || v_old_bed.label;
    else
      v_note := v_note || '; ' || v_old_captain.full_name || ' deja el dormitorio';
    end if;
  end if;

  perform public.log_action(
    case when p_id is null then 'room_create' else 'room_update' end, 'rooms', v_row.id,
    case when p_id is null then 'Dormitorio creado: ' else 'Dormitorio actualizado: ' end
      || v_code || ' (' || p_sex || ', ' || p_bunks || ' camarotes, capitan ' || v_captain.full_name || ')'
      || v_note);
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 6) Borrado protegido
--    Las estadias vigentes o reservadas lo impiden siempre. Las finalizadas
--    son historial: lo impiden salvo p_force (solo admin), que las arrastra.
--    Las camas caen en cascada con el dormitorio.
-- ---------------------------------------------------------------------------
create or replace function public.room_delete(p_id uuid, p_force boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row     public.rooms%rowtype;
  v_beds    integer;
  v_stays   integer;
  v_active  integer;
begin
  perform public.assert_can_write();

  select * into v_row from public.rooms where id = p_id;
  if not found then
    raise exception 'El dormitorio no existe o ya fue eliminado.' using errcode = 'P0001';
  end if;

  select count(*) into v_beds from public.beds where room_id = p_id;

  select count(*), count(*) filter (where s.status in ('Reservado', 'Alojado'))
    into v_stays, v_active
    from public.stays s join public.beds b on b.id = s.bed_id
   where b.room_id = p_id;

  if v_active > 0 then
    raise exception '% tiene % estadia(s) vigentes o reservadas. Confirma las salidas antes de eliminarlo.',
      v_row.code, v_active using errcode = 'P0001';
  end if;

  if v_stays > 0 and not coalesce(p_force, false) then
    raise exception 'No se puede eliminar % porque tiene % estadia(s) en su historial.',
      v_row.code, v_stays using errcode = 'P0001';
  end if;

  if coalesce(p_force, false) and not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar un dormitorio con historial.' using errcode = 'P0001';
  end if;

  -- stays -> beds es restrict; beds -> rooms es cascade.
  delete from public.stays s using public.beds b where b.id = s.bed_id and b.room_id = p_id;
  delete from public.rooms where id = p_id;

  perform public.log_action(
    'room_delete', 'rooms', p_id,
    'Dormitorio eliminado: ' || v_row.code,
    jsonb_build_object('camas', v_beds, 'estadias', v_stays, 'forzado', coalesce(p_force, false))
  );
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 7) Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'room_upsert(uuid,text,public.sex_group,integer,uuid,text,text,boolean,text,date)',
    'room_delete(uuid,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 8) Verificacion: dormitorios, camarotes y capitan
-- ---------------------------------------------------------------------------
select r.code as dormitorio, r.sex as seccion,
       count(b.id) as camas,
       count(b.id) filter (where b.level = 'Inferior') as inferiores,
       count(b.id) filter (where b.level = 'Superior') as superiores,
       cp.full_name as capitan, r.captain_phone as whatsapp,
       (select label from public.beds where id = r.captain_bed_id) as cama_capitan
  from public.rooms r
  left join public.beds b on b.room_id = r.id
  left join public.people cp on cp.id = r.captain_id
 group by r.id, cp.full_name
 order by r.code;
