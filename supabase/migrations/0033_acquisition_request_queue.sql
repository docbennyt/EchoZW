-- DR-169: structured missing-timetable acquisition queue.
--
-- Public request submissions must become deduplicated operational work, not
-- founder memory or manual spreadsheets. Raw private source documents are
-- stored outside this table; this table keeps only safe metadata and routing
-- state for acquisition, review, and requester notification.

alter table public.timetable_requests
  add column if not exists semester_name text,
  add column if not exists class_rep_status text not null default 'unknown'
    check (class_rep_status in ('unknown', 'is_class_rep', 'knows_class_rep', 'not_class_rep')),
  add column if not exists source_document_name text,
  add column if not exists source_document_storage_path text,
  add column if not exists source_upload_status text not null default 'none'
    check (source_upload_status in ('none', 'metadata_only', 'uploaded', 'parse_ready', 'parsed', 'blocked')),
  add column if not exists source_import_review_id uuid,
  add column if not exists requester_notify_on_publish boolean not null default true,
  add column if not exists requester_notified_at timestamptz,
  add column if not exists acquisition_notes text,
  add column if not exists institution_key text,
  add column if not exists programme_key text,
  add column if not exists class_group_key text,
  add column if not exists academic_period_key text,
  add column if not exists demand_key text;

update public.timetable_requests
set
  institution_key = coalesce(institution_key, lower(regexp_replace(trim(institution_name), '\s+', ' ', 'g'))),
  programme_key = coalesce(programme_key, lower(regexp_replace(trim(programme_name), '\s+', ' ', 'g'))),
  class_group_key = coalesce(class_group_key, lower(regexp_replace(trim(class_group), '\s+', ' ', 'g'))),
  academic_period_key = coalesce(academic_period_key, lower(regexp_replace(trim(coalesce(academic_period, semester_name, '')), '\s+', ' ', 'g'))),
  demand_key = coalesce(
    demand_key,
    lower(regexp_replace(trim(institution_name), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(trim(programme_name), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(trim(class_group), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(trim(coalesce(academic_period, semester_name, '')), '\s+', ' ', 'g'))
  )
where demand_key is null
   or institution_key is null
   or programme_key is null
   or class_group_key is null
   or academic_period_key is null;

alter table public.timetable_requests
  alter column institution_key set not null,
  alter column programme_key set not null,
  alter column class_group_key set not null,
  alter column academic_period_key set not null,
  alter column demand_key set not null;

create index if not exists timetable_requests_demand_key_idx
  on public.timetable_requests (demand_key, created_at desc);
create index if not exists timetable_requests_notify_idx
  on public.timetable_requests (status, requester_notify_on_publish, requester_notified_at)
  where requester_notify_on_publish = true;
create index if not exists timetable_requests_source_upload_status_idx
  on public.timetable_requests (source_upload_status, created_at desc);

create or replace view public.timetable_acquisition_queue as
select
  demand_key,
  min(created_at) as first_requested_at,
  max(created_at) as last_requested_at,
  count(*)::integer as request_count,
  count(*) filter (where email is not null and requester_notify_on_publish)::integer as notify_email_count,
  count(*) filter (where requester_role = 'class_rep' or class_rep_status in ('is_class_rep', 'knows_class_rep'))::integer as class_rep_lead_count,
  count(*) filter (where source_access <> 'none' or source_upload_status <> 'none')::integer as source_lead_count,
  bool_or(source_upload_status in ('uploaded', 'parse_ready', 'parsed')) as has_source_document,
  max(status) filter (where status <> 'closed') as current_status,
  min(institution_name) as institution_name,
  min(programme_name) as programme_name,
  min(class_group) as class_group,
  min(coalesce(academic_period, semester_name)) as academic_period
from public.timetable_requests
group by demand_key;

comment on view public.timetable_acquisition_queue is 'Aggregated missing-timetable demand queue. One row represents a normalized institution/programme/class/period acquisition target.';
