-- SECURITY: a SECURITY DEFINER function callable by `anon` that writes to any user's account.
--
-- insert_saved_meal has TWO live overloads in production:
--   (uuid, text, int, int,     int,     int,     int, jsonb, jsonb, text)  -- current, guarded
--   (uuid, text, int, numeric, numeric, numeric, int, jsonb, jsonb)        -- superseded, NOT guarded
--
-- The superseded one predates 20260420112446, which is the migration that added both the
-- `p_user_id IS DISTINCT FROM auth.uid()` ownership check and the 50-row cap. CREATE OR REPLACE
-- with new argument TYPES makes a new function rather than replacing the old one, so the old
-- version was never removed — the same overload trap that already left refund_scan(text) and
-- increment_vote_score(uuid,int) behind, both of which were caught and dropped.
--
-- Read off pg_proc, not the repo: SECURITY DEFINER, no auth.uid() anywhere in the body, and
-- EXECUTE held by anon, authenticated, postgres, service_role. It takes the target account as a
-- PARAMETER and trusts it. The anon key ships inside the app bundle, so with no login at all a
-- caller could write arbitrary saved_meals rows against any user id they supply, unbounded —
-- the cap lives only in the guarded overload.
--
-- Safe to drop: both call sites (app/meal/[id].tsx:484 and app/onboarding/index.tsx:4054) pass
-- p_image_url, so PostgREST resolves both to the 10-argument guarded overload. Nothing reaches
-- the 9-argument one.
drop function if exists public.insert_saved_meal(
  uuid, text, integer, numeric, numeric, numeric, integer, jsonb, jsonb
);
