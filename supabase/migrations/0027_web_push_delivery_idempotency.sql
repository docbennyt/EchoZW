-- DR-46: persist per-target push delivery state so an outbox retry never
-- re-notifies endpoints that already received the same timetable change.
--
-- Retry contract:
--   * target delivery is claimed with row locks and a stale-lock recovery window;
--   * transient failures retry at 30s, 2m, 8m, then 30m (bounded), while
--     respecting a provider Retry-After value up to one hour;
--   * six failed delivery attempts exhaust one target and mark it dead;
--   * only provider-confirmed gone endpoints (HTTP 404/410 in the worker) are
--     recorded as terminal and expire the timetable-specific subscription;
--   * successful and terminal targets are never selected by a later retry.

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.push_notification_outbox(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'delivered', 'terminal', 'dead')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  terminal_at timestamptz,
  dead_at timestamptz,
  unique (outbox_id, subscription_id)
);

create index if not exists push_notification_deliveries_pending_idx
  on public.push_notification_deliveries (outbox_id, available_at, created_at)
  where status in ('pending', 'processing');

create index if not exists push_notification_deliveries_subscription_idx
  on public.push_notification_deliveries (subscription_id, updated_at desc);

alter table public.push_notification_deliveries enable row level security;
revoke all on table public.push_notification_deliveries from public, anon, authenticated;
grant all on table public.push_notification_deliveries to service_role;

create or replace function public.materialize_push_notification_targets(
  p_outbox_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timetable_id uuid;
  v_total integer;
begin
  select timetable_id
  into v_timetable_id
  from public.push_notification_outbox
  where id = p_outbox_id;

  if v_timetable_id is null then
    raise exception 'PUSH_OUTBOX_NOT_FOUND';
  end if;

  insert into public.push_notification_deliveries (
    outbox_id,
    subscription_id
  )
  select
    p_outbox_id,
    subscription.id
  from public.push_subscriptions subscription
  where subscription.timetable_id = v_timetable_id
    and subscription.status = 'active'
  on conflict (outbox_id, subscription_id) do nothing;

  select count(*)::integer
  into v_total
  from public.push_notification_deliveries
  where outbox_id = p_outbox_id;

  return v_total;
end;
$$;

revoke all on function public.materialize_push_notification_targets(uuid) from public, anon, authenticated;
grant execute on function public.materialize_push_notification_targets(uuid) to service_role;

-- Replace the 0026 enqueue function now that delivery rows exist. This snapshots
-- the active timetable-specific endpoints in the same transaction as the durable
-- student-visible change. A later subscriber never receives an alert that predates
-- their opt-in, and a duplicate source event never expands an old target set.
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
declare
  v_outbox_id uuid;
  v_target_count integer;
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
  on conflict (dedupe_key) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    return;
  end if;

  v_target_count := public.materialize_push_notification_targets(v_outbox_id);
  if v_target_count = 0 then
    update public.push_notification_outbox
    set
      status = 'no_targets',
      delivered_at = now(),
      locked_at = null,
      updated_at = now()
    where id = v_outbox_id;
  end if;
end;
$$;

revoke all on function public.enqueue_timetable_push_notification(uuid, text, uuid, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.enqueue_timetable_push_notification(uuid, text, uuid, text, integer, jsonb, text) to service_role;

create or replace function public.claim_push_notification_deliveries(
  p_outbox_id uuid,
  p_limit integer default 100
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  platform text,
  attempt_count integer
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select d.id
    from public.push_notification_deliveries d
    where d.outbox_id = p_outbox_id
      and (
        (d.status = 'pending' and d.available_at <= now())
        or
        (d.status = 'processing' and d.locked_at < now() - interval '2 minutes')
      )
    order by d.available_at, d.created_at
    for update skip locked
    limit greatest(least(coalesce(p_limit, 100), 500), 1)
  ), claimed as (
    update public.push_notification_deliveries d
    set
      status = 'processing',
      attempt_count = d.attempt_count + 1,
      locked_at = now(),
      updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select
    c.id,
    c.subscription_id,
    s.endpoint,
    s.p256dh,
    s.auth_secret,
    s.platform,
    c.attempt_count
  from claimed c
  join public.push_subscriptions s on s.id = c.subscription_id
  where s.status = 'active';
$$;

revoke all on function public.claim_push_notification_deliveries(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_deliveries(uuid, integer) to service_role;

create or replace function public.push_retry_delay_seconds(
  p_attempt_count integer,
  p_retry_after_seconds integer default null
)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when p_retry_after_seconds is not null then
      greatest(1, least(p_retry_after_seconds, 3600))
    when coalesce(p_attempt_count, 1) <= 1 then 30
    when p_attempt_count = 2 then 120
    when p_attempt_count = 3 then 480
    else 1800
  end;
$$;

revoke all on function public.push_retry_delay_seconds(integer, integer) from public, anon, authenticated;
grant execute on function public.push_retry_delay_seconds(integer, integer) to service_role;

create or replace function public.record_push_notification_delivery(
  p_delivery_id uuid,
  p_result text,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.push_notification_deliveries%rowtype;
  v_next_status text;
  v_delay_seconds integer;
begin
  select *
  into v_delivery
  from public.push_notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'PUSH_DELIVERY_NOT_FOUND';
  end if;

  if v_delivery.status in ('delivered', 'terminal', 'dead') then
    return v_delivery.status;
  end if;

  if p_result = 'delivered' then
    update public.push_notification_deliveries
    set
      status = 'delivered',
      delivered_at = now(),
      locked_at = null,
      last_error_code = null,
      updated_at = now()
    where id = v_delivery.id;

    update public.push_subscriptions
    set
      last_success_at = now(),
      last_error_code = null,
      updated_at = now()
    where id = v_delivery.subscription_id;

    return 'delivered';
  end if;

  if p_result = 'terminal' then
    update public.push_notification_deliveries
    set
      status = 'terminal',
      terminal_at = now(),
      locked_at = null,
      last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_ENDPOINT_GONE'), 120), ''),
      updated_at = now()
    where id = v_delivery.id;

    -- This is intentionally timetable-scoped. One browser endpoint may have a
    -- different push_subscriptions row for another timetable.
    update public.push_subscriptions
    set
      status = 'expired',
      revoked_at = coalesce(revoked_at, now()),
      last_error_at = now(),
      last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_ENDPOINT_GONE'), 120), ''),
      updated_at = now()
    where id = v_delivery.subscription_id;

    return 'terminal';
  end if;

  if p_result <> 'retry' then
    raise exception 'PUSH_DELIVERY_RESULT_INVALID';
  end if;

  if v_delivery.attempt_count >= 6 then
    update public.push_notification_deliveries
    set
      status = 'dead',
      dead_at = now(),
      locked_at = null,
      last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_RETRY_EXHAUSTED'), 120), ''),
      updated_at = now()
    where id = v_delivery.id;

    update public.push_subscriptions
    set
      last_error_at = now(),
      last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_RETRY_EXHAUSTED'), 120), ''),
      updated_at = now()
    where id = v_delivery.subscription_id;

    return 'dead';
  end if;

  v_delay_seconds := public.push_retry_delay_seconds(
    v_delivery.attempt_count,
    p_retry_after_seconds
  );
  v_next_status := 'pending';

  update public.push_notification_deliveries
  set
    status = v_next_status,
    available_at = now() + make_interval(secs => v_delay_seconds),
    locked_at = null,
    last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_TRANSIENT_FAILURE'), 120), ''),
    updated_at = now()
  where id = v_delivery.id;

  update public.push_subscriptions
  set
    last_error_at = now(),
    last_error_code = nullif(left(coalesce(p_error_code, 'PUSH_TRANSIENT_FAILURE'), 120), ''),
    updated_at = now()
  where id = v_delivery.subscription_id;

  return v_next_status;
end;
$$;

revoke all on function public.record_push_notification_delivery(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_push_notification_delivery(uuid, text, text, integer) to service_role;

create or replace function public.finalize_push_notification_outbox(
  p_outbox_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_pending integer;
  v_dead integer;
  v_next_available timestamptz;
  v_status text;
begin
  perform 1
  from public.push_notification_outbox
  where id = p_outbox_id
  for update;

  if not found then
    raise exception 'PUSH_OUTBOX_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status in ('pending', 'processing'))::integer,
    count(*) filter (where status = 'dead')::integer,
    min(available_at) filter (where status = 'pending')
  into v_total, v_pending, v_dead, v_next_available
  from public.push_notification_deliveries
  where outbox_id = p_outbox_id;

  if v_total = 0 then
    v_status := 'no_targets';
    update public.push_notification_outbox
    set
      status = v_status,
      delivered_at = coalesce(delivered_at, now()),
      locked_at = null,
      last_error_code = null,
      updated_at = now()
    where id = p_outbox_id;
    return v_status;
  end if;

  if v_dead > 0 and v_pending = 0 then
    v_status := 'dead';
    update public.push_notification_outbox
    set
      status = v_status,
      locked_at = null,
      last_error_code = 'PUSH_TARGET_RETRY_EXHAUSTED',
      updated_at = now()
    where id = p_outbox_id;
    return v_status;
  end if;

  if v_pending > 0 then
    v_status := 'pending';
    update public.push_notification_outbox
    set
      status = v_status,
      available_at = coalesce(v_next_available, now() + interval '2 minutes'),
      locked_at = null,
      last_error_code = null,
      updated_at = now()
    where id = p_outbox_id;
    return v_status;
  end if;

  v_status := 'delivered';
  update public.push_notification_outbox
  set
    status = v_status,
    delivered_at = coalesce(delivered_at, now()),
    locked_at = null,
    last_error_code = null,
    updated_at = now()
  where id = p_outbox_id;
  return v_status;
end;
$$;

revoke all on function public.finalize_push_notification_outbox(uuid) from public, anon, authenticated;
grant execute on function public.finalize_push_notification_outbox(uuid) to service_role;
