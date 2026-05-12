-- Affiliate creator profiles
CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE, -- e.g. "jordanshrinks"
  avatar_url TEXT,
  bio TEXT,
  youtube_url TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  affiliate_code TEXT UNIQUE, -- used for referral tracking
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active creators" ON creators FOR SELECT USING (is_active = true);

-- Link trending meals to creators
ALTER TABLE trending_meals ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES creators(id) ON DELETE SET NULL;
