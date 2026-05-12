-- Add grants_premium flag to referral_codes
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS grants_premium BOOLEAN NOT NULL DEFAULT FALSE;

-- Add promo_active flag to profiles (set true when a grants_premium code is redeemed)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS promo_active BOOLEAN NOT NULL DEFAULT FALSE;

-- Updated RPC that returns both valid + grants_premium so onboarding can skip the paywall
CREATE OR REPLACE FUNCTION validate_referral_code_v2(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_normalized TEXT;
  v_row referral_codes%ROWTYPE;
BEGIN
  v_normalized := UPPER(TRIM(p_code));
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RETURN jsonb_build_object('valid', false, 'grants_premium', false);
  END IF;
  SELECT * INTO v_row FROM referral_codes
  WHERE code = v_normalized
    AND active = TRUE
    AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'grants_premium', false);
  END IF;
  RETURN jsonb_build_object('valid', true, 'grants_premium', v_row.grants_premium);
END;
$$;

GRANT EXECUTE ON FUNCTION validate_referral_code_v2(TEXT) TO anon, authenticated;

-- Insert the dev bypass code (grants_premium = true, never expires)
INSERT INTO referral_codes (code, creator_name, active, grants_premium, notes)
VALUES ('PANTRY_CREATOR', 'Internal', TRUE, TRUE, 'Dev/internal bypass — skips paywall')
ON CONFLICT (code) DO UPDATE SET grants_premium = TRUE, active = TRUE;
