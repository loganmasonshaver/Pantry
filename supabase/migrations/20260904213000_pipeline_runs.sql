-- Persist each trending-pipeline run's funnel so a run's result can be READ back from SQL.
--
-- Today it cannot be. The funnel exists only in the HTTP response body and in console logs, and
-- pg_net times out long before a run finishes — net._http_response id 187 (the 08:00 UTC cron on
-- 2026-09-04) has status_code NULL and empty content, while the function itself completed and
-- stored rows. So the cron's own output has never been readable from the database.
--
-- That blocks the PRELAUNCH yield-variance test outright. It calls for ~10 sequential runs compared
-- against each other; without persistence that means scraping ten dashboard log pages by hand, and
-- "identical code gave raw 24 vs 5" is exactly the kind of claim that needs the numbers side by
-- side rather than remembered.
create table if not exists pipeline_runs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  dry_run     boolean     not null default false,
  provider    text,
  stored      int,
  funnel      jsonb       not null
);
create index if not exists pipeline_runs_created_idx on pipeline_runs (created_at desc);

-- No policies: RLS on with zero policies means anon and authenticated get nothing, and the
-- service role bypasses RLS to write. Run diagnostics are operational data, not public content —
-- the trending_meals anon-DELETE incident is the reason this is stated rather than assumed.
alter table pipeline_runs enable row level security;
