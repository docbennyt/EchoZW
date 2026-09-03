-- Fix Source Gateway draft materialization after 0017 was applied.
-- The RETURNS TABLE output parameter `timetable_id` conflicted with
-- unqualified timetable/version column references inside PL/pgSQL, causing
-- mapped cohorts to fail before any source sessions could be materialized.

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
#variable_conflict use_column
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
  select dc.*
  into v_discovered
  from public.timetable_source_discovered_cohorts dc
  where dc.id = p_discovered_cohort_id
    and dc.mapping_status = 'mapped'
  for update;

  if not found then
    raise exception 'SOURCE_COHORT_MAPPING_NOT_FOUND';
  end if;

  select s.* into v_source
  from public.timetable_sources s
  where s.id = v_discovered.source_id;

  select p.* into v_programme
  from public.programmes p
  where p.id = v_discovered.target_programme_id;

  select c.* into v_cohort
  from public.cohorts c
  where c.id = v_discovered.target_cohort_id;

  select ap.* into v_period
  from public.academic_periods ap
  where ap.id = v_discovered.target_academic_period_id;

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
      from public.timetables t
      where t.public_slug = v_public_slug
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
    returning public.timetables.id into v_timetable_id;
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
    select coalesce(max(v.version_number), 0) + 1
    into v_version_number
    from public.timetable_versions v
    where v.timetable_id = v_timetable_id;

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
    returning public.timetable_versions.id into v_version_id;
  else
    delete from public.timetable_sessions ts
    where ts.timetable_version_id = v_version_id;

    update public.timetable_source_reviews r
    set status = 'superseded', updated_at = now()
    where r.discovered_cohort_id = p_discovered_cohort_id
      and r.status = 'pending';
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
    (select t.public_slug from public.timetables t where t.id = v_timetable_id),
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
  returning public.timetable_source_reconciliation_bindings.id into v_binding_id;

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
  returning public.timetable_source_reviews.id into v_review_id;

  update public.timetables t
  set current_version_id = v_version_id, updated_at = now()
  where t.id = v_timetable_id;

  review_id := v_review_id;
  timetable_id := v_timetable_id;
  draft_version_id := v_version_id;
  session_count := jsonb_array_length(p_sessions);
  status := 'draft_generated';
  return next;
end;
$$;

revoke execute on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid)
  to service_role;
