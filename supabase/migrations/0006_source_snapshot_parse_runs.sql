create table if not exists timetable_source_parse_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references timetable_source_snapshots(id) on delete restrict,
  parser_version text not null,
  status text not null check (status in ('parsed', 'review_required', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, parser_version)
);

create index if not exists timetable_source_parse_runs_snapshot_idx
  on timetable_source_parse_runs (snapshot_id, created_at desc);

create index if not exists timetable_source_parse_runs_status_idx
  on timetable_source_parse_runs (status, completed_at desc);

alter table timetable_source_parse_runs enable row level security;

revoke all on table timetable_source_parse_runs from anon, authenticated;
grant all on table timetable_source_parse_runs to service_role;
