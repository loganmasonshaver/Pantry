-- Schedule a daily job that regenerates the YouTube trending batch so every user
-- hits a pre-warmed cache the moment they open the app. Runs at 5am UTC =
-- midnight Central / 1am Eastern / 10pm Pacific the previous day — quiet hours.
--
-- Auth: pg_cron has no user JWT, so it sends the project's service-role key as
-- a Bearer token. The edge function is updated to accept this and bypass the
-- user check + rate limit when the bearer matches SUPABASE_SERVICE_ROLE_KEY.
--
-- The service-role key is stored in Supabase Vault (encrypted) so it isn't
-- committed to git. Before this cron job actually fires, run ONCE in the
-- Supabase SQL editor (or psql):
--
--   SELECT vault.create_secret(
--     '<paste-your-service-role-key>',
--     'cron_service_role_key',
--     'Used by daily trending-meals regen cron job'
--   );
--
-- Get the key from Supabase Dashboard → Project Settings → API → service_role.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any prior version of the job before re-scheduling (idempotent across re-runs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trending-meals-daily') THEN
    PERFORM cron.unschedule('trending-meals-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'trending-meals-daily',
  '0 5 * * *',  -- 05:00 UTC every day
  $$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
