create table if not exists google_calendar_oauth_states (
  state_hash text primary key,
  subscription_id uuid not null references calendar_subscriptions(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_calendar_oauth_states_subscription_idx
  on google_calendar_oauth_states(subscription_id);

create index if not exists google_calendar_oauth_states_expiry_idx
  on google_calendar_oauth_states(expires_at);

create table if not exists google_calendar_credentials (
  subscription_id uuid primary key references calendar_subscriptions(id) on delete cascade,
  encrypted_refresh_token text not null,
  granted_scope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table google_calendar_oauth_states enable row level security;
alter table google_calendar_credentials enable row level security;

revoke all on table google_calendar_oauth_states from anon, authenticated;
revoke all on table google_calendar_credentials from anon, authenticated;
grant all on table google_calendar_oauth_states to service_role;
grant all on table google_calendar_credentials to service_role;

comment on table google_calendar_credentials is
  'Server-only encrypted Google OAuth refresh tokens for CalenderZW-created secondary calendars.';

comment on column google_calendar_credentials.encrypted_refresh_token is
  'AES-256-GCM ciphertext bundle. TOKEN_ENCRYPTION_KEY remains server-side and is never stored in Postgres.';
