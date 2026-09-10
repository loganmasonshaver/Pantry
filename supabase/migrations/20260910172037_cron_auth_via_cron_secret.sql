-- Move both cron jobs off the drifting service-role key and onto CRON_SECRET.
--
-- WHY. From 2026-09-08 the trending pipeline and its health check both returned 401 Unauthorized
-- every day (net._http_response), while pg_cron reported every run as "succeeded" — because
-- net.http_post is asynchronous and "succeeded" only means the request was QUEUED. No meals were
-- added to Discover on Sep 8, 9 or 10, and the health check could not raise the alarm because it
-- authenticates the same way and was locked out by the same fault.
--
-- Both functions accept a Bearer matching EITHER CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY. Their own
-- comment says CRON_SECRET is preferred because the service-role key "kept drifting and 401'ing the
-- cron" — but the cron jobs were never moved over, and still sent vault.cron_service_role_key.
-- That vault secret is unchanged since 2026-05-31; what changed is the platform-injected
-- SUPABASE_SERVICE_ROLE_KEY inside the function, which is not ours to pin.
--
-- CRON_SECRET is a value we control on both ends, which is the whole point of it.
--
-- SAFE TO APPLY BEFORE THE VAULT SECRET EXISTS. The Bearer is COALESCE(cron_secret,
-- cron_service_role_key, ''), so until `cron_secret` is added to the vault this sends exactly what it
-- sends today — no regression — and the moment it is added, the next run authenticates. The value
-- must be added by hand from Apple Passwords ("Pantry — Supabase CRON_SECRET"); it never belongs in
-- a migration or a commit:
--
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'Durable cron auth');
--
-- alter_job changes ONLY the command. The live schedules (08:00 / 08:20 UTC) have already drifted
-- from the 05:00 in the original migration, and re-running cron.schedule would silently revert them.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'trending-meals-daily'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb
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
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $cmd$
)
where exists (select 1 from cron.job where jobname = 'trending-health-check-daily');
