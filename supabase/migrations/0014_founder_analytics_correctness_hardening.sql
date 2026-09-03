-- Founder analytics correctness hardening.
-- This follows 0013 before either founder-analytics migration is applied in production.
-- It preserves the service-role-only boundary while correcting metric and identity semantics.

-- The summary view calls these helpers. Keep them unavailable to browser roles,
-- but explicitly executable by the service role that reads founder analytics.
grant execute on function public.analytics_stage_for_events(
  text[],
  boolean,
  boolean,
  boolean,
  integer
) to service_role;

grant execute on function public.analytics_score_for_events(text[], integer)
  to service_role;

-- Replace identity resolution with a deterministic merge-safe resolver.
-- A subscription ID and anonymous ID appearing in the same accepted product event
-- are a direct product relationship, so they may be stitched. Heuristic attributes
-- such as IP, browser, OS, programme, timetable similarity, or timing are never used.
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
  anonymous_person_id uuid;
  subscription_person_id uuid;
  person_id uuid;
  created_person_id uuid;
  profile_uuid uuid;
begin
  select analytics_person_id into anonymous_person_id
  from public.analytics_person_identities
  where identity_type = 'anonymous_id'
    and identity_uuid = p_anonymous_id;

  if p_subscription_id is not null then
    select analytics_person_id into subscription_person_id
    from public.analytics_person_identities
    where identity_type = 'subscription_id'
      and identity_uuid = p_subscription_id;
  end if;

  -- If the same accepted event proves that an existing anonymous identity and an
  -- existing subscription identity are the same product relationship, collapse
  -- the anonymous record into the subscription-backed record deterministically.
  if subscription_person_id is not null
    and anonymous_person_id is not null
    and subscription_person_id <> anonymous_person_id then

    update public.analytics_events
    set analytics_person_id = subscription_person_id
    where analytics_person_id = anonymous_person_id;

    update public.analytics_person_identities
    set analytics_person_id = subscription_person_id
    where analytics_person_id = anonymous_person_id;

    update public.analytics_people target
    set
      first_seen_at = least(target.first_seen_at, source.first_seen_at),
      last_seen_at = greatest(target.last_seen_at, source.last_seen_at),
      identity_strength = case
        when target.identity_strength = 'consented_contact_linked'
          or source.identity_strength = 'consented_contact_linked'
          then 'consented_contact_linked'
        when target.identity_strength = 'subscription_linked'
          or source.identity_strength = 'subscription_linked'
          then 'subscription_linked'
        else 'anonymous'
      end,
      updated_at = now()
    from public.analytics_people source
    where target.id = subscription_person_id
      and source.id = anonymous_person_id;

    delete from public.analytics_people
    where id = anonymous_person_id;

    anonymous_person_id := subscription_person_id;
  end if;

  person_id := coalesce(subscription_person_id, anonymous_person_id);

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
  else
    -- When the subscription is already known, also remember the deterministic
    -- anonymous identity observed with it so later same-browser events stay linked.
    insert into public.analytics_person_identities (
      analytics_person_id,
      identity_type,
      identity_uuid
    )
    values (person_id, 'anonymous_id', p_anonymous_id)
    on conflict (identity_type, identity_uuid) do nothing;
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
    first_seen_at = least(first_seen_at, p_seen_at),
    last_seen_at = greatest(last_seen_at, p_seen_at),
    identity_strength = case
      when identity_strength = 'consented_contact_linked'
        or profile_uuid is not null
        then 'consented_contact_linked'
      when identity_strength = 'subscription_linked'
        or p_subscription_id is not null
        then 'subscription_linked'
      else 'anonymous'
    end,
    updated_at = now()
  where id = person_id;

  return person_id;
end;
$$;

revoke all on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) from public;

grant execute on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) to service_role;

-- Keep the reviewed 0013 aggregate as an internal implementation, then expose a
-- corrected wrapper with the same public server contract. This avoids duplicating
-- the entire Tableau-style aggregate while fixing two semantics that must never lie:
-- activation excludes one-time ICS, and known-vs-anonymous is calculated from data.
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
      count(distinct e.analytics_person_id)::integer filter (
        where e.analytics_person_id is not null
          and p.identity_strength <> 'anonymous'
      ) as linked_people
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
