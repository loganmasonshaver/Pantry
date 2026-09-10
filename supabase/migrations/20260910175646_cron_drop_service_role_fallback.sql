-- Finish the cron auth fix: drop the stale service-role fallback and the vault copy behind it.
--
-- Migration 20260910172037 moved both cron jobs to prefer vault `cron_secret`, keeping
-- `cron_service_role_key` as a fallback until the new path had proven itself. It has: on 2026-09-10
-- the pipeline job's EXACT stored command was executed by hand and put 13 recipes (all with AI
-- images) into trending_meals, and the health-check job's stored command then returned 200 with
-- {"healthy": true, "count": 13}.
--
-- The fallback was never a real safety net. It is a copy of a service-role key taken on 2026-05-31,
-- and the reason for the whole fix is that it stopped matching the function's platform-injected
-- SUPABASE_SERVICE_ROLE_KEY — so falling back to it can only produce the same 401. Keeping it bought
-- nothing and left a high-privilege credential sitting in the vault for no purpose.
--
-- NEW COUPLING, and the thing to remember: the cron now works only while vault `cron_secret` equals
-- the Edge Function secret CRON_SECRET. CRON_SECRET must never be rotated (Logan's standing rule) —
-- but if it ever is, the vault copy has to be updated in the same sitting or both jobs 401 again.
--
-- alter_job touches ONLY the command, as before, so the live 08:00 / 08:20 UTC schedules survive.

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
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $cmd$
)
where exists (select 1 from cron.job where jobname = 'trending-health-check-daily');

-- Only after both jobs have stopped reading it.
delete from vault.secrets where name = 'cron_service_role_key';
