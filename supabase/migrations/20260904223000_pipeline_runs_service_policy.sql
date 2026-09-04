-- pipeline_runs stayed EMPTY after a run that returned HTTP 200 and a complete body. The insert
-- failed and nothing said so: supabase-js returns an error object rather than throwing, and the
-- call ignored the result.
--
-- RLS was enabled with zero policies on the assumption that service_role bypasses RLS. That is
-- true of the Postgres role, but the edge function reaches PostgREST over HTTP with whatever
-- SUPABASE_SERVICE_ROLE_KEY currently holds — and today's 401 investigation showed that value has
-- drifted from the legacy JWT that `projects api-keys` returns. If the key resolves to anything
-- other than service_role, zero policies means every write is silently refused. Reading
-- trending_meals still worked because it has a public SELECT policy, which is exactly why the
-- audit appeared to succeed.
--
-- An explicit policy removes the assumption. anon and authenticated still get nothing.
drop policy if exists pipeline_runs_service_write on pipeline_runs;
create policy pipeline_runs_service_write on pipeline_runs
  for all to service_role using (true) with check (true);
