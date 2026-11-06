-- Preserve uncertain Calendar insert outcomes across queue retries and renewed consent.
-- Existing jobs, credentials, calendar identities and reminder preferences are retained.
alter table public.google_calendar_delivery_jobs
  add column calendar_creation_started_at timestamptz,
  add column calendar_creation_generation bigint,
  add constraint google_calendar_creation_marker_valid check (
    (calendar_creation_started_at is null and calendar_creation_generation is null)
    or (calendar_creation_started_at is not null and calendar_creation_generation is not null and calendar_creation_generation >= 0)
  );

create function public.begin_google_calendar_creation(
  p_subscription_id uuid, p_connection_generation bigint, p_lease_token uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare s public.calendar_subscriptions%rowtype;
begin
  select * into s from public.calendar_subscriptions where id = p_subscription_id for update;
  if not found or s.provider <> 'google_api' or s.revoked_at is not null
    or s.status not in ('active', 'pending') or s.external_calendar_id is not null
    or p_connection_generation is null or s.google_connection_generation <> p_connection_generation
    or not exists (select 1 from public.google_calendar_credentials where subscription_id = s.id)
    then return false; end if;
  update public.google_calendar_delivery_jobs
    set calendar_creation_started_at = clock_timestamp(), calendar_creation_generation = p_connection_generation
    where subscription_id = s.id and calendar_creation_started_at is null
      and lease_token = p_lease_token and lease_expires_at > clock_timestamp() + interval '5 seconds'
      and claimed_revision = desired_revision and claimed_generation = requested_generation
      and reconnect_required_at is null;
  return found;
end;
$$;
revoke all on function public.begin_google_calendar_creation(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.begin_google_calendar_creation(uuid, bigint, uuid) to service_role;

-- Serialize the selected owner's enrollment retries while retaining the established
-- subscription/profile transaction and its consent validation.
create function public.create_scoped_google_subscription_with_profile(
  p_issued_at timestamptz,
  p_timetable_id uuid, p_anonymous_session_id uuid, p_provider text,
  p_reminder_preset text, p_reminder_offsets_minutes jsonb,
  p_calendar_name text, p_timezone text,
  p_token_hash text default null, p_phone_e164 text default null,
  p_country_code text default null, p_consent_updates boolean default false,
  p_consent_source text default null
) returns public.calendar_subscriptions language plpgsql security invoker set search_path = public as $$
declare s public.calendar_subscriptions%rowtype;
begin
  if p_provider is distinct from 'google_api' or p_anonymous_session_id is null or p_timetable_id is null
    or p_issued_at is null or p_issued_at > clock_timestamp()
    or p_issued_at < clock_timestamp() - interval '24 hours' then
      raise exception 'GOOGLE_ONBOARDING_SCOPE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_anonymous_session_id::text || ':' || p_timetable_id::text, 0));
  if exists (select 1 from public.calendar_subscriptions
    where anonymous_session_id = p_anonymous_session_id and timetable_id = p_timetable_id
      and provider = 'google_api' and revoked_at is null
      and (created_at < p_issued_at or status <> 'pending'
        or google_connection_generation <> 0 or external_calendar_id is not null)) then
    raise exception 'GOOGLE_EXISTING_CONNECTION_REQUIRES_REVIEW';
  end if;
  select * into s from public.calendar_subscriptions
    where anonymous_session_id = p_anonymous_session_id and timetable_id = p_timetable_id
      and provider = 'google_api' and revoked_at is null
    order by created_at desc limit 1 for update;
  if found then
    if s.created_at >= p_issued_at and s.status = 'pending'
      and s.google_connection_generation = 0 and s.external_calendar_id is null then return s; end if;
    raise exception 'GOOGLE_EXISTING_CONNECTION_REQUIRES_REVIEW';
  end if;
  return public.create_calendar_subscription_with_profile(
    p_timetable_id, p_anonymous_session_id, p_provider, p_reminder_preset,
    p_reminder_offsets_minutes, p_calendar_name, p_timezone, p_token_hash,
    p_phone_e164, p_country_code, p_consent_updates, p_consent_source
  );
end;
$$;
revoke all on function public.create_scoped_google_subscription_with_profile(timestamptz, uuid, uuid, text, text, jsonb, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_scoped_google_subscription_with_profile(timestamptz, uuid, uuid, text, text, jsonb, text, text, text, text, text, boolean, text) to service_role;
