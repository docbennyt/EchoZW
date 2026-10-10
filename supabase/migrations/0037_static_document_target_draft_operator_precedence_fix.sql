-- Follow-up to 0036: parenthesize JSON extraction before text concatenation.
-- PostgreSQL operator precedence otherwise evaluates the text concatenation first.

create or replace function public.materialize_static_document_target_draft(
  p_import_target_id uuid,
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
  v_target public.import_targets%rowtype;
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

  select * into v_target
  from public.import_targets
  where id = p_import_target_id
  for update;
  if not found then
    raise exception 'STATIC_IMPORT_TARGET_NOT_FOUND';
  end if;

  select * into v_batch
  from public.import_batches
  where id = v_target.import_batch_id
    and import_mode = 'static_timetable_document'
  for update;
  if not found then raise exception 'STATIC_IMPORT_BATCH_NOT_FOUND'; end if;

  select * into v_document
  from public.source_documents
  where id = v_batch.source_document_id
  for update;
  if not found then raise exception 'STATIC_IMPORT_DOCUMENT_NOT_FOUND'; end if;

  select * into v_existing_version
  from public.timetable_versions
  where import_target_id = v_target.id
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

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as session_row(value)
    where not exists (
      select 1
      from public.import_candidates c
      join public.import_candidate_targets ct on ct.candidate_id = c.id
      where c.import_batch_id = v_target.import_batch_id
        and ct.import_target_id = v_target.id
        and c.candidate_key = session_row.value->>'candidateKey'
        and c.candidate_type = 'session'
    )
  ) then
    raise exception 'STATIC_IMPORT_TARGET_SESSION_INVALID';
  end if;

  if exists (
    select 1
    from public.import_candidate_warnings w
    join public.import_candidates c on c.id = w.candidate_id
    join public.import_candidate_targets ct on ct.candidate_id = c.id
    where ct.import_target_id = v_target.id
      and w.severity = 'blocking'
      and not exists (
        select 1
        from jsonb_array_elements(p_resolutions) as resolution(value)
        where resolution.value->>'warningId' = w.id::text
          and nullif(btrim(resolution.value->>'note'), '') is not null
      )
  ) then
    raise exception 'STATIC_IMPORT_BLOCKERS_UNRESOLVED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as session_row(value)
    where nullif(btrim(session_row.value->>'candidateKey'), '') is null
      or nullif(btrim(session_row.value->>'courseCode'), '') is null
      or nullif(btrim(session_row.value->>'courseName'), '') is null
      or coalesce(session_row.value->>'weekday', '') !~ '^[1-7]$'
      or coalesce(session_row.value->>'startTime', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
      or coalesce(session_row.value->>'endTime', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
      or (session_row.value->>'startTime')::time >= (session_row.value->>'endTime')::time
  ) then
    raise exception 'STATIC_IMPORT_SESSION_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as session_row(value)
    group by session_row.value->>'candidateKey'
    having count(*) > 1
  ) then
    raise exception 'STATIC_IMPORT_DUPLICATE_CANDIDATE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as session_row(value)
    group by
      upper(btrim(session_row.value->>'courseCode')),
      session_row.value->>'weekday',
      session_row.value->>'startTime',
      session_row.value->>'endTime'
    having count(*) > 1
  ) then
    raise exception 'STATIC_IMPORT_DUPLICATE_SESSION';
  end if;

  if exists (
    with planned as (
      select
        row_number() over () as n,
        (session_row.value->>'weekday')::int as weekday,
        (session_row.value->>'startTime')::time as start_time,
        (session_row.value->>'endTime')::time as end_time
      from jsonb_array_elements(p_sessions) as session_row(value)
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

  select * into v_timetable
  from public.timetables t
  where t.programme_id = p_programme_id
    and t.cohort_id = p_cohort_id
    and t.academic_period_id = p_academic_period_id
  order by t.created_at
  limit 1
  for update;

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
    import_batch_id,
    import_target_id
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
    v_batch.id,
    v_target.id
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
          v_target.id::text || '|' || (session_row.value->>'candidateKey'),
          'sha256'
        ),
        'hex'
      ),
      1,
      24
    ),
    btrim(session_row.value->>'courseCode'),
    btrim(session_row.value->>'courseName'),
    nullif(btrim(session_row.value->>'sessionType'), ''),
    (session_row.value->>'weekday')::smallint,
    (session_row.value->>'startTime')::time,
    (session_row.value->>'endTime')::time,
    v_period.starts_on,
    v_period.ends_on,
    nullif(btrim(session_row.value->>'venue'), ''),
    nullif(btrim(session_row.value->>'venue'), ''),
    nullif(btrim(session_row.value->>'venue'), ''),
    nullif(btrim(session_row.value->>'lecturer'), ''),
    nullif(btrim(session_row.value->>'lecturer'), ''),
    nullif(btrim(session_row.value->>'lecturer'), ''),
    case
      when nullif(btrim(session_row.value->>'deliveryModeRaw'), '') is null then null
      else 'Source delivery wording: ' || btrim(session_row.value->>'deliveryModeRaw')
    end,
    c.id,
    'tentative',
    session_row.value->>'candidateKey'
  from jsonb_array_elements(p_sessions) as session_row(value)
  join public.import_candidates c
    on c.import_batch_id = v_batch.id
   and c.candidate_key = session_row.value->>'candidateKey';

  update public.import_candidate_warnings w
  set
    resolved_at = now(),
    resolved_by = p_actor_id,
    resolution_note = resolution.value->>'note'
  from public.import_candidates c,
       jsonb_array_elements(p_resolutions) as resolution(value)
  where w.candidate_id = c.id
    and c.import_batch_id = v_batch.id
    and resolution.value->>'warningId' = w.id::text
    and nullif(btrim(resolution.value->>'note'), '') is not null;

  update public.import_targets
  set
    matched_programme_id = p_programme_id,
    matched_cohort_id = p_cohort_id,
    matched_academic_period_id = p_academic_period_id,
    review_status = 'materialized',
    updated_at = now()
  where id = v_target.id;

  update public.import_batches
  set
    selected_programme_id = p_programme_id,
    selected_cohort_id = p_cohort_id,
    selected_academic_period_id = p_academic_period_id,
    status = 'confirmed',
    completed_at = now(),
    summary = summary || jsonb_build_object(
      'lastDraftVersionId', v_version_id,
      'lastImportTargetId', v_target.id,
      'verifiedBy', p_actor_id
    )
  where id = v_batch.id;

  update public.source_documents
  set source_status = 'approved', academic_period_id = p_academic_period_id
  where id = v_document.id;

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

revoke all on function public.materialize_static_document_target_draft(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_static_document_target_draft(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
