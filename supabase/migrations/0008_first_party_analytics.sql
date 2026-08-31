create extension if not exists pgcrypto;

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  event_name text not null,
  anonymous_id uuid not null,
  session_id uuid not null,
  timetable_id text,
  subscription_id text,
  public_slug text,
  provider text,
  properties jsonb not null default '{}'::jsonb,
  device_kind text not null check (device_kind in ('desktop', 'mobile', 'tablet', 'other')),
  browser_family text not null check (browser_family in ('chrome', 'safari', 'firefox', 'edge', 'other')),
  os_family text not null check (os_family in ('android', 'ios', 'windows', 'macos', 'linux', 'other')),
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(product_key) between 1 and 64),
  check (char_length(event_name) between 1 and 96),
  check (octet_length(properties::text) <= 8192)
);

create index if not exists analytics_events_product_event_created_idx
  on analytics_events (product_key, event_name, created_at desc);
create index if not exists analytics_events_anonymous_created_idx
  on analytics_events (anonymous_id, created_at desc);
create index if not exists analytics_events_timetable_created_idx
  on analytics_events (timetable_id, created_at desc)
  where timetable_id is not null;
create index if not exists analytics_events_subscription_created_idx
  on analytics_events (subscription_id, created_at desc)
  where subscription_id is not null;

alter table analytics_events enable row level security;
revoke all on table analytics_events from anon, authenticated;
grant all on table analytics_events to service_role;

create index if not exists calendar_subscriptions_anonymous_session_idx
  on calendar_subscriptions (anonymous_session_id)
  where anonymous_session_id is not null;

create table if not exists calendar_feed_activity_daily (
  subscription_id uuid not null references calendar_subscriptions(id) on delete cascade,
  activity_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  not_modified_count integer not null default 0 check (not_modified_count >= 0),
  last_status_code integer not null check (last_status_code in (200, 304)),
  last_seen_at timestamptz not null default now(),
  device_kind text not null check (device_kind in ('desktop', 'mobile', 'tablet', 'other')),
  browser_family text not null check (browser_family in ('chrome', 'safari', 'firefox', 'edge', 'other')),
  os_family text not null check (os_family in ('android', 'ios', 'windows', 'macos', 'linux', 'other')),
  primary key (subscription_id, activity_date)
);

create index if not exists calendar_feed_activity_daily_date_idx
  on calendar_feed_activity_daily (activity_date desc, last_seen_at desc);

alter table calendar_feed_activity_daily enable row level security;
revoke all on table calendar_feed_activity_daily from anon, authenticated;
grant all on table calendar_feed_activity_daily to service_role;

create or replace function public.record_calendar_feed_activity(
  p_subscription_id uuid,
  p_status_code integer,
  p_device_kind text,
  p_browser_family text,
  p_os_family text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status_code not in (200, 304) then
    raise exception 'INVALID_FEED_STATUS';
  end if;

  insert into public.calendar_feed_activity_daily (
    subscription_id,
    activity_date,
    request_count,
    not_modified_count,
    last_status_code,
    last_seen_at,
    device_kind,
    browser_family,
    os_family
  )
  values (
    p_subscription_id,
    (now() at time zone 'UTC')::date,
    1,
    case when p_status_code = 304 then 1 else 0 end,
    p_status_code,
    now(),
    p_device_kind,
    p_browser_family,
    p_os_family
  )
  on conflict (subscription_id, activity_date)
  do update set
    request_count = public.calendar_feed_activity_daily.request_count + 1,
    not_modified_count = public.calendar_feed_activity_daily.not_modified_count
      + case when excluded.last_status_code = 304 then 1 else 0 end,
    last_status_code = excluded.last_status_code,
    last_seen_at = excluded.last_seen_at,
    device_kind = excluded.device_kind,
    browser_family = excluded.browser_family,
    os_family = excluded.os_family;

  update public.calendar_subscriptions
  set last_feed_fetch_at = now()
  where id = p_subscription_id;
end;
$$;

revoke all on function public.record_calendar_feed_activity(uuid, integer, text, text, text) from public;
revoke all on function public.record_calendar_feed_activity(uuid, integer, text, text, text) from anon;
revoke all on function public.record_calendar_feed_activity(uuid, integer, text, text, text) from authenticated;
grant execute on function public.record_calendar_feed_activity(uuid, integer, text, text, text) to service_role;
