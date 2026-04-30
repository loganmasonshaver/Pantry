-- Add lifetime free scan counters to profiles
-- Free users get 3 lifetime scans per type before hitting the paywall
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receipt_scan_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pantry_scan_count  integer NOT NULL DEFAULT 0;
