-- Preserve the owner verified under the subscription lock for callback checks.
-- Existing unconsumed states stay NULL and fail closed in the isolated canary;
-- users can restart OAuth. Do not infer historical ownership by backfilling.
alter table public.google_calendar_oauth_states add column anonymous_session_id uuid;

create or replace function public.start_google_calendar_connection(
  p_subscription_id uuid, p_owner uuid, p_state_hash text, p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare s public.calendar_subscriptions%rowtype;
begin
  select * into s from public.calendar_subscriptions where id = p_subscription_id for update;
  if not found or s.provider <> 'google_api' or s.revoked_at is not null
    or p_owner is null or s.anonymous_session_id is distinct from p_owner then return false; end if;
  if s.status = 'disconnected' then
    update public.calendar_subscriptions set status = 'pending', last_error_code = null,
      updated_at = clock_timestamp() where id = s.id;
  end if;
  insert into public.google_calendar_oauth_states(state_hash, subscription_id, expires_at, connection_generation, anonymous_session_id)
    values (p_state_hash, s.id, p_expires_at, s.google_connection_generation, s.anonymous_session_id);
  return true;
end;
$$;
revoke all on function public.start_google_calendar_connection(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.start_google_calendar_connection(uuid, uuid, text, timestamptz) to service_role;
