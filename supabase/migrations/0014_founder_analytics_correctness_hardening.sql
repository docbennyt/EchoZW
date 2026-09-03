-- Founder analytics identity correctness hardening.
-- This follows 0013 before either founder-analytics migration is applied in production.

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
