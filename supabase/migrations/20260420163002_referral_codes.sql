-- Referral code storage + validation.
-- Codes are validated via RPC so the table itself is not exposed to clients
-- (no SELECT policy). Creators/admins insert codes via Supabase dashboard
-- or an admin service_role call.

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY,
  creator_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
-- No policies = anonymous/authenticated clients cannot read the table directly.
-- Validation happens through the SECURITY DEFINER RPC below.

-- Track which code (if any) a user applied during onboarding
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code_used TEXT;

CREATE OR REPLACE FUNCTION validate_referral_code(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_normalized TEXT;
BEGIN
  v_normalized := UPPER(TRIM(p_code));
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM referral_codes
    WHERE code = v_normalized
      AND active = TRUE
      AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_referral_code(TEXT) TO anon, authenticated;
