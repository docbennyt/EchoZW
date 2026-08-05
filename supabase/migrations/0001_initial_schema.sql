create table if not exists institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country text not null default 'Zimbabwe',
  timezone text not null default 'Africa/Harare',
  created_at timestamptz not null default now()
);

create table if not exists timetables (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id),
  slug text not null unique,
  programme text not null,
  cohort text not null,
  semester text not null,
  status text not null check (status in ('draft', 'community_verified', 'official', 'archived')),
  current_version_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists timetable_versions (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references timetables(id),
  version_label text not null,
  source text not null,
  published_by uuid,
  published_at timestamptz,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  timetable_version_id uuid not null references timetable_versions(id),
  stable_uid text not null,
  course_code text not null,
  title text not null,
  location text,
  lecturer text,
  group_name text,
  starts_at_local timestamp not null,
  ends_at_local timestamp not null,
  timezone text not null default 'Africa/Harare',
  recurrence jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  status text not null check (status in ('confirmed', 'tentative', 'cancelled')),
  sequence int not null default 0,
  unique (timetable_version_id, stable_uid)
);

create table if not exists correction_reports (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references timetables(id),
  issue_type text not null,
  details text not null,
  contact text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists feed_tokens (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references timetables(id),
  token_hash text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references timetables(id),
  user_id uuid,
  anonymous_session_id uuid,
  provider text not null check (
    provider in (
      'google_api',
      'apple_subscription',
      'webcal_subscription',
      'ics_download',
      'outlook_subscription'
    )
  ),
  reminder_preset text,
  reminder_offsets_minutes jsonb not null default '[]'::jsonb,
  calendar_name text not null,
  timezone text not null default 'Africa/Harare',
  token_hash text unique,
  status text not null check (
    status in (
      'pending',
      'active',
      'disconnected',
      'revoked',
      'failed'
    )
  ),
  synced_timetable_version_id uuid references timetable_versions(id),
  external_calendar_id text,
  last_synced_at timestamptz,
  last_feed_fetch_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists calendar_event_sync_records (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references calendar_subscriptions(id),
  internal_event_id text not null,
  timetable_version_id uuid not null references timetable_versions(id),
  provider text not null,
  external_calendar_id text,
  external_event_id text,
  content_hash text,
  sync_status text not null default 'pending',
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, provider, internal_event_id)
);
