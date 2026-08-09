create extension if not exists pgcrypto;

alter table institutions
  add column if not exists short_name text,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update institutions
set active = true
where active is distinct from true;

alter table programmes
  add column if not exists active boolean not null default true;

update programmes
set active = case when status = 'active' then true else false end
where active is distinct from (status = 'active');

alter table cohorts
  add column if not exists label text,
  add column if not exists slug text,
  add column if not exists year_level integer,
  add column if not exists semester_number integer,
  add column if not exists group_name text,
  add column if not exists active boolean not null default true;

update cohorts
set
  label = coalesce(nullif(label, ''), nullif(group_label, ''), code),
  slug = coalesce(
    nullif(slug, ''),
    lower(regexp_replace(coalesce(nullif(group_label, ''), code), '[^a-zA-Z0-9]+', '-', 'g'))
  ),
  group_name = coalesce(group_name, group_label),
  active = case when status = 'active' then true else false end
where
  label is null
  or slug is null
  or group_name is null
  or active is distinct from (status = 'active');

alter table cohorts
  alter column label set not null,
  alter column slug set not null;

create unique index if not exists cohorts_programme_slug_unique
  on cohorts (programme_id, slug);

alter table academic_periods
  add column if not exists active boolean not null default true;

update academic_periods
set active = case when status = 'archived' then false else true end
where active is distinct from (status <> 'archived');

alter table timetables
  add column if not exists current_published_version_id uuid references timetable_versions(id) on delete set null;

update timetables
set current_published_version_id = current_version_id
where current_published_version_id is null
  and current_version_id is not null;

create unique index if not exists timetables_cohort_period_unique
  on timetables (cohort_id, academic_period_id)
  where archived_at is null
    and cohort_id is not null
    and academic_period_id is not null;

alter table timetable_versions
  drop constraint if exists timetable_versions_status_check;

update timetable_versions
set status = case
  when status = 'archived' then 'superseded'
  when status = 'review_required' then 'draft'
  else status
end
where status in ('archived', 'review_required');

alter table timetable_versions
  add constraint timetable_versions_status_check
  check (status in ('draft', 'published', 'superseded'));

alter table timetable_sessions
  alter column course_id drop not null;

alter table timetable_sessions
  add column if not exists course_code text,
  add column if not exists course_name text,
  add column if not exists venue text,
  add column if not exists lecturer text;

update timetable_sessions
set
  venue = coalesce(venue, venue_normalized, venue_raw),
  lecturer = coalesce(lecturer, lecturer_normalized, lecturer_raw),
  course_code = coalesce(course_code, ''),
  course_name = coalesce(course_name, '')
where
  venue is null
  or lecturer is null
  or course_code is null
  or course_name is null;

create index if not exists timetable_sessions_version_weekday_idx
  on timetable_sessions (timetable_version_id, weekday, start_time, end_time);

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'institutions',
        'programmes',
        'cohorts',
        'academic_periods',
        'timetables',
        'timetable_versions',
        'timetable_sessions',
        'calendar_subscriptions'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end $$;

revoke all on table institutions from anon, authenticated;
revoke all on table programmes from anon, authenticated;
revoke all on table cohorts from anon, authenticated;
revoke all on table academic_periods from anon, authenticated;
revoke all on table timetables from anon, authenticated;
revoke all on table timetable_versions from anon, authenticated;
revoke all on table timetable_sessions from anon, authenticated;
revoke all on table calendar_subscriptions from anon, authenticated;

create or replace function public.publish_timetable_version(
  p_timetable_id uuid,
  p_version_id uuid,
  p_published_by uuid
)
returns table (
  public_slug text,
  version_number integer,
  session_count integer,
  published_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session_count integer;
begin
  perform 1
  from public.timetables
  where id = p_timetable_id
  for update;

  if not found then
    raise exception 'TIMETABLE_NOT_FOUND';
  end if;

  perform 1
  from public.timetable_versions
  where id = p_version_id
    and timetable_id = p_timetable_id
    and status = 'draft';

  if not found then
    raise exception 'TIMETABLE_VERSION_NOT_DRAFT';
  end if;

  select count(*)::integer
  into v_session_count
  from public.timetable_sessions
  where timetable_version_id = p_version_id;

  if v_session_count < 1 then
    raise exception 'TIMETABLE_EMPTY';
  end if;

  if exists (
    select 1
    from public.timetable_sessions left_session
    join public.timetable_sessions right_session
      on right_session.timetable_version_id = left_session.timetable_version_id
     and right_session.id > left_session.id
     and right_session.weekday = left_session.weekday
     and right_session.start_time < left_session.end_time
     and right_session.end_time > left_session.start_time
    where left_session.timetable_version_id = p_version_id
  ) then
    raise exception 'TIMETABLE_CONFLICT';
  end if;

  update public.timetable_versions
  set status = 'superseded'
  where timetable_id = p_timetable_id
    and status = 'published'
    and id <> p_version_id;

  update public.timetable_versions
  set
    status = 'published',
    published_at = now(),
    published_by = p_published_by,
    published_by_user_id = p_published_by
  where id = p_version_id;

  update public.timetables
  set
    current_published_version_id = p_version_id,
    current_version_id = p_version_id,
    status = 'official',
    updated_at = now()
  where id = p_timetable_id;

  return query
  select
    t.public_slug,
    v.version_number,
    v_session_count,
    v.published_at
  from public.timetables t
  join public.timetable_versions v on v.id = p_version_id
  where t.id = p_timetable_id;
end;
$$;

revoke all on function public.publish_timetable_version(uuid, uuid, uuid) from public;
revoke all on function public.publish_timetable_version(uuid, uuid, uuid) from anon;
revoke all on function public.publish_timetable_version(uuid, uuid, uuid) from authenticated;
grant execute on function public.publish_timetable_version(uuid, uuid, uuid) to service_role;
