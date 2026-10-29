-- One atomic statement: preserve historical SEQUENCE high-water marks before
-- readers adopt the existing durable effective-revision counter.
set statement_timeout = '30s';
do $migration$
begin
  perform set_config('lock_timeout', '5s', true);
  lock table public.institutions, public.programmes, public.cohorts,
    public.academic_periods, public.timetables, public.timetable_versions,
    public.timetable_correction_directives, public.timetable_session_exceptions,
    public.academic_schedule_pauses in share row exclusive mode;

  alter table public.google_calendar_delivery_revisions
    add column updated_at timestamptz not null default clock_timestamp();

  -- Retained history bounds every value the former row-count clock could emit,
  -- including revoke/undo and a previously published higher version.
  insert into public.google_calendar_delivery_revisions as clock(timetable_id, revision, updated_at)
  select t.id,
    greatest(1::bigint, coalesce(v.maximum_version, 1))
      + 3 * coalesce(c.total, 0) + 2 * coalesce(e.total, 0) + 1,
    greatest(clock_timestamp(), t.updated_at, v.latest, c.latest, e.latest)
  from public.timetables t
  left join (
    select timetable_id, max(version_number)::bigint maximum_version,
      greatest(max(published_at), max(created_at)) latest
    from public.timetable_versions group by timetable_id
  ) v on v.timetable_id = t.id
  left join (
    select timetable_id, count(*) total,
      greatest(max(created_at), max(updated_at), max(revoked_at), max(superseded_at)) latest
    from public.timetable_correction_directives group by timetable_id
  ) c on c.timetable_id = t.id
  left join (
    select timetable_id, count(*) total,
      greatest(max(created_at), max(revoked_at)) latest
    from public.timetable_session_exceptions group by timetable_id
  ) e on e.timetable_id = t.id
  on conflict(timetable_id) do update set
    revision = greatest(clock.revision + 1, excluded.revision),
    updated_at = greatest(clock.updated_at, excluded.updated_at);

  if exists(select 1 from public.google_calendar_delivery_revisions where revision > 2147483647) then
    raise exception 'Calendar revision exceeds the supported RFC SEQUENCE range';
  end if;
  alter table public.google_calendar_delivery_revisions
    add constraint calendar_revision_rfc_sequence_range
    check (revision between 1 and 2147483647);

  create function public.stamp_calendar_revision_clock()
  returns trigger language plpgsql set search_path = pg_catalog, public as $clock$
  begin
    if new.revision < old.revision then
      raise exception 'Calendar revision cannot decrease';
    end if;
    new.updated_at := case when new.revision > old.revision
      then greatest(old.updated_at, clock_timestamp()) else old.updated_at end;
    return new;
  end;
  $clock$;
  create trigger stamp_calendar_revision_clock
    before update on public.google_calendar_delivery_revisions
    for each row execute function public.stamp_calendar_revision_clock();

  -- Scope predicates must match feed reads, including timetables whose cohort
  -- has subsequently moved to a different programme.
  create or replace function public.observe_google_calendar_effective_change()
  returns trigger language plpgsql security definer set search_path = pg_catalog, public as $observer$
  declare v_old jsonb; v_new jsonb;
  begin
    if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
    if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
    if v_old is not distinct from v_new then return null; end if;
    if tg_table_name = 'timetables' then
      if v_old ->> 'current_published_version_id' is not distinct from v_new ->> 'current_published_version_id' then return null; end if;
      -- Preserve the adoption high-water mark during a mixed-runtime rollout,
      -- even if draft allocation jumps the published version number afterwards.
      insert into public.google_calendar_delivery_revisions(timetable_id, revision)
      select t.id,
        greatest(1::bigint, coalesce((select max(v.version_number)::bigint from public.timetable_versions v where v.timetable_id=t.id), 1))
        + 3 * (select count(*) from public.timetable_correction_directives c where c.timetable_id=t.id)
        + 2 * (select count(*) from public.timetable_session_exceptions e where e.timetable_id=t.id) + 1
      from public.timetables t where t.id=(coalesce(v_new, v_old) ->> 'id')::uuid
      on conflict(timetable_id) do update set revision = greatest(google_calendar_delivery_revisions.revision + 1, excluded.revision);
    elsif tg_table_name in ('institutions', 'programmes', 'cohorts', 'academic_periods') then
      if (v_old - 'updated_at') is not distinct from (v_new - 'updated_at') then return null; end if;
      insert into public.google_calendar_delivery_revisions(timetable_id)
      select t.id from public.timetables t where
        (tg_table_name = 'institutions' and t.institution_id::text in (v_old ->> 'id', v_new ->> 'id'))
        or (tg_table_name = 'programmes' and t.programme_id::text in (v_old ->> 'id', v_new ->> 'id'))
        or (tg_table_name = 'cohorts' and t.cohort_id::text in (v_old ->> 'id', v_new ->> 'id'))
        or (tg_table_name = 'academic_periods' and t.academic_period_id::text in (v_old ->> 'id', v_new ->> 'id'))
      on conflict(timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
    elsif tg_table_name = 'academic_schedule_pauses' then
      insert into public.google_calendar_delivery_revisions(timetable_id)
      select distinct t.id from public.timetables t
      cross join jsonb_array_elements(jsonb_build_array(v_old, v_new)) scope
      where coalesce((scope ->> 'active')::boolean, false) and (
        (scope ->> 'scope_type' = 'institution' and t.institution_id::text = scope ->> 'institution_id')
        or (scope ->> 'scope_type' = 'programme' and t.programme_id::text = scope ->> 'programme_id')
        or (scope ->> 'scope_type' = 'cohort' and t.cohort_id::text = scope ->> 'cohort_id')
        or (scope ->> 'scope_type' in ('timetable', 'session') and t.id::text = scope ->> 'timetable_id'))
      on conflict(timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
    else
      insert into public.google_calendar_delivery_revisions(timetable_id)
      select distinct t.id from public.timetables t
      join jsonb_array_elements(jsonb_build_array(v_old, v_new)) scope
        on t.id::text = scope ->> 'timetable_id'
      where coalesce((scope ->> 'active')::boolean, false)
      on conflict(timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
    end if;
    return null;
  end;
  $observer$;

  create trigger calendar_revision_institution_reference after update on public.institutions
    for each row execute function public.observe_google_calendar_effective_change();
  create trigger calendar_revision_programme_reference after update on public.programmes
    for each row execute function public.observe_google_calendar_effective_change();
  create trigger calendar_revision_cohort_reference after update on public.cohorts
    for each row execute function public.observe_google_calendar_effective_change();
  create trigger calendar_revision_period_reference after update on public.academic_periods
    for each row execute function public.observe_google_calendar_effective_change();

  revoke all on function public.stamp_calendar_revision_clock() from public, anon, authenticated;
  grant execute on function public.stamp_calendar_revision_clock() to service_role;
  revoke all on function public.observe_google_calendar_effective_change() from public, anon, authenticated;
end;
$migration$;
reset statement_timeout;
