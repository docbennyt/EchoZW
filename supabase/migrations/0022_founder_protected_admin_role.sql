-- DR-54: founder-protected operational Admin role.
-- Supabase Auth remains identity; staff_users remains server-owned authorization.
-- The protected founder is represented by a durable database invariant, never frontend copy.

alter table public.staff_users
  add column if not exists is_founder boolean not null default false;

alter table public.staff_users
  drop constraint if exists staff_users_role_check;

alter table public.staff_users
  add constraint staff_users_role_check
  check (role in ('superadmin', 'admin', 'class_rep'));

-- Resolve the existing root principal conservatively. A single current superadmin is
-- unambiguous. If staff_users has no superadmin, the single active legacy admin may be
-- used as the explicit continuity anchor. Anything ambiguous fails the migration.
do $$
declare
  v_superadmin_count integer;
  v_founder_count integer;
  v_staff_count integer;
  v_legacy_admin_count integer;
  v_legacy_user_id uuid;
begin
  select count(*) into v_founder_count
  from public.staff_users
  where is_founder;

  if v_founder_count > 1 then
    raise exception 'CZWFOUNDER_AMBIGUOUS: multiple founder markers exist';
  end if;

  select count(*) into v_superadmin_count
  from public.staff_users
  where role = 'superadmin';

  if v_founder_count = 0 then
    if v_superadmin_count = 1 then
      update public.staff_users
      set is_founder = true,
          active = true,
          disabled_at = null,
          updated_at = now()
      where role = 'superadmin';
    elsif v_superadmin_count > 1 then
      raise exception 'CZWFOUNDER_AMBIGUOUS: multiple superadmins require explicit operator resolution';
    else
      select count(*), min(user_id)
      into v_legacy_admin_count, v_legacy_user_id
      from public.admin_users
      where active;

      if v_legacy_admin_count = 1 then
        insert into public.staff_users (
          user_id,
          role,
          active,
          is_founder,
          created_at,
          created_by,
          notes
        )
        select
          admin_users.user_id,
          'superadmin',
          true,
          true,
          now(),
          admin_users.created_by,
          'DR-54 founder continuity from the single active legacy admin_users row.'
        from public.admin_users
        where admin_users.user_id = v_legacy_user_id
        on conflict (user_id) do update
        set role = 'superadmin',
            active = true,
            is_founder = true,
            disabled_at = null,
            updated_at = now();
      elsif v_legacy_admin_count > 1 then
        raise exception 'CZWFOUNDER_AMBIGUOUS: multiple active legacy admins require explicit operator resolution';
      else
        select count(*) into v_staff_count from public.staff_users;
        if v_staff_count > 0 then
          raise exception 'CZWFOUNDER_MISSING: staff authorization exists without an unambiguous founder';
        end if;
        -- A genuinely empty installation is allowed to migrate. Its first founder must
        -- be explicitly bootstrapped server-side with role=superadmin,is_founder=true.
      end if;
    end if;
  end if;
end $$;

-- In this product model superadmin is the protected founder/root role. Operational
-- administrators use role=admin; this prevents an unprotected second superadmin.
alter table public.staff_users
  drop constraint if exists staff_users_founder_role_check;
alter table public.staff_users
  add constraint staff_users_founder_role_check
  check ((role = 'superadmin') = is_founder);

alter table public.staff_users
  drop constraint if exists staff_users_founder_active_check;
alter table public.staff_users
  add constraint staff_users_founder_active_check
  check (not is_founder or active);

create unique index if not exists staff_users_one_founder_idx
  on public.staff_users (is_founder)
  where is_founder;

create or replace function public.guard_czw_founder_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_founder then
      raise exception using errcode = '42501', message = 'FOUNDER_PROTECTED';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'superadmin' or new.is_founder then
      if not (new.role = 'superadmin' and new.is_founder and new.active) then
        raise exception using errcode = '42501', message = 'FOUNDER_INVARIANT_REQUIRED';
      end if;
      if exists (select 1 from public.staff_users where is_founder) then
        raise exception using errcode = '42501', message = 'FOUNDER_ALREADY_EXISTS';
      end if;
    end if;
    return new;
  end if;

  if old.is_founder then
    if new.user_id is distinct from old.user_id
      or new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.is_founder is distinct from old.is_founder then
      raise exception using errcode = '42501', message = 'FOUNDER_PROTECTED';
    end if;
    return new;
  end if;

  -- Founder transfer/promotion is deliberately not a normal staff mutation in v1.
  if new.role = 'superadmin' or new.is_founder then
    raise exception using errcode = '42501', message = 'FOUNDER_GRANT_FORBIDDEN';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_czw_founder_authority() from public;
grant execute on function public.guard_czw_founder_authority() to service_role;

drop trigger if exists staff_users_founder_authority_guard on public.staff_users;
create trigger staff_users_founder_authority_guard
before insert or update or delete on public.staff_users
for each row execute function public.guard_czw_founder_authority();

-- Admins may create timetable corrections/exceptions through the same guarded server
-- APIs as the founder. Expand only the audit provenance role constraints.
alter table public.timetable_correction_directives
  drop constraint if exists timetable_correction_directives_creator_role_check;
alter table public.timetable_correction_directives
  add constraint timetable_correction_directives_creator_role_check
  check (creator_role in ('superadmin', 'admin', 'class_rep'));

alter table public.timetable_session_exceptions
  drop constraint if exists timetable_session_exceptions_creator_role_check;
alter table public.timetable_session_exceptions
  add constraint timetable_session_exceptions_creator_role_check
  check (creator_role is null or creator_role in ('superadmin', 'admin', 'class_rep')) not valid;

comment on column public.staff_users.is_founder is
  'Protected CalenderZW root authority. Exactly one existing founder is preserved; normal staff APIs cannot transfer or remove it.';
comment on column public.staff_users.role is
  'Application role: superadmin is the protected founder/root, admin is global operations without founder authority, class_rep is timetable-scoped.';
