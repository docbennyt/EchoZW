create table if not exists public.timetable_requests (
  id uuid primary key default gen_random_uuid(),
  institution_name text not null check (char_length(institution_name) between 2 and 160),
  programme_name text not null check (char_length(programme_name) between 2 and 160),
  class_group text not null check (char_length(class_group) between 1 and 120),
  academic_period text,
  requester_role text not null default 'student' check (requester_role in ('student','class_rep','staff','other')),
  source_access text not null default 'none' check (source_access in ('none','class_rep','official_link','document','other')),
  source_note text,
  contact_name text,
  phone_e164 text,
  email text,
  consent_contact boolean not null default false,
  status text not null default 'new' check (status in ('new','triaged','source_needed','in_progress','published','closed')),
  public_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists timetable_requests_created_at_idx
  on public.timetable_requests (created_at desc);
create index if not exists timetable_requests_status_idx
  on public.timetable_requests (status, created_at desc);
create index if not exists timetable_requests_demand_idx
  on public.timetable_requests (institution_name, programme_name, class_group, academic_period);

create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('timetable_problem','calendar_problem','product_feedback','suggestion','praise')),
  rating integer check (rating between 1 and 5),
  message text not null check (char_length(message) between 3 and 4000),
  public_slug text,
  contact_name text,
  email text,
  phone_e164 text,
  consent_contact boolean not null default false,
  testimonial_permission boolean not null default false,
  testimonial_approved boolean not null default false,
  status text not null default 'new' check (status in ('new','reviewed','actioned','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_feedback_created_at_idx
  on public.product_feedback (created_at desc);
create index if not exists product_feedback_status_idx
  on public.product_feedback (status, created_at desc);

alter table public.timetable_requests enable row level security;
alter table public.product_feedback enable row level security;

revoke all on public.timetable_requests from anon, authenticated;
revoke all on public.product_feedback from anon, authenticated;
grant all on public.timetable_requests to service_role;
grant all on public.product_feedback to service_role;

comment on table public.timetable_requests is 'Private demand and source-access leads submitted through CalenderZW public request flows.';
comment on table public.product_feedback is 'Private product/timetable feedback. Testimonial use requires explicit permission and founder approval.';
