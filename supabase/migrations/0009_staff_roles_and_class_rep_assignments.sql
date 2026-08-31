-- Role-scoped CalenderZW staff authorization.
-- Supabase Auth remains identity; these tables are application authorization.

create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('superadmin', 'class_rep')),
  active boolean not null default true,
  display_name text,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  disabled_at timestamptz,
  notes text
);

comment on table public.staff_users is
  'CalenderZW staff authorization. A Supabase Auth user is staff only when this server-side table grants active access.';
comment on column public.staff_users.role is
  'Application role. superadmin grants global staff management; class_rep must also have active timetable assignments.';

create index if not exists staff_users_user_id_idx
  on public.staff_users (user_id);

create index if not exists staff_users_active_role_idx
  on public.staff_users (role, user_id)
  where active;

create table if not exists public.class_rep_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.staff_users(id) on delete cascade,
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  notes text
);

comment on table public.class_rep_assignments is
  'Timetable-scoped authorization for CalenderZW class representatives.';

create index if not exists class_rep_assignments_staff_user_id_idx
  on public.class_rep_assignments (staff_user_id);

create index if not exists class_rep_assignments_timetable_id_idx
  on public.class_rep_assignments (timetable_id);

create unique index if not exists class_rep_assignments_one_active_idx
  on public.class_rep_assignments (staff_user_id, timetable_id)
  where active;

alter table public.staff_users enable row level security;
alter table public.class_rep_assignments enable row level security;

revoke all on table public.staff_users from anon, authenticated;
revoke all on table public.class_rep_assignments from anon, authenticated;

grant all on table public.staff_users to service_role;
grant all on table public.class_rep_assignments to service_role;

do $$
declare
  active_admin_count integer;
begin
  select count(*) into active_admin_count
  from public.admin_users
  where active;

  if active_admin_count = 1 then
    insert into public.staff_users (
      user_id,
      role,
      active,
      created_at,
      created_by,
      notes
    )
    select
      admin_users.user_id,
      'superadmin',
      true,
      now(),
      admin_users.created_by,
      'Bootstrapped from the single active legacy admin_users row.'
    from public.admin_users
    where admin_users.active
    on conflict (user_id) do nothing;
  end if;
end $$;
