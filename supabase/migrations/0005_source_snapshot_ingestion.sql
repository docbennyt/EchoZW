create table if not exists timetable_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  display_name text not null,
  provider text not null check (provider in ('google_docs_apps_script')),
  external_file_id text not null,
  active boolean not null default true,
  last_observed_at timestamptz,
  last_snapshot_received_at timestamptz,
  last_successful_snapshot_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_file_id)
);

create table if not exists timetable_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references timetable_sources(id) on delete restrict,
  provider text not null check (provider in ('google_docs_apps_script')),
  external_file_id text not null,
  schema_version integer not null check (schema_version > 0),
  observed_at timestamptz not null,
  accepted_at timestamptz not null default now(),
  content_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending_parse' check (
    processing_status in ('pending_parse', 'parsed', 'parse_failed')
  ),
  failure_code text,
  failure_metadata jsonb not null default '{}'::jsonb,
  tab_count integer not null default 0 check (tab_count >= 0),
  table_count integer not null default 0 check (table_count >= 0),
  text_length integer not null default 0 check (text_length >= 0),
  created_at timestamptz not null default now(),
  unique (source_id, content_hash)
);

create index if not exists timetable_source_snapshots_source_observed_idx
  on timetable_source_snapshots (source_id, observed_at desc);

create index if not exists timetable_source_snapshots_processing_idx
  on timetable_source_snapshots (processing_status, accepted_at desc);

alter table timetable_sources enable row level security;
alter table timetable_source_snapshots enable row level security;

revoke all on table timetable_sources from anon, authenticated;
revoke all on table timetable_source_snapshots from anon, authenticated;
grant all on table timetable_sources to service_role;
grant all on table timetable_source_snapshots to service_role;

insert into timetable_sources (
  source_key,
  display_name,
  provider,
  external_file_id
)
values (
  'hit-sist-master-sem1-2026',
  'HIT SIST Master Timetable - Semester I 2026',
  'google_docs_apps_script',
  '1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q'
)
on conflict (source_key) do update
set
  display_name = excluded.display_name,
  provider = excluded.provider,
  external_file_id = excluded.external_file_id,
  active = true,
  updated_at = now();
