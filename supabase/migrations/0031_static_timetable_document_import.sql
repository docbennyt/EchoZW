-- DR-120: deterministic class-specific static timetable document imports.
-- This migration deliberately creates review drafts only. It never changes the
-- student-visible current_published_version_id pointer.

alter table public.timetables
  add column if not exists source_strategy text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'timetables_source_strategy_check'
  ) then
    alter table public.timetables
      add constraint timetables_source_strategy_check
      check (source_strategy in ('manual', 'live_managed_source', 'static_document', 'hybrid'));
  end if;
end $$;

-- Preserve the meaning of already-bound watcher timetables.
update public.timetables t
set source_strategy = 'live_managed_source'
where t.source_strategy = 'manual'
  and exists (
    select 1
    from public.timetable_source_reconciliation_bindings b
    where b.target_timetable_id = t.id
      and b.active = true
  );

alter table public.import_candidates
  add column if not exists candidate_key text,
  add column if not exists source_column integer,
  add column if not exists delivery_mode_raw text;

create unique index if not exists import_candidates_batch_candidate_key_unique
  on public.import_candidates (import_batch_id, candidate_key)
  where candidate_key is not null;

alter table public.import_candidate_warnings
  add column if not exists resolution_note text;

alter table public.timetable_versions
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

create unique index if not exists timetable_versions_static_import_batch_unique
  on public.timetable_versions (import_batch_id)
  where import_batch_id is not null;

create unique index if not exists import_batches_static_docx_idempotency_unique
  on public.import_batches (source_document_id, parser_version)
  where import_mode = 'cohort_docx';

-- Persist a deterministic parse result atomically. The source document itself is
-- retained before parsing; this transaction prevents a concurrent duplicate from
-- observing a half-written batch/candidate/warning graph.
create or replace function public.persist_static_document_import(
  p_source_document_id uuid,
  p_actor_id uuid,
  p_parser_version text,
  p_summary jsonb,
  p_candidates jsonb,
  p_warnings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  if p_actor_id is null then
    raise exception 'STATIC_IMPORT_ACTOR_REQUIRED';
  end if;
  if nullif(btrim(p_parser_version), '') is null then
    raise exception 'STATIC_IMPORT_PARSER_VERSION_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_summary, '{}'::jsonb)) <> 'object' then
    raise exception 'STATIC_IMPORT_SUMMARY_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_candidates, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_candidates, '[]'::jsonb)) < 1 then
    raise exception 'STATIC_IMPORT_CANDIDATES_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_warnings, '[]'::jsonb)) <> 'array' then
    raise exception 'STATIC_IMPORT_WARNINGS_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_candidates) candidate
    where nullif(candidate->>'candidate_key', '') is null
      or nullif(candidate->>'raw_text', '') is null
      or nullif(candidate->>'candidate_type', '') is null
  ) then
    raise exception 'STATIC_IMPORT_CANDIDATE_INVALID';
  end if;

  perform 1
  from public.source_documents d
  where d.id = p_source_document_id
  for update;
  if not found then
    raise exception 'STATIC_IMPORT_DOCUMENT_NOT_FOUND';
  end if;

  insert into public.import_batches (
    source_document_id,
    import_mode,
    status,
    parser_version,
    started_by,
    summary
  ) values (
    p_source_document_id,
    'cohort_docx',
    'review_required',
    p_parser_version,
    p_actor_id,
    coalesce(p_summary, '{}'::jsonb)
  )
  on conflict (source_document_id, parser_version)
    where import_mode = 'cohort_docx'
  do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select b.id
    into v_batch_id
    from public.import_batches b
    where b.source_document_id = p_source_document_id
      and b.import_mode = 'cohort_docx'
      and b.parser_version = p_parser_version
    limit 1;

    if v_batch_id is null then
      raise exception 'STATIC_IMPORT_IDEMPOTENCY_LOOKUP_FAILED';
    end if;

    update public.source_documents
    set
      source_status = 'review_required',
      parser_version = p_parser_version
    where id = p_source_document_id;

    return v_batch_id;
  end if;

  insert into public.import_candidates (
    import_batch_id,
    candidate_key,
    source_table,
    source_row,
    source_column,
    source_cell,
    raw_text,
    candidate_type,
    course_code_raw,
    course_name_raw,
    day_raw,
    weekday,
    time_raw,
    start_time,
    end_time,
    venue_raw,
    lecturer_raw,
    delivery_mode_raw,
    review_status,
    normalized_payload
  )
  select
    v_batch_id,
    candidate->>'candidate_key',
    nullif(candidate->>'source_table', '')::integer,
    nullif(candidate->>'source_row', '')::integer,
    nullif(candidate->>'source_column', '')::integer,
    nullif(candidate->>'source_cell', ''),
    candidate->>'raw_text',
    candidate->>'candidate_type',
    nullif(candidate->>'course_code_raw', ''),
    nullif(candidate->>'course_name_raw', ''),
    nullif(candidate->>'day_raw', ''),
    nullif(candidate->>'weekday', '')::smallint,
    nullif(candidate->>'time_raw', ''),
    nullif(candidate->>'start_time', '')::time,
    nullif(candidate->>'end_time', '')::time,
    nullif(candidate->>'venue_raw', ''),
    nullif(candidate->>'lecturer_raw', ''),
    nullif(candidate->>'delivery_mode_raw', ''),
    coalesce(nullif(candidate->>'review_status', ''), 'unreviewed'),
    coalesce(candidate->'normalized_payload', '{}'::jsonb)
  from jsonb_array_elements(p_candidates) candidate;

  if exists (
    select 1
    from jsonb_array_elements(p_warnings) warning
    where nullif(warning->>'candidate_key', '') is null
      or not exists (
        select 1
        from public.import_candidates c
        where c.import_batch_id = v_batch_id
          and c.candidate_key = warning->>'candidate_key'
      )
  ) then
    raise exception 'STATIC_IMPORT_WARNING_CANDIDATE_NOT_FOUND';
  end if;

  insert into public.import_candidate_warnings (
    candidate_id,
    warning_code,
    severity,
    message,
    field_name,
    suggested_value
  )
  select
    c.id,
    warning->>'warning_code',
    warning->>'severity',
    warning->>'message',
    nullif(warning->>'field_name', ''),
    nullif(warning->>'suggested_value', '')
  from jsonb_array_elements(p_warnings) warning
  join public.import_candidates c
    on c.import_batch_id = v_batch_id
   and c.candidate_key = warning->>'candidate_key';

  update public.source_documents
  set
    source_status = 'review_required',
    parser_version = p_parser_version
  where id = p_source_document_id;

  return v_batch_id;
end;
$$;

revoke all on function public.persist_static_document_import(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_static_document_import(uuid, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

-- Live watcher materialization must not reinterpret a class whose durable source
-- authority is a static document. The server checks this guard immediately before
-- source-gateway draft materialization.
create or replace function public.guard_live_source_materialization(
  p_programme_id uuid,
  p_cohort_id uuid,
  p_academic_period_id uuid
)
returns table (
  status text,
  timetable_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timetable_id uuid;
begin
  select t.id
  into v_timetable_id
  from public.timetables t
  where t.programme_id = p_programme_id
    and t.cohort_id = p_cohort_id
    and t.academic_period_id = p_academic_period_id
    and t.source_strategy = 'static_document'
  order by t.created_at
  limit 1;

  if v_timetable_id is not null then
    status := 'skipped';
    timetable_id := v_timetable_id;
    return next;
    return;
  end if;

  status := 'allowed';
  timetable_id := null;
  return next;
end;
$$;

revoke all on function public.guard_live_source_materialization(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.guard_live_source_materialization(uuid, uuid, uuid) to service_role;

create or replace function public.materialize_static_document_draft(
  p_import_batch_id uuid,
  p_actor_id uuid,
  p_programme_id uuid,
  p_cohort_id uuid,
  p_academic_period_id uuid,
  p_resolutions jsonb,
  p_sessions jsonb
)
returns table (
  timetable_id uuid,
  draft_version_id uuid,
  public_slug text,
  session_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_batch public.import_batches%rowtype;
  v_document public.source_documents%rowtype;
  v_programme public.programmes%rowtype;
  v_cohort public.cohorts%rowtype;
  v_period public.academic_periods%rowtype;
  v_timetable public.timetables%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_slug_base text;
  v_slug text;
  v_slug_suffix integer := 2;
  v_existing_version public.timetable_versions%rowtype;
begin
  if p_actor_id is null then
    raise exception 'STATIC_IMPORT_ACTOR_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) < 1 then
    raise exception 'STATIC_IMPORT_SESSIONS_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_resolutions, '[]'::jsonb)) <> 'array' then
    raise exception 'STATIC_IMPORT_RESOLUTIONS_INVALID';
  end if;

  select * into v_batch
  from public.import_batches
  where id = p_import_batch_id
    and import_mode = 'cohort_docx'
  for update;
  if not found then raise exception 'STATIC_IMPORT_BATCH_NOT_FOUND'; end if;

  select * into v_document
  from public.source_documents
  where id = v_batch.source_document_id
  for update;
  if not found then raise exception 'STATIC_IMPORT_DOCUMENT_NOT_FOUND'; end if;

  select * into v_programme from public.programmes where id = p_programme_id;
  select * into v_cohort from public.cohorts where id = p_cohort_id;
  select * into v_period from public.academic_periods where id = p_academic_period_id;

  if v_programme.id is null or v_cohort.id is null or v_period.id is null then
    raise exception 'STATIC_IMPORT_CANONICAL_MAPPING_NOT_FOUND';
  end if;
  if v_programme.institution_id <> v_document.institution_id
    or v_period.institution_id <> v_document.institution_id
    or v_cohort.programme_id <> v_programme.id then
    raise exception 'STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH';
  end if;
  if v_period.starts_on is null or v_period.ends_on is null then
    raise exception 'STATIC_IMPORT_ACADEMIC_PERIOD_DATES_REQUIRED';
  end if;

  -- Every blocking parser warning must receive an explicit human resolution note.
  if exists (
    select 1
    from public.import_candidate_warnings w
    join public.import_candidates c on c.id = w.candidate_id
    where c.import_batch_id = p_import_batch_id
      and w.severity = 'blocking'
      and not exists (
        select 1
        from jsonb_array_elements(p_resolutions) resolution
        where resolution->>'warningId' = w.id::text
          and nullif(btrim(resolution->>'note'), '') is not null
      )
  ) then
    raise exception 'STATIC_IMPORT_BLOCKERS_UNRESOLVED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) session_row
    where nullif(btrim(session_row->>'candidateKey'), '') is null
      or nullif(btrim(session_row->>'courseCode'), '') is null
      or nullif(btrim(session_row->>'courseName'), '') is null
      or coalesce(session_row->>'weekday', '') !~ '^[1-7]$'
      or coalesce(session_row->>'startTime', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
      or coalesce(session_row->>'endTime', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
      or (session_row->>'startTime')::time >= (session_row->>'endTime')::time
      or not exists (
        select 1
        from public.import_candidates c
        where c.import_batch_id = p_import_batch_id
          and c.candidate_key = session_row->>'candidateKey'
          and c.candidate_type = 'session'
      )
  ) then
    raise exception 'STATIC_IMPORT_SESSION_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) session_row
    group by session_row->>'candidateKey'
    having count(*) > 1
  ) then
    raise exception 'STATIC_IMPORT_DUPLICATE_CANDIDATE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) session_row
    group by
      upper(btrim(session_row->>'courseCode')),
      session_row->>'weekday',
      session_row->>'startTime',
      session_row->>'endTime'
    having count(*) > 1
  ) then
    raise exception 'STATIC_IMPORT_DUPLICATE_SESSION';
  end if;

  if exists (
    with planned as (
      select
        row_number() over () as n,
        (session_row->>'weekday')::int as weekday,
        (session_row->>'startTime')::time as start_time,
        (session_row->>'endTime')::time as end_time
      from jsonb_array_elements(p_sessions) session_row
    )
    select 1
    from planned a
    join planned b
      on b.n > a.n
     and b.weekday = a.weekday
     and b.start_time < a.end_time
     and b.end_time > a.start_time
  ) then
    raise exception 'STATIC_IMPORT_TIMETABLE_CONFLICT';
  end if;

  -- Same batch is an idempotent replay, never a duplicate draft.
  select * into v_existing_version
  from public.timetable_versions
  where import_batch_id = p_import_batch_id
  limit 1;
  if found then
    return query
    select
      v_existing_version.timetable_id,
      v_existing_version.id,
      t.public_slug,
      (
        select count(*)::int
        from public.timetable_sessions s
        where s.timetable_version_id = v_existing_version.id
      ),
      'existing'::text
    from public.timetables t
    where t.id = v_existing_version.timetable_id;
    return;
  end if;

  select * into v_timetable
  from public.timetables t
  where t.programme_id = p_programme_id
    and t.cohort_id = p_cohort_id
    and t.academic_period_id = p_academic_period_id
  order by t.created_at
  limit 1
  for update;

  -- Static import never takes ownership of a previously published class from a
  -- different source strategy. That transition requires explicit reconciliation.
  if found
    and v_timetable.current_published_version_id is not null
    and v_timetable.source_strategy <> 'static_document' then
    raise exception 'STATIC_IMPORT_EXISTING_PUBLISHED_REQUIRES_RECONCILIATION';
  end if;

  if not found then
    v_slug_base := lower(regexp_replace(
      coalesce(v_programme.code, v_programme.name) || '-' || v_cohort.label || '-' || v_period.name,
      '[^a-zA-Z0-9]+',
      '-',
      'g'
    ));
    v_slug_base := trim(both '-' from v_slug_base);
    v_slug := v_slug_base;
    while exists (
      select 1 from public.timetables where public_slug = v_slug
    ) loop
      v_slug := v_slug_base || '-' || v_slug_suffix;
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
      source_strategy,
      created_by,
      updated_at
    ) values (
      v_programme.institution_id,
      v_slug,
      v_programme.name,
      v_cohort.label,
      v_period.name,
      'draft',
      v_programme.id,
      v_cohort.id,
      v_period.id,
      v_slug,
      'static_document',
      p_actor_id,
      now()
    ) returning * into v_timetable;
  else
    update public.timetables
    set source_strategy = 'static_document', updated_at = now()
    where id = v_timetable.id
    returning * into v_timetable;
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_version_number
  from public.timetable_versions v
  where v.timetable_id = v_timetable.id;

  insert into public.timetable_versions (
    timetable_id,
    version_label,
    source,
    version_number,
    status,
    verification_status,
    source_document_id,
    source_label,
    source_is_draft,
    change_summary,
    created_by,
    import_batch_id
  ) values (
    v_timetable.id,
    'v' || v_version_number,
    'static_document',
    v_version_number,
    'draft',
    'unverified',
    v_document.id,
    v_document.original_filename,
    false,
    'Human-reviewed static document import draft',
    p_actor_id,
    p_import_batch_id
  ) returning id into v_version_id;

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
    source_candidate_id,
    status,
    source_candidate_key
  )
  select
    v_version_id,
    'static_' || substr(
      encode(
        extensions.digest(
          p_import_batch_id::text || '|' || session_row->>'candidateKey',
          'sha256'
        ),
        'hex'
      ),
      1,
      24
    ),
    btrim(session_row->>'courseCode'),
    btrim(session_row->>'courseName'),
    nullif(btrim(session_row->>'sessionType'), ''),
    (session_row->>'weekday')::smallint,
    (session_row->>'startTime')::time,
    (session_row->>'endTime')::time,
    v_period.starts_on,
    v_period.ends_on,
    nullif(btrim(session_row->>'venue'), ''),
    nullif(btrim(session_row->>'venue'), ''),
    nullif(btrim(session_row->>'venue'), ''),
    nullif(btrim(session_row->>'lecturer'), ''),
    nullif(btrim(session_row->>'lecturer'), ''),
    nullif(btrim(session_row->>'lecturer'), ''),
    case
      when nullif(btrim(session_row->>'deliveryModeRaw'), '') is null then null
      else 'Source delivery wording: ' || btrim(session_row->>'deliveryModeRaw')
    end,
    c.id,
    'tentative',
    session_row->>'candidateKey'
  from jsonb_array_elements(p_sessions) session_row
  join public.import_candidates c
    on c.import_batch_id = p_import_batch_id
   and c.candidate_key = session_row->>'candidateKey';

  update public.import_candidate_warnings w
  set
    resolved_at = now(),
    resolved_by = p_actor_id,
    resolution_note = resolution->>'note'
  from public.import_candidates c,
       jsonb_array_elements(p_resolutions) resolution
  where w.candidate_id = c.id
    and c.import_batch_id = p_import_batch_id
    and resolution->>'warningId' = w.id::text
    and nullif(btrim(resolution->>'note'), '') is not null;

  update public.import_batches
  set
    selected_programme_id = p_programme_id,
    selected_cohort_id = p_cohort_id,
    selected_academic_period_id = p_academic_period_id,
    status = 'confirmed',
    completed_at = now(),
    summary = summary || jsonb_build_object(
      'draftVersionId', v_version_id,
      'verifiedBy', p_actor_id
    )
  where id = p_import_batch_id;

  update public.source_documents
  set source_status = 'approved', academic_period_id = p_academic_period_id
  where id = v_document.id;

  -- This pointer is review-facing only. Publication remains guarded elsewhere.
  update public.timetables
  set current_version_id = v_version_id, updated_at = now()
  where id = v_timetable.id;

  return query
  select
    v_timetable.id,
    v_version_id,
    v_timetable.public_slug,
    jsonb_array_length(p_sessions)::int,
    'draft'::text;
end;
$$;

revoke all on function public.materialize_static_document_draft(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.materialize_static_document_draft(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;
