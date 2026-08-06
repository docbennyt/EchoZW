-- Phase 2 pilot admin authorization.
-- Supabase Auth remains the identity provider. A user is a CalenderZW admin
-- only when auth.users.id has one active row in public.admin_users.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  disabled_at timestamptz,
  notes text
);

comment on table public.admin_users is
  'Pilot admin authorization table. Active rows grant CalenderZW administrator access after Supabase Auth validates identity.';
comment on column public.admin_users.user_id is
  'Supabase Auth user id. This is the authoritative admin identity.';
comment on column public.admin_users.active is
  'False disables admin access without deleting the Auth user.';

create index if not exists admin_users_active_idx
  on public.admin_users (user_id)
  where active;

create index if not exists admin_users_created_by_idx
  on public.admin_users (created_by)
  where created_by is not null;

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from anon;
revoke all on table public.admin_users from authenticated;

-- No anon/authenticated policies are created intentionally. The browser does
-- not need to enumerate or mutate admin records. Server code validates the
-- Supabase Auth session, then uses the service-role client for this lookup.
