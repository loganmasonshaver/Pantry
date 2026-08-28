-- Adds the column three separate places already depend on and no migration ever created.
--
-- The chain that was silently broken:
--   1. hooks/useNotifications.ts:169  writes profiles.expo_push_token after permission is granted
--   2. trending-health-check reads it to find the ops device to push to
--   3. with no column, the read returns nothing and the function returns
--      "FAILED: ops user has no expo_push_token" — so no alert has EVER been sent
--
-- The write is inside a try/catch whose comment says "Token fails on simulator — non-critical",
-- and the empty catch swallowed the 42703 undefined-column error just as quietly as it swallows
-- the simulator case. Nothing surfaced anywhere.
--
-- Consequence: the trending cron missed 7 of the last 19 days (Aug 11, 13, 14, 15, 18, 23, 24
-- against a '0 5 * * *' daily schedule) and the health check built specifically to catch that was
-- itself dead on arrival. Two independent failures, neither visible.
--
-- `if not exists` per the repo's migration rule, so a partial apply is re-runnable.
alter table public.profiles
  add column if not exists expo_push_token text;

comment on column public.profiles.expo_push_token is
  'Expo push token for this user''s device. Written by hooks/useNotifications.ts once notification permission is granted; read by the trending-health-check job to target the ops device. Null on simulator (Expo issues push tokens only on physical devices).';
