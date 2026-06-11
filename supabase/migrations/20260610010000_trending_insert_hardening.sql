-- M5 #2: tighten who can INSERT creator trending meals.
-- The old policy only checked that creator_id belonged to the caller. But ANY authed
-- user can self-create a creator row (see creator_voting policy), so a non-promo user
-- could self-promote; and nothing pinned trend_source, so a client could insert with
-- trend_source != 'creator' to masquerade as cron content AND dodge the daily-post trigger
-- (which only fires for trend_source = 'creator').
--
-- Note: the daily-batch cron inserts via the service role, which bypasses RLS entirely,
-- so this stricter client policy doesn't affect it.

DROP POLICY IF EXISTS "Creators can insert their own trending meals" ON trending_meals;

CREATE POLICY "Creators can insert their own trending meals"
  ON trending_meals FOR INSERT
  WITH CHECK (
    -- Must be tagged as creator content (can't pose as algorithmic/cron rows, which
    -- would also slip past the per-creator daily-post limit trigger).
    trend_source = 'creator'
    -- Must own the creator record it's attributed to.
    AND creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid())
    -- Must actually be a promo/creator-enabled account (matches the UI's promoActive gate).
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND promo_active = true)
  );
