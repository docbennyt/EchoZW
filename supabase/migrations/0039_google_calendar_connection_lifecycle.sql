-- Fence OAuth callbacks across disconnect/reconnect without changing token crypto.
alter table public.calendar_subscriptions add column google_connection_generation bigint not null default 0;
alter table public.google_calendar_oauth_states add column connection_generation bigint not null default 0;

create function public.invalidate_google_calendar_connection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.provider = 'google_api' and (new.status = 'disconnected' or new.revoked_at is not null) then
    new.google_connection_generation := old.google_connection_generation + 1;
    delete from public.google_calendar_oauth_states where subscription_id = new.id;
    delete from public.google_calendar_credentials where subscription_id = new.id;
  end if;
  return new;
end;
$$;
create trigger google_calendar_connection_invalidation
before update of status, revoked_at on public.calendar_subscriptions
for each row execute function public.invalidate_google_calendar_connection();

create function public.start_google_calendar_connection(
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
  insert into public.google_calendar_oauth_states(state_hash, subscription_id, expires_at, connection_generation)
    values (p_state_hash, s.id, p_expires_at, s.google_connection_generation);
  return true;
end;
$$;

create function public.complete_google_calendar_connection(
  p_subscription_id uuid, p_generation bigint, p_encrypted_refresh_token text, p_granted_scope text
) returns boolean language plpgsql security definer set search_path = public as $$
declare s public.calendar_subscriptions%rowtype;
begin
  select * into s from public.calendar_subscriptions where id = p_subscription_id for update;
  if not found or s.provider <> 'google_api' or s.revoked_at is not null
    or s.status = 'disconnected' or p_generation is null
    or s.google_connection_generation <> p_generation then return false; end if;
  insert into public.google_calendar_credentials(subscription_id, encrypted_refresh_token, granted_scope, updated_at)
    values (s.id, p_encrypted_refresh_token, p_granted_scope, clock_timestamp())
    on conflict (subscription_id) do update set encrypted_refresh_token = excluded.encrypted_refresh_token,
      granted_scope = excluded.granted_scope, updated_at = excluded.updated_at;
  update public.calendar_subscriptions set status = 'pending', last_error_code = null,
    updated_at = clock_timestamp() where id = s.id;
  if not public.enqueue_google_calendar_subscription(s.id) then
    raise exception 'Google Calendar delivery intent could not be persisted';
  end if;
  return true;
end;
$$;

create function public.disconnect_google_calendar_connection(
  p_subscription_id uuid, p_owner uuid, p_delete_calendar boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.calendar_subscriptions%rowtype; v_ciphertext text; v_generation bigint;
begin
  if p_delete_calendar then return null; end if;
  select * into s from public.calendar_subscriptions where id = p_subscription_id for update;
  if not found or s.provider <> 'google_api' or p_owner is null
    or s.anonymous_session_id is distinct from p_owner then return null; end if;
  select encrypted_refresh_token into v_ciphertext from public.google_calendar_credentials where subscription_id = s.id;
  update public.calendar_subscriptions set status = 'disconnected', last_error_code = null,
    updated_at = clock_timestamp() where id = s.id
    returning google_connection_generation into v_generation;
  return jsonb_build_object('encrypted_refresh_token', v_ciphertext, 'external_calendar_id', s.external_calendar_id,
    'connection_generation', v_generation);
end;
$$;

revoke all on function public.invalidate_google_calendar_connection() from public, anon, authenticated;
revoke all on function public.start_google_calendar_connection(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_connection(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.disconnect_google_calendar_connection(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.start_google_calendar_connection(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.complete_google_calendar_connection(uuid, bigint, text, text) to service_role;
grant execute on function public.disconnect_google_calendar_connection(uuid, uuid, boolean) to service_role;

-- Mapping writes share the lifecycle lock; a disconnected generation cannot
-- recreate a mapping after provider I/O returns.
create function public.write_google_calendar_sync_record(
  p_subscription_id uuid, p_generation bigint, p_internal_event_id text, p_record jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare s public.calendar_subscriptions%rowtype;
begin
  select * into s from public.calendar_subscriptions where id = p_subscription_id for update;
  if not found or s.provider <> 'google_api' or s.revoked_at is not null
    or s.status = 'disconnected' or p_generation is null
    or s.google_connection_generation <> p_generation then return false; end if;
  if p_record is null then
    delete from public.calendar_event_sync_records where subscription_id = s.id
      and provider = 'google_api' and internal_event_id = p_internal_event_id;
  else
    insert into public.calendar_event_sync_records(subscription_id, provider, internal_event_id,
      timetable_version_id, external_calendar_id, external_event_id, content_hash,
      sync_status, last_synced_at, last_error_code, updated_at)
    values (s.id, 'google_api', p_internal_event_id, (p_record->>'timetable_version_id')::uuid,
      p_record->>'external_calendar_id', p_record->>'external_event_id', p_record->>'content_hash',
      p_record->>'sync_status', case when p_record->>'sync_status' = 'active' then clock_timestamp() else null end,
      p_record->>'last_error_code', clock_timestamp())
    on conflict (subscription_id, provider, internal_event_id) do update set
      timetable_version_id = excluded.timetable_version_id, external_calendar_id = excluded.external_calendar_id,
      external_event_id = excluded.external_event_id, content_hash = excluded.content_hash,
      sync_status = excluded.sync_status, last_synced_at = excluded.last_synced_at,
      last_error_code = excluded.last_error_code, updated_at = excluded.updated_at;
  end if;
  return true;
end;
$$;
revoke all on function public.write_google_calendar_sync_record(uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_google_calendar_sync_record(uuid, bigint, text, jsonb) to service_role;
