-- ============================================================================
-- CEPEV · 15_kitchen_gender.sql · Cocina separada por genero
--
--   Regla: en una misma comida (Desayuno, Almuerzo o Cena) no se mezclan
--          cepevistas ni colportores de distinto genero. El primer cepevista o
--          colportor que entra define el grupo del turno (Hombres o Mujeres) y
--          los siguientes deben ser del mismo grupo. El personal de apoyo
--          (logistica, conduccion y administracion) no entra en esta regla.
--
--   Cambios:
--     kitchen_block_reason -> nuevo motivo de bloqueo por genero. Como
--                             kitchen_add, kitchen_autofill y kitchen_publish
--                             ya lo consultan, los tres respetan la regla sin
--                             cambiar su codigo.
--     v_kitchen_shifts     -> nueva columna person_sex (al final)
--
--   Ejecutar DESPUES de 12_kitchen_dynamic.sql
--
--   SE PUEDE VOLVER A EJECUTAR TAL CUAL las veces que haga falta.
--
--   NOTA: si mas adelante vuelves a correr 12_kitchen_dynamic.sql, ese script
--   recrea kitchen_block_reason sin la regla; en ese caso vuelve a ejecutar
--   este archivo despues.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Motivos de bloqueo: se suma la separacion por genero
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_block_reason(p_shift uuid, p_person uuid)
returns text
language plpgsql stable
set search_path = public
as $fn$
declare
  v_shift  public.kitchen_shifts%rowtype;
  v_person public.people%rowtype;
  v_city   text;
  v_other  public.sex_group;
begin
  select * into v_shift from public.kitchen_shifts where id = p_shift;
  if not found then return 'El turno no existe.'; end if;

  select * into v_person from public.people where id = p_person;
  if not found then return 'La persona no existe.'; end if;

  if not v_person.is_available then
    return 'La persona figura como no disponible.';
  end if;

  if v_person.kind::text not in
       ('Logistica', 'Conductor', 'Administrativo', 'Cepevista', 'Colportor') then
    return 'Los residentes y las llegadas no cubren turnos de cocina.';
  end if;

  -- Cepevistas y colportores: un solo genero por comida
  if v_person.kind::text in ('Cepevista', 'Colportor') then
    select p.sex into v_other
      from public.kitchen_shifts k
      join public.people p on p.id = k.person_id
     where k.service_date = v_shift.service_date
       and k.meal = v_shift.meal
       and k.id <> v_shift.id
       and p.kind::text in ('Cepevista', 'Colportor')
       and p.sex <> v_person.sex
     limit 1;

    if v_other is not null then
      return 'El turno de ' || v_shift.meal || ' ya tiene cepevistas o colportores del grupo '
          || v_other || '; no se mezclan hombres y mujeres.';
    end if;
  end if;

  -- Fuera de la sede = su equipo esta de rotacion en otra ciudad ese dia.
  select r.city into v_city
    from public.rotations r
    join public.people pe on pe.team_id = r.team_id
   where pe.id = p_person
     and v_shift.service_date >= r.start_date
     and v_shift.service_date <  r.end_date
   limit 1;

  if v_city is not null and v_city <> 'Piedecuesta' then
    return 'Su equipo esta de rotacion en ' || v_city || ' ese dia.';
  end if;

  if exists (
    select 1 from public.kitchen_shifts k
     where k.person_id = p_person
       and k.service_date = v_shift.service_date
       and k.id <> v_shift.id
       and k.starts_at < v_shift.ends_at
       and v_shift.starts_at < k.ends_at
  ) then
    return 'Ya tiene otro turno de cocina que se cruza en ese horario.';
  end if;

  if exists (
    select 1 from public.trips t
     where t.driver_id = p_person
       and t.status in ('Reservado', 'En ruta')
       and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(
             (v_shift.service_date + v_shift.starts_at)::timestamptz,
             (v_shift.service_date + v_shift.ends_at)::timestamptz, '[)')
  ) then
    return 'Tiene un recorrido asignado en ese horario.';
  end if;

  return null;
end;
$fn$;

revoke all on function public.kitchen_block_reason(uuid, uuid) from public, anon;
grant execute on function public.kitchen_block_reason(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2) La grilla necesita el genero de cada participante
-- ---------------------------------------------------------------------------
create or replace view public.v_kitchen_shifts as
select
  k.id,
  k.service_date,
  k.meal,
  k.task,
  k.position_index,
  k.starts_at,
  k.ends_at,
  k.person_id,
  p.full_name  as person_name,
  p.kind       as person_kind,
  p.is_available,
  (kp.service_date is not null) as is_published,
  p.sex        as person_sex
from public.kitchen_shifts k
left join public.people p on p.id = k.person_id
left join public.kitchen_publications kp on kp.service_date = k.service_date;

alter view public.v_kitchen_shifts set (security_invoker = on);
revoke all on public.v_kitchen_shifts from anon;
grant select on public.v_kitchen_shifts to authenticated;


-- ---------------------------------------------------------------------------
-- 3) Verificacion
--    Esperado: cero comidas mezcladas. Si aparece alguna, viene de antes de
--    esta regla: la grilla la marca como conflicto y no deja publicar el dia
--    hasta quitar a quien sobre.
-- ---------------------------------------------------------------------------
select count(*) as comidas_mezcladas
  from (
    select k.service_date, k.meal
      from public.kitchen_shifts k
      join public.people p on p.id = k.person_id
     where p.kind::text in ('Cepevista', 'Colportor')
     group by k.service_date, k.meal
    having count(distinct p.sex) > 1
  ) t;
