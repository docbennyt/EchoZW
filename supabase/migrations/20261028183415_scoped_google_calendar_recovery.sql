-- Scope request-driven recovery to the already-authorized published timetables.
-- The original one-argument bounded sweep remains the scheduled retry path.
-- No provider writes, backfill, new tables, lease resets or generation bumps.
create function public.recover_google_calendar_delivery(p_limit integer, p_timetable_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if p_timetable_ids is null then
    raise exception 'GOOGLE_DELIVERY_SCOPE_REQUIRED';
  end if;
  insert into public.google_calendar_delivery_jobs as j(subscription_id, desired_revision)
  select s.id, r.revision
  from public.calendar_subscriptions s
  join public.google_calendar_delivery_revisions r on r.timetable_id = s.timetable_id
  left join public.google_calendar_delivery_jobs old on old.subscription_id = s.id
  where s.timetable_id = any(p_timetable_ids)
    and s.provider = 'google_api'
    and (s.status in ('active', 'failed') or (s.status = 'pending' and exists (
      select 1 from public.google_calendar_credentials credential where credential.subscription_id = s.id)))
    and s.revoked_at is null
    and (old.subscription_id is null or old.desired_revision < r.revision
      or (old.reconnect_required_at is not null and exists (
        select 1 from public.google_calendar_credentials c where c.subscription_id = s.id
          and c.updated_at > coalesce(old.credential_updated_at, '-infinity'::timestamptz))))
  order by old.desired_revision nulls first, s.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  on conflict (subscription_id) do update set
    desired_revision = greatest(j.desired_revision, excluded.desired_revision),
    reconnect_required_at = case when exists (
      select 1 from public.google_calendar_credentials c
      where c.subscription_id = j.subscription_id
        and c.updated_at > coalesce(j.credential_updated_at, '-infinity'::timestamptz)
    ) then null else j.reconnect_required_at end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


revoke all on function public.recover_google_calendar_delivery(integer, uuid[]) from public, anon, authenticated;
grant execute on function public.recover_google_calendar_delivery(integer, uuid[]) to service_role;
