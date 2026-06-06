-- Critical security fixes (code review batch 1)
-- 1. promo_active was client-writable -> any user could self-grant free premium.
-- 2. trending_meals UPDATE policy was open to all authenticated users (IDOR).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Make profiles.promo_active SERVER-ONLY.
-- The profiles UPDATE RLS policy is a blanket (auth.uid() = id), so a client
-- could update({ promo_active: true }) and grant itself permanent premium.
-- This trigger neutralizes any client attempt to set/change promo_active:
-- only server contexts (service_role, or a SECURITY DEFINER fn owned by the
-- db owner) may change it. Clients get their value silently preserved (no error,
-- so older app builds that still send promo_active won't break onboarding).
CREATE OR REPLACE FUNCTION enforce_promo_active_server_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- current_user is the table owner inside a SECURITY DEFINER fn (redeem RPC),
  -- and 'service_role' for edge functions using the service key.
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.promo_active := FALSE;           -- new profiles never start promo'd from the client
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.promo_active := OLD.promo_active; -- clients can't flip it
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_promo_active ON profiles;
CREATE TRIGGER trg_enforce_promo_active
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_promo_active_server_only();

-- Server-side redemption: re-validates the code (never trusts a client flag) and
-- sets promo_active itself. SECURITY DEFINER runs as the owner, so the trigger
-- above permits the write. Replaces the old client-side promo_active upsert.
CREATE OR REPLACE FUNCTION redeem_referral_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_norm TEXT;
  v_row  referral_codes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'grants_premium', false);
  END IF;

  v_norm := UPPER(TRIM(COALESCE(p_code, '')));
  IF length(v_norm) = 0 THEN
    RETURN jsonb_build_object('valid', false, 'grants_premium', false);
  END IF;

  SELECT * INTO v_row FROM referral_codes
   WHERE code = v_norm AND active = TRUE
     AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    -- Unknown code: still record attribution, but no premium.
    UPDATE profiles SET referral_code_used = v_norm WHERE id = v_uid;
    RETURN jsonb_build_object('valid', false, 'grants_premium', false);
  END IF;

  IF v_row.grants_premium THEN
    UPDATE profiles SET promo_active = TRUE, referral_code_used = v_norm WHERE id = v_uid;
  ELSE
    UPDATE profiles SET referral_code_used = v_norm WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('valid', true, 'grants_premium', v_row.grants_premium);
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_referral_code(TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) trending_meals: drop the open UPDATE policy (IDOR — any authenticated user
-- could overwrite any creator's meal). Voting (increment_vote_score) and the
-- log-count trigger are SECURITY DEFINER and bypass RLS, so they keep working.
DROP POLICY IF EXISTS "Authenticated users can vote on trending meals" ON trending_meals;

-- Creators may edit ONLY their own meals.
DROP POLICY IF EXISTS "Creators can update their own trending meals" ON trending_meals;
CREATE POLICY "Creators can update their own trending meals"
  ON trending_meals FOR UPDATE
  USING (creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid()))
  WITH CHECK (creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid()));
