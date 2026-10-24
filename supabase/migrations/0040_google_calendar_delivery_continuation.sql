-- A bounded invocation may persist progress without completing the provider revision.
-- Keep the existing fenced lease/RPC and defer the same durable job, not a new subscription.
create or replace function public.finish_google_calendar_delivery(
  p_subscription_id uuid, p_lease_token uuid, p_revision bigint,
  p_outcome text, p_error_code text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_job public.google_calendar_delivery_jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('success', 'retry', 'reconnect', 'continue') then
    raise exception 'Invalid Google delivery outcome';
  end if;
  select * into v_job from public.google_calendar_delivery_jobs
    where subscription_id = p_subscription_id and lease_token = p_lease_token
      and claimed_revision = p_revision and lease_expires_at > clock_timestamp()
    for update;
  if not found then return false; end if;
  if v_job.lease_expires_at <= clock_timestamp() then return false; end if;

  update public.google_calendar_delivery_jobs set
    successful_revision = case when p_outcome = 'success' then greatest(successful_revision, p_revision) else successful_revision end,
    successful_generation = case when p_outcome = 'success' then greatest(successful_generation, claimed_generation) else successful_generation end,
    lease_token = null, lease_expires_at = null, claimed_revision = null, claimed_generation = null,
    attempt_count = case when p_outcome in ('success', 'continue') then 0 else attempt_count end,
    reconnect_required_at = case when p_outcome = 'reconnect' then clock_timestamp() else null end,
    available_at = clock_timestamp() + make_interval(secs => case
      when p_outcome = 'continue' then 15
      when p_outcome = 'retry' then least(3600, (15 * power(2, least(v_job.attempt_count - 1, 8)))::integer)
      else 0 end),
    last_error_code = case when p_outcome = 'success' then null else left(p_error_code, 120) end
  where subscription_id = p_subscription_id;
  return true;
end;
$$;

revoke all on function public.finish_google_calendar_delivery(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.finish_google_calendar_delivery(uuid, uuid, bigint, text, text) to service_role;
