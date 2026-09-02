-- Founder analytics command center foundation.
-- Analytics observes product truth; it does not change timetable, feed, or Google sync behavior.

create extension if not exists pgcrypto;

create table if not exists public.analytics_people (
  id uuid primary key default gen_random_uuid(),
  product_key text not null default 'calenderzw',
  identity_strength text not null default 'anonymous'
    check (
      identity_strength in (
        'anonymous',
        'subscription_linked',
        'consented_contact_linked'
      )
    ),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_stage text not null default 'Visitor',
  engagement_score integer not null default 0 check (engagement_score between 0 and 100),
  score_factors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_person_identities (
  analytics_person_id uuid not null references public.analytics_people(id) on delete cascade,
  identity_type text not null
    check (identity_type in ('anonymous_id', 'subscription_id', 'subscriber_profile_id')),
  identity_uuid uuid not null,
  linked_at timestamptz not null default now(),
  primary key (identity_type, identity_uuid),
  unique (analytics_person_id, identity_type, identity_uuid)
);

alter table public.analytics_events
  add column if not exists analytics_person_id uuid
  references public.analytics_people(id) on delete set null;

create index if not exists analytics_people_last_seen_idx
  on public.analytics_people (last_seen_at desc);

create index if not exists analytics_person_identities_person_idx
  on public.analytics_person_identities (analytics_person_id, identity_type);

create index if not exists analytics_events_person_created_idx
  on public.analytics_events (analytics_person_id, created_at desc)
  where analytics_person_id is not null;

alter table public.analytics_people enable row level security;
alter table public.analytics_person_identities enable row level security;
revoke all on table public.analytics_people from anon, authenticated;
revoke all on table public.analytics_person_identities from anon, authenticated;
grant all on table public.analytics_people to service_role;
grant all on table public.analytics_person_identities to service_role;

create or replace function public.analytics_stage_for_events(
  p_events text[],
  p_has_active_connection boolean,
  p_has_recent_activity boolean,
  p_has_prolonged_failure boolean,
  p_session_count integer
)
returns text
language sql
immutable
as $$
  select case
    when p_has_prolonged_failure then 'At risk'
    when 'timetable_shared' = any(p_events) then 'Advocate'
    when p_has_active_connection and p_has_recent_activity then 'Active subscriber'
    when p_has_active_connection
      or p_events && array[
        'subscription_created',
        'calendar_subscription_created',
        'google_oauth_completed',
        'google_calendar_created'
      ] then 'Calendar connected'
    when p_events && array[
      'provider_selected',
      'calendar_method_selected',
      'calendar_provider_selected'
    ] then 'Provider selected'
    when 'onboarding_opened' = any(p_events) then 'Onboarding started'
    when p_session_count > 1
      or p_events && array[
        'calendar_cta_clicked',
        'share_prompt_viewed',
        'timetable_shared'
      ] then 'Engaged'
    when 'timetable_viewed' = any(p_events) then 'Timetable viewer'
    else 'Visitor'
  end;
$$;

create or replace function public.analytics_score_for_events(
  p_events text[],
  p_session_count integer
)
returns integer
language sql
immutable
as $$
  select greatest(
    0,
    least(
      100,
      coalesce(array_length(array_positions(p_events, 'timetable_viewed'), 1), 0) * 5
      + case when p_session_count > 1 then 5 else 0 end
      + coalesce(array_length(array_positions(p_events, 'calendar_cta_clicked'), 1), 0) * 10
      + coalesce(array_length(array_positions(p_events, 'onboarding_opened'), 1), 0) * 10
      + coalesce(array_length(array_positions(p_events, 'provider_selected'), 1), 0) * 10
      + coalesce(array_length(array_positions(p_events, 'calendar_provider_selected'), 1), 0) * 10
      + coalesce(array_length(array_positions(p_events, 'subscription_created'), 1), 0) * 25
      + coalesce(array_length(array_positions(p_events, 'calendar_subscription_created'), 1), 0) * 25
      + coalesce(array_length(array_positions(p_events, 'google_oauth_completed'), 1), 0) * 15
      + coalesce(array_length(array_positions(p_events, 'google_calendar_sync_completed'), 1), 0) * 10
      + coalesce(array_length(array_positions(p_events, 'timetable_shared'), 1), 0) * 15
      - coalesce(array_length(array_positions(p_events, 'onboarding_abandoned'), 1), 0) * 5
      - coalesce(array_length(array_positions(p_events, 'google_calendar_sync_failed'), 1), 0) * 10
    )
  );
$$;

create or replace function public.resolve_analytics_person(
  p_product_key text,
  p_anonymous_id uuid,
  p_subscription_id uuid default null,
  p_seen_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  person_id uuid;
  created_person_id uuid;
  profile_uuid uuid;
begin
  if p_subscription_id is not null then
    select analytics_person_id into person_id
    from public.analytics_person_identities
    where identity_type = 'subscription_id'
      and identity_uuid = p_subscription_id;
  end if;

  if person_id is null then
    select analytics_person_id into person_id
    from public.analytics_person_identities
    where identity_type = 'anonymous_id'
      and identity_uuid = p_anonymous_id;
  end if;

  if person_id is null then
    insert into public.analytics_people (product_key, first_seen_at, last_seen_at)
    values (p_product_key, p_seen_at, p_seen_at)
    returning id into created_person_id;

    insert into public.analytics_person_identities (
      analytics_person_id,
      identity_type,
      identity_uuid
    )
    values (created_person_id, 'anonymous_id', p_anonymous_id)
    on conflict (identity_type, identity_uuid) do nothing;

    select analytics_person_id into person_id
    from public.analytics_person_identities
    where identity_type = 'anonymous_id'
      and identity_uuid = p_anonymous_id;

    person_id := coalesce(person_id, created_person_id);
  end if;

  if p_subscription_id is not null then
    insert into public.analytics_person_identities (
      analytics_person_id,
      identity_type,
      identity_uuid
    )
    values (person_id, 'subscription_id', p_subscription_id)
    on conflict (identity_type, identity_uuid) do nothing;

    select subscriber_profile_id into profile_uuid
    from public.calendar_subscriptions
    where id = p_subscription_id;

    if profile_uuid is not null then
      insert into public.analytics_person_identities (
        analytics_person_id,
        identity_type,
        identity_uuid
      )
      values (person_id, 'subscriber_profile_id', profile_uuid)
      on conflict (identity_type, identity_uuid) do nothing;
    end if;

  end if;

  update public.analytics_people
  set
    last_seen_at = greatest(last_seen_at, p_seen_at),
    identity_strength = case
      when profile_uuid is not null then 'consented_contact_linked'
      when p_subscription_id is not null then 'subscription_linked'
      else identity_strength
    end,
    updated_at = now()
  where id = person_id;

  return person_id;
end;
$$;

create or replace view public.analytics_person_summary as
select
  p.id as analytics_person_id,
  p.identity_strength,
  min(e.created_at) as first_seen_at,
  max(e.created_at) as last_seen_at,
  count(distinct e.session_id) as session_count,
  count(e.id) as meaningful_action_count,
  public.analytics_stage_for_events(
    array_agg(e.event_name order by e.created_at),
    bool_or(cs.status = 'active' and cs.provider <> 'ics_download'),
    bool_or(
      cs.last_feed_fetch_at > now() - interval '14 days'
      or cs.last_synced_at > now() - interval '14 days'
    ),
    bool_or(cs.status = 'failed' or cs.last_error_code is not null),
    count(distinct e.session_id)::integer
  ) as current_stage,
  public.analytics_score_for_events(
    array_agg(e.event_name order by e.created_at),
    count(distinct e.session_id)::integer
  ) as engagement_score,
  max(e.timetable_id) filter (where e.timetable_id is not null) as latest_timetable_id,
  max(e.provider) filter (where e.provider is not null) as latest_provider,
  max(e.device_kind) filter (where e.device_kind is not null) as device_kind,
  max(e.browser_family) filter (where e.browser_family is not null) as browser_family,
  max(e.os_family) filter (where e.os_family is not null) as os_family,
  bool_or(sp.consent_updates is true) as has_consented_contact,
  bool_or(gc.subscription_id is not null) as has_google_connection
from public.analytics_people p
left join public.analytics_events e on e.analytics_person_id = p.id
left join public.analytics_person_identities psi
  on psi.analytics_person_id = p.id
  and psi.identity_type = 'subscription_id'
left join public.calendar_subscriptions cs on cs.id = psi.identity_uuid
left join public.subscriber_profiles sp on sp.id = cs.subscriber_profile_id
left join public.google_calendar_credentials gc on gc.subscription_id = cs.id
group by p.id, p.identity_strength;

revoke all on table public.analytics_person_summary from anon, authenticated;
grant select on table public.analytics_person_summary to service_role;

create or replace function public.get_admin_analytics_overview(
  p_from date,
  p_to date,
  p_timezone text default 'Africa/Harare',
  p_institution_id uuid default null,
  p_programme_id uuid default null,
  p_class_group_id uuid default null,
  p_timetable_id uuid default null,
  p_provider text default null,
  p_device_kind text default null,
  p_browser_family text default null,
  p_os_family text default null,
  p_utm_source text default null,
  p_stage text default null
)
returns table (
  active_calendar_connections integer,
  unique_timetable_viewers integer,
  calendar_activation_rate numeric,
  new_calendar_connections integer,
  feed_health_rate numeric,
  provider_mix jsonb,
  adoption_timeseries jsonb,
  funnel jsonb,
  events_received integer,
  unique_anonymous_identities integer,
  identities_stitched_to_subscriptions integer,
  consented_contact_linkage_rate numeric,
  missing_timetable_context integer,
  missing_subscription_linkage integer,
  identity_stitching_rate numeric,
  known_vs_anonymous_ratio numeric,
  last_ingestion_at timestamptz,
  persistence_failures integer,
  unexpected_event_names text[],
  known_historical_instrumentation_gaps text[],
  aggregate_freshness_minutes numeric
)
language sql
stable
as $$
  with filtered_events as (
    select e.*
    from public.analytics_events e
    left join public.timetables t
      on t.id::text = e.timetable_id
    where e.created_at >= (p_from::timestamp at time zone p_timezone)
      and e.created_at < ((p_to + 1)::timestamp at time zone p_timezone)
      and (p_timetable_id is null or e.timetable_id = p_timetable_id::text)
      and (p_provider is null or e.provider = p_provider)
      and (p_device_kind is null or e.device_kind = p_device_kind)
      and (p_browser_family is null or e.browser_family = p_browser_family)
      and (p_os_family is null or e.os_family = p_os_family)
      and (p_utm_source is null or e.properties ->> 'utmSource' = p_utm_source)
      and (p_institution_id is null or t.institution_id = p_institution_id)
      and (p_programme_id is null or t.programme_id = p_programme_id)
      and (p_class_group_id is null or t.cohort_id = p_class_group_id)
  ),
  person_events as (
    select distinct
      coalesce(analytics_person_id::text, anonymous_id::text) as person_key,
      event_name
    from filtered_events
  ),
  funnel_counts as (
    select *
    from (values
      ('Timetable viewed', 1, array['timetable_viewed']),
      ('Calendar CTA clicked', 2, array['calendar_cta_clicked']),
      ('Onboarding opened', 3, array['onboarding_opened']),
      (
        'Provider selected',
        4,
        array[
          'provider_selected',
          'calendar_method_selected',
          'calendar_provider_selected'
        ]
      ),
      (
        'Calendar connection created',
        5,
        array[
          'subscription_created',
          'calendar_subscription_created',
          'google_oauth_completed',
          'google_calendar_created'
        ]
      ),
      ('Onboarding completed', 6, array['onboarding_completed'])
    ) as stages(stage, position, event_names)
  ),
  counted_funnel as (
    select
      fc.stage,
      fc.position,
      count(distinct pe.person_key)::integer as people
    from funnel_counts fc
    left join person_events pe on pe.event_name = any(fc.event_names)
    group by fc.stage, fc.position
  ),
  funnel_rates as (
    select
      stage,
      position,
      people,
      people::numeric / nullif(lag(people) over (order by position), 0)
        as conversion_from_previous,
      people::numeric / nullif(first_value(people) over (order by position), 0)
        as conversion_from_first,
      lag(people) over (order by position) - people as dropoff_count,
      (lag(people) over (order by position) - people)::numeric
        / nullif(lag(people) over (order by position), 0) as dropoff_rate
    from counted_funnel
  ),
  provider_counts as (
    select
      coalesce(provider, 'unknown') as provider,
      count(*) filter (
        where event_name in (
          'provider_selected',
          'calendar_provider_selected',
          'calendar_method_selected',
          'ics_download_started',
          'ics_download_completed'
        )
      )::integer as setup_choices
    from filtered_events
    group by coalesce(provider, 'unknown')
  ),
  active_connections as (
    select
      cs.provider,
      count(*)::integer as active_connections,
      count(*) filter (
        where cs.last_feed_fetch_at > now() - interval '14 days'
          or cs.last_synced_at > now() - interval '14 days'
      )::integer as healthy_connections
    from public.calendar_subscriptions cs
    join public.timetables t on t.id = cs.timetable_id
    where cs.status = 'active'
      and cs.provider <> 'ics_download'
      and (p_timetable_id is null or cs.timetable_id = p_timetable_id)
      and (p_provider is null or cs.provider = p_provider)
      and (p_institution_id is null or t.institution_id = p_institution_id)
      and (p_programme_id is null or t.programme_id = p_programme_id)
      and (p_class_group_id is null or t.cohort_id = p_class_group_id)
    group by cs.provider
  ),
  daily_trend as (
    select
      (created_at at time zone p_timezone)::date as activity_date,
      count(distinct coalesce(analytics_person_id::text, anonymous_id::text))::integer
        as unique_people,
      count(*) filter (where event_name = 'timetable_viewed')::integer
        as timetable_views,
      count(*) filter (where event_name = 'onboarding_opened')::integer
        as onboarding_starts,
      count(distinct coalesce(subscription_id, analytics_person_id::text, anonymous_id::text))
        filter (
          where event_name in (
            'subscription_created',
            'calendar_subscription_created',
            'google_oauth_completed',
            'google_calendar_created'
          )
          and coalesce(provider, '') <> 'ics_download'
        )::integer as calendar_connections,
      count(distinct coalesce(subscription_id, analytics_person_id::text, anonymous_id::text))
        filter (
          where event_name in (
            'google_oauth_completed',
            'google_calendar_created',
            'google_calendar_sync_completed'
          )
        )::integer as google_connections,
      count(*) filter (where event_name = 'timetable_shared')::integer as shares
    from filtered_events
    group by (created_at at time zone p_timezone)::date
  ),
  totals as (
    select
      count(*)::integer as events_received,
      count(distinct anonymous_id)::integer as unique_anonymous_identities,
      count(*) filter (where timetable_id is null)::integer as missing_timetable_context,
      count(*) filter (where subscription_id is null)::integer as missing_subscription_linkage,
      count(distinct coalesce(analytics_person_id::text, anonymous_id::text))
        filter (where event_name = 'timetable_viewed')::integer as unique_timetable_viewers,
      count(distinct coalesce(analytics_person_id::text, anonymous_id::text))
        filter (
          where event_name in (
            'calendar_subscription_created',
            'subscription_created',
            'google_oauth_completed',
            'google_calendar_created'
          )
        )::integer as activated_people,
      count(distinct coalesce(subscription_id, analytics_person_id::text, anonymous_id::text))
        filter (
          where event_name in (
            'subscription_created',
            'calendar_subscription_created',
            'google_oauth_completed',
            'google_calendar_created'
          )
          and coalesce(provider, '') <> 'ics_download'
        )::integer as new_calendar_connections,
      count(*) filter (where analytics_person_id is not null)::numeric
        / nullif(count(*), 0) as identity_stitching_rate,
      max(created_at) as last_ingestion_at
    from filtered_events
  ),
  connection_totals as (
    select
      coalesce(sum(active_connections), 0)::integer as active_calendar_connections,
      coalesce(sum(healthy_connections), 0)::integer as healthy_connections
    from active_connections
  ),
  identity_quality as (
    select
      count(distinct psi.analytics_person_id)
        filter (where psi.identity_type = 'subscription_id')::integer
        as identities_stitched_to_subscriptions,
      count(distinct psi.analytics_person_id)
        filter (where psi.identity_type = 'subscriber_profile_id')::integer
        as consented_contact_people
    from public.analytics_person_identities psi
  )
  select
    ct.active_calendar_connections,
    totals.unique_timetable_viewers,
    coalesce(
      totals.activated_people::numeric / nullif(totals.unique_timetable_viewers, 0),
      0
    ) as calendar_activation_rate,
    totals.new_calendar_connections,
    coalesce(
      ct.healthy_connections::numeric / nullif(ct.active_calendar_connections, 0),
      0
    ) as feed_health_rate,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'provider',
            coalesce(pc.provider, ac.provider),
            'setupChoices',
            coalesce(pc.setup_choices, 0),
            'activeConnections',
            coalesce(ac.active_connections, 0)
          )
          order by coalesce(ac.active_connections, 0) desc
        ),
        '[]'::jsonb
      )
      from provider_counts pc
      full outer join active_connections ac on ac.provider = pc.provider
    ) as provider_mix,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', activity_date,
            'uniquePeople', unique_people,
            'timetableViews', timetable_views,
            'onboardingStarts', onboarding_starts,
            'calendarConnections', calendar_connections,
            'googleConnections', google_connections,
            'shares', shares
          )
          order by activity_date
        ),
        '[]'::jsonb
      )
      from daily_trend
    ) as adoption_timeseries,
    (
      select jsonb_agg(
        jsonb_build_object(
          'stage', stage,
          'people', people,
          'conversionFromPrevious', conversion_from_previous,
          'conversionFromFirst', conversion_from_first,
          'dropoffCount', dropoff_count,
          'dropoffRate', dropoff_rate
        )
        order by position
      )
      from funnel_rates
    ) as funnel,
    totals.events_received,
    totals.unique_anonymous_identities,
    iq.identities_stitched_to_subscriptions,
    coalesce(
      iq.consented_contact_people::numeric
        / nullif(iq.identities_stitched_to_subscriptions, 0),
      0
    ) as consented_contact_linkage_rate,
    totals.missing_timetable_context,
    totals.missing_subscription_linkage,
    coalesce(totals.identity_stitching_rate, 0) as identity_stitching_rate,
    0::numeric as known_vs_anonymous_ratio,
    totals.last_ingestion_at,
    null::integer as persistence_failures,
    array[]::text[] as unexpected_event_names,
    array[
      'Events before the founder analytics identity model may be missing analytics_person_id.',
      'Share attribution is only available when shareAttributionId is present.',
      'Persistence failures are logged operationally but were not historically persisted as a metric.'
    ]::text[] as known_historical_instrumentation_gaps,
    extract(epoch from (now() - totals.last_ingestion_at)) / 60
      as aggregate_freshness_minutes
  from totals
  cross join connection_totals ct
  cross join identity_quality iq;
$$;

revoke all on function public.analytics_stage_for_events(
  text[],
  boolean,
  boolean,
  boolean,
  integer
) from public;
revoke all on function public.analytics_score_for_events(text[], integer) from public;
revoke all on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) from public;
revoke all on function public.get_admin_analytics_overview(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.get_admin_analytics_overview(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

grant execute on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) to service_role;
