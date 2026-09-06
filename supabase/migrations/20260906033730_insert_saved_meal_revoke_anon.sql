-- Finishes the tightening 20260906033549 intended but did not achieve.
--
-- That migration ran `revoke all ... from public` after recreating insert_saved_meal, and verifying
-- against prod afterwards showed `anon` STILL holding EXECUTE. The reason: Supabase ships ALTER
-- DEFAULT PRIVILEGES granting EXECUTE on new functions in `public` to anon and authenticated, so
-- the CREATE itself minted a fresh, explicit anon grant. Revoking PUBLIC does not touch it —
-- PUBLIC and anon are different grantees. Any migration that recreates a function in this schema
-- has the same hole, and checking `information_schema.routine_privileges` after the push is the
-- only way it shows up.
--
-- Not a live vulnerability on its own: the body raises 'not authorized' unless
-- p_user_id = auth.uid(), and anon has no auth.uid(). But the anon key ships inside the app bundle,
-- this is SECURITY DEFINER, it writes rows, and it takes the target account as a parameter — the
-- exact shape whose unguarded overload was the real vulnerability dropped in 20260904161200.
revoke all on function public.insert_saved_meal(
  uuid, text, integer, integer, integer, integer, integer, jsonb, jsonb, text, integer
) from anon;
