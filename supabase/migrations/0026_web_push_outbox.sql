-- DR-46: installable PWA + opt-in urgent timetable change alerts.
--
-- Push capability URLs and encryption material are secrets. The browser can only
-- reach them through the server-owned API; these tables are service-role private.
-- Student-visible change producers enqueue durable notifications transactionally,
-- while network delivery is performed asynchronously after commit.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  subscriber_profile_id uuid references public.subscriber_profiles(id) on delete set null,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth_secret text not null,
  platform text not null default 'unknown' check (
    platform in ('android', 'ios', 'desktop', 'unknown')
  ),
  status text not null default 'active' check (
    status in ('active', 'revoked', 'expired')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  constraint push_subscriptions_endpoint_hash_shape check (
    endpoint_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint push_subscriptions_endpoint_size check (
    char_length(endpoint) between 8 and 4096
  ),
  constraint push_subscriptions_key_size check (
    char_length(p256dh) between 8 and 1024
    and char_length(auth_secret) between 4 and 512
  ),
  unique (timetable_id, endpoint_hash)
);

create index if not exists push_subscriptions_active_timetable_idx
  on public.push_subscriptions (timetable_id, updated_at desc)
  where status = 'active';

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (subscriber_profile_id)
  where subscriber_profile_id is not null;

create table if not exists public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  source_kind text not null check (
    source_kind in ('source_publication', 'correction', 'exception', 'academic_pause')
  ),
  source_id uuid not null,
  change_kind text not null check (
    change_kind in (
      'added',
      'cancelled',
      'moved',
      'time_changed',
      'venue_changed',
      'updated',
      'restored',
      'published_update'
    )
  ),
  change_count integer not null default 1 check (change_count > 0),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'delivered', 'no_targets', 'dead')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_notification_outbox_payload_object check (
    jsonb_typeof(payload) = 'object'
  )
);

create index if not exists push_notification_outbox_pending_idx
  on public.push_notification_outbox (available_at, created_at)
  where status = 'pending';

create index if not exists push_notification_outbox_timetable_idx
  on public.push_notification_outbox (timetable_id, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_outbox enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_notification_outbox from public, anon, authenticated;
grant all on table public.push_subscriptions to service_role;
grant all on table public.push_notification_outbox to service_role;

create or replace function public.enqueue_timetable_push_notification(
  p_timetable_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_change_kind text,
  p_change_count integer,
  p_payload jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_notification_outbox (
    timetable_id,
    source_kind,
    source_id,
    change_kind,
    change_count,
    payload,
    dedupe_key
  ) values (
    p_timetable_id,
    p_source_kind,
    p_source_id,
    p_change_kind,
    greatest(coalesce(p_change_count, 1), 1),
    coalesce(p_payload, '{}'::jsonb),
    p_dedupe_key
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function public.enqueue_timetable_push_notification(uuid, text, uuid, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.enqueue_timetable_push_notification(uuid, text, uuid, text, integer, jsonb, text) to service_role;

create or replace function public.enqueue_source_publication_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_additions integer := coalesce((new.plan_payload #>> '{summary,additions}')::integer, 0);
  v_removals integer := coalesce((new.plan_payload #>> '{summary,removals}')::integer, 0);
  v_updates integer := coalesce((new.plan_payload #>> '{summary,updates}')::integer, 0);
  v_change_kind text;
  v_count integer;
begin
  if new.status <> 'published'
    or old.status = 'published'
    or new.published_version_id is null
  then
    return new;
  end if;

  v_count := v_additions + v_removals + v_updates;
  if v_count < 1 then
    return new;
  end if;

  v_change_kind := case
    when v_additions > 0 and v_removals = 0 and v_updates = 0 then 'added'
    when v_removals > 0 and v_additions = 0 and v_updates = 0 then 'cancelled'
    when v_updates > 0 and v_additions = 0 and v_removals = 0 then 'updated'
    else 'published_update'
  end;

  perform public.enqueue_timetable_push_notification(
    new.timetable_id,
    'source_publication',
    new.id,
    v_change_kind,
    v_count,
    jsonb_build_object(
      'versionId', new.published_version_id,
      'additions', v_additions,
      'removals', v_removals,
      'updates', v_updates
    ),
    'source_publication:' || new.id::text || ':' || new.published_version_id::text
  );
  return new;
end;
$$;

revoke all on function public.enqueue_source_publication_push() from public, anon, authenticated;

drop trigger if exists timetable_source_publications_push_outbox on public.timetable_source_publications;
create trigger timetable_source_publications_push_outbox
after update of status, published_version_id on public.timetable_source_publications
for each row execute function public.enqueue_source_publication_push();

create or replace function public.enqueue_correction_directive_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.timetable_correction_directives%rowtype;
  v_change_kind text;
begin
  if tg_op = 'INSERT' then
    if not new.active then
      return new;
    end if;

    v_change_kind := case new.action
      when 'add' then 'added'
      when 'remove' then 'cancelled'
      else 'updated'
    end;

    if new.supersedes_id is not null then
      select * into v_previous
      from public.timetable_correction_directives
      where id = new.supersedes_id;

      if found then
        v_change_kind := case
          when v_previous.weekday is distinct from new.weekday then 'moved'
          when v_previous.start_time is distinct from new.start_time
            or v_previous.end_time is distinct from new.end_time then 'time_changed'
          when v_previous.venue is distinct from new.venue then 'venue_changed'
          when v_previous.action = 'remove' and new.action <> 'remove' then 'restored'
          when v_previous.action <> 'remove' and new.action = 'remove' then 'cancelled'
          else 'updated'
        end;
      end if;
    end if;

    perform public.enqueue_timetable_push_notification(
      new.timetable_id,
      'correction',
      new.id,
      v_change_kind,
      1,
      jsonb_strip_nulls(jsonb_build_object(
        'courseCode', new.course_code,
        'weekday', new.weekday,
        'startTime', new.start_time,
        'venue', new.venue
      )),
      'correction:' || new.id::text || ':active'
    );
    return new;
  end if;

  if old.active and not new.active then
    -- Replacement RPCs deactivate the old row before inserting its successor.
    -- The successor is the single alert for that edit; do not double notify.
    if new.superseded_at is not null or new.replaced_by_id is not null then
      return new;
    end if;

    perform public.enqueue_timetable_push_notification(
      new.timetable_id,
      'correction',
      new.id,
      'restored',
      1,
      jsonb_strip_nulls(jsonb_build_object('courseCode', new.course_code)),
      'correction:' || new.id::text || ':revoked'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_correction_directive_push() from public, anon, authenticated;

drop trigger if exists timetable_correction_directives_push_outbox on public.timetable_correction_directives;
create trigger timetable_correction_directives_push_outbox
after insert or update of active, superseded_at, replaced_by_id on public.timetable_correction_directives
for each row execute function public.enqueue_correction_directive_push();

create or replace function public.enqueue_session_exception_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_kind text;
begin
  if tg_op = 'INSERT' then
    if not new.active or new.timetable_id is null then
      return new;
    end if;

    v_change_kind := case new.exception_type
      when 'cancelled' then 'cancelled'
      when 'moved' then 'moved'
      when 'extra' then 'added'
      else 'updated'
    end;

    perform public.enqueue_timetable_push_notification(
      new.timetable_id,
      'exception',
      new.id,
      v_change_kind,
      1,
      jsonb_strip_nulls(jsonb_build_object(
        'courseCode', new.course_code,
        'date', new.exception_date,
        'startTime', new.start_time,
        'venue', new.venue
      )),
      'exception:' || new.id::text || ':active'
    );
    return new;
  end if;

  if old.active and not new.active and new.timetable_id is not null then
    if new.superseded_at is not null or new.replaced_by_id is not null then
      return new;
    end if;
    perform public.enqueue_timetable_push_notification(
      new.timetable_id,
      'exception',
      new.id,
      'restored',
      1,
      jsonb_strip_nulls(jsonb_build_object(
        'courseCode', new.course_code,
        'date', new.exception_date
      )),
      'exception:' || new.id::text || ':revoked'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_session_exception_push() from public, anon, authenticated;

drop trigger if exists timetable_session_exceptions_push_outbox on public.timetable_session_exceptions;
create trigger timetable_session_exceptions_push_outbox
after insert or update of active, superseded_at, replaced_by_id on public.timetable_session_exceptions
for each row execute function public.enqueue_session_exception_push();

create or replace function public.enqueue_academic_pause_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timetable_id uuid;
  v_kind text;
begin
  if tg_op = 'INSERT' and not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active = new.active then
    return new;
  end if;

  v_kind := case when new.active then 'cancelled' else 'restored' end;

  for v_timetable_id in
    select t.id
    from public.timetables t
    left join public.cohorts c on c.id = t.cohort_id
    where
      (new.scope_type = 'institution' and t.institution_id = new.institution_id)
      or (new.scope_type = 'programme' and c.programme_id = new.programme_id)
      or (new.scope_type = 'cohort' and t.cohort_id = new.cohort_id)
      or (new.scope_type in ('timetable', 'session') and t.id = new.timetable_id)
  loop
    perform public.enqueue_timetable_push_notification(
      v_timetable_id,
      'academic_pause',
      new.id,
      v_kind,
      1,
      jsonb_build_object(
        'label', new.label,
        'startsOn', new.starts_on,
        'endsOn', new.ends_on,
        'reason', new.reason
      ),
      'academic_pause:' || new.id::text || ':' || v_timetable_id::text || ':' || case when new.active then 'active' else 'revoked' end
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.enqueue_academic_pause_push() from public, anon, authenticated;

drop trigger if exists academic_schedule_pauses_push_outbox on public.academic_schedule_pauses;
create trigger academic_schedule_pauses_push_outbox
after insert or update of active on public.academic_schedule_pauses
for each row execute function public.enqueue_academic_pause_push();

create or replace function public.claim_push_notification_outbox(
  p_limit integer default 10
)
returns table (
  id uuid,
  timetable_id uuid,
  public_slug text,
  source_kind text,
  source_id uuid,
  change_kind text,
  change_count integer,
  payload jsonb,
  attempt_count integer
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select o.id
    from public.push_notification_outbox o
    where (
      o.status = 'pending'
      and o.available_at <= now()
    ) or (
      o.status = 'processing'
      and o.locked_at < now() - interval '5 minutes'
    )
    order by o.available_at, o.created_at
    for update skip locked
    limit greatest(least(coalesce(p_limit, 10), 50), 1)
  ), claimed as (
    update public.push_notification_outbox o
    set
      status = 'processing',
      attempt_count = o.attempt_count + 1,
      locked_at = now(),
      updated_at = now()
    from candidates c
    where o.id = c.id
    returning o.*
  )
  select
    c.id,
    c.timetable_id,
    t.public_slug,
    c.source_kind,
    c.source_id,
    c.change_kind,
    c.change_count,
    c.payload,
    c.attempt_count
  from claimed c
  join public.timetables t on t.id = c.timetable_id;
$$;

revoke all on function public.claim_push_notification_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_outbox(integer) to service_role;
