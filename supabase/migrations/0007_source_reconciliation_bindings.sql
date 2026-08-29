create table if not exists timetable_source_reconciliation_bindings (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references timetable_sources(source_key) on delete restrict,
  source_cohort_code text not null,
  target_public_slug text not null,
  target_class_group_label text not null,
  target_academic_period_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, source_cohort_code)
);

create index if not exists timetable_source_reconciliation_bindings_target_slug_idx
  on timetable_source_reconciliation_bindings (target_public_slug)
  where active = true;

alter table timetable_source_reconciliation_bindings enable row level security;

revoke all on table timetable_source_reconciliation_bindings from anon, authenticated;
grant all on table timetable_source_reconciliation_bindings to service_role;

insert into timetable_source_reconciliation_bindings (
  source_key,
  source_cohort_code,
  target_public_slug,
  target_class_group_label,
  target_academic_period_name
)
values (
  'hit-sist-master-sem1-2026',
  'CS.1',
  'hit-cs-1-1-august-2026',
  '1.1',
  'August Semester 2026'
)
on conflict (source_key, source_cohort_code) do update
set
  target_public_slug = excluded.target_public_slug,
  target_class_group_label = excluded.target_class_group_label,
  target_academic_period_name = excluded.target_academic_period_name,
  active = true,
  updated_at = now();
