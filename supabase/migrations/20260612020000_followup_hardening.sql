-- Follow-up hardening: items B, C, D, E from the red-team report.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. creators: stop leaking affiliate_code to the client.
-- The public read policy (USING is_active = true) is needed — the Discover feed
-- embeds creator display fields (name/handle/avatar/socials). But `select *` via
-- the anon key also returned `affiliate_code` (referral/payout attribution → fraud
-- + competitor intel) and `user_id`. We can't fully hide user_id (own-row lookups
-- filter on it), but affiliate_code is referenced NOWHERE client-side, so revoke
-- column SELECT for it. RLS still governs which ROWS are visible; this governs
-- which COLUMNS. Every column the app actually selects is re-granted below.
REVOKE SELECT ON creators FROM anon, authenticated;
GRANT  SELECT (
  id, name, handle, avatar_url, bio,
  youtube_url, instagram_url, tiktok_url,
  is_active, created_at, user_id            -- everything EXCEPT affiliate_code
) ON creators TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Storage buckets: enforce MIME allow-list + size cap at the bucket level.
-- Even with the upload policies tightened, a public bucket with no type/size limit
-- can host arbitrary content (phishing pages, oversized files → cost). Limits apply
-- to NEW uploads only; existing objects are untouched. Both buckets only ever store
-- images: meal-images = image/jpeg (AI + creator photos), ingredient-images = webp.
-- A small allow-list of image types + a generous size ceiling blocks abuse without
-- touching the legitimate pipelines.
UPDATE storage.buckets
SET file_size_limit = 5242880,  -- 5 MB; downscaled photos/AI images are well under this
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'meal-images';

UPDATE storage.buckets
SET file_size_limit = 2097152,  -- 2 MB; generated thumbnails are tiny
    allowed_mime_types = ARRAY['image/webp', 'image/png', 'image/jpeg']
WHERE id = 'ingredient-images';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. redeem_referral_code: make redemption single-use per (user, code).
-- Today it only flips promo_active (idempotent, harmless to repeat). But the moment
-- a code grants a STACKING reward (creator payout, credits — Stage 2 economics), an
-- unbounded re-redeem becomes a money bug. Add a redemption ledger now so the guard
-- is in place before rewards stack. Behavior is unchanged for first-time redemptions.
CREATE TABLE IF NOT EXISTS referral_redemptions (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code        text        NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
-- RLS on, no client policies: only the SECURITY DEFINER RPC below writes it.
ALTER TABLE referral_redemptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION redeem_referral_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_norm TEXT;
  v_row  referral_codes%ROWTYPE;
  v_first_time BOOLEAN;
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

  -- Single-use gate: record this (user, code) redemption. If it already exists, the
  -- user has redeemed this code before — return valid but DON'T re-apply the grant.
  INSERT INTO referral_redemptions (user_id, code) VALUES (v_uid, v_norm)
  ON CONFLICT (user_id, code) DO NOTHING;
  v_first_time := FOUND; -- true only when a new ledger row was inserted

  IF v_first_time THEN
    IF v_row.grants_premium THEN
      UPDATE profiles SET promo_active = TRUE, referral_code_used = v_norm WHERE id = v_uid;
    ELSE
      UPDATE profiles SET referral_code_used = v_norm WHERE id = v_uid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'grants_premium', v_row.grants_premium,
    'already_redeemed', NOT v_first_time
  );
END;
$$;
GRANT EXECUTE ON FUNCTION redeem_referral_code(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Drop the dead email_otp table. It has no verify function anywhere — real email
-- verification runs through Supabase Auth (signInWithOtp/verifyOtp). The orphan table
-- has no length/attempt constraints; dropping it removes the temptation to wire a
-- hand-rolled (unprotected) verify path against it later.
-- (The other E item — the obsolete insert_saved_meal definition — needs no action:
--  the later guarded version with the auth.uid() check is already the live one.)
DROP TABLE IF EXISTS email_otp;
