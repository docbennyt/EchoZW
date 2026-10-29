alter table public.google_calendar_credentials
  add column if not exists legacy_encrypted_refresh_token_backup text,
  add column if not exists encryption_migration_id uuid,
  add column if not exists encryption_migrated_at timestamptz;

comment on column public.google_calendar_credentials.legacy_encrypted_refresh_token_backup is
  'Recoverable authenticated ciphertext retained during the legacy-key migration. Never exposed to browser roles or logs.';

create table if not exists public.google_calendar_credential_migration_audit (
  migration_id uuid primary key,
  subscription_id uuid not null references public.calendar_subscriptions(id) on delete restrict,
  status text not null check (status in ('swapped', 'verified', 'failed_reverted')),
  started_at timestamptz not null default now(),
  verified_at timestamptz,
  reverted_at timestamptz
);

alter table public.google_calendar_credential_migration_audit enable row level security;
revoke all on table public.google_calendar_credential_migration_audit from public, anon, authenticated;
grant select, insert, update on table public.google_calendar_credential_migration_audit to service_role;

create or replace function public.begin_google_credential_key_migration(
  p_subscription_id uuid,
  p_expected_ciphertext text,
  p_new_ciphertext text,
  p_migration_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.google_calendar_credentials
  set legacy_encrypted_refresh_token_backup = encrypted_refresh_token,
      encrypted_refresh_token = p_new_ciphertext,
      encryption_migration_id = p_migration_id,
      encryption_migrated_at = now(),
      updated_at = now()
  where subscription_id = p_subscription_id
    and encrypted_refresh_token = p_expected_ciphertext
    and legacy_encrypted_refresh_token_backup is null;
  get diagnostics changed = row_count;
  if changed <> 1 then
    return false;
  end if;
  insert into public.google_calendar_credential_migration_audit(
    migration_id, subscription_id, status
  ) values (p_migration_id, p_subscription_id, 'swapped');
  return true;
end;
$$;

create or replace function public.verify_google_credential_key_migration(
  p_subscription_id uuid,
  p_expected_ciphertext text,
  p_migration_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.google_calendar_credential_migration_audit audit
  set status = 'verified', verified_at = now()
  from public.google_calendar_credentials credential
  where audit.migration_id = p_migration_id
    and audit.subscription_id = p_subscription_id
    and audit.status = 'swapped'
    and credential.subscription_id = p_subscription_id
    and credential.encryption_migration_id = p_migration_id
    and credential.encrypted_refresh_token = p_expected_ciphertext;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.revert_google_credential_key_migration(
  p_subscription_id uuid,
  p_expected_ciphertext text,
  p_migration_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.google_calendar_credentials
  set encrypted_refresh_token = legacy_encrypted_refresh_token_backup,
      legacy_encrypted_refresh_token_backup = null,
      encryption_migration_id = null,
      encryption_migrated_at = null,
      updated_at = now()
  where subscription_id = p_subscription_id
    and encryption_migration_id = p_migration_id
    and encrypted_refresh_token = p_expected_ciphertext
    and legacy_encrypted_refresh_token_backup is not null;
  get diagnostics changed = row_count;
  if changed <> 1 then
    return false;
  end if;
  update public.google_calendar_credential_migration_audit
  set status = 'failed_reverted', reverted_at = now()
  where migration_id = p_migration_id and status = 'swapped';
  return true;
end;
$$;

revoke all on function public.begin_google_credential_key_migration(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.verify_google_credential_key_migration(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.revert_google_credential_key_migration(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.begin_google_credential_key_migration(uuid, text, text, uuid) to service_role;
grant execute on function public.verify_google_credential_key_migration(uuid, text, uuid) to service_role;
grant execute on function public.revert_google_credential_key_migration(uuid, text, uuid) to service_role;
