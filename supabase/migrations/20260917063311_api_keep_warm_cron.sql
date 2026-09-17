-- Keep Supabase's API warm while the project is on the Free plan's Nano compute (0.5 GB RAM).
--
-- Measured 2026-09-17: after ~15 quiet minutes, a burst of 50 small reads waited a median 3.7 s (8 s
-- once on the phone after an app reload), the same burst straight after took 0.7 s, and 5 s later
-- 0.26 s. The box carries ~250 MB of swap, so the leading explanation is idle API memory paged out
-- and paged back in by the next burst. One tiny read through the gateway and PostgREST every two
-- minutes keeps that path in use. Measured before and after in PRELAUNCH §3; drop this job once the
-- project moves to a paid compute size (POST-LAUNCH #1).
--
-- The anon key is public (it ships in the app) but is read from Vault so no key sits in a committed
-- file. trending_meals is readable by anon, and `limit 1` keeps each ping to one row.
select cron.unschedule(jobid) from cron.job where jobname = 'api-keep-warm';

select cron.schedule(
  'api-keep-warm',
  '*/2 * * * *',
  $cmd$
  SELECT net.http_get(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/rest/v1/trending_meals?select=id&limit=1',
    headers := jsonb_build_object(
      'apikey', COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1), '')
    ),
    timeout_milliseconds := 10000
  );
  $cmd$
);
