-- Founder analytics metric correctness hardening.
-- 0013 establishes the aggregate. This migration preserves that reviewed query as
-- an internal implementation and exposes the same server contract with corrected
-- activation and identity-mix semantics.

alter function public.get_admin_analytics_overview(
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
) rename to get_admin_analytics_overview_v1;

create function public.get_admin_analytics_overview(
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
security invoker
as $$
  with base as (
    select *
    from public.get_admin_analytics_overview_v1(
      p_from,
      p_to,
      p_timezone,
      p_institution_id,
      p_programme_id,
      p_class_group_id,
      p_timetable_id,
      p_provider,
      p_device_kind,
      p_browser_family,
      p_os_family,
      p_utm_source,
      p_stage
    )
  ),
  filtered_events as (
    select e.*
    from public.analytics_events e
    left join public.timetables t on t.id::text = e.timetable_id
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
  activation as (
    select
      count(distinct coalesce(analytics_person_id::text, anonymous_id::text))
        filter (where event_name = 'timetable_viewed')::integer as viewers,
      count(distinct coalesce(analytics_person_id::text, anonymous_id::text))
        filter (
          where event_name in (
            'subscription_created',
            'calendar_subscription_created',
            'google_oauth_completed',
            'google_calendar_created'
          )
          and provider in (
            'google_api',
            'apple_subscription',
            'webcal_subscription',
            'outlook_subscription'
          )
        )::integer as activated
    from filtered_events
  ),
  identity_mix as (
    select
      count(distinct coalesce(e.analytics_person_id::text, e.anonymous_id::text))::integer
        as total_people,
      (
        count(distinct e.analytics_person_id) filter (
          where e.analytics_person_id is not null
            and p.identity_strength <> 'anonymous'
        )
      )::integer as linked_people
    from filtered_events e
    left join public.analytics_people p on p.id = e.analytics_person_id
  )
  select
    b.active_calendar_connections,
    b.unique_timetable_viewers,
    coalesce(a.activated::numeric / nullif(a.viewers, 0), 0)
      as calendar_activation_rate,
    b.new_calendar_connections,
    b.feed_health_rate,
    b.provider_mix,
    b.adoption_timeseries,
    b.funnel,
    b.events_received,
    b.unique_anonymous_identities,
    b.identities_stitched_to_subscriptions,
    b.consented_contact_linkage_rate,
    b.missing_timetable_context,
    b.missing_subscription_linkage,
    b.identity_stitching_rate,
    coalesce(im.linked_people::numeric / nullif(im.total_people, 0), 0)
      as known_vs_anonymous_ratio,
    b.last_ingestion_at,
    b.persistence_failures,
    b.unexpected_event_names,
    b.known_historical_instrumentation_gaps,
    b.aggregate_freshness_minutes
  from base b
  cross join activation a
  cross join identity_mix im;
$$;

revoke all on function public.get_admin_analytics_overview_v1(
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

grant execute on function public.get_admin_analytics_overview_v1(
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
