-- image_cache: allow public SELECT, keep writes service-role only.
--
-- Background: image_cache maps a normalized meal_key -> a public Supabase Storage
-- image URL. It's a SHARED, non-user-specific cache of generated meal thumbnails —
-- there is nothing private in it (no user_id, just meal name + a URL that's already
-- public). It was originally locked to service-role-only as a blanket default, but
-- the client was written to read it directly (onboarding plan-image hydration +
-- meal-log image fallback). With no SELECT policy those reads silently returned
-- nothing, so brand-new users saw blank placeholder thumbnails on their first Home
-- screen until they opened each meal individually.
--
-- Adding a read-only policy restores that intended optimization. Writes deliberately
-- get NO policy here — the generate-meal-image edge function upserts with the service
-- role, which bypasses RLS, and must remain the ONLY writer (a client write policy
-- would let anyone poison the shared cache with arbitrary URLs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'image_cache'
      AND policyname = 'Anyone can read image cache'
  ) THEN
    CREATE POLICY "Anyone can read image cache" ON image_cache FOR SELECT USING (true);
  END IF;
END $$;
