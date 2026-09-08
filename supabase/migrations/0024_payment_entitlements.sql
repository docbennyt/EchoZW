create table if not exists public.payment_purchases (
  id uuid primary key default gen_random_uuid(),
  calendar_subscription_id uuid not null references public.calendar_subscriptions(id) on delete restrict,
  subscriber_profile_id uuid not null references public.subscriber_profiles(id) on delete restrict,
  timetable_id uuid not null references public.timetables(id) on delete restrict,
  academic_period_id uuid not null references public.academic_periods(id) on delete restrict,
  plan_code text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider text not null check (provider in ('pesepay')),
  merchant_reference text not null unique,
  idempotency_key uuid not null unique,
  provider_reference text unique,
  provider_poll_url text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  gateway_status text,
  failure_class text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_purchases is
  'Server-owned payment state. No card credentials, mobile-money account details, raw callback payloads, or browser-trusted success flags may be stored here.';

create unique index if not exists payment_purchases_active_semester_checkout_idx
  on public.payment_purchases (calendar_subscription_id, academic_period_id, plan_code)
  where status in ('pending', 'paid');

create index if not exists payment_purchases_profile_idx
  on public.payment_purchases (subscriber_profile_id, created_at desc);

create table if not exists public.semester_entitlements (
  id uuid primary key default gen_random_uuid(),
  subscriber_profile_id uuid not null references public.subscriber_profiles(id) on delete restrict,
  timetable_id uuid not null references public.timetables(id) on delete restrict,
  academic_period_id uuid not null references public.academic_periods(id) on delete restrict,
  plan_code text not null,
  source text not null check (source in ('pilot_grant', 'purchase', 'manual_grant')),
  purchase_id uuid references public.payment_purchases(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (subscriber_profile_id, timetable_id, academic_period_id, plan_code)
);

comment on table public.semester_entitlements is
  'Server-owned semester access. Pilot grants and paid access share one lifecycle so an existing calendar never silently becomes stale at a pricing boundary.';

create table if not exists public.payment_gateway_events (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payment_purchases(id) on delete cascade,
  provider text not null,
  event_fingerprint text not null unique,
  gateway_status text,
  created_at timestamptz not null default now()
);

comment on table public.payment_gateway_events is
  'Idempotency evidence for payment result processing. Stores a fingerprint and coarse gateway status only, never the raw provider callback body.';

alter table public.payment_purchases enable row level security;
alter table public.semester_entitlements enable row level security;
alter table public.payment_gateway_events enable row level security;

revoke all on table public.payment_purchases from anon, authenticated;
revoke all on table public.semester_entitlements from anon, authenticated;
revoke all on table public.payment_gateway_events from anon, authenticated;
grant all on table public.payment_purchases to service_role;
grant all on table public.semester_entitlements to service_role;
grant all on table public.payment_gateway_events to service_role;

create or replace function public.ensure_calendar_subscription_profile(
  p_subscription_id uuid,
  p_anonymous_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_anonymous_session_id uuid;
  v_revoked_at timestamptz;
begin
  select subscriber_profile_id, anonymous_session_id, revoked_at
  into v_profile_id, v_anonymous_session_id, v_revoked_at
  from public.calendar_subscriptions
  where id = p_subscription_id
  for update;

  if not found or v_revoked_at is not null then
    raise exception 'SUBSCRIPTION_NOT_FOUND';
  end if;

  if v_anonymous_session_id is null
     or p_anonymous_session_id is null
     or v_anonymous_session_id <> p_anonymous_session_id then
    raise exception 'SUBSCRIPTION_OWNERSHIP_MISMATCH';
  end if;

  if v_profile_id is null then
    insert into public.subscriber_profiles (consent_updates)
    values (false)
    returning id into v_profile_id;

    update public.calendar_subscriptions
    set subscriber_profile_id = v_profile_id,
        updated_at = now()
    where id = p_subscription_id;
  end if;

  return v_profile_id;
end;
$$;

create or replace function public.begin_payment_purchase(
  p_calendar_subscription_id uuid,
  p_subscriber_profile_id uuid,
  p_timetable_id uuid,
  p_academic_period_id uuid,
  p_plan_code text,
  p_amount_minor integer,
  p_currency text,
  p_provider text,
  p_merchant_reference text,
  p_idempotency_key uuid
)
returns public.payment_purchases
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.payment_purchases;
begin
  select * into v_purchase
  from public.payment_purchases
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_purchase.calendar_subscription_id <> p_calendar_subscription_id
       or v_purchase.plan_code <> p_plan_code
       or v_purchase.amount_minor <> p_amount_minor
       or v_purchase.currency <> p_currency then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_purchase;
  end if;

  if exists (
    select 1 from public.semester_entitlements
    where subscriber_profile_id = p_subscriber_profile_id
      and timetable_id = p_timetable_id
      and academic_period_id = p_academic_period_id
      and plan_code = p_plan_code
      and status = 'active'
      and ends_on >= current_date
  ) then
    raise exception 'ENTITLEMENT_ALREADY_ACTIVE';
  end if;

  select * into v_purchase
  from public.payment_purchases
  where calendar_subscription_id = p_calendar_subscription_id
    and academic_period_id = p_academic_period_id
    and plan_code = p_plan_code
    and status in ('pending', 'paid')
  order by created_at desc
  limit 1
  for update;

  if found then
    return v_purchase;
  end if;

  insert into public.payment_purchases (
    calendar_subscription_id,
    subscriber_profile_id,
    timetable_id,
    academic_period_id,
    plan_code,
    amount_minor,
    currency,
    provider,
    merchant_reference,
    idempotency_key,
    status
  ) values (
    p_calendar_subscription_id,
    p_subscriber_profile_id,
    p_timetable_id,
    p_academic_period_id,
    p_plan_code,
    p_amount_minor,
    p_currency,
    p_provider,
    p_merchant_reference,
    p_idempotency_key,
    'pending'
  ) returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.record_payment_gateway_checkout(
  p_purchase_id uuid,
  p_provider_reference text,
  p_poll_url text,
  p_gateway_status text
)
returns public.payment_purchases
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.payment_purchases;
begin
  select * into v_purchase
  from public.payment_purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'PURCHASE_NOT_FOUND';
  end if;

  if v_purchase.provider_reference is not null
     and v_purchase.provider_reference <> p_provider_reference then
    raise exception 'PROVIDER_REFERENCE_MISMATCH';
  end if;

  update public.payment_purchases
  set provider_reference = coalesce(provider_reference, p_provider_reference),
      provider_poll_url = coalesce(provider_poll_url, p_poll_url),
      gateway_status = p_gateway_status,
      updated_at = now()
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.apply_verified_payment(
  p_purchase_id uuid,
  p_provider_reference text,
  p_gateway_status text,
  p_event_fingerprint text
)
returns public.semester_entitlements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase public.payment_purchases;
  v_entitlement public.semester_entitlements;
  v_starts_on date;
  v_ends_on date;
begin
  select * into v_purchase
  from public.payment_purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'PURCHASE_NOT_FOUND';
  end if;

  if v_purchase.provider_reference is null
     or v_purchase.provider_reference <> p_provider_reference then
    raise exception 'PROVIDER_REFERENCE_MISMATCH';
  end if;

  if v_purchase.status = 'paid' then
    select * into v_entitlement
    from public.semester_entitlements
    where purchase_id = v_purchase.id
    limit 1;
    if found then
      return v_entitlement;
    end if;
  end if;

  insert into public.payment_gateway_events (
    purchase_id,
    provider,
    event_fingerprint,
    gateway_status
  ) values (
    v_purchase.id,
    v_purchase.provider,
    p_event_fingerprint,
    p_gateway_status
  ) on conflict (event_fingerprint) do nothing;

  select starts_on, ends_on into v_starts_on, v_ends_on
  from public.academic_periods
  where id = v_purchase.academic_period_id;

  if v_starts_on is null or v_ends_on is null then
    raise exception 'ACADEMIC_PERIOD_DATES_REQUIRED';
  end if;

  update public.payment_purchases
  set status = 'paid',
      gateway_status = p_gateway_status,
      paid_at = coalesce(paid_at, now()),
      failure_class = null,
      updated_at = now()
  where id = v_purchase.id;

  insert into public.semester_entitlements (
    subscriber_profile_id,
    timetable_id,
    academic_period_id,
    plan_code,
    source,
    purchase_id,
    status,
    starts_on,
    ends_on
  ) values (
    v_purchase.subscriber_profile_id,
    v_purchase.timetable_id,
    v_purchase.academic_period_id,
    v_purchase.plan_code,
    'purchase',
    v_purchase.id,
    'active',
    v_starts_on,
    v_ends_on
  )
  on conflict (subscriber_profile_id, timetable_id, academic_period_id, plan_code)
  do update set
    source = 'purchase',
    purchase_id = excluded.purchase_id,
    status = 'active',
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    updated_at = now()
  returning * into v_entitlement;

  return v_entitlement;
end;
$$;

revoke all on function public.ensure_calendar_subscription_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.begin_payment_purchase(uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_payment_gateway_checkout(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_verified_payment(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.ensure_calendar_subscription_profile(uuid, uuid) to service_role;
grant execute on function public.begin_payment_purchase(uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid) to service_role;
grant execute on function public.record_payment_gateway_checkout(uuid, text, text, text) to service_role;
grant execute on function public.apply_verified_payment(uuid, text, text, text) to service_role;
