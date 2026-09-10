-- The Claude scheduled task reads the daily report through the Supabase MCP connector, which runs
-- as supabase_read_only_user (verified with current_user). The revoke in 20260910201831 left it
-- "permission denied". That role already SELECTs meal_ratings directly, so this adds no exposure —
-- and it is not anon or authenticated, which stay revoked (the app's bundled key must never reach it).
-- Guarded: the role exists on the hosted project but not in a local `supabase start`.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    grant execute on function public.ops_report_data() to supabase_read_only_user;
  end if;
end $$;
