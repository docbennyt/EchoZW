-- Source Gateway V1: dynamic source configuration, durable processing jobs,
-- discovery catalog, explicit mappings, and source-generated review drafts.

alter table public.timetable_sources
  add column if not exists parser_profile text,
  add column if not exists relay_secret_env_name text,
  add column if not exists last_processing_started_at timestamptz,
  add column if not exists last_processing_completed_at timestamptz,
  add column if not exists last_processing_error_at timestamptz,
  add column if not exists last_processing_error_code text;

update public.timetable_sources
set
  parser_profile = coalesce(parser_profile, 'hit_sist_master_v1'),
  relay_secret_env_name = coalesce(relay_secret_env_name, 'HIT_TIMETABLE_RELAY_SECRET'),
  updated_at = now()
where source_key = 'hit-sist-master-sem1-2026';

alter table public.timetable_sources
  alter column parser_profile set default 'hit_sist_master_v1';

create table if not exists public.timetable_source_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.timetable_source_snapshots(id) on delete restrict,
  source_id uuid not null references public.timetable_sources(id) on delete restrict,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'review_ready', 'completed', 'failed', 'superseded')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_metadata jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_id)
);

create index if not exists timetable_source_processing_jobs_claim_idx
  on public.timetable_source_processing_jobs (status, available_at, created_at)
  where status in ('queued', 'failed');

create index if not exists timetable_source_processing_jobs_source_idx
  on public.timetable_source_processing_jobs (source_id, created_at desc);

create table if not exists public.timetable_source_discovered_programmes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.timetable_sources(id) on delete restrict,
  source_programme_code text not null,
  display_label text,
  first_seen_parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  last_seen_parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  session_count integer not null default 0 check (session_count >= 0),
  currently_present boolean not null default true,
  mapping_status text not null default 'unmapped' check (
    mapping_status in ('unmapped', 'mapped', 'disabled', 'conflict')
  ),
  target_programme_id uuid references public.programmes(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_programme_code)
);

create table if not exists public.timetable_source_discovered_cohorts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.timetable_sources(id) on delete restrict,
  source_cohort_code text not null,
  source_programme_code text not null,
  first_seen_parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  last_seen_parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  session_count integer not null default 0 check (session_count >= 0),
  currently_present boolean not null default true,
  mapping_status text not null default 'unmapped' check (
    mapping_status in ('unmapped', 'mapped', 'disabled', 'conflict')
  ),
  target_programme_id uuid references public.programmes(id) on delete set null,
  target_cohort_id uuid references public.cohorts(id) on delete set null,
  target_academic_period_id uuid references public.academic_periods(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_cohort_code)
);

create index if not exists timetable_source_discovered_programmes_status_idx
  on public.timetable_source_discovered_programmes (source_id, mapping_status, source_programme_code);

create index if not exists timetable_source_discovered_programmes_target_idx
  on public.timetable_source_discovered_programmes (target_programme_id)
  where target_programme_id is not null;

create index if not exists timetable_source_discovered_cohorts_status_idx
  on public.timetable_source_discovered_cohorts (source_id, mapping_status, source_cohort_code);

create index if not exists timetable_source_discovered_cohorts_source_programme_idx
  on public.timetable_source_discovered_cohorts (source_id, source_programme_code);

create index if not exists timetable_source_discovered_cohorts_target_idx
  on public.timetable_source_discovered_cohorts (
    target_programme_id,
    target_cohort_id,
    target_academic_period_id
  )
  where target_programme_id is not null;

alter table public.timetable_source_reconciliation_bindings
  add column if not exists target_timetable_id uuid references public.timetables(id) on delete set null,
  add column if not exists target_programme_id uuid references public.programmes(id) on delete set null,
  add column if not exists target_cohort_id uuid references public.cohorts(id) on delete set null,
  add column if not exists target_academic_period_id uuid references public.academic_periods(id) on delete set null;

create index if not exists timetable_source_reconciliation_bindings_target_ids_idx
  on public.timetable_source_reconciliation_bindings (
    target_timetable_id,
    target_programme_id,
    target_cohort_id,
    target_academic_period_id
  )
  where active = true;

alter table public.timetable_sessions
  add column if not exists source_parse_run_id uuid references public.timetable_source_parse_runs(id) on delete set null,
  add column if not exists source_candidate_key text;

create index if not exists timetable_sessions_source_parse_candidate_idx
  on public.timetable_sessions (source_parse_run_id, source_candidate_key)
  where source_parse_run_id is not null;

create table if not exists public.timetable_source_reviews (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.timetable_sources(id) on delete restrict,
  snapshot_id uuid not null references public.timetable_source_snapshots(id) on delete restrict,
  parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  discovered_cohort_id uuid not null references public.timetable_source_discovered_cohorts(id) on delete restrict,
  source_cohort_code text not null,
  binding_id uuid references public.timetable_source_reconciliation_bindings(id) on delete set null,
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  draft_version_id uuid not null references public.timetable_versions(id) on delete cascade,
  parser_version text not null,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'superseded', 'published', 'rejected', 'failed')
  ),
  summary jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parse_run_id, discovered_cohort_id)
);

create index if not exists timetable_source_reviews_action_idx
  on public.timetable_source_reviews (source_id, status, created_at desc);

create index if not exists timetable_source_reviews_timetable_idx
  on public.timetable_source_reviews (timetable_id, draft_version_id);

alter table public.timetable_source_processing_jobs enable row level security;
alter table public.timetable_source_discovered_programmes enable row level security;
alter table public.timetable_source_discovered_cohorts enable row level security;
alter table public.timetable_source_reviews enable row level security;

revoke all on table public.timetable_source_processing_jobs from anon, authenticated;
revoke all on table public.timetable_source_discovered_programmes from anon, authenticated;
revoke all on table public.timetable_source_discovered_cohorts from anon, authenticated;
revoke all on table public.timetable_source_reviews from anon, authenticated;

grant all on table public.timetable_source_processing_jobs to service_role;
grant all on table public.timetable_source_discovered_programmes to service_role;
grant all on table public.timetable_source_discovered_cohorts to service_role;
grant all on table public.timetable_source_reviews to service_role;

create or replace function public.claim_timetable_source_processing_job()
returns table (
  id uuid,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select job.id
    from public.timetable_source_processing_jobs job
    where job.status in ('queued', 'failed')
      and job.available_at <= now()
    order by job.created_at desc
    limit 1
    for update skip locked
  )
  update public.timetable_source_processing_jobs job
  set
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    started_at = now(),
    updated_at = now()
  from claimed
  where job.id = claimed.id
  returning job.id, job.snapshot_id;
end;
$$;

create or replace function public.fail_timetable_source_processing_job(
  p_snapshot_id uuid,
  p_error_code text,
  p_error_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.timetable_source_processing_jobs
  set
    status = case when attempt_count >= 5 then 'failed' else 'queued' end,
    available_at = now() + ((least(attempt_count, 5) * 5) || ' minutes')::interval,
    last_error_code = p_error_code,
    last_error_metadata = coalesce(p_error_metadata, '{}'::jsonb),
    updated_at = now()
  where snapshot_id = p_snapshot_id;

  update public.timetable_sources source
  set
    last_processing_error_at = now(),
    last_processing_error_code = p_error_code,
    updated_at = now()
  from public.timetable_source_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and source.id = snapshot.source_id;
end;
$$;

create or replace function public.materialize_source_generated_draft(
  p_discovered_cohort_id uuid,
  p_parse_run_id uuid,
  p_parser_version text,
  p_sessions jsonb,
  p_snapshot_id uuid
)
returns table (
  review_id uuid,
  timetable_id uuid,
  draft_version_id uuid,
  session_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_binding_id uuid;
  v_discovered public.timetable_source_discovered_cohorts%rowtype;
  v_period public.academic_periods%rowtype;
  v_programme public.programmes%rowtype;
  v_cohort public.cohorts%rowtype;
  v_source public.timetable_sources%rowtype;
  v_timetable_id uuid;
  v_public_slug text;
  v_slug_base text;
  v_slug_suffix integer := 2;
  v_version_id uuid;
  v_version_number integer;
  v_review_id uuid;
begin
  select *
  into v_discovered
  from public.timetable_source_discovered_cohorts
  where id = p_discovered_cohort_id
    and mapping_status = 'mapped'
  for update;

  if not found then
    raise exception 'SOURCE_COHORT_MAPPING_NOT_FOUND';
  end if;

  select * into v_source from public.timetable_sources where id = v_discovered.source_id;
  select * into v_programme from public.programmes where id = v_discovered.target_programme_id;
  select * into v_cohort from public.cohorts where id = v_discovered.target_cohort_id;
  select * into v_period from public.academic_periods where id = v_discovered.target_academic_period_id;

  if v_programme.id is null or v_cohort.id is null or v_period.id is null then
    raise exception 'SOURCE_COHORT_MAPPING_TARGET_NOT_FOUND';
  end if;

  select t.id
  into v_timetable_id
  from public.timetables t
  where t.programme_id = v_programme.id
    and t.cohort_id = v_cohort.id
    and t.academic_period_id = v_period.id
  order by t.created_at
  limit 1
  for update;

  if v_timetable_id is null then
    v_slug_base := lower(regexp_replace(
      coalesce(v_programme.code, v_programme.name) || '-' || v_cohort.label || '-' || v_period.name,
      '[^a-zA-Z0-9]+',
      '-',
      'g'
    ));
    v_slug_base := trim(both '-' from v_slug_base);
    v_public_slug := v_slug_base;

    while exists (
      select 1
      from public.timetables
      where public_slug = v_public_slug
    ) loop
      v_public_slug := v_slug_base || '-' || v_slug_suffix;
      v_slug_suffix := v_slug_suffix + 1;
    end loop;

    insert into public.timetables (
      institution_id,
      slug,
      programme,
      cohort,
      semester,
      status,
      programme_id,
      cohort_id,
      academic_period_id,
      public_slug,
      updated_at
    )
    values (
      v_programme.institution_id,
      v_public_slug,
      v_programme.name,
      v_cohort.label,
      v_period.name,
      'draft',
      v_programme.id,
      v_cohort.id,
      v_period.id,
      v_public_slug,
      now()
    )
    returning id into v_timetable_id;
  end if;

  select v.id
  into v_version_id
  from public.timetable_versions v
  join public.timetable_source_reviews r on r.draft_version_id = v.id
  where r.discovered_cohort_id = p_discovered_cohort_id
    and r.status = 'pending'
    and v.status = 'draft'
  order by r.created_at desc
  limit 1
  for update;

  if v_version_id is null then
    select coalesce(max(version_number), 0) + 1
    into v_version_number
    from public.timetable_versions
    where timetable_id = v_timetable_id;

    insert into public.timetable_versions (
      timetable_id,
      version_label,
      source,
      version_number,
      status,
      change_summary,
      source_label,
      created_by
    )
    values (
      v_timetable_id,
      'v' || v_version_number,
      'source_gateway',
      v_version_number,
      'draft',
      'Source Gateway draft generated from ' || v_source.display_name,
      v_source.display_name,
      null
    )
    returning id into v_version_id;
  else
    delete from public.timetable_sessions
    where timetable_version_id = v_version_id;

    update public.timetable_source_reviews
    set status = 'superseded', updated_at = now()
    where discovered_cohort_id = p_discovered_cohort_id
      and status = 'pending';
  end if;

  insert into public.timetable_sessions (
    timetable_version_id,
    stable_session_key,
    course_code,
    course_name,
    session_type,
    weekday,
    start_time,
    end_time,
    starts_on,
    ends_on,
    venue,
    venue_raw,
    venue_normalized,
    lecturer,
    lecturer_raw,
    lecturer_normalized,
    notes,
    status,
    source_parse_run_id,
    source_candidate_key
  )
  select
    v_version_id,
    session_row->>'stableSessionKey',
    session_row->>'courseCode',
    session_row->>'courseName',
    nullif(session_row->>'sessionType', ''),
    (session_row->>'weekday')::smallint,
    (session_row->>'startTime')::time,
    (session_row->>'endTime')::time,
    v_period.starts_on,
    v_period.ends_on,
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'notes', ''),
    'tentative',
    p_parse_run_id,
    session_row->>'sourceCandidateKey'
  from jsonb_array_elements(p_sessions) as session_row;

  insert into public.timetable_source_reconciliation_bindings (
    source_key,
    source_cohort_code,
    target_public_slug,
    target_class_group_label,
    target_academic_period_name,
    target_timetable_id,
    target_programme_id,
    target_cohort_id,
    target_academic_period_id,
    active,
    updated_at
  )
  values (
    v_source.source_key,
    v_discovered.source_cohort_code,
    (select public_slug from public.timetables where id = v_timetable_id),
    v_cohort.label,
    v_period.name,
    v_timetable_id,
    v_programme.id,
    v_cohort.id,
    v_period.id,
    true,
    now()
  )
  on conflict (source_key, source_cohort_code) do update
  set
    target_public_slug = excluded.target_public_slug,
    target_class_group_label = excluded.target_class_group_label,
    target_academic_period_name = excluded.target_academic_period_name,
    target_timetable_id = excluded.target_timetable_id,
    target_programme_id = excluded.target_programme_id,
    target_cohort_id = excluded.target_cohort_id,
    target_academic_period_id = excluded.target_academic_period_id,
    active = true,
    updated_at = now()
  returning id into v_binding_id;

  insert into public.timetable_source_reviews (
    source_id,
    snapshot_id,
    parse_run_id,
    discovered_cohort_id,
    source_cohort_code,
    binding_id,
    timetable_id,
    draft_version_id,
    parser_version,
    status,
    summary
  )
  values (
    v_source.id,
    p_snapshot_id,
    p_parse_run_id,
    p_discovered_cohort_id,
    v_discovered.source_cohort_code,
    v_binding_id,
    v_timetable_id,
    v_version_id,
    p_parser_version,
    'pending',
    jsonb_build_object('sessionCount', jsonb_array_length(p_sessions))
  )
  on conflict (parse_run_id, discovered_cohort_id) do update
  set updated_at = now()
  returning id into v_review_id;

  update public.timetables
  set current_version_id = v_version_id, updated_at = now()
  where id = v_timetable_id;

  review_id := v_review_id;
  timetable_id := v_timetable_id;
  draft_version_id := v_version_id;
  session_count := jsonb_array_length(p_sessions);
  status := 'draft_generated';
  return next;
end;
$$;

revoke execute on function public.claim_timetable_source_processing_job() from public, anon, authenticated;
revoke execute on function public.fail_timetable_source_processing_job(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;

grant execute on function public.claim_timetable_source_processing_job() to service_role;
grant execute on function public.fail_timetable_source_processing_job(uuid, text, jsonb) to service_role;
grant execute on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid) to service_role;
