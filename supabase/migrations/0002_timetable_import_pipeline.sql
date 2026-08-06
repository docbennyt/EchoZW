create extension if not exists pgcrypto;

create table if not exists academic_units (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  parent_id uuid references academic_units(id) on delete restrict,
  unit_type text not null check (unit_type in ('school', 'faculty', 'department')),
  name text not null,
  short_name text,
  slug text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, parent_id, slug)
);

create table if not exists programmes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  academic_unit_id uuid references academic_units(id) on delete set null,
  code text,
  name text not null,
  short_name text,
  slug text not null,
  qualification_level text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, slug)
);

create unique index if not exists programmes_institution_code_unique
  on programmes (institution_id, code)
  where code is not null;

create table if not exists cohorts (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  code text not null,
  level_label text not null,
  intake_label text,
  group_label text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programme_id, code, group_label)
);

create table if not exists academic_periods (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  name text not null,
  academic_year text not null,
  period_number integer,
  starts_on date,
  ends_on date,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    starts_on is null
    or ends_on is null
    or ends_on >= starts_on
  )
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  code text not null,
  name text not null,
  default_lecturer_text text,
  owning_academic_unit_id uuid references academic_units(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code)
);

create table if not exists source_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete restrict,
  academic_period_id uuid references academic_periods(id) on delete set null,
  original_filename text not null,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256 text not null,
  document_type text not null check (
    document_type in (
      'master_timetable_pdf',
      'cohort_timetable_docx',
      'structured_csv',
      'supporting_evidence'
    )
  ),
  source_status text not null default 'uploaded' check (
    source_status in (
      'uploaded',
      'parsing',
      'parsed',
      'review_required',
      'approved',
      'rejected',
      'archived'
    )
  ),
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  parser_version text,
  metadata jsonb not null default '{}'::jsonb,
  unique (institution_id, sha256)
);

create table if not exists programme_courses (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  level_label text,
  academic_period_label text,
  is_core boolean not null default true,
  source_document_id uuid references source_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (programme_id, course_id, level_label, academic_period_label)
);

alter table timetables
  add column if not exists academic_unit_id uuid references academic_units(id) on delete set null,
  add column if not exists programme_id uuid references programmes(id) on delete restrict,
  add column if not exists cohort_id uuid references cohorts(id) on delete restrict,
  add column if not exists academic_period_id uuid references academic_periods(id) on delete restrict,
  add column if not exists public_slug text,
  add column if not exists archived_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

update timetables set public_slug = slug where public_slug is null;

create unique index if not exists timetables_public_slug_unique
  on timetables (public_slug)
  where public_slug is not null;

alter table timetable_versions
  add column if not exists version_number integer,
  add column if not exists status text not null default 'draft',
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists source_document_id uuid references source_documents(id) on delete set null,
  add column if not exists source_label text,
  add column if not exists source_issued_on date,
  add column if not exists source_is_draft boolean not null default false,
  add column if not exists change_summary text,
  add column if not exists created_by uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists published_by_user_id uuid,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'timetable_versions_status_check'
  ) then
    alter table timetable_versions
      add constraint timetable_versions_status_check
      check (status in ('draft', 'review_required', 'published', 'archived'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'timetable_versions_verification_status_check'
  ) then
    alter table timetable_versions
      add constraint timetable_versions_verification_status_check
      check (verification_status in ('unverified', 'community_verified', 'official'));
  end if;
end $$;

update timetable_versions
set version_number = coalesce(version_number, 1)
where version_number is null;

create unique index if not exists timetable_versions_number_unique
  on timetable_versions (timetable_id, version_number)
  where version_number is not null;

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references source_documents(id) on delete cascade,
  import_mode text not null check (
    import_mode in (
      'cohort_csv',
      'cohort_docx',
      'master_pdf_assisted',
      'course_catalog_from_pdf'
    )
  ),
  selected_programme_id uuid references programmes(id) on delete set null,
  selected_cohort_id uuid references cohorts(id) on delete set null,
  selected_academic_period_id uuid references academic_periods(id) on delete set null,
  status text not null default 'queued' check (
    status in (
      'queued',
      'extracting',
      'normalizing',
      'review_required',
      'ready_to_confirm',
      'confirmed',
      'failed',
      'cancelled'
    )
  ),
  parser_version text not null,
  started_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists import_candidates (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  source_page integer,
  source_table integer,
  source_cell text,
  source_row integer,
  raw_text text not null,
  candidate_type text not null check (
    candidate_type in ('session', 'course_catalog', 'ignored_row', 'non_session')
  ),
  programme_code_raw text,
  cohort_code_raw text,
  course_code_raw text,
  course_name_raw text,
  day_raw text,
  weekday smallint check (weekday between 1 and 7),
  time_raw text,
  start_time time,
  end_time time,
  venue_raw text,
  lecturer_raw text,
  matched_programme_id uuid references programmes(id) on delete set null,
  matched_cohort_id uuid references cohorts(id) on delete set null,
  matched_course_id uuid references courses(id) on delete set null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'unreviewed' check (
    review_status in ('unreviewed', 'valid', 'warning', 'invalid', 'ignored', 'approved')
  ),
  reviewer_notes text,
  normalized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_candidates_batch_cohort_idx
  on import_candidates (import_batch_id, cohort_code_raw, review_status);

create table if not exists import_candidate_warnings (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references import_candidates(id) on delete cascade,
  warning_code text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  message text not null,
  field_name text,
  suggested_value text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists timetable_sessions (
  id uuid primary key default gen_random_uuid(),
  timetable_version_id uuid not null references timetable_versions(id) on delete cascade,
  stable_session_key text not null,
  course_id uuid not null references courses(id) on delete restrict,
  programme_course_id uuid references programme_courses(id) on delete set null,
  session_type text,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  starts_on date not null,
  ends_on date not null,
  venue_raw text,
  venue_normalized text,
  lecturer_raw text,
  lecturer_normalized text,
  group_label text,
  notes text,
  source_candidate_id uuid references import_candidates(id) on delete set null,
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (timetable_version_id, stable_session_key),
  check (end_time > start_time),
  check (ends_on >= starts_on)
);

create table if not exists timetable_session_exceptions (
  id uuid primary key default gen_random_uuid(),
  timetable_session_id uuid not null references timetable_sessions(id) on delete cascade,
  exception_date date not null,
  exception_type text not null check (exception_type in ('cancelled', 'moved', 'extra')),
  replacement_starts_at timestamptz,
  replacement_ends_at timestamptz,
  notes text,
  source_candidate_id uuid references import_candidates(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists verification_records (
  id uuid primary key default gen_random_uuid(),
  timetable_version_id uuid not null references timetable_versions(id) on delete cascade,
  verification_status text not null check (
    verification_status in ('unverified', 'community_verified', 'official')
  ),
  verified_by uuid not null,
  verification_notes text,
  evidence_source_document_id uuid references source_documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references institutions(id) on delete set null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table calendar_events
  add column if not exists timetable_session_id uuid references timetable_sessions(id) on delete set null,
  add column if not exists source_candidate_id uuid references import_candidates(id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'timetable-sources',
  'timetable-sources',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table academic_units enable row level security;
alter table programmes enable row level security;
alter table cohorts enable row level security;
alter table academic_periods enable row level security;
alter table courses enable row level security;
alter table programme_courses enable row level security;
alter table source_documents enable row level security;
alter table import_batches enable row level security;
alter table import_candidates enable row level security;
alter table import_candidate_warnings enable row level security;
alter table timetable_sessions enable row level security;
alter table timetable_session_exceptions enable row level security;
alter table verification_records enable row level security;
alter table audit_logs enable row level security;

create policy "authenticated users can read academic hierarchy"
  on academic_units for select
  to authenticated
  using (true);

create policy "authenticated users can read programmes"
  on programmes for select
  to authenticated
  using (true);

create policy "authenticated users can read cohorts"
  on cohorts for select
  to authenticated
  using (true);

create policy "authenticated users can read academic periods"
  on academic_periods for select
  to authenticated
  using (true);

create policy "authenticated users can read courses"
  on courses for select
  to authenticated
  using (true);

create policy "authenticated users can read programme courses"
  on programme_courses for select
  to authenticated
  using (true);

create policy "import admins manage source documents"
  on source_documents for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins manage import batches"
  on import_batches for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins manage import candidates"
  on import_candidates for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins manage import candidate warnings"
  on import_candidate_warnings for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "authenticated users can read timetable sessions"
  on timetable_sessions for select
  to authenticated
  using (true);

create policy "import admins manage timetable sessions"
  on timetable_sessions for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "authenticated users can read timetable session exceptions"
  on timetable_session_exceptions for select
  to authenticated
  using (true);

create policy "import admins manage timetable session exceptions"
  on timetable_session_exceptions for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins manage verification records"
  on verification_records for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins read audit logs"
  on audit_logs for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins insert audit logs"
  on audit_logs for insert
  to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

create policy "import admins manage timetable source objects"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'timetable-sources'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin')
  )
  with check (
    bucket_id = 'timetable-sources'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin')
  );
