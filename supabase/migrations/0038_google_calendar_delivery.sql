-- DR-178: push rows are durable change evidence, but their status/claims belong to
-- push. Existing Google tables have neither revision watermarks nor fenced leases.
-- Observe INSERT only; never consume, claim, or update push delivery state.
create table public.google_calendar_delivery_revisions (
  timetable_id uuid primary key references public.timetables(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0)
);

create table public.google_calendar_delivery_jobs (
  subscription_id uuid primary key references public.calendar_subscriptions(id) on delete cascade,
  desired_revision bigint not null check (desired_revision > 0),
  successful_revision bigint not null default 0 check (successful_revision >= 0),
  requested_generation bigint not null default 1 check (requested_generation > 0),
  successful_generation bigint not null default 0 check (successful_generation >= 0),
  claimed_generation bigint,
  claimed_revision bigint,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  reconnect_required_at timestamptz,
  credential_updated_at timestamptz,
  last_error_code text,
  check (successful_revision <= desired_revision),
  check (successful_generation <= requested_generation),
  check ((lease_token is null and lease_expires_at is null and claimed_revision is null and claimed_generation is null)
    or (lease_token is not null and lease_expires_at is not null and claimed_revision is not null and claimed_generation is not null))
);

create index google_calendar_delivery_ready_idx
  on public.google_calendar_delivery_jobs(available_at, subscription_id)
  where (desired_revision > successful_revision or requested_generation > successful_generation)
    and reconnect_required_at is null;

alter table public.google_calendar_delivery_revisions enable row level security;
alter table public.google_calendar_delivery_jobs enable row level security;
revoke all on public.google_calendar_delivery_revisions, public.google_calendar_delivery_jobs from public, anon, authenticated;
grant all on public.google_calendar_delivery_revisions, public.google_calendar_delivery_jobs to service_role;

create function public.observe_google_calendar_delivery_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.google_calendar_delivery_revisions(timetable_id, revision)
    values (new.timetable_id, 1)
    on conflict (timetable_id) do update
      set revision = google_calendar_delivery_revisions.revision + 1;
  return new;
end;
$$;

-- The source change, push evidence and Google revision intent commit or roll back
-- together. An unavailable queue cannot lose this intent.
create trigger google_calendar_delivery_revision
after insert on public.push_notification_outbox
for each row execute function public.observe_google_calendar_delivery_revision();

-- Push dedupe keys may suppress a repeated undo/reactivation; manual publishing
-- need not create source-publication evidence. Observe effective rows as well.
-- Generations are opaque: overlapping observers may conservatively bump twice.
create function public.observe_google_calendar_effective_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if v_old is not distinct from v_new then return null; end if;
  if tg_table_name = 'timetables' then
    if v_old ->> 'current_published_version_id' is not distinct from v_new ->> 'current_published_version_id' then return null; end if;
    insert into public.google_calendar_delivery_revisions(timetable_id)
      values ((coalesce(v_new, v_old) ->> 'id')::uuid)
      on conflict (timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
  elsif tg_table_name = 'academic_schedule_pauses' then
    insert into public.google_calendar_delivery_revisions(timetable_id)
    select distinct t.id from public.timetables t
    left join public.cohorts c on c.id = t.cohort_id
    cross join jsonb_array_elements(jsonb_build_array(v_old, v_new)) scope
    where coalesce((scope ->> 'active')::boolean, false) and (
      (scope ->> 'scope_type' = 'institution' and t.institution_id::text = scope ->> 'institution_id')
      or (scope ->> 'scope_type' = 'programme' and c.programme_id::text = scope ->> 'programme_id')
      or (scope ->> 'scope_type' = 'cohort' and t.cohort_id::text = scope ->> 'cohort_id')
      or (scope ->> 'scope_type' in ('timetable', 'session') and t.id::text = scope ->> 'timetable_id'))
    on conflict (timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
  else
    insert into public.google_calendar_delivery_revisions(timetable_id)
    select distinct t.id from public.timetables t
      join jsonb_array_elements(jsonb_build_array(v_old, v_new)) scope
        on t.id::text = scope ->> 'timetable_id'
      where coalesce((scope ->> 'active')::boolean, false)
    on conflict (timetable_id) do update set revision = google_calendar_delivery_revisions.revision + 1;
  end if;
  return null;
end;
$$;

create trigger google_calendar_delivery_publication
after insert or update of current_published_version_id on public.timetables
for each row execute function public.observe_google_calendar_effective_change();
create trigger google_calendar_delivery_correction
after insert or update or delete on public.timetable_correction_directives
for each row execute function public.observe_google_calendar_effective_change();
create trigger google_calendar_delivery_exception
after insert or update or delete on public.timetable_session_exceptions
for each row execute function public.observe_google_calendar_effective_change();
create trigger google_calendar_delivery_pause
after insert or update or delete on public.academic_schedule_pauses
for each row execute function public.observe_google_calendar_effective_change();

-- Baseline existing published timetables, including already-delivered push rows.
-- Revisions are opaque delivery generations, not timetable version numbers.
insert into public.google_calendar_delivery_revisions(timetable_id)
select id from public.timetables where current_published_version_id is not null
on conflict (timetable_id) do nothing;

create function public.enqueue_google_calendar_subscription(p_subscription_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into public.google_calendar_delivery_revisions(timetable_id)
  select s.timetable_id from public.calendar_subscriptions s
  join public.timetables t on t.id = s.timetable_id
  where s.id = p_subscription_id and s.provider = 'google_api'
    and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
      select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
    and s.revoked_at is null
    and t.current_published_version_id is not null
  on conflict (timetable_id) do nothing;
  insert into public.google_calendar_delivery_jobs as j(subscription_id, desired_revision)
  select s.id, r.revision from public.calendar_subscriptions s
  join public.google_calendar_delivery_revisions r on r.timetable_id = s.timetable_id
  where s.id = p_subscription_id and s.provider = 'google_api'
    and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
      select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
    and s.revoked_at is null
  on conflict (subscription_id) do update set
    desired_revision = greatest(j.desired_revision, excluded.desired_revision),
    requested_generation = j.requested_generation + 1;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
insert into public.google_calendar_delivery_revisions(timetable_id)
select distinct timetable_id from public.push_notification_outbox
on conflict (timetable_id) do nothing;

create function public.recover_google_calendar_delivery(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into public.google_calendar_delivery_jobs as j(subscription_id, desired_revision)
  select s.id, r.revision
  from public.calendar_subscriptions s
  join public.google_calendar_delivery_revisions r on r.timetable_id = s.timetable_id
  left join public.google_calendar_delivery_jobs old on old.subscription_id = s.id
  where s.provider = 'google_api'
    and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
      select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
    and s.revoked_at is null
    and (old.subscription_id is null or old.desired_revision < r.revision
      or (old.reconnect_required_at is not null and exists (
        select 1 from public.google_calendar_credentials c where c.subscription_id = s.id
          and c.updated_at > coalesce(old.credential_updated_at, '-infinity'::timestamptz))))
  order by old.desired_revision nulls first, s.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  on conflict (subscription_id) do update set
    desired_revision = greatest(j.desired_revision, excluded.desired_revision),
    reconnect_required_at = case when exists (
      select 1 from public.google_calendar_credentials c
      where c.subscription_id = j.subscription_id
        and c.updated_at > coalesce(j.credential_updated_at, '-infinity'::timestamptz)
    ) then null else j.reconnect_required_at end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Listing is read-only. Consumers acquire the fenced lease after dequeueing.
create function public.list_google_calendar_delivery_ready(p_limit integer default 10)
returns table(subscription_id uuid)
language sql security definer set search_path = public as $$
  select j.subscription_id from public.google_calendar_delivery_jobs j
  join public.calendar_subscriptions s on s.id = j.subscription_id
  where (j.desired_revision > j.successful_revision or j.requested_generation > j.successful_generation)
    and j.reconnect_required_at is null and j.available_at <= clock_timestamp()
    and (j.lease_expires_at is null or j.lease_expires_at <= clock_timestamp())
    and s.provider = 'google_api'
    and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
      select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
    and s.revoked_at is null
  order by j.available_at, j.subscription_id
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

create function public.claim_google_calendar_delivery(p_limit integer default 10, p_lease_seconds integer default 300, p_subscription_id uuid default null)
returns setof public.google_calendar_delivery_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select j.subscription_id from public.google_calendar_delivery_jobs j
    join public.calendar_subscriptions s on s.id = j.subscription_id
    where (j.desired_revision > j.successful_revision or j.requested_generation > j.successful_generation)
      and (p_subscription_id is null or j.subscription_id = p_subscription_id)
      and j.reconnect_required_at is null and j.available_at <= clock_timestamp()
      and (j.lease_expires_at is null or j.lease_expires_at <= clock_timestamp())
      and s.provider = 'google_api'
      and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
        select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
      and s.revoked_at is null
    order by j.available_at, j.subscription_id
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update of j skip locked
  )
  update public.google_calendar_delivery_jobs j set
    lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds, 300), 900))),
    claimed_revision = j.desired_revision,
    claimed_generation = j.requested_generation,
    credential_updated_at = (select c.updated_at from public.google_calendar_credentials c
      where c.subscription_id = j.subscription_id),
    attempt_count = least(j.attempt_count, 2147483646) + 1
  from candidates c where j.subscription_id = c.subscription_id
  returning j.*;
end;
$$;

create function public.finish_google_calendar_delivery(
  p_subscription_id uuid, p_lease_token uuid, p_revision bigint,
  p_outcome text, p_error_code text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_job public.google_calendar_delivery_jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('success', 'retry', 'reconnect') then
    raise exception 'Invalid Google delivery outcome';
  end if;
  select * into v_job from public.google_calendar_delivery_jobs
    where subscription_id = p_subscription_id and lease_token = p_lease_token
      and claimed_revision = p_revision and lease_expires_at > clock_timestamp()
    for update;
  if not found then return false; end if;
  if v_job.lease_expires_at <= clock_timestamp() then return false; end if;

  update public.google_calendar_delivery_jobs set
    successful_revision = case when p_outcome = 'success' then greatest(successful_revision, p_revision) else successful_revision end,
    successful_generation = case when p_outcome = 'success' then greatest(successful_generation, claimed_generation) else successful_generation end,
    lease_token = null, lease_expires_at = null, claimed_revision = null, claimed_generation = null,
    attempt_count = case when p_outcome = 'success' then 0 else attempt_count end,
    reconnect_required_at = case when p_outcome = 'reconnect' then clock_timestamp() else null end,
    available_at = clock_timestamp() + make_interval(secs => case when p_outcome = 'retry'
      then least(3600, (15 * power(2, least(v_job.attempt_count - 1, 8)))::integer) else 0 end),
    last_error_code = case when p_outcome = 'success' then null else left(p_error_code, 120) end
  where subscription_id = p_subscription_id;
  return true;
end;
$$;

revoke all on function public.observe_google_calendar_delivery_revision() from public, anon, authenticated;
revoke all on function public.observe_google_calendar_effective_change() from public, anon, authenticated;
revoke all on function public.enqueue_google_calendar_subscription(uuid) from public, anon, authenticated;
revoke all on function public.recover_google_calendar_delivery(integer) from public, anon, authenticated;
revoke all on function public.list_google_calendar_delivery_ready(integer) from public, anon, authenticated;
revoke all on function public.claim_google_calendar_delivery(integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.finish_google_calendar_delivery(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.recover_google_calendar_delivery(integer) to service_role;
grant execute on function public.list_google_calendar_delivery_ready(integer) to service_role;
grant execute on function public.enqueue_google_calendar_subscription(uuid) to service_role;
grant execute on function public.claim_google_calendar_delivery(integer, integer, uuid) to service_role;
grant execute on function public.finish_google_calendar_delivery(uuid, uuid, bigint, text, text) to service_role;
