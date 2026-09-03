-- Founder analytics RPC privilege hardening.
-- Supabase's public-schema default function privileges explicitly grant EXECUTE
-- to anon and authenticated. These analytics functions are server-only and must
-- remain callable only by postgres/service_role.

revoke execute on function public.analytics_stage_for_events(
  text[],
  boolean,
  boolean,
  boolean,
  integer
) from public, anon, authenticated;

revoke execute on function public.analytics_score_for_events(text[], integer)
  from public, anon, authenticated;

revoke execute on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;

revoke execute on function public.get_admin_analytics_overview_v1(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

revoke execute on function public.get_admin_analytics_overview(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.analytics_stage_for_events(
  text[],
  boolean,
  boolean,
  boolean,
  integer
) to service_role;

grant execute on function public.analytics_score_for_events(text[], integer)
  to service_role;

grant execute on function public.resolve_analytics_person(
  text,
  uuid,
  uuid,
  timestamptz
) to service_role;

grant execute on function public.get_admin_analytics_overview_v1(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

grant execute on function public.get_admin_analytics_overview(
  date,
  date,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;
