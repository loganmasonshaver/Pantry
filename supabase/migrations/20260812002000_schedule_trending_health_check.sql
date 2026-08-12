-- Daily verification that the trending batch actually landed, one hour after it should have.
--
-- Why a separate job instead of a check at the end of generate-trending-meals: a self-check can
-- only report failures it survives to report. It cannot fire when the cron never runs, when the
-- function times out, or when the worker dies mid-run. This checks the OUTCOME — "does today have
-- meals?" — so all of those are caught.
--
-- The case that prompted it: on 2026-08-11 the generator built 16 recipes and lost all of them to
-- one decimal macro failing an int4 insert. It returned 500, stored nothing, and the gap was only
-- noticed by manually querying the table a day later.
--
-- Runs at 06:00 UTC = one hour after 'trending-meals-daily' (05:00 UTC). The gap matters: image
-- generation runs after the insert and takes minutes, so checking any earlier would report missing
-- images that are simply still rendering.
--
-- SETUP — required before this alerts anything:
--   1. Set the ops user (whose device receives the push):
--        Dashboard -> Edge Functions -> Secrets -> OPS_USER_ID = <your profiles.id uuid>
--      Find it with:  SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;
--   2. Optional: TRENDING_MIN_EXPECTED (defaults to 10; STORE_CAP is 18 and a normal run yields ~16).
--   3. The device must have registered a push token — profiles.expo_push_token is written by
--      hooks/useNotifications.ts once notification permission is granted. Verify with:
--        SELECT expo_push_token FROM profiles WHERE id = '<OPS_USER_ID>';
--      A null token makes the alert a silent no-op, which the function logs as a FAILED alert.
--
-- Reuses the same vault secret as the generation cron; no new key to store.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent across re-runs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trending-health-check-daily') THEN
    PERFORM cron.unschedule('trending-health-check-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'trending-health-check-daily',
  '0 6 * * *',  -- 06:00 UTC daily, one hour after the generator
  $$
  SELECT net.http_post(
    url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/trending-health-check',
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
