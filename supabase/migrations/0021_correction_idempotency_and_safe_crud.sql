-- DR-53: correction mutation idempotency, exact-active dedupe, and audit-preserving CRUD.
-- Existing source/published timetable evidence stays immutable; this migration hardens only
-- the correction/exception overlay layer used by authorized staff.

create extension if not exists pgcrypto;

alter table public.timetable_correction_directives
  add column if not exists mutation_key uuid,
  add column if not exists semantic_fingerprint text,
  add column if not exists revision integer not null default 1,
  add column if not exists supersedes_id uuid references public.timetable_correction_directives(id) on delete set null,
  add column if not exists replaced_by_id uuid references public.timetable_correction_directives(id) on delete set null;

alter table public.timetable_session_exceptions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists mutation_key uuid,
  add column if not exists semantic_fingerprint text,
  add column if not exists revision integer not null default 1,
  add column if not exists supersedes_id uuid references public.timetable_session_exceptions(id) on delete set null,
  add column if not exists replaced_by_id uuid references public.timetable_session_exceptions(id) on delete set null,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

create unique index if not exists timetable_correction_mutation_key_unique_idx
  on public.timetable_correction_directives (timetable_id, creator_staff_user_id, mutation_key)
  where mutation_key is not null;

create unique index if not exists timetable_exception_mutation_key_unique_idx
  on public.timetable_session_exceptions (timetable_id, creator_staff_user_id, mutation_key)
  where mutation_key is not null;

create index if not exists timetable_correction_semantic_fingerprint_idx
  on public.timetable_correction_directives (timetable_id, semantic_fingerprint, active);

create index if not exists timetable_exception_semantic_fingerprint_idx
  on public.timetable_session_exceptions (timetable_id, semantic_fingerprint, active);

create or replace function public.czw_normalize_semantic_text(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.czw_normalize_semantic_code(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.czw_normalize_semantic_time(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then ''
    else to_char((nullif(trim(p_value), ''))::time, 'HH24:MI:SS')
  end;
$$;

create or replace function public.czw_normalize_semantic_timestamp(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then ''
    else to_char(
      (nullif(trim(p_value), ''))::timestamptz at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  end;
$$;

create or replace function public.timetable_correction_semantic_fingerprint(p_payload jsonb)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select encode(
    digest(
      jsonb_build_object(
        'v', 1,
        'action', public.czw_normalize_semantic_text(p_payload->>'action'),
        'stableSessionKey', public.czw_normalize_semantic_text(p_payload->>'stable_session_key'),
        'sourceMayReplace', coalesce((p_payload->>'source_may_replace')::boolean, false),
        'courseCode', public.czw_normalize_semantic_code(p_payload->>'course_code'),
        'courseName', public.czw_normalize_semantic_text(p_payload->>'course_name'),
        'weekday', coalesce(p_payload->>'weekday', ''),
        'startTime', public.czw_normalize_semantic_time(p_payload->>'start_time'),
        'endTime', public.czw_normalize_semantic_time(p_payload->>'end_time'),
        'venue', public.czw_normalize_semantic_text(p_payload->>'venue'),
        'lecturer', public.czw_normalize_semantic_text(p_payload->>'lecturer'),
        'sessionType', public.czw_normalize_semantic_text(p_payload->>'session_type'),
        'notes', public.czw_normalize_semantic_text(p_payload->>'notes')
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.timetable_exception_semantic_fingerprint(p_payload jsonb)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select encode(
    digest(
      jsonb_build_object(
        'v', 1,
        'stableSessionKey', public.czw_normalize_semantic_text(p_payload->>'stable_session_key'),
        'exceptionDate', coalesce(p_payload->>'exception_date', ''),
        'exceptionType', public.czw_normalize_semantic_text(p_payload->>'exception_type'),
        'replacementStartsAt', public.czw_normalize_semantic_timestamp(p_payload->>'replacement_starts_at'),
        'replacementEndsAt', public.czw_normalize_semantic_timestamp(p_payload->>'replacement_ends_at'),
        'courseCode', public.czw_normalize_semantic_code(p_payload->>'course_code'),
        'courseName', public.czw_normalize_semantic_text(p_payload->>'course_name'),
        'startTime', public.czw_normalize_semantic_time(p_payload->>'start_time'),
        'endTime', public.czw_normalize_semantic_time(p_payload->>'end_time'),
        'venue', public.czw_normalize_semantic_text(p_payload->>'venue'),
        'lecturer', public.czw_normalize_semantic_text(p_payload->>'lecturer'),
        'sessionType', public.czw_normalize_semantic_text(p_payload->>'session_type'),
        'notes', public.czw_normalize_semantic_text(p_payload->>'notes')
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

-- Backfill exact semantic identities without deleting or coalescing any historic rows.
-- Existing duplicate groups intentionally remain visible for the authorized cleanup workflow.
update public.timetable_correction_directives as correction
set semantic_fingerprint = public.timetable_correction_semantic_fingerprint(to_jsonb(correction))
where semantic_fingerprint is null;

update public.timetable_session_exceptions as exception_row
set semantic_fingerprint = public.timetable_exception_semantic_fingerprint(to_jsonb(exception_row))
where semantic_fingerprint is null;

create or replace function public.guard_timetable_correction_semantic_duplicate()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.semantic_fingerprint := public.timetable_correction_semantic_fingerprint(to_jsonb(new));

  if new.active then
    perform pg_advisory_xact_lock(
      hashtext(new.timetable_id::text),
      hashtext(new.semantic_fingerprint)
    );

    if exists (
      select 1
      from public.timetable_correction_directives existing
      where existing.timetable_id = new.timetable_id
        and existing.active
        and existing.semantic_fingerprint = new.semantic_fingerprint
        and existing.id <> new.id
    ) then
      raise exception using
        errcode = '23505',
        message = 'TIMETABLE_UPDATE_ALREADY_EXISTS';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_timetable_exception_semantic_duplicate()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.semantic_fingerprint := public.timetable_exception_semantic_fingerprint(to_jsonb(new));

  if new.active then
    perform pg_advisory_xact_lock(
      hashtext(new.timetable_id::text),
      hashtext(new.semantic_fingerprint)
    );

    if exists (
      select 1
      from public.timetable_session_exceptions existing
      where existing.timetable_id = new.timetable_id
        and existing.active
        and existing.semantic_fingerprint = new.semantic_fingerprint
        and existing.id <> new.id
    ) then
      raise exception using
        errcode = '23505',
        message = 'TIMETABLE_UPDATE_ALREADY_EXISTS';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists timetable_correction_semantic_duplicate_guard
  on public.timetable_correction_directives;
create trigger timetable_correction_semantic_duplicate_guard
before insert or update on public.timetable_correction_directives
for each row execute function public.guard_timetable_correction_semantic_duplicate();

drop trigger if exists timetable_exception_semantic_duplicate_guard
  on public.timetable_session_exceptions;
create trigger timetable_exception_semantic_duplicate_guard
before insert or update on public.timetable_session_exceptions
for each row execute function public.guard_timetable_exception_semantic_duplicate();

create or replace function public.replace_timetable_correction_update(
  p_timetable_id uuid,
  p_correction_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_role text,
  p_mutation_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old public.timetable_correction_directives%rowtype;
  v_new public.timetable_correction_directives%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_old
  from public.timetable_correction_directives
  where id = p_correction_id
    and timetable_id = p_timetable_id
  for update;

  if not found or not v_old.active or v_old.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CORRECTION_STALE_EDIT';
  end if;

  update public.timetable_correction_directives
  set active = false,
      superseded_at = v_now,
      superseded_reason = 'edited',
      updated_at = v_now
  where id = v_old.id;

  insert into public.timetable_correction_directives (
    timetable_id,
    stable_session_key,
    action,
    source_may_replace,
    course_code,
    course_name,
    weekday,
    start_time,
    end_time,
    venue,
    lecturer,
    session_type,
    notes,
    reason,
    provenance,
    creator_role,
    creator_user_id,
    creator_staff_user_id,
    mutation_key,
    revision,
    supersedes_id,
    active,
    updated_at
  )
  values (
    p_timetable_id,
    nullif(p_payload->>'stable_session_key', ''),
    p_payload->>'action',
    coalesce((p_payload->>'source_may_replace')::boolean, false),
    nullif(p_payload->>'course_code', ''),
    nullif(p_payload->>'course_name', ''),
    nullif(p_payload->>'weekday', '')::smallint,
    nullif(p_payload->>'start_time', '')::time,
    nullif(p_payload->>'end_time', '')::time,
    nullif(p_payload->>'venue', ''),
    nullif(p_payload->>'lecturer', ''),
    nullif(p_payload->>'session_type', ''),
    nullif(p_payload->>'notes', ''),
    p_payload->>'reason',
    nullif(p_payload->>'provenance', ''),
    p_actor_role,
    p_actor_user_id,
    p_actor_staff_user_id,
    p_mutation_key,
    v_old.revision + 1,
    v_old.id,
    true,
    v_now
  )
  returning * into v_new;

  update public.timetable_correction_directives
  set replaced_by_id = v_new.id
  where id = v_old.id;

  return to_jsonb(v_new);
end;
$$;

create or replace function public.replace_timetable_exception_update(
  p_timetable_id uuid,
  p_exception_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_role text,
  p_mutation_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old public.timetable_session_exceptions%rowtype;
  v_new public.timetable_session_exceptions%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_old
  from public.timetable_session_exceptions
  where id = p_exception_id
    and timetable_id = p_timetable_id
  for update;

  if not found or not v_old.active or v_old.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'EXCEPTION_STALE_EDIT';
  end if;

  update public.timetable_session_exceptions
  set active = false,
      superseded_at = v_now,
      superseded_reason = 'edited',
      updated_at = v_now
  where id = v_old.id;

  insert into public.timetable_session_exceptions (
    timetable_id,
    timetable_session_id,
    stable_session_key,
    exception_date,
    exception_type,
    replacement_starts_at,
    replacement_ends_at,
    course_code,
    course_name,
    start_time,
    end_time,
    venue,
    lecturer,
    session_type,
    notes,
    reason,
    provenance,
    creator_role,
    creator_user_id,
    creator_staff_user_id,
    mutation_key,
    revision,
    supersedes_id,
    active,
    updated_at
  )
  values (
    p_timetable_id,
    nullif(p_payload->>'timetable_session_id', '')::uuid,
    nullif(p_payload->>'stable_session_key', ''),
    (p_payload->>'exception_date')::date,
    p_payload->>'exception_type',
    nullif(p_payload->>'replacement_starts_at', '')::timestamptz,
    nullif(p_payload->>'replacement_ends_at', '')::timestamptz,
    nullif(p_payload->>'course_code', ''),
    nullif(p_payload->>'course_name', ''),
    nullif(p_payload->>'start_time', '')::time,
    nullif(p_payload->>'end_time', '')::time,
    nullif(p_payload->>'venue', ''),
    nullif(p_payload->>'lecturer', ''),
    nullif(p_payload->>'session_type', ''),
    nullif(p_payload->>'notes', ''),
    nullif(p_payload->>'reason', ''),
    nullif(p_payload->>'provenance', ''),
    p_actor_role,
    p_actor_user_id,
    p_actor_staff_user_id,
    p_mutation_key,
    v_old.revision + 1,
    v_old.id,
    true,
    v_now
  )
  returning * into v_new;

  update public.timetable_session_exceptions
  set replaced_by_id = v_new.id
  where id = v_old.id;

  return to_jsonb(v_new);
end;
$$;

create or replace function public.dedupe_timetable_correction_group(
  p_timetable_id uuid,
  p_semantic_fingerprint text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_keep_id uuid;
  v_revoked_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtext(p_timetable_id::text),
    hashtext(p_semantic_fingerprint)
  );

  select id
  into v_keep_id
  from public.timetable_correction_directives
  where timetable_id = p_timetable_id
    and active
    and semantic_fingerprint = p_semantic_fingerprint
  order by created_at asc, id asc
  limit 1
  for update;

  if v_keep_id is null then
    return jsonb_build_object('keptId', null, 'revokedCount', 0);
  end if;

  update public.timetable_correction_directives
  set active = false,
      revoked_at = now(),
      revoked_by = p_actor_user_id,
      updated_at = now()
  where timetable_id = p_timetable_id
    and active
    and semantic_fingerprint = p_semantic_fingerprint
    and id <> v_keep_id;

  get diagnostics v_revoked_count = row_count;
  return jsonb_build_object('keptId', v_keep_id, 'revokedCount', v_revoked_count);
end;
$$;

create or replace function public.dedupe_timetable_exception_group(
  p_timetable_id uuid,
  p_semantic_fingerprint text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_keep_id uuid;
  v_revoked_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtext(p_timetable_id::text),
    hashtext(p_semantic_fingerprint)
  );

  select id
  into v_keep_id
  from public.timetable_session_exceptions
  where timetable_id = p_timetable_id
    and active
    and semantic_fingerprint = p_semantic_fingerprint
  order by created_at asc, id asc
  limit 1
  for update;

  if v_keep_id is null then
    return jsonb_build_object('keptId', null, 'revokedCount', 0);
  end if;

  update public.timetable_session_exceptions
  set active = false,
      revoked_at = now(),
      revoked_by = p_actor_user_id,
      updated_at = now()
  where timetable_id = p_timetable_id
    and active
    and semantic_fingerprint = p_semantic_fingerprint
    and id <> v_keep_id;

  get diagnostics v_revoked_count = row_count;
  return jsonb_build_object('keptId', v_keep_id, 'revokedCount', v_revoked_count);
end;
$$;

revoke execute on function public.timetable_correction_semantic_fingerprint(jsonb)
  from public, anon, authenticated;
revoke execute on function public.timetable_exception_semantic_fingerprint(jsonb)
  from public, anon, authenticated;
revoke execute on function public.replace_timetable_correction_update(uuid, uuid, timestamptz, uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.replace_timetable_exception_update(uuid, uuid, timestamptz, uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.dedupe_timetable_correction_group(uuid, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.dedupe_timetable_exception_group(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.timetable_correction_semantic_fingerprint(jsonb)
  to service_role;
grant execute on function public.timetable_exception_semantic_fingerprint(jsonb)
  to service_role;
grant execute on function public.replace_timetable_correction_update(uuid, uuid, timestamptz, uuid, uuid, text, uuid, jsonb)
  to service_role;
grant execute on function public.replace_timetable_exception_update(uuid, uuid, timestamptz, uuid, uuid, text, uuid, jsonb)
  to service_role;
grant execute on function public.dedupe_timetable_correction_group(uuid, text, uuid)
  to service_role;
grant execute on function public.dedupe_timetable_exception_group(uuid, text, uuid)
  to service_role;
