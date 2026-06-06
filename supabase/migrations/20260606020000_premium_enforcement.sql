-- Server-side premium enforcement, Stage A (plumbing only — no endpoint enforces yet).
-- Gives the server a trustworthy "is this user actually subscribed?" flag, written
-- ONLY by the Superwall webhook (service role). The phone app cannot set it.

-- Trustworthy, server-written entitlement flag (Superwall webhook keeps it accurate).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_updated_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_source TEXT; -- e.g. 'superwall:renewal'

-- Extend the server-only guard to cover is_premium too (replaces the promo-only trigger).
-- current_user is the table owner inside a SECURITY DEFINER fn, and 'service_role' for
-- edge functions using the service key — only those contexts may set these columns.
CREATE OR REPLACE FUNCTION enforce_server_managed_premium()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.promo_active := FALSE;
      NEW.is_premium := FALSE;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.promo_active := OLD.promo_active; -- clients can't flip either flag
      NEW.is_premium := OLD.is_premium;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Swap the trigger over to the broadened guard, then drop the old promo-only function.
DROP TRIGGER IF EXISTS trg_enforce_promo_active ON profiles;
DROP TRIGGER IF EXISTS trg_enforce_server_premium ON profiles;
CREATE TRIGGER trg_enforce_server_premium
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_server_managed_premium();
DROP FUNCTION IF EXISTS enforce_promo_active_server_only();

-- One-time backfill so we DON'T lock out users who already converted/are in trial when
-- enforcement turns on later. Superwall only sends webhooks on future events, so existing
-- subscribers wouldn't otherwise get is_premium until their next renewal. Uses the
-- client-derived lifecycle markers as a best-effort seed (acceptable for a one-time backfill).
UPDATE profiles
SET is_premium = TRUE,
    premium_updated_at = now(),
    premium_source = 'backfill'
WHERE (subscribed_at IS NOT NULL AND churned_at IS NULL)
   OR (trial_started_at IS NOT NULL AND trial_ended_at IS NULL);
