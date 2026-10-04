-- ============================================================================
-- CEPEV · 20_room_issues.sql · Novedades de cada dormitorio
--
--   Bitacora por dormitorio para registrar lo que pasa en el cuarto:
--   mantenimiento, limpieza, quejas, convivencia u otros. Cada novedad nace
--   'Abierta' y se cierra como 'Resuelta' con una nota de lo que se hizo.
--
--   Cambios:
--     room_issues          -> NUEVA tabla: novedades de un dormitorio
--     room_issue_create    -> NUEVA: registra una novedad
--     room_issue_resolve   -> NUEVA: la marca como resuelta
--     room_issue_reopen    -> NUEVA: la vuelve a abrir
--
--   Las novedades caen en cascada si se elimina el dormitorio.
--
--   Ejecutar DESPUES de 19_lodging_children.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Novedades
-- ---------------------------------------------------------------------------
create table if not exists public.room_issues (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  category         text not null,
  priority         text not null default 'Normal',
  detail           text not null,
  status           text not null default 'Abierta',
  reported_by      uuid references public.profiles (id) on delete set null,
  reported_by_name text,
  resolution       text,
  resolved_at      timestamptz,
  resolved_by_name text,
  created_at       timestamptz not null default now(),
  constraint room_issues_category_ok
    check (category in ('Mantenimiento', 'Limpieza', 'Queja', 'Convivencia', 'Otro')),
  constraint room_issues_priority_ok check (priority in ('Normal', 'Urgente')),
  constraint room_issues_status_ok check (status in ('Abierta', 'Resuelta')),
  constraint room_issues_detail_ok check (length(trim(detail)) > 0)
);

create index if not exists room_issues_room_idx on public.room_issues (room_id, created_at desc);
create index if not exists room_issues_open_idx on public.room_issues (status) where status = 'Abierta';

alter table public.room_issues enable row level security;
revoke all on public.room_issues from anon;

drop policy if exists room_issues_read on public.room_issues;
create policy room_issues_read on public.room_issues
  for select to authenticated using (true);

-- Solo se escribe a traves de las funciones de abajo
grant select on public.room_issues to authenticated;


-- ---------------------------------------------------------------------------
-- 2) Registrar una novedad
-- ---------------------------------------------------------------------------
create or replace function public.room_issue_create(
  p_room     uuid,
  p_category text,
  p_detail   text,
  p_priority text default 'Normal'
)
returns public.room_issues
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_room public.rooms%rowtype;
  v_row  public.room_issues%rowtype;
begin
  perform public.assert_can_write();

  select * into v_room from public.rooms where id = p_room;
  if not found then
    raise exception 'El dormitorio no existe.' using errcode = 'P0001';
  end if;

  if coalesce(p_category, '') not in ('Mantenimiento', 'Limpieza', 'Queja', 'Convivencia', 'Otro') then
    raise exception 'Elige el tipo de novedad.' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_detail, ''))) < 3 then
    raise exception 'Describe la novedad.' using errcode = 'P0001';
  end if;

  insert into public.room_issues (room_id, category, priority, detail, reported_by, reported_by_name)
  values (
    p_room, p_category,
    case when p_priority = 'Urgente' then 'Urgente' else 'Normal' end,
    trim(p_detail), auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), 'Sistema')
  )
  returning * into v_row;

  perform public.log_action('room_issue_create', 'room_issues', v_row.id,
    'Novedad en ' || v_room.code || ' (' || p_category
      || case when v_row.priority = 'Urgente' then ', urgente' else '' end || '): ' || left(v_row.detail, 120));
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 3) Resolver y reabrir
-- ---------------------------------------------------------------------------
create or replace function public.room_issue_resolve(p_issue uuid, p_resolution text default null)
returns public.room_issues
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.room_issues%rowtype;
  v_code text;
begin
  perform public.assert_can_write();

  select * into v_row from public.room_issues where id = p_issue for update;
  if not found then
    raise exception 'La novedad no existe.' using errcode = 'P0001';
  end if;
  if v_row.status = 'Resuelta' then
    raise exception 'La novedad ya estaba resuelta.' using errcode = 'P0001';
  end if;

  update public.room_issues
     set status = 'Resuelta',
         resolution = nullif(trim(coalesce(p_resolution, '')), ''),
         resolved_at = now(),
         resolved_by_name = coalesce((select full_name from public.profiles where id = auth.uid()), 'Sistema')
   where id = p_issue
  returning * into v_row;

  select code into v_code from public.rooms where id = v_row.room_id;
  perform public.log_action('room_issue_resolve', 'room_issues', p_issue,
    'Novedad resuelta en ' || v_code || ' (' || v_row.category || ')'
      || coalesce(': ' || left(v_row.resolution, 120), ''));
  return v_row;
end;
$fn$;

create or replace function public.room_issue_reopen(p_issue uuid)
returns public.room_issues
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row  public.room_issues%rowtype;
  v_code text;
begin
  perform public.assert_can_write();

  update public.room_issues
     set status = 'Abierta', resolution = null, resolved_at = null, resolved_by_name = null
   where id = p_issue
  returning * into v_row;
  if not found then
    raise exception 'La novedad no existe.' using errcode = 'P0001';
  end if;

  select code into v_code from public.rooms where id = v_row.room_id;
  perform public.log_action('room_issue_reopen', 'room_issues', p_issue,
    'Novedad reabierta en ' || v_code || ' (' || v_row.category || ')');
  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 4) Permisos de ejecucion
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'room_issue_create(uuid,text,text,text)',
    'room_issue_resolve(uuid,text)',
    'room_issue_reopen(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 5) Verificacion: novedades abiertas por dormitorio
-- ---------------------------------------------------------------------------
select r.code as dormitorio,
       count(*) filter (where i.status = 'Abierta')                           as abiertas,
       count(*) filter (where i.status = 'Abierta' and i.priority = 'Urgente') as urgentes,
       count(*) filter (where i.status = 'Resuelta')                          as resueltas
  from public.rooms r
  left join public.room_issues i on i.room_id = r.id
 group by r.id
 order by r.code;
