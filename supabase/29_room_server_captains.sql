-- CEPEV ? 29_room_server_captains.sql
-- Run after 28_cepevista_classification.sql (and 17_lodging_rooms.sql).
-- Direct selection of Administration users with role servidor. Keeps a single
-- internal people identity so captain beds, stays, transfers and history retain
-- their existing rules. No login role or module permission is changed.
begin;

alter table public.people add column if not exists captain_user_id uuid
  references public.profiles(id) on delete restrict;
create unique index if not exists people_captain_user_unique
  on public.people(captain_user_id) where captain_user_id is not null;
-- Only an explicitly linked account may omit the unknown birth date.
alter table public.people alter column birth_date drop not null;
alter table public.people drop constraint if exists people_birth_date_or_captain_user;
alter table public.people add constraint people_birth_date_or_captain_user
  check (birth_date is not null or captain_user_id is not null);
comment on column public.people.captain_user_id is
  'Internal lodging identity for a servidor selected directly from Administration. Account deletion is restricted to preserve lodging history.';

create or replace function public.room_captain_candidates()
returns table (id text, person_id uuid, user_id uuid, full_name text,
               sex public.sex_group, phone text, kind text)
language plpgsql stable security definer
set search_path = public
as $fn$
begin
  perform public.assert_can_write();
  return query
    select p.id::text, p.id, null::uuid, p.full_name, p.sex, p.phone, p.kind::text
      from public.people p
     where p.kind::text in ('Cepevista', 'Colportor') and p.captain_user_id is null
    union all
    select coalesce(p.id::text, 'user:' || u.id::text), p.id, u.id,
           u.full_name, p.sex, p.phone, 'Servidor'::text
      from public.profiles u left join public.people p on p.captain_user_id = u.id
     where u.role::text = 'servidor'
        or exists (select 1 from public.rooms r where r.captain_id = p.id)
    order by full_name;
end;
$fn$;

-- Keep the room display and audit identity in sync when Administration renames a user.
create or replace function public.sync_room_captain_name()
returns trigger language plpgsql security definer set search_path = public
as $fn$
begin
  update public.people set full_name = new.full_name, updated_at = now()
   where captain_user_id = new.id;
  return new;
end;
$fn$;
drop trigger if exists sync_room_captain_name on public.profiles;
create trigger sync_room_captain_name after update of full_name on public.profiles
  for each row execute function public.sync_room_captain_name();

-- Replace the old RPC signature so PostgREST cannot choose an ambiguous overload.
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
  p_old_captain_end   date    default null,
  p_captain_user      uuid    default null
)
returns public.rooms
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_user        public.profiles%rowtype;
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

  -- Administration users have no section or birth date. The selected room
  -- supplies the section; no invented birth date or separate registration.
  if p_captain_user is not null then
    if p_captain is not null then
      raise exception 'Elige una persona o un usuario servidor, no ambos.' using errcode = 'P0001';
    end if;
    select * into v_user from public.profiles where id = p_captain_user for update;
    if not found then
      raise exception 'El usuario servidor ya no existe.' using errcode = 'P0001';
    end if;
    select * into v_captain from public.people where captain_user_id = p_captain_user;
    if v_user.role::text <> 'servidor' and not exists (
      select 1 from public.rooms where id = p_id and captain_id = v_captain.id
    ) then
      raise exception 'El usuario seleccionado ya no tiene el rol servidor.' using errcode = 'P0001';
    end if;
    if v_captain.id is null then
      insert into public.people (full_name, sex, birth_date, kind, captain_user_id)
      values (v_user.full_name, p_sex, null, 'Residente', p_captain_user)
      returning * into v_captain;
    end if;
    p_captain := v_captain.id;
  end if;

  if p_captain is null then
    raise exception 'Elige el capitan o capitana del dormitorio.' using errcode = 'P0001';
  end if;

  select * into v_captain from public.people where id = p_captain;
  if not found then
    raise exception 'El capitan seleccionado no existe.' using errcode = 'P0001';
  end if;
  if v_captain.captain_user_id is not null then
    -- Lock the same account for calls using a person ID as well.
    select * into v_user from public.profiles where id = v_captain.captain_user_id for update;
    if v_user.role::text <> 'servidor' and not exists (
      select 1 from public.rooms where id = p_id and captain_id = p_captain
    ) then
      raise exception 'El usuario seleccionado ya no tiene el rol servidor.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.rooms where captain_id = p_captain and id is distinct from p_id) then
      raise exception 'El servidor ya es capitan de otro dormitorio.' using errcode = 'P0001';
    end if;
  elsif v_captain.kind::text not in ('Cepevista', 'Colportor') then
    raise exception '% no es cepevista, colportor ni usuario servidor.', v_captain.full_name
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

  if v_captain.captain_user_id is not null then
    update public.people set phone = v_phone, updated_at = now() where id = p_captain;
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

revoke all on function public.room_captain_candidates() from public, anon;
grant execute on function public.room_captain_candidates() to authenticated;
revoke all on function public.sync_room_captain_name() from public, anon, authenticated;
revoke all on function public.room_upsert(uuid, text, public.sex_group, integer, uuid, text, text, boolean, text, date, uuid) from public, anon;
grant execute on function public.room_upsert(uuid, text, public.sex_group, integer, uuid, text, text, boolean, text, date, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
