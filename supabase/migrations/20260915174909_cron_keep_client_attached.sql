-- The trending cron's net.http_post used pg_net's DEFAULT 5-second timeout. A run takes ~85 s
-- since attempts were unioned (2026-09-13), so pg_cron reported "succeeded" (= request queued)
-- while net._http_response recorded `timed_out: true` at 5003 ms — and the 08:00 UTC runs on
-- 2026-09-14 and 2026-09-15 stored NOTHING and wrote no pipeline_runs row, the fail case of the
-- Sep-13 handoff's PASS criterion. Earlier crons survived the disconnect (the function ran on
-- after the client left); the new, longer run evidently does not.
--
-- 200 s keeps the client attached for the whole run, which also means the cron's real status
-- and body land in net._http_response for the first time — until now that table only ever held
-- the timeout. The health check gets 30 s for the same reason.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'trending-meals-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 200000
  );
  $cmd$
)
where exists (select 1 from cron.job where jobname = 'trending-meals-daily');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'trending-health-check-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/trending-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
)
where exists (select 1 from cron.job where jobname = 'trending-health-check-daily');
