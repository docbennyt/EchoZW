create table if not exists public.growth_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('missing_timetable', 'feedback')),
  status text not null default 'new'
    check (status in ('new', 'triaged', 'in_progress', 'resolved', 'closed')),
  timetable_id uuid references public.timetables(id) on delete set null,
  public_slug text,
  institution_name text,
  programme_name text,
  class_group_label text,
  academic_period_name text,
  feedback_type text
    check (
      feedback_type is null
      or feedback_type in (
        'timetable_problem',
        'product_problem',
        'suggestion',
        'rating',
        'other'
      )
    ),
  rating smallint check (rating is null or rating between 1 and 5),
  message text,
  contact_name text,
  contact_email text,
  contact_phone_e164 text,
  contact_consent boolean not null default false,
  is_class_rep boolean not null default false,
  can_provide_source boolean not null default false,
  testimonial_consent boolean not null default false,
  testimonial_approved boolean not null default false,
  testimonial_approved_at timestamptz,
  testimonial_approved_by uuid references auth.users(id) on delete set null,
  source_page text,
  internal_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(coalesce(institution_name, '')) <= 180),
  check (char_length(coalesce(programme_name, '')) <= 180),
  check (char_length(coalesce(class_group_label, '')) <= 120),
  check (char_length(coalesce(academic_period_name, '')) <= 160),
  check (char_length(coalesce(message, '')) <= 4000),
  check (char_length(coalesce(contact_name, '')) <= 120),
  check (char_length(coalesce(contact_email, '')) <= 254),
  check (char_length(coalesce(source_page, '')) <= 240),
  check (char_length(coalesce(internal_note, '')) <= 4000),
  check (
    contact_phone_e164 is null
    or contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  check (
    contact_email is null
    or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  check (
    contact_consent
    or (
      contact_name is null
      and contact_email is null
      and contact_phone_e164 is null
    )
  ),
  check (
    request_type <> 'missing_timetable'
    or (
      nullif(btrim(institution_name), '') is not null
      and nullif(btrim(programme_name), '') is not null
      and nullif(btrim(class_group_label), '') is not null
    )
  ),
  check (
    request_type <> 'feedback'
    or (
      feedback_type is not null
      and nullif(btrim(message), '') is not null
    )
  ),
  check (
    not testimonial_consent
    or (
      request_type = 'feedback'
      and contact_consent
      and (contact_email is not null or contact_phone_e164 is not null)
    )
  ),
  check (
    not testimonial_approved
    or (
      request_type = 'feedback'
      and testimonial_consent
      and testimonial_approved_at is not null
      and testimonial_approved_by is not null
    )
  )
);

comment on table public.growth_requests is
  'Server-owned demand and feedback inbox. Contact fields are optional PII and must never be copied into analytics properties or public responses.';

create index if not exists growth_requests_status_created_at_idx
  on public.growth_requests (status, created_at desc);

create index if not exists growth_requests_type_created_at_idx
  on public.growth_requests (request_type, created_at desc);

create index if not exists growth_requests_demand_lookup_idx
  on public.growth_requests (
    lower(institution_name),
    lower(programme_name),
    lower(class_group_label)
  )
  where request_type = 'missing_timetable';

alter table public.growth_requests enable row level security;
revoke all on table public.growth_requests from anon, authenticated;
grant all on table public.growth_requests to service_role;
