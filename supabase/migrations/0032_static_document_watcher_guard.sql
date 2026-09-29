-- DR-120: wrap the existing live Source Gateway draft materializer so a class
-- whose durable authority is a static document is skipped instead of generating
-- watcher proposals from a less-authoritative live source.

alter function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid)
  rename to materialize_live_source_generated_draft_unchecked;

create function public.materialize_source_generated_draft(
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
  v_static_timetable_id uuid;
begin
  select t.id
  into v_static_timetable_id
  from public.timetable_source_discovered_cohorts dc
  join public.timetables t
    on t.programme_id = dc.target_programme_id
   and t.cohort_id = dc.target_cohort_id
   and t.academic_period_id = dc.target_academic_period_id
  where dc.id = p_discovered_cohort_id
    and t.source_strategy = 'static_document'
  order by t.created_at
  limit 1;

  if v_static_timetable_id is not null then
    review_id := null;
    timetable_id := v_static_timetable_id;
    draft_version_id := null;
    session_count := 0;
    status := 'skipped';
    return next;
    return;
  end if;

  return query
  select *
  from public.materialize_live_source_generated_draft_unchecked(
    p_discovered_cohort_id,
    p_parse_run_id,
    p_parser_version,
    p_sessions,
    p_snapshot_id
  );
end;
$$;

revoke all on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.materialize_source_generated_draft(uuid, uuid, text, jsonb, uuid)
  to service_role;
