-- Independent per-subscription examination reminders. No schedule or credential
-- rows are replaced; existing subscriptions remain opted out until configured.
alter table public.calendar_subscriptions
  add column exam_reminder_offsets_minutes integer[] not null default '{}',
  add constraint calendar_subscription_exam_reminders_valid check (
    cardinality(exam_reminder_offsets_minutes) <= 5
    and array_position(exam_reminder_offsets_minutes, null) is null
    and 0 < all(exam_reminder_offsets_minutes)
    and 40320 >= all(exam_reminder_offsets_minutes)
  );

-- A reminder-policy edit is durable delivery intent, without changing the
-- timetable revision or bypassing existing leases/reconnect fences.
create function public.observe_exam_reminder_policy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_google_calendar_subscription(new.id);
  return new;
end;
$$;
revoke all on function public.observe_exam_reminder_policy_change() from public, anon, authenticated;
create trigger google_calendar_exam_reminder_policy
  after update of exam_reminder_offsets_minutes on public.calendar_subscriptions
  for each row
  when (old.exam_reminder_offsets_minutes is distinct from new.exam_reminder_offsets_minutes)
  execute function public.observe_exam_reminder_policy_change();
