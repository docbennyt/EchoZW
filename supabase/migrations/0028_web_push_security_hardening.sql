-- DR-46: close the final Supabase advisor warning introduced by the push retry helper.
-- The helper is pure SQL, but pinning search_path keeps every DR-46 database
-- function explicit and future-safe under role/schema changes.

alter function public.push_retry_delay_seconds(integer, integer)
  set search_path = public;

revoke all on function public.push_retry_delay_seconds(integer, integer)
  from public, anon, authenticated;
grant execute on function public.push_retry_delay_seconds(integer, integer)
  to service_role;
