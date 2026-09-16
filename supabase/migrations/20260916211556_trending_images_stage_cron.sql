-- The photo step as its own scheduled invocation, five minutes after the daily recipe run.
--
-- The recipe run (trending-meals-daily, 08:00) makes its photos at the end of the same request,
-- and the edge gateway ends every request at 150 s. Photos are the one stage that request does not
-- control: on 2026-09-16, 10 rows took 9 s and 9 rows took 30 s an hour apart on the same code, and
-- a slow day ran real run 808 to 129 s. The recipe run now stops making photos at 143 s and leaves
-- the rest on their YouTube thumbnails; this job finishes them with a fresh 150 s of its own.
--
-- ?stage=images only touches rows still without an AI photo (or with none), so on a day the recipe
-- run finished its photos it selects nothing and costs nothing. 08:05 is after the recipe run's own
-- image deadline (08:02:23 at the latest), so the two never work the same row at once.
select cron.unschedule(jobid) from cron.job where jobname = 'trending-images-daily';

select cron.schedule(
  'trending-images-daily',
  '5 8 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?stage=images',
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
);
