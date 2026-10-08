-- DR-161: static timetable documents may contain multiple review targets.
-- Supabase remains relational truth; raw bytes remain private object storage.

alter table public.source_documents
  drop constraint if exists source_documents_document_type_check;

alter table public.source_documents
  add constraint source_documents_document_type_check
  check (
    document_type in (
      'master_timetable_pdf',
      'cohort_timetable_docx',
      'structured_csv',
      'supporting_evidence',
      'static_timetable_document'
    )
  );

alter table public.import_batches
  drop constraint if exists import_batches_import_mode_check;

alter table public.import_batches
  add constraint import_batches_import_mode_check
  check (
    import_mode in (
      'cohort_csv',
      'cohort_docx',
      'master_pdf_assisted',
      'course_catalog_from_pdf',
      'static_timetable_document'
    )
  );

create table if not exists public.import_targets (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  target_key text not null,
  title_raw text not null,
  academic_unit_name_raw text,
  programme_name_raw text,
  programme_code_raw text,
  cohort_label_raw text,
  year_level_raw text,
  year_level integer,
  semester_raw text,
  semester_number integer,
  academic_year_raw text,
  matched_academic_unit_id uuid references public.academic_units(id) on delete set null,
  matched_programme_id uuid references public.programmes(id) on delete set null,
  matched_cohort_id uuid references public.cohorts(id) on delete set null,
  matched_academic_period_id uuid references public.academic_periods(id) on delete set null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'unreviewed' check (
    review_status in (
      'unreviewed',
      'valid',
      'warning',
      'invalid',
      'ignored',
      'approved',
      'materialized'
    )
  ),
  reviewer_notes text,
  normalized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_batch_id, target_key)
);

create table if not exists public.import_candidate_targets (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.import_candidates(id) on delete cascade,
  import_target_id uuid not null references public.import_targets(id) on delete cascade,
  applicability_raw text not null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'unreviewed' check (
    review_status in ('unreviewed', 'valid', 'warning', 'invalid', 'ignored', 'approved')
  ),
  reviewer_notes text,
  normalized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, import_target_id)
);

alter table public.import_targets enable row level security;
alter table public.import_candidate_targets enable row level security;

drop policy if exists "import admins manage import targets" on public.import_targets;
create policy "import admins manage import targets"
  on public.import_targets for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

drop policy if exists "import admins manage import candidate targets" on public.import_candidate_targets;
create policy "import admins manage import candidate targets"
  on public.import_candidate_targets for all
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'))
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'import_admin'));

grant all on table public.import_targets to service_role;
grant all on table public.import_candidate_targets to service_role;

alter table public.timetable_versions
  add column if not exists import_target_id uuid references public.import_targets(id) on delete set null;

drop index if exists public.timetable_versions_static_import_batch_unique;

create unique index if not exists timetable_versions_static_import_target_unique
  on public.timetable_versions (import_target_id)
  where import_target_id is not null;

create index if not exists timetable_versions_static_import_batch_idx
  on public.timetable_versions (import_batch_id)
  where import_batch_id is not null;

create unique index if not exists import_batches_static_document_idempotency_unique
  on public.import_batches (source_document_id, parser_version, import_mode)
  where import_mode = 'static_timetable_document';

create or replace function public.persist_static_document_import_v2(
  p_source_document_id uuid,
  p_actor_id uuid,
  p_parser_version text,
  p_summary jsonb,
  p_candidates jsonb,
  p_warnings jsonb,
  p_targets jsonb,
  p_candidate_targets jsonb
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
  if jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array' then
    raise exception 'STATIC_IMPORT_TARGETS_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_candidate_targets, '[]'::jsonb)) <> 'array' then
    raise exception 'STATIC_IMPORT_CANDIDATE_TARGETS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_candidates) candidate
    where nullif(candidate->>'candidate_key', '') is null
      or nullif(candidate->>'candidate_type', '') is null
      or (
        nullif(btrim(candidate->>'raw_text'), '') is null
        and not (
          candidate->>'candidate_type' = 'ignored_row'
          and coalesce(candidate #>> '{normalized_payload,kind}', '') = 'blank'
        )
      )
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
    'static_timetable_document',
    'review_required',
    p_parser_version,
    p_actor_id,
    coalesce(p_summary, '{}'::jsonb)
  )
  on conflict (source_document_id, parser_version, import_mode)
    where import_mode = 'static_timetable_document'
  do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select b.id
    into v_batch_id
    from public.import_batches b
    where b.source_document_id = p_source_document_id
      and b.import_mode = 'static_timetable_document'
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
  from jsonb_array_elements(p_candidates) candidate
  where not (
    candidate->>'candidate_type' = 'ignored_row'
    and nullif(btrim(candidate->>'raw_text'), '') is null
    and coalesce(candidate #>> '{normalized_payload,kind}', '') = 'blank'
  );

  insert into public.import_targets (
    import_batch_id,
    target_key,
    title_raw,
    academic_unit_name_raw,
    programme_name_raw,
    programme_code_raw,
    cohort_label_raw,
    year_level_raw,
    year_level,
    semester_raw,
    semester_number,
    academic_year_raw,
    matched_academic_unit_id,
    matched_programme_id,
    matched_cohort_id,
    matched_academic_period_id,
    confidence,
    review_status,
    normalized_payload
  )
  select
    v_batch_id,
    target->>'target_key',
    target->>'title_raw',
    nullif(target->>'academic_unit_name_raw', ''),
    nullif(target->>'programme_name_raw', ''),
    nullif(target->>'programme_code_raw', ''),
    nullif(target->>'cohort_label_raw', ''),
    nullif(target->>'year_level_raw', ''),
    nullif(target->>'year_level', '')::integer,
    nullif(target->>'semester_raw', ''),
    nullif(target->>'semester_number', '')::integer,
    nullif(target->>'academic_year_raw', ''),
    nullif(target->>'matched_academic_unit_id', '')::uuid,
    nullif(target->>'matched_programme_id', '')::uuid,
    nullif(target->>'matched_cohort_id', '')::uuid,
    nullif(target->>'matched_academic_period_id', '')::uuid,
    nullif(target->>'confidence', '')::numeric,
    coalesce(nullif(target->>'review_status', ''), 'unreviewed'),
    coalesce(target->'normalized_payload', '{}'::jsonb)
  from jsonb_array_elements(p_targets) target
  where nullif(target->>'target_key', '') is not null
    and nullif(target->>'title_raw', '') is not null
  on conflict (import_batch_id, target_key) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_candidate_targets) link
    where nullif(link->>'candidate_key', '') is null
      or nullif(link->>'target_key', '') is null
      or not exists (
        select 1
        from public.import_candidates c
        where c.import_batch_id = v_batch_id
          and c.candidate_key = link->>'candidate_key'
      )
      or not exists (
        select 1
        from public.import_targets t
        where t.import_batch_id = v_batch_id
          and t.target_key = link->>'target_key'
      )
  ) then
    raise exception 'STATIC_IMPORT_CANDIDATE_TARGET_INVALID';
  end if;

  insert into public.import_candidate_targets (
    candidate_id,
    import_target_id,
    applicability_raw,
    confidence,
    review_status,
    normalized_payload
  )
  select
    c.id,
    t.id,
    coalesce(nullif(link->>'applicability_raw', ''), t.title_raw),
    nullif(link->>'confidence', '')::numeric,
    coalesce(nullif(link->>'review_status', ''), 'unreviewed'),
    coalesce(link->'normalized_payload', '{}'::jsonb)
  from jsonb_array_elements(p_candidate_targets) link
  join public.import_candidates c
    on c.import_batch_id = v_batch_id
   and c.candidate_key = link->>'candidate_key'
  join public.import_targets t
    on t.import_batch_id = v_batch_id
   and t.target_key = link->>'target_key'
  on conflict (candidate_id, import_target_id) do nothing;

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

revoke all on function public.persist_static_document_import_v2(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_static_document_import_v2(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

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
begin
  return public.persist_static_document_import_v2(
    p_source_document_id,
    p_actor_id,
    p_parser_version,
    p_summary,
    p_candidates,
    p_warnings,
    '[]'::jsonb,
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.persist_static_document_import(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_static_document_import(uuid, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

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
    from jsonb_array_elements(p_sessions) session_row
    where not exists (
      select 1
      from public.import_candidates c
      join public.import_candidate_targets ct on ct.candidate_id = c.id
      where c.import_batch_id = v_target.import_batch_id
        and ct.import_target_id = v_target.id
        and c.candidate_key = session_row->>'candidateKey'
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
          v_target.id::text || '|' || session_row->>'candidateKey',
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
    on c.import_batch_id = v_batch.id
   and c.candidate_key = session_row->>'candidateKey';

  update public.import_candidate_warnings w
  set
    resolved_at = now(),
    resolved_by = p_actor_id,
    resolution_note = resolution->>'note'
  from public.import_candidates c,
       jsonb_array_elements(p_resolutions) resolution
  where w.candidate_id = c.id
    and c.import_batch_id = v_batch.id
    and resolution->>'warningId' = w.id::text
    and nullif(btrim(resolution->>'note'), '') is not null;

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
