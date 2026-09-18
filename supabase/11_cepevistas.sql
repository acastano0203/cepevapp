-- ============================================================================
-- CEPEV · 11_cepevistas.sql · Modulo de cepevistas
--
--   Los cepevistas son un tipo mas de persona: viven en public.people con
--   kind = 'Cepevista'.
--
--   Este script generaliza lo que se hizo para colportores:
--     person_kind          -> nuevo valor 'Cepevista'
--     v_people_registry    -> vista unica de registro, sirve para CUALQUIER tipo
--     v_colporteurs        -> pasa a ser una vista delgada sobre la anterior
--     person_upsert        -> exige documento y correo tambien a los cepevistas
--
--   Ejecutar DESPUES de 10_people_documents.sql
--
--   NOTA TECNICA: las comparaciones usan kind::text en lugar del literal del
--   enum. PostgreSQL no permite usar un valor de enum recien creado dentro de
--   la misma transaccion, y el editor SQL de Supabase ejecuta todo el script
--   como una sola. Comparando contra texto, el script corre de una sola pasada.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Nuevo tipo de persona
-- ---------------------------------------------------------------------------
alter type public.person_kind add value if not exists 'Cepevista';


-- ---------------------------------------------------------------------------
-- 2) Vista de registro, valida para todos los tipos de persona
--    Reemplaza a la especifica de colportores: una sola definicion que
--    mantener, filtrada por kind desde la aplicacion.
-- ---------------------------------------------------------------------------
drop view if exists public.v_colporteurs;

create or replace view public.v_people_registry as
select
  p.id,
  p.full_name,
  p.kind,
  p.sex,
  p.birth_date,
  date_part('year', age(p.birth_date))::int as age,
  p.document_type,
  p.document_id,
  p.email,
  p.phone,
  p.base_city,
  p.team_id,
  t.name as team_name,
  p.daily_goal,
  p.is_available,
  p.notes,
  p.created_at,
  public.person_city_on(p.id, public.cepev_today()) as current_city,

  -- Alojamiento vigente, util para la ficha de un cepevista
  (select r.code || ' / ' || b.label
     from public.stays s
     join public.beds b  on b.id = s.bed_id
     join public.rooms r on r.id = b.room_id
    where s.person_id = p.id
      and s.status in ('Reservado', 'Alojado')
      and public.cepev_today() >= s.start_date
      and public.cepev_today() <  s.end_date
    limit 1) as current_bed,

  (select count(*) from public.sales_reports sr where sr.person_id = p.id)::int as reports_count,
  (select coalesce(sum(sr.books_sold), 0)
     from public.sales_reports sr where sr.person_id = p.id)::int               as books_total,
  (select max(sr.report_date)
     from public.sales_reports sr where sr.person_id = p.id)                    as last_report_date,
  (select count(*) from public.stays s  where s.person_id = p.id)::int          as stays_count,
  (select count(*) from public.trips tr where tr.driver_id = p.id)::int         as trips_count,
  (select count(*) from public.kitchen_shifts k where k.person_id = p.id)::int  as shifts_count,

  not exists (select 1 from public.sales_reports sr where sr.person_id = p.id)
  and not exists (select 1 from public.stays s     where s.person_id = p.id)
  and not exists (select 1 from public.trips tr    where tr.driver_id = p.id) as can_delete
from public.people p
left join public.teams t on t.id = p.team_id;

alter view public.v_people_registry set (security_invoker = on);
revoke all on public.v_people_registry from anon;
grant select on public.v_people_registry to authenticated;


-- ---------------------------------------------------------------------------
-- 3) v_colporteurs se conserva como vista delgada
--    Asi no se rompe nada que todavia la consulte.
-- ---------------------------------------------------------------------------
create or replace view public.v_colporteurs as
select * from public.v_people_registry where kind::text = 'Colportor';

alter view public.v_colporteurs set (security_invoker = on);
revoke all on public.v_colporteurs from anon;
grant select on public.v_colporteurs to authenticated;


-- ---------------------------------------------------------------------------
-- 4) person_upsert: documento y correo obligatorios tambien para cepevistas
--    Misma firma que en 10_people_documents.sql, solo cambia esa regla.
-- ---------------------------------------------------------------------------
create or replace function public.person_upsert(
  p_id uuid,
  p_full_name text,
  p_sex public.sex_group,
  p_birth_date date,
  p_phone text,
  p_base_city text,
  p_kind public.person_kind,
  p_team uuid default null,
  p_goal integer default 0,
  p_available boolean default true,
  p_notes text default null,
  p_document_type text default null,
  p_document_id text default null,
  p_email text default null
) returns public.people
language plpgsql security definer
set search_path = public
as $fn$
declare
  v_row      public.people%rowtype;
  v_document text := nullif(upper(regexp_replace(coalesce(p_document_id, ''), '[\s.\-]', '', 'g')), '');
  v_email    text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_doc_type text := nullif(upper(trim(coalesce(p_document_type, ''))), '');
  v_kind     text := p_kind::text;
begin
  perform public.assert_can_write();

  ------------------------------------------------------------------ nombre
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Indica el nombre completo.' using errcode = 'P0001';
  end if;

  ------------------------------------------------------------- nacimiento
  if p_birth_date is null or p_birth_date >= public.cepev_today() then
    raise exception 'Revisa la fecha de nacimiento.' using errcode = 'P0001';
  end if;
  if date_part('year', age(p_birth_date)) < 14 then
    raise exception 'La persona debe tener al menos 14 anos.' using errcode = 'P0001';
  end if;

  --------------------------------------------------------------- documento
  if v_document is not null then
    if v_doc_type is null then
      v_doc_type := 'CC';
    end if;
    if v_doc_type not in ('CC', 'TI', 'CE', 'PA') then
      raise exception 'Tipo de documento no valido: %.', v_doc_type using errcode = 'P0001';
    end if;
    if v_document !~ '^[A-Z0-9]{5,20}$' then
      raise exception 'El numero de documento debe tener entre 5 y 20 caracteres, sin simbolos.'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people
       where document_id = v_document and document_type = v_doc_type
         and (p_id is null or id <> p_id)
    ) then
      raise exception 'Ya existe una persona registrada con el documento % %.', v_doc_type, v_document
        using errcode = 'P0001';
    end if;
  else
    v_doc_type := null;
  end if;

  ------------------------------------------------------------------ correo
  if v_email is not null then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
      raise exception 'El correo electronico no tiene un formato valido.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people
       where lower(email) = v_email and (p_id is null or id <> p_id)
    ) then
      raise exception 'Ya existe una persona registrada con el correo %.', v_email using errcode = 'P0001';
    end if;
  end if;

  ------------------------------- obligatorios para colportores y cepevistas
  if v_kind in ('Colportor', 'Cepevista') then
    if v_document is null then
      raise exception 'El documento de identidad es obligatorio.' using errcode = 'P0001';
    end if;
    if v_email is null then
      raise exception 'El correo electronico es obligatorio.' using errcode = 'P0001';
    end if;
  end if;

  ------------------------------------------------------------------- meta
  if coalesce(p_goal, 0) < 0 then
    raise exception 'La meta diaria no puede ser negativa.' using errcode = 'P0001';
  end if;

  -------------------------------------------------------- nombre duplicado
  if exists (
    select 1 from public.people
     where lower(full_name) = lower(trim(p_full_name))
       and kind::text = v_kind
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'Ya existe otra persona registrada como % con el nombre %.',
      v_kind, trim(p_full_name) using errcode = 'P0001';
  end if;

  ------------------------------------------------------------------ guarda
  if p_id is null then
    insert into public.people (full_name, sex, birth_date, phone, base_city, kind, team_id,
                               daily_goal, is_available, notes,
                               document_type, document_id, email)
    values (trim(p_full_name), p_sex, p_birth_date, nullif(trim(p_phone), ''),
            coalesce(nullif(trim(p_base_city), ''), 'Piedecuesta'), p_kind, p_team,
            coalesce(p_goal, 0), coalesce(p_available, true), nullif(trim(p_notes), ''),
            v_doc_type, v_document, v_email)
    returning * into v_row;

    perform public.log_action('person_create', 'people', v_row.id,
      'Persona registrada: ' || v_row.full_name || ' (' || v_kind || ')');
  else
    update public.people
       set full_name     = trim(p_full_name),
           sex           = p_sex,
           birth_date    = p_birth_date,
           phone         = nullif(trim(p_phone), ''),
           base_city     = coalesce(nullif(trim(p_base_city), ''), base_city),
           kind          = p_kind,
           team_id       = p_team,
           daily_goal    = coalesce(p_goal, daily_goal),
           is_available  = coalesce(p_available, is_available),
           notes         = nullif(trim(p_notes), ''),
           document_type = v_doc_type,
           document_id   = v_document,
           email         = v_email
     where id = p_id
    returning * into v_row;

    if not found then raise exception 'Persona no encontrada.' using errcode = 'P0001'; end if;

    perform public.log_action('person_update', 'people', v_row.id,
      'Ficha actualizada: ' || v_row.full_name);
  end if;

  return v_row;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 5) Comprobacion
-- ---------------------------------------------------------------------------
select kind, count(*) as personas
  from public.v_people_registry
 group by kind
 order by personas desc;
