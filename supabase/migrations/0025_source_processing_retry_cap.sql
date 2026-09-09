-- DR-41: failed source jobs are terminal after the bounded retry budget.
-- 0017 marked attempt_count >= 5 as failed but its claim function also
-- reclaimed failed rows, causing an unbounded retry loop in production.

create or replace function public.claim_timetable_source_processing_job()
returns table (id uuid, snapshot_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select job.id
    from public.timetable_source_processing_jobs job
    where job.status = 'queued'
      and job.attempt_count < 5
      and job.available_at <= now()
    order by job.created_at desc
    limit 1
    for update skip locked
  )
  update public.timetable_source_processing_jobs job
  set
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    started_at = now(),
    updated_at = now()
  from claimed
  where job.id = claimed.id
  returning job.id, job.snapshot_id;
end;
$$;

create or replace function public.fail_timetable_source_processing_job(
  p_snapshot_id uuid,
  p_error_code text,
  p_error_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.timetable_source_processing_jobs
  set
    status = case when attempt_count >= 5 then 'failed' else 'queued' end,
    available_at = case
      when attempt_count >= 5 then available_at
      else now() + ((least(attempt_count, 5) * 5) || ' minutes')::interval
    end,
    last_error_code = p_error_code,
    last_error_metadata = coalesce(p_error_metadata, '{}'::jsonb),
    updated_at = now()
  where snapshot_id = p_snapshot_id;

  update public.timetable_sources source
  set
    last_processing_error_at = now(),
    last_processing_error_code = p_error_code,
    updated_at = now()
  from public.timetable_source_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and source.id = snapshot.source_id;
end;
$$;

revoke execute on function public.claim_timetable_source_processing_job()
  from public, anon, authenticated;
revoke execute on function public.fail_timetable_source_processing_job(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_timetable_source_processing_job()
  to service_role;
grant execute on function public.fail_timetable_source_processing_job(uuid, text, jsonb)
  to service_role;
