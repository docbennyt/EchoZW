-- DR-58: scalable academic pause / no-lecture calendar.
-- Pauses suppress generated lecture occurrences without deleting recurring timetable truth.
-- Supabase Auth remains identity; all mutations remain server-authorized via service_role.

create table if not exists public.academic_schedule_pauses (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (
    scope_type in ('institution', 'programme', 'cohort', 'timetable', 'session')
  ),
  institution_id uuid references public.institutions(id) on delete cascade,
  programme_id uuid references public.programmes(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete cascade,
  timetable_id uuid references public.timetables(id) on delete cascade,
  stable_session_key text,
  starts_on date not null,
  ends_on date not null,
  all_day boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text not null check (
    reason in ('sim_break', 'graduation', 'swot_week', 'holiday', 'closure', 'other')
  ),
  label text not null,
  provenance text,
  creator_role text not null check (creator_role in ('superadmin', 'admin', 'class_rep')),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  creator_staff_user_id uuid not null references public.staff_users(id) on delete restrict,
  active boolean not null default true,
  disabled_at timestamptz,
  disabled_by_user_id uuid references auth.users(id) on delete set null,
  disabled_by_staff_user_id uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_schedule_pauses_date_range_check check (ends_on >= starts_on),
  constraint academic_schedule_pauses_time_shape_check check (
    (all_day and starts_at is null and ends_at is null)
    or
    (not all_day and starts_at is not null and ends_at is not null and ends_at > starts_at)
  ),
  constraint academic_schedule_pauses_scope_target_check check (
    (scope_type = 'institution'
      and institution_id is not null
      and programme_id is null
      and cohort_id is null
      and timetable_id is null
      and stable_session_key is null)
    or
    (scope_type = 'programme'
      and institution_id is null
      and programme_id is not null
      and cohort_id is null
      and timetable_id is null
      and stable_session_key is null)
    or
    (scope_type = 'cohort'
      and institution_id is null
      and programme_id is null
      and cohort_id is not null
      and timetable_id is null
      and stable_session_key is null)
    or
    (scope_type = 'timetable'
      and institution_id is null
      and programme_id is null
      and cohort_id is null
      and timetable_id is not null
      and stable_session_key is null)
    or
    (scope_type = 'session'
      and institution_id is null
      and programme_id is null
      and cohort_id is null
      and timetable_id is not null
      and nullif(btrim(stable_session_key), '') is not null)
  )
);

comment on table public.academic_schedule_pauses is
  'Non-destructive no-lecture windows applied at institution, programme, cohort, timetable, or stable recurring-session scope.';
comment on column public.academic_schedule_pauses.stable_session_key is
  'Stable recurring-session identity used only for scope_type=session; never a version-specific timetable_session id.';
comment on column public.academic_schedule_pauses.all_day is
  'When true, starts_on..ends_on is an inclusive institution-local date range. When false, starts_at..ends_at is the authoritative bounded interval.';

create index if not exists academic_schedule_pauses_institution_idx
  on public.academic_schedule_pauses (institution_id, starts_on, ends_on)
  where active and institution_id is not null;
create index if not exists academic_schedule_pauses_programme_idx
  on public.academic_schedule_pauses (programme_id, starts_on, ends_on)
  where active and programme_id is not null;
create index if not exists academic_schedule_pauses_cohort_idx
  on public.academic_schedule_pauses (cohort_id, starts_on, ends_on)
  where active and cohort_id is not null;
create index if not exists academic_schedule_pauses_timetable_idx
  on public.academic_schedule_pauses (timetable_id, starts_on, ends_on)
  where active and timetable_id is not null;
create index if not exists academic_schedule_pauses_session_idx
  on public.academic_schedule_pauses (timetable_id, stable_session_key, starts_on, ends_on)
  where active and scope_type = 'session';
create index if not exists academic_schedule_pauses_creator_idx
  on public.academic_schedule_pauses (creator_staff_user_id, created_at desc);

alter table public.academic_schedule_pauses enable row level security;
revoke all on table public.academic_schedule_pauses from anon, authenticated;
grant all on table public.academic_schedule_pauses to service_role;
