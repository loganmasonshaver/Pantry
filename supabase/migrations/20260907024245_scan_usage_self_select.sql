-- Let a user read their OWN generation quota, so the client stops keeping a second copy of it.
--
-- scan_usage had RLS enabled and ZERO policies, so only service_role could see it. The client
-- therefore predicted the quota instead of reading it, with its own counter — and that counter
-- drifted three separate ways:
--   1. a Profile change regenerates through the effect, not regenerate(), so it never incremented;
--   2. the same change stales the meal cache, and the counter is only restored on a cache HIT, so
--      it reset to 0 — changing meal frequency both SPENT a server generation and REFILLED the
--      client's allowance;
--   3. it lives in AsyncStorage, so a second device keeps a separate count of one server number.
-- The visible symptom: the Pantry refresh button reported "0 of 3 used" and was guaranteed to fail
-- because the server had counted 6 of 6.
--
-- SELECT only, and only your own row. Writes stay where they were — checkScanCap and refundScan
-- run service-role inside the edge functions, which is the invariant for anything that grants or
-- meters access. Reading your own count grants nothing: it is the same number the API already
-- tells you when it rejects you.
--
-- `to authenticated` deliberately, NOT public. The anon key ships inside the app bundle, and
-- 20260906033730 is the reminder that a permissive default here is easy to miss — Supabase's own
-- default privileges re-granted anon EXECUTE on a function moments after it had been revoked from
-- PUBLIC. Verify with information_schema/pg_policies after the push rather than assuming.
create policy scan_usage_own_select on public.scan_usage
  for select
  to authenticated
  using (auth.uid() = user_id);
