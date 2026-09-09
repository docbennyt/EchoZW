-- DR-46: a timetable-specific alert opt-out must immediately remove unfinished
-- delivery work for that subscription. This prevents a revoked/expired target
-- from leaving an outbox item permanently pending.

create or replace function public.terminalize_inactive_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update public.push_notification_deliveries
    set
      status = 'terminal',
      terminal_at = coalesce(terminal_at, now()),
      locked_at = null,
      last_error_code = case
        when new.status = 'revoked' then 'PUSH_SUBSCRIPTION_REVOKED'
        else 'PUSH_SUBSCRIPTION_EXPIRED'
      end,
      updated_at = now()
    where subscription_id = new.id
      and status in ('pending', 'processing');
  end if;
  return new;
end;
$$;

revoke all on function public.terminalize_inactive_push_deliveries()
  from public, anon, authenticated;

drop trigger if exists push_subscriptions_terminalize_deliveries
  on public.push_subscriptions;
create trigger push_subscriptions_terminalize_deliveries
after update of status on public.push_subscriptions
for each row execute function public.terminalize_inactive_push_deliveries();
