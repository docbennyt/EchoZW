-- Usable class-rep corrections tranche.
-- Supabase Auth remains identity; application authorization remains server-side.

alter table public.staff_users
  add column if not exists email text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_invited_at timestamptz;

create unique index if not exists staff_users_email_unique_idx
  on public.staff_users (lower(email))
  where email is not null;

create index if not exists staff_users_role_active_idx
  on public.staff_users (role, active);

create table if not exists public.timetable_correction_directives (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  timetable_session_id uuid references public.timetable_sessions(id) on delete set null,
  stable_session_key text,
  action text not null check (action in ('add', 'modify', 'remove')),
  source_may_replace boolean not null default false,
  course_code text,
  course_name text,
  weekday smallint check (weekday >= 1 and weekday <= 7),
  start_time time,
  end_time time,
  venue text,
  lecturer text,
  session_type text,
  notes text,
  reason text not null,
  provenance text,
  creator_role text not null check (creator_role in ('superadmin', 'class_rep')),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  creator_staff_user_id uuid not null references public.staff_users(id) on delete restrict,
  active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  superseded_by_source_snapshot_id uuid references public.timetable_source_snapshots(id) on delete set null,
  superseded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_correction_directives_payload_check check (
    action = 'remove'
    or (
      course_code is not null
      and course_name is not null
      and weekday is not null
      and start_time is not null
      and end_time is not null
      and end_time > start_time
    )
  )
);

comment on table public.timetable_correction_directives is
  'Human recurring timetable corrections. Pinned corrections are rows where source_may_replace=false.';

create index if not exists timetable_correction_directives_timetable_idx
  on public.timetable_correction_directives (timetable_id, active);

create index if not exists timetable_correction_directives_session_idx
  on public.timetable_correction_directives (timetable_session_id)
  where timetable_session_id is not null;

create index if not exists timetable_correction_directives_stable_key_idx
  on public.timetable_correction_directives (timetable_id, stable_session_key)
  where stable_session_key is not null;

create index if not exists timetable_correction_directives_creator_idx
  on public.timetable_correction_directives (creator_staff_user_id, created_at desc);

alter table public.timetable_correction_directives enable row level security;
revoke all on table public.timetable_correction_directives from anon, authenticated;
grant all on table public.timetable_correction_directives to service_role;

alter table public.timetable_session_exceptions
  alter column timetable_session_id drop not null,
  add column if not exists timetable_id uuid references public.timetables(id) on delete cascade,
  add column if not exists stable_session_key text,
  add column if not exists course_code text,
  add column if not exists course_name text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists venue text,
  add column if not exists lecturer text,
  add column if not exists session_type text,
  add column if not exists reason text,
  add column if not exists provenance text,
  add column if not exists active boolean not null default true,
  add column if not exists creator_role text,
  add column if not exists creator_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists creator_staff_user_id uuid references public.staff_users(id) on delete restrict,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'timetable_session_exceptions_target_check'
      and conrelid = 'public.timetable_session_exceptions'::regclass
  ) then
    alter table public.timetable_session_exceptions
      add constraint timetable_session_exceptions_target_check check (
        (
          exception_type in ('cancelled', 'moved')
          and timetable_session_id is not null
        )
        or (
          exception_type = 'extra'
          and timetable_id is not null
          and timetable_session_id is null
          and course_code is not null
          and course_name is not null
          and start_time is not null
          and end_time is not null
          and end_time > start_time
        )
      ) not valid;
  end if;
end $$;

create index if not exists timetable_session_exceptions_timetable_date_idx
  on public.timetable_session_exceptions (timetable_id, exception_date, active)
  where timetable_id is not null;

create index if not exists timetable_session_exceptions_stable_key_idx
  on public.timetable_session_exceptions (stable_session_key, exception_date)
  where stable_session_key is not null;

create index if not exists timetable_session_exceptions_creator_idx
  on public.timetable_session_exceptions (creator_staff_user_id, created_at desc)
  where creator_staff_user_id is not null;
