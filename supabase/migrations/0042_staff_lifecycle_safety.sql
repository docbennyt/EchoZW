-- Staff lifecycle writes remain server-owned. No browser role may call this RPC.
create table public.staff_invitation_cooldowns (
  recipient_email text primary key check (recipient_email = lower(btrim(recipient_email))),
  next_allowed_at timestamptz not null
);
alter table public.staff_invitation_cooldowns enable row level security;
revoke all on public.staff_invitation_cooldowns from public, anon, authenticated;
grant select, insert, update on public.staff_invitation_cooldowns to service_role;

-- Fixed policy: at most 10 attempted email sends per actor in a 10-minute window.
create table public.staff_invitation_actor_budgets (
  actor_user_id uuid primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 10)
);
alter table public.staff_invitation_actor_budgets enable row level security;
revoke all on public.staff_invitation_actor_budgets from public, anon, authenticated;
grant select, insert, update on public.staff_invitation_actor_budgets to service_role;

create function public.czw_staff_lifecycle(
  p_actor_user_id uuid,
  p_operation text,
  p_input jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.staff_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_staff_id uuid := (p_input->>'staffUserId')::uuid;
  v_user_id uuid := (p_input->>'userId')::uuid;
  v_assignment_id uuid := (p_input->>'assignmentId')::uuid;
  v_timetable_id uuid := (p_input->>'timetableId')::uuid;
  v_lock_user uuid;
  v_founder boolean := false;
  v_manager boolean := false;
  v_email text := lower(btrim(p_input->>'email'));
  v_role text;
  v_previous_role text;
  v_enrollment text := p_input->>'enrollment';
  v_invitation_sent boolean := coalesce((p_input->>'invitationSent')::boolean, false);
  v_active boolean := (p_input->>'active')::boolean;
  v_error text;
  v_action text;
  v_entity_type text := 'staff_user';
  v_entity_id uuid;
  v_metadata jsonb := '{}'::jsonb;
  v_result jsonb := '{}'::jsonb;
  v_existing_assignment uuid;
  v_next_allowed_at timestamptz;
  v_budget public.staff_invitation_actor_budgets%rowtype;
  v_now timestamptz;
begin
  if p_actor_user_id is null or p_operation is null or p_operation not in (
    'enroll_class_rep', 'enroll_admin', 'assign', 'revoke', 'set_active',
    'set_role', 'reserve_invite', 'record_resend'
  ) or jsonb_typeof(p_input) is distinct from 'object' then
    return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
  end if;

  if p_operation = 'revoke' then
    select staff_user_id into v_staff_id from public.class_rep_assignments
      where id = v_assignment_id;
  end if;
  if v_staff_id is not null then
    select user_id into v_user_id from public.staff_users where id = v_staff_id;
  end if;

  -- Order actor/target locks consistently, including enrollment before a staff row exists.
  for v_lock_user in
    select distinct id from unnest(array[p_actor_user_id, v_user_id]) as ids(id)
      where id is not null order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('czw-staff:' || v_lock_user::text, 0));
    perform 1 from public.staff_users where user_id = v_lock_user for update;
  end loop;
  select * into v_actor from public.staff_users where user_id = p_actor_user_id;
  if found then
    v_founder := v_actor.active and v_actor.role = 'superadmin' and v_actor.is_founder;
    v_manager := v_actor.active and (v_founder or v_actor.role = 'admin');
  else
    -- Match requireStaffUser: legacy access is operational only, never founder authority.
    perform 1 from public.admin_users where user_id = p_actor_user_id and active for share;
    v_manager := found;
  end if;
  select * into v_staff from public.staff_users where user_id = v_user_id;
  v_previous_role := v_staff.role;
  v_staff_id := coalesce(v_staff.id, v_staff_id);
  v_now := clock_timestamp();

  if not v_manager then
    v_error := 'STAFF_MANAGER_REQUIRED';
  elsif p_operation in ('enroll_admin', 'set_role') and not v_founder then
    v_error := 'FOUNDER_REQUIRED';
  elsif p_operation = 'reserve_invite' and p_input->>'role' = 'admin' and not v_founder then
    v_error := 'FOUNDER_REQUIRED';
  elsif p_operation in ('set_active', 'record_resend', 'reserve_invite')
      and v_staff.role = 'admin' and not v_founder then
    v_error := 'FOUNDER_REQUIRED';
  elsif v_staff.is_founder then
    v_error := 'FOUNDER_PROTECTED';
  elsif p_operation not in ('enroll_class_rep', 'enroll_admin', 'reserve_invite')
      and v_staff.id is null then
    v_error := 'NOT_FOUND';
  elsif p_operation = 'reserve_invite' and p_input ? 'staffUserId' and v_staff.id is null then
    v_error := 'NOT_FOUND';
  elsif p_operation in ('assign', 'revoke') and v_staff.role <> 'class_rep' then
    v_error := 'NOT_FOUND';
  elsif (p_operation = 'enroll_class_rep'
      or (p_operation = 'reserve_invite' and p_input->>'role' = 'class_rep'))
      and v_staff.id is not null and v_staff.role <> 'class_rep' then
    v_error := 'ROLE_CHANGE_REQUIRED';
  elsif p_operation = 'set_role' and v_staff.user_id = p_actor_user_id then
    v_error := 'SELF_PRIVILEGE_CHANGE_FORBIDDEN';
  end if;

  if v_error is not null then
    -- Return expected denials so their rejection audits commit without changing access.
    if v_error in ('FOUNDER_REQUIRED', 'FOUNDER_PROTECTED', 'ROLE_CHANGE_REQUIRED') then
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
      values (p_actor_user_id,
        case when v_error = 'FOUNDER_PROTECTED' then 'staff.founder_change_rejected'
          when v_error = 'ROLE_CHANGE_REQUIRED' then 'staff.role_change_rejected'
          else 'staff.privilege_escalation_rejected' end,
        'staff_user', v_staff.id,
        jsonb_build_object('reason', p_operation, 'actorRole', coalesce(v_actor.role, 'admin')));
    end if;
    return jsonb_build_object('error', jsonb_build_object('code', v_error));
  end if;

  if p_operation in ('assign', 'enroll_class_rep')
      or (p_operation = 'reserve_invite' and p_input ? 'timetableId') then
    perform 1 from public.timetables where id = v_timetable_id for key share;
    if not found then
      return jsonb_build_object('error', jsonb_build_object('code', 'TIMETABLE_NOT_FOUND'));
    end if;
  end if;

  if p_operation = 'reserve_invite' then
    if v_email is null or position('@' in v_email) < 2
        or p_input->>'role' is null or p_input->>'role' not in ('admin', 'class_rep') then
      return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
    end if;
    if p_input ? 'staffUserId' and
        (v_staff.user_id is distinct from (p_input->>'userId')::uuid
          or lower(btrim(v_staff.email)) is distinct from v_email) then
      return jsonb_build_object('error', jsonb_build_object('code', 'AUTH_IDENTITY_MISMATCH'));
    end if;
    -- Actor locks are already held. Lock even an absent recipient before checking
    -- both limits, so denial never consumes the other budget under concurrency.
    perform pg_advisory_xact_lock(hashtextextended('czw-staff-invite:' || v_email, 0));
    v_now := clock_timestamp();
    select next_allowed_at into v_next_allowed_at from public.staff_invitation_cooldowns
      where recipient_email = v_email for update;
    if v_next_allowed_at > v_now then
      return jsonb_build_object('error', jsonb_build_object('code', 'INVITE_RATE_LIMITED'));
    end if;
    select * into v_budget from public.staff_invitation_actor_budgets
      where actor_user_id = p_actor_user_id for update;
    if v_budget.window_started_at > v_now - interval '10 minutes' and v_budget.attempt_count >= 10 then
      return jsonb_build_object('error', jsonb_build_object('code', 'INVITE_ACTOR_RATE_LIMITED'));
    end if;
    insert into public.staff_invitation_cooldowns(recipient_email, next_allowed_at)
      values (v_email, v_now + interval '60 seconds')
      on conflict (recipient_email) do update set next_allowed_at = excluded.next_allowed_at;
    insert into public.staff_invitation_actor_budgets(actor_user_id, window_started_at, attempt_count)
      values (p_actor_user_id, v_now, 1)
      on conflict (actor_user_id) do update set
        window_started_at = case when v_budget.window_started_at > v_now - interval '10 minutes'
          then v_budget.window_started_at else v_now end,
        attempt_count = case when v_budget.window_started_at > v_now - interval '10 minutes'
          then v_budget.attempt_count + 1 else 1 end;
    return jsonb_build_object('reserved', true);
  end if;

  if p_operation in ('enroll_class_rep', 'enroll_admin', 'record_resend') then
    if v_enrollment is null or v_enrollment not in (
      'invited_new_user', 'invite_resent_pending_user', 'access_granted_existing_user'
    ) or v_invitation_sent <> (v_enrollment <> 'access_granted_existing_user') then
      return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
    end if;
  end if;

  if p_operation in ('enroll_class_rep', 'enroll_admin') then
    if v_user_id is null or v_email is null or position('@' in v_email) < 2
        or nullif(btrim(p_input->>'displayName'), '') is null then
      return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
    end if;
    v_role := case when p_operation = 'enroll_admin' then 'admin' else 'class_rep' end;
    v_action := v_role || case v_enrollment
      when 'invited_new_user' then '.invited'
      when 'invite_resent_pending_user' then '.invite_resent'
      else '.access_granted_existing_user' end;
    if v_staff.id is null then
      insert into public.staff_users(user_id, email, display_name, role, is_founder,
        active, invited_at, last_invited_at, disabled_at, created_by, updated_at)
      values (v_user_id, v_email, btrim(p_input->>'displayName'), v_role, false,
        true, case when v_invitation_sent then v_now end,
        case when v_invitation_sent then v_now end, null, p_actor_user_id, v_now)
      returning * into v_staff;
    else
      update public.staff_users set email = v_email, display_name = btrim(p_input->>'displayName'),
        role = v_role, active = true, disabled_at = null, updated_at = v_now,
        last_invited_at = case when v_invitation_sent then v_now else last_invited_at end
        where id = v_staff.id returning * into v_staff;
    end if;
    v_staff_id := v_staff.id;
    v_metadata := jsonb_build_object('enrollment', v_enrollment,
      'existingAuthUser', coalesce((p_input->>'existingAuthUser')::boolean, false),
      'invitationSent', v_invitation_sent, 'previousRole', v_previous_role);
    v_result := jsonb_build_object('staffUserId', v_staff_id, 'enrollment', v_enrollment);
  end if;

  if p_operation in ('assign', 'enroll_class_rep') then
    -- Retain a same-target assignment ID and repair any pre-existing extra assignments.
    select id into v_existing_assignment from public.class_rep_assignments
      where staff_user_id = v_staff_id and timetable_id = v_timetable_id and active;
    update public.class_rep_assignments set active = false, revoked_at = v_now
      where staff_user_id = v_staff_id and active and id is distinct from v_existing_assignment;
    if v_existing_assignment is null then
      insert into public.class_rep_assignments(staff_user_id, timetable_id, active, created_by)
        values (v_staff_id, v_timetable_id, true, p_actor_user_id)
        returning id into v_existing_assignment;
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
        values (p_actor_user_id, coalesce(v_action, 'class_rep.assigned'),
          'class_rep_assignment', v_existing_assignment,
          jsonb_build_object('staffUserId', v_staff_id, 'timetableId', v_timetable_id,
            'actorRole', coalesce(v_actor.role, 'admin')));
    elsif found then
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
        values (p_actor_user_id, 'class_rep.assignments_reconciled', 'staff_user',
          v_staff_id, jsonb_build_object('assignmentId', v_existing_assignment));
    end if;
    if p_operation = 'assign' then
      return jsonb_build_object('id', v_existing_assignment);
    end if;
    v_metadata := v_metadata || jsonb_build_object('assignmentId', v_existing_assignment);
    v_result := v_result || jsonb_build_object('assignmentId', v_existing_assignment);
  elsif (p_operation = 'enroll_admin' and v_previous_role = 'class_rep')
      or (p_operation = 'set_role' and p_input->>'role' = 'admin' and v_staff.role <> 'admin') then
    update public.class_rep_assignments set active = false, revoked_at = v_now
      where staff_user_id = v_staff_id and active;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id)
      values (p_actor_user_id, 'class_rep.assignments_revoked_for_role_change', 'staff_user', v_staff_id);
  end if;

  if p_operation = 'revoke' then
    update public.class_rep_assignments set active = false, revoked_at = v_now
      where id = v_assignment_id and staff_user_id = v_staff_id and active;
    if not found then return '{}'::jsonb; end if;
    v_action := 'class_rep.assignment_revoked';
    v_entity_type := 'class_rep_assignment';
    v_entity_id := v_assignment_id;
    v_metadata := jsonb_build_object('actorRole', coalesce(v_actor.role, 'admin'));
  elsif p_operation = 'set_active' then
    if v_active is null then
      return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
    end if;
    if v_staff.active = v_active then return '{}'::jsonb; end if;
    update public.staff_users set active = v_active,
      disabled_at = case when v_active then null else v_now end, updated_at = v_now
      where id = v_staff_id;
    v_action := v_staff.role || case when v_active then '.reactivated' else '.deactivated' end;
  elsif p_operation = 'set_role' then
    v_role := p_input->>'role';
    if v_role is null or v_role not in ('admin', 'class_rep') then
      return jsonb_build_object('error', jsonb_build_object('code', 'VALIDATION_FAILED'));
    end if;
    if v_staff.role = v_role then return '{}'::jsonb; end if;
    update public.staff_users set role = v_role, active = (v_role = 'admin'),
      disabled_at = case when v_role = 'admin' then null else v_now end, updated_at = v_now
      where id = v_staff_id;
    v_action := case when v_role = 'admin' then 'admin.role_granted' else 'admin.role_revoked' end;
    v_metadata := jsonb_build_object('previousRole', v_previous_role, 'newRole', v_role,
      'classRepRequiresAssignmentAfterDemotion', v_role = 'class_rep');
  elsif p_operation = 'record_resend' then
    if v_staff.user_id is distinct from (p_input->>'userId')::uuid
        or lower(btrim(v_staff.email)) is distinct from v_email then
      return jsonb_build_object('error', jsonb_build_object('code', 'AUTH_IDENTITY_MISMATCH'));
    end if;
    if v_invitation_sent then
      update public.staff_users set last_invited_at = v_now where id = v_staff_id;
    end if;
    v_action := v_staff.role || case when v_invitation_sent then '.invite_resent'
      else '.access_confirmed_existing_user' end;
    v_metadata := jsonb_build_object('enrollment', v_enrollment,
      'existingAuthUser', true, 'invitationSent', v_invitation_sent);
    v_result := jsonb_build_object('enrollment', v_enrollment);
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_user_id, v_action, v_entity_type, coalesce(v_entity_id, v_staff_id), v_metadata);
  return v_result;
end;
$$;

revoke all on function public.czw_staff_lifecycle(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.czw_staff_lifecycle(uuid, text, jsonb) to service_role;
