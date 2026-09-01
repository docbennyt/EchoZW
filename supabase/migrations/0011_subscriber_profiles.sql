create table if not exists public.subscriber_profiles (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text,
  country_code text,
  consent_updates boolean not null default false,
  consented_at timestamptz,
  consent_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  check (
    consent_updates = false
    or (phone_e164 is not null and consented_at is not null and consent_source is not null)
  )
);

comment on table public.subscriber_profiles is
  'Server-owned optional contact profile for calendar subscribers. Phone is PII and must never be exposed to analytics, feed URLs, or public APIs.';

create unique index if not exists subscriber_profiles_contact_channel_idx
  on public.subscriber_profiles (phone_e164, country_code, consent_source)
  where phone_e164 is not null and consent_updates;

alter table public.subscriber_profiles enable row level security;
revoke all on table public.subscriber_profiles from anon, authenticated;
grant all on table public.subscriber_profiles to service_role;

alter table public.calendar_subscriptions
  add column if not exists subscriber_profile_id uuid
  references public.subscriber_profiles(id) on delete set null;

create index if not exists calendar_subscriptions_subscriber_profile_id_idx
  on public.calendar_subscriptions (subscriber_profile_id)
  where subscriber_profile_id is not null;

create or replace function public.create_calendar_subscription_with_profile(
  p_timetable_id uuid,
  p_anonymous_session_id uuid,
  p_provider text,
  p_reminder_preset text,
  p_reminder_offsets_minutes jsonb,
  p_calendar_name text,
  p_timezone text,
  p_token_hash text default null,
  p_phone_e164 text default null,
  p_country_code text default null,
  p_consent_updates boolean default false,
  p_consent_source text default null
)
returns public.calendar_subscriptions
language plpgsql
security invoker
set search_path = public
as $$
declare
  profile_id uuid;
  subscription public.calendar_subscriptions;
begin
  if p_phone_e164 is not null then
    if p_consent_updates is not true then
      raise exception 'CONTACT_CONSENT_REQUIRED';
    end if;

    insert into public.subscriber_profiles (
      phone_e164,
      country_code,
      consent_updates,
      consented_at,
      consent_source
    )
    values (
      p_phone_e164,
      p_country_code,
      true,
      now(),
      p_consent_source
    )
    on conflict (phone_e164, country_code, consent_source)
      where phone_e164 is not null and consent_updates
    do update set
      consent_updates = true,
      consented_at = excluded.consented_at,
      updated_at = now()
    returning id into profile_id;
  end if;

  insert into public.calendar_subscriptions (
    timetable_id,
    anonymous_session_id,
    provider,
    reminder_preset,
    reminder_offsets_minutes,
    calendar_name,
    timezone,
    token_hash,
    subscriber_profile_id,
    status
  )
  values (
    p_timetable_id,
    p_anonymous_session_id,
    p_provider,
    p_reminder_preset,
    p_reminder_offsets_minutes,
    p_calendar_name,
    p_timezone,
    p_token_hash,
    profile_id,
    'active'
  )
  returning * into subscription;

  return subscription;
end;
$$;

revoke all on function public.create_calendar_subscription_with_profile(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) from public;
revoke all on function public.create_calendar_subscription_with_profile(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) from anon, authenticated;
grant execute on function public.create_calendar_subscription_with_profile(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) to service_role;
