-- DR-39: persist verified compare-only reconciliation evidence and publish only an
-- exact, human-reviewed guarded plan. These tables are service-role private.
--
-- CS.1 canary blast-radius policy lives in server/sourcePublication.ts and is
-- persisted into every plan. The database function refuses any plan carrying
-- blockers and requires exact approval of every explicit current-only removal.

create table if not exists public.timetable_source_reconciliations (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references public.timetable_source_reconciliation_bindings(id) on delete restrict,
  source_snapshot_id uuid not null references public.timetable_source_snapshots(id) on delete restrict,
  parse_run_id uuid not null references public.timetable_source_parse_runs(id) on delete restrict,
  timetable_id uuid not null references public.timetables(id) on delete restrict,
  published_version_id uuid not null references public.timetable_versions(id) on delete restrict,
  source_cohort_code text not null,
  parser_version text not null,
  result_hash text not null,
  result_payload jsonb not null,
  status text not null default 'verified' check (
    status in ('verified', 'published', 'superseded')
  ),
  verification_mode text not null default 'compare_only' check (
    verification_mode in ('compare_only')
  ),
  verified_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (
    source_snapshot_id,
    parse_run_id,
    timetable_id,
    published_version_id,
    source_cohort_code
  )
);

create index if not exists timetable_source_reconciliations_timetable_idx
  on public.timetable_source_reconciliations (
    timetable_id,
    status,
    verified_at desc
  );

create table if not exists public.timetable_source_publications (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null unique references public.timetable_source_reconciliations(id) on delete restrict,
  timetable_id uuid not null references public.timetables(id) on delete restrict,
  previous_published_version_id uuid not null references public.timetable_versions(id) on delete restrict,
  published_version_id uuid references public.timetable_versions(id) on delete restrict,
  plan_hash text not null,
  plan_payload jsonb not null,
  status text not null check (status in ('blocked', 'planned', 'published')),
  publication_mode text not null default 'canary_manual' check (
    publication_mode in ('canary_manual')
  ),
  actor_id uuid references auth.users(id) on delete set null,
  approved_removal_session_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (jsonb_typeof(plan_payload) = 'object'),
  check (jsonb_typeof(approved_removal_session_ids) = 'array')
);

create index if not exists timetable_source_publications_timetable_idx
  on public.timetable_source_publications (timetable_id, status, created_at desc);

alter table public.timetable_source_reconciliations enable row level security;
alter table public.timetable_source_publications enable row level security;

revoke all on table public.timetable_source_reconciliations from anon, authenticated;
revoke all on table public.timetable_source_publications from anon, authenticated;
grant all on table public.timetable_source_reconciliations to service_role;
grant all on table public.timetable_source_publications to service_role;

alter table public.timetable_versions
  add column if not exists source_snapshot_id uuid references public.timetable_source_snapshots(id) on delete set null,
  add column if not exists source_parse_run_id uuid references public.timetable_source_parse_runs(id) on delete set null,
  add column if not exists source_reconciliation_id uuid references public.timetable_source_reconciliations(id) on delete set null,
  add column if not exists previous_published_version_id uuid references public.timetable_versions(id) on delete set null,
  add column if not exists publication_plan_hash text,
  add column if not exists publication_mode text;

create index if not exists timetable_versions_source_reconciliation_idx
  on public.timetable_versions (source_reconciliation_id)
  where source_reconciliation_id is not null;

create or replace function public.publish_guarded_source_reconciliation(
  p_publication_id uuid,
  p_expected_plan_hash text,
  p_published_by uuid,
  p_approved_removal_session_ids jsonb default '[]'::jsonb
)
returns table (
  publication_id uuid,
  public_slug text,
  version_id uuid,
  version_number integer,
  session_count integer,
  published_at timestamptz,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication public.timetable_source_publications%rowtype;
  v_reconciliation public.timetable_source_reconciliations%rowtype;
  v_timetable public.timetables%rowtype;
  v_plan jsonb;
  v_version_id uuid;
  v_version_number integer;
  v_session_count integer;
  v_period_starts_on date;
  v_period_ends_on date;
  v_published_at timestamptz;
begin
  if p_published_by is null then
    raise exception 'SOURCE_PUBLICATION_ACTOR_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_approved_removal_session_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'SOURCE_PUBLICATION_REMOVAL_APPROVAL_INVALID';
  end if;

  select sp.*
  into v_publication
  from public.timetable_source_publications sp
  where sp.id = p_publication_id
  for update;

  if not found then
    raise exception 'SOURCE_PUBLICATION_NOT_FOUND';
  end if;

  if v_publication.plan_hash <> p_expected_plan_hash then
    raise exception 'SOURCE_PUBLICATION_PLAN_HASH_MISMATCH';
  end if;

  if v_publication.status = 'published' then
    if v_publication.published_version_id is null then
      raise exception 'SOURCE_PUBLICATION_CORRUPT_STATE';
    end if;

    return query
    select
      v_publication.id,
      t.public_slug,
      v.id,
      v.version_number,
      (select count(*)::integer from public.timetable_sessions ts where ts.timetable_version_id = v.id),
      v.published_at,
      true
    from public.timetables t
    join public.timetable_versions v on v.id = v_publication.published_version_id
    where t.id = v_publication.timetable_id;
    return;
  end if;

  if v_publication.status <> 'planned' then
    raise exception 'SOURCE_PUBLICATION_BLOCKED';
  end if;

  select sr.*
  into v_reconciliation
  from public.timetable_source_reconciliations sr
  where sr.id = v_publication.reconciliation_id
    and sr.status = 'verified'
  for update;

  if not found then
    raise exception 'SOURCE_RECONCILIATION_NOT_VERIFIED';
  end if;

  select t.*
  into v_timetable
  from public.timetables t
  where t.id = v_publication.timetable_id
  for update;

  if not found then
    raise exception 'TIMETABLE_NOT_FOUND';
  end if;

  if v_publication.timetable_id <> v_reconciliation.timetable_id
    or v_publication.previous_published_version_id <> v_reconciliation.published_version_id
  then
    raise exception 'SOURCE_PUBLICATION_RECONCILIATION_MISMATCH';
  end if;

  if v_timetable.current_published_version_id is distinct from v_reconciliation.published_version_id then
    raise exception 'SOURCE_PUBLICATION_STALE_BASE';
  end if;

  v_plan := v_publication.plan_payload;

  if v_plan->>'reconciliationId' is distinct from v_reconciliation.id::text
    or v_plan->>'timetableId' is distinct from v_reconciliation.timetable_id::text
    or v_plan->>'previousPublishedVersionId' is distinct from v_reconciliation.published_version_id::text
    or v_plan->>'sourceSnapshotId' is distinct from v_reconciliation.source_snapshot_id::text
    or v_plan->>'parseRunId' is distinct from v_reconciliation.parse_run_id::text
    or v_plan->>'reconciliationResultHash' is distinct from v_reconciliation.result_hash
  then
    raise exception 'SOURCE_PUBLICATION_PLAN_INPUT_MISMATCH';
  end if;

  if jsonb_typeof(coalesce(v_plan->'blockers', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(v_plan->'blockers', '[]'::jsonb)) > 0
  then
    raise exception 'SOURCE_PUBLICATION_PLAN_HAS_BLOCKERS';
  end if;

  if jsonb_typeof(coalesce(v_plan->'removalSessionIds', '[]'::jsonb)) <> 'array' then
    raise exception 'SOURCE_PUBLICATION_REMOVAL_PLAN_INVALID';
  end if;

  -- A current-only session can disappear only when the operator executing this
  -- exact plan approves that exact session id. Extra or missing approvals fail.
  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_plan->'removalSessionIds', '[]'::jsonb)) planned(id)
    where not exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_approved_removal_session_ids, '[]'::jsonb)) approved(id)
      where approved.id = planned.id
    )
  ) or exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_approved_removal_session_ids, '[]'::jsonb)) approved(id)
    where not exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_plan->'removalSessionIds', '[]'::jsonb)) planned(id)
      where planned.id = approved.id
    )
  ) then
    raise exception 'SOURCE_PUBLICATION_REMOVAL_APPROVAL_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(v_plan->'sessions', '[]'::jsonb)) <> 'array' then
    raise exception 'SOURCE_PUBLICATION_SESSIONS_INVALID';
  end if;

  v_session_count := jsonb_array_length(coalesce(v_plan->'sessions', '[]'::jsonb));
  if v_session_count < 1 then
    raise exception 'TIMETABLE_EMPTY';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_plan->'sessions') session_row
    where nullif(btrim(session_row->>'stableSessionKey'), '') is null
      or nullif(btrim(session_row->>'courseCode'), '') is null
      or nullif(btrim(session_row->>'courseName'), '') is null
      or coalesce(session_row->>'weekday', '') !~ '^[1-7]$'
      or coalesce(session_row->>'startTime', '') !~ '^[0-2][0-9]:[0-5][0-9]:[0-5][0-9]$'
      or coalesce(session_row->>'endTime', '') !~ '^[0-2][0-9]:[0-5][0-9]:[0-5][0-9]$'
      or (session_row->>'endTime')::time <= (session_row->>'startTime')::time
      or nullif(session_row->>'sourceParseRunId', '')::uuid is distinct from v_reconciliation.parse_run_id
  ) then
    raise exception 'SOURCE_PUBLICATION_SESSION_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_plan->'sessions') session_row
    group by session_row->>'stableSessionKey'
    having count(*) > 1
  ) then
    raise exception 'SOURCE_PUBLICATION_DUPLICATE_STABLE_KEY';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_plan->'sessions') session_row
    group by
      upper(btrim(session_row->>'courseCode')),
      session_row->>'weekday',
      session_row->>'startTime',
      session_row->>'endTime'
    having count(*) > 1
  ) then
    raise exception 'SOURCE_PUBLICATION_DUPLICATE_LOGICAL_SESSION';
  end if;

  if exists (
    with planned as (
      select
        row_number() over () as row_number,
        (session_row->>'weekday')::integer as weekday,
        (session_row->>'startTime')::time as start_time,
        (session_row->>'endTime')::time as end_time
      from jsonb_array_elements(v_plan->'sessions') session_row
    )
    select 1
    from planned left_session
    join planned right_session
      on right_session.row_number > left_session.row_number
     and right_session.weekday = left_session.weekday
     and right_session.start_time < left_session.end_time
     and right_session.end_time > left_session.start_time
  ) then
    raise exception 'TIMETABLE_CONFLICT';
  end if;

  select ap.starts_on, ap.ends_on
  into v_period_starts_on, v_period_ends_on
  from public.academic_periods ap
  where ap.id = v_timetable.academic_period_id;

  if v_period_starts_on is null or v_period_ends_on is null then
    raise exception 'SOURCE_PUBLICATION_ACADEMIC_PERIOD_DATES_REQUIRED';
  end if;

  select coalesce(max(tv.version_number), 0) + 1
  into v_version_number
  from public.timetable_versions tv
  where tv.timetable_id = v_timetable.id;

  insert into public.timetable_versions (
    timetable_id,
    version_label,
    source,
    version_number,
    status,
    verification_status,
    change_summary,
    source_label,
    created_by,
    source_snapshot_id,
    source_parse_run_id,
    source_reconciliation_id,
    previous_published_version_id,
    publication_plan_hash,
    publication_mode
  )
  values (
    v_timetable.id,
    'v' || v_version_number,
    'source_reconciliation',
    v_version_number,
    'draft',
    'official',
    'Guarded source publication from verified reconciliation ' || v_reconciliation.id,
    'Verified Source Gateway reconciliation',
    p_published_by,
    v_reconciliation.source_snapshot_id,
    v_reconciliation.parse_run_id,
    v_reconciliation.id,
    v_reconciliation.published_version_id,
    v_publication.plan_hash,
    v_publication.publication_mode
  )
  returning public.timetable_versions.id into v_version_id;

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
    v_period_starts_on,
    v_period_ends_on,
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'venue', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'lecturer', ''),
    nullif(session_row->>'notes', ''),
    'confirmed',
    nullif(session_row->>'sourceParseRunId', '')::uuid,
    nullif(session_row->>'sourceCandidateKey', '')
  from jsonb_array_elements(v_plan->'sessions') session_row;

  -- No student-visible pointer has changed before all validation and inserts pass.
  -- Any later exception rolls this entire function back as one transaction.
  update public.timetable_versions tv
  set status = 'superseded'
  where tv.id = v_reconciliation.published_version_id
    and tv.timetable_id = v_timetable.id
    and tv.status = 'published';

  v_published_at := now();

  update public.timetable_versions tv
  set
    status = 'published',
    published_at = v_published_at,
    published_by = p_published_by,
    published_by_user_id = p_published_by
  where tv.id = v_version_id;

  update public.timetables t
  set
    current_published_version_id = v_version_id,
    current_version_id = v_version_id,
    status = 'official',
    updated_at = v_published_at
  where t.id = v_timetable.id;

  update public.timetable_source_publications sp
  set
    status = 'published',
    published_version_id = v_version_id,
    actor_id = p_published_by,
    approved_removal_session_ids = coalesce(p_approved_removal_session_ids, '[]'::jsonb),
    published_at = v_published_at,
    updated_at = v_published_at
  where sp.id = v_publication.id;

  update public.timetable_source_reconciliations sr
  set status = 'published'
  where sr.id = v_reconciliation.id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_published_by,
    'source_reconciliation.published',
    'timetable_version',
    v_version_id,
    jsonb_build_object(
      'publicationId', v_publication.id,
      'publicationMode', v_publication.publication_mode,
      'planHash', v_publication.plan_hash,
      'reconciliationId', v_reconciliation.id,
      'sourceSnapshotId', v_reconciliation.source_snapshot_id,
      'parseRunId', v_reconciliation.parse_run_id,
      'previousPublishedVersionId', v_reconciliation.published_version_id,
      'approvedRemovalSessionIds', coalesce(p_approved_removal_session_ids, '[]'::jsonb)
    )
  );

  return query
  select
    v_publication.id,
    t.public_slug,
    tv.id,
    tv.version_number,
    v_session_count,
    tv.published_at,
    false
  from public.timetables t
  join public.timetable_versions tv on tv.id = v_version_id
  where t.id = v_timetable.id;
end;
$$;

revoke execute on function public.publish_guarded_source_reconciliation(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_guarded_source_reconciliation(uuid, text, uuid, jsonb)
  to service_role;
