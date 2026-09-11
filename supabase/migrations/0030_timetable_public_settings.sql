-- DR-62: durable founder-controlled public timetable display settings.
-- Timetable truth, publication/versioning, calendar identities and push delivery are unchanged.
-- Browser clients never read or mutate this table directly; server service_role access is authoritative.

create table if not exists public.timetable_public_settings (
  timetable_id uuid primary key references public.timetables(id) on delete cascade,
  show_visual_preview boolean not null default false,
  show_change_alerts boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_staff_user_id uuid references public.staff_users(id) on delete set null
);

comment on table public.timetable_public_settings is
  'Founder-controlled public presentation policy for one timetable. Missing rows are interpreted by the server as both features OFF.';
comment on column public.timetable_public_settings.show_visual_preview is
  'Whether students may see the optional static visual timetable preview/download surface.';
comment on column public.timetable_public_settings.show_change_alerts is
  'Whether students may see the optional browser change-alert setup surface.';
comment on column public.timetable_public_settings.updated_by_staff_user_id is
  'Staff actor that last changed the public display policy; mutations are founder-superadmin guarded server-side.';

-- Make the current state explicit for existing timetables while preserving the
-- fail-closed server rule for any row that is absent during a staggered deploy.
insert into public.timetable_public_settings (
  timetable_id,
  show_visual_preview,
  show_change_alerts,
  updated_at,
  updated_by_staff_user_id
)
select
  id,
  false,
  false,
  now(),
  null
from public.timetables
on conflict (timetable_id) do nothing;

alter table public.timetable_public_settings enable row level security;
revoke all on table public.timetable_public_settings from anon, authenticated;
grant all on table public.timetable_public_settings to service_role;
