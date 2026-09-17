-- ============================================================================
-- CEPEV · Gestión integral
-- 01_schema.sql · Extensiones, tipos y tablas
-- Ejecutar en Supabase Studio -> SQL Editor, en orden: 01 -> 02 -> 03 -> 04 -> 05
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist"; -- exclusiones uuid + rango

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'coordinador', 'consulta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sex_group as enum ('Mujeres', 'Hombres');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.person_kind as enum ('Residente', 'Logistica', 'Conductor', 'Colportor', 'Llegada', 'Administrativo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.stay_status as enum ('Reservado', 'Alojado', 'Finalizado', 'Cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meal_type as enum ('Desayuno', 'Almuerzo', 'Cena');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kitchen_task as enum ('Preparacion', 'Comedor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vehicle_status as enum ('Disponible', 'Mantenimiento', 'Fuera de servicio');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trip_status as enum ('Reservado', 'En ruta', 'Finalizado', 'Cancelado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Perfiles (enlazados a auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default 'Usuario CEPEV',
  role       public.app_role not null default 'consulta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuario autenticado. El rol gobierna la escritura via RLS.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Equipos de colportaje
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
create table if not exists public.people (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  sex          public.sex_group not null,
  birth_date   date not null,
  phone        text,
  base_city    text not null default 'Piedecuesta',
  kind         public.person_kind not null default 'Residente',
  team_id      uuid references public.teams (id) on delete set null,
  daily_goal   integer not null default 0 check (daily_goal >= 0),
  is_available boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
  -- La fecha de nacimiento se valida en public.person_upsert (un CHECK con
  -- current_date no seria determinista para restaurar copias de seguridad).
);

create index if not exists people_kind_idx on public.people (kind);
create index if not exists people_team_idx on public.people (team_id);
create index if not exists people_name_idx on public.people (lower(full_name));

-- ---------------------------------------------------------------------------
-- Alojamiento
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  building   text not null default 'A',
  sex        public.sex_group not null,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.beds (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  label          text not null,
  is_blocked     boolean not null default false,
  blocked_reason text,
  created_at     timestamptz not null default now(),
  unique (room_id, label)
);

create index if not exists beds_room_idx on public.beds (room_id);

create table if not exists public.stays (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.people (id) on delete restrict,
  bed_id         uuid not null references public.beds (id) on delete restrict,
  start_date     date not null,
  end_date       date not null,
  status         public.stay_status not null default 'Reservado',
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint stays_dates_ok check (end_date > start_date)
);

-- Una cama no admite dos estadias vigentes solapadas
alter table public.stays drop constraint if exists stays_bed_no_overlap;
alter table public.stays add constraint stays_bed_no_overlap
  exclude using gist (
    bed_id with =,
    daterange(start_date, end_date, '[)') with &&
  ) where (status in ('Reservado', 'Alojado'));

-- Una persona no puede ocupar dos camas a la vez
alter table public.stays drop constraint if exists stays_person_no_overlap;
alter table public.stays add constraint stays_person_no_overlap
  exclude using gist (
    person_id with =,
    daterange(start_date, end_date, '[)') with &&
  ) where (status in ('Reservado', 'Alojado'));

create index if not exists stays_status_idx on public.stays (status);
create index if not exists stays_range_idx on public.stays (start_date, end_date);

-- ---------------------------------------------------------------------------
-- Cocina
-- ---------------------------------------------------------------------------
create table if not exists public.kitchen_shifts (
  id             uuid primary key default gen_random_uuid(),
  service_date   date not null,
  meal           public.meal_type not null,
  task           public.kitchen_task not null,
  position_index smallint not null check (position_index between 1 and 12),
  starts_at      time not null,
  ends_at        time not null,
  person_id      uuid references public.people (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint kitchen_shift_times_ok check (ends_at > starts_at),
  unique (service_date, meal, task, position_index)
);

create index if not exists kitchen_shifts_date_idx on public.kitchen_shifts (service_date);
create index if not exists kitchen_shifts_person_idx on public.kitchen_shifts (person_id);

create table if not exists public.kitchen_publications (
  service_date date primary key,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Flota
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  plate             text not null unique,
  current_city      text not null default 'Piedecuesta',
  status            public.vehicle_status not null default 'Disponible',
  odometer_km       integer not null default 0 check (odometer_km >= 0),
  capacity          smallint not null default 12 check (capacity > 0),
  next_service_date date not null,
  next_service_km   integer not null check (next_service_km > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.trips (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid not null references public.vehicles (id) on delete restrict,
  driver_id        uuid not null references public.people (id) on delete restrict,
  destination_city text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.trip_status not null default 'Reservado',
  return_km        integer check (return_km >= 0),
  return_city      text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trips_times_ok check (ends_at > starts_at)
);

alter table public.trips drop constraint if exists trips_vehicle_no_overlap;
alter table public.trips add constraint trips_vehicle_no_overlap
  exclude using gist (
    vehicle_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('Reservado', 'En ruta'));

alter table public.trips drop constraint if exists trips_driver_no_overlap;
alter table public.trips add constraint trips_driver_no_overlap
  exclude using gist (
    driver_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('Reservado', 'En ruta'));

create index if not exists trips_status_idx on public.trips (status);

create table if not exists public.fuel_logs (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  log_date    date not null default current_date,
  liters      numeric(8,2) not null check (liters > 0),
  amount_cop  integer not null check (amount_cop > 0),
  odometer_km integer not null check (odometer_km >= 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.maintenance_logs (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  log_date   date not null default current_date,
  detail     text not null,
  cost_cop   integer not null default 0 check (cost_cop >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Colportaje
-- ---------------------------------------------------------------------------
create table if not exists public.rotations (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  city       text not null,
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now(),
  constraint rotations_dates_ok check (end_date > start_date)
);

alter table public.rotations drop constraint if exists rotations_team_no_overlap;
alter table public.rotations add constraint rotations_team_no_overlap
  exclude using gist (
    team_id with =,
    daterange(start_date, end_date, '[)') with &&
  );

create table if not exists public.sales_reports (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete cascade,
  report_date date not null,
  books_sold  integer not null check (books_sold >= 0),
  city        text not null,
  team_id     uuid references public.teams (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (person_id, report_date)
);

create index if not exists sales_reports_date_idx on public.sales_reports (report_date);

-- ---------------------------------------------------------------------------
-- Bitacora
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_name  text,
  action      text not null,
  entity      text,
  entity_id   uuid,
  summary     text not null,
  payload     jsonb
);

create index if not exists audit_log_recent_idx on public.audit_log (occurred_at desc);

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $$
declare t text;
begin
  foreach t in array array['profiles','people','stays','kitchen_shifts','vehicles','trips','sales_reports']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
