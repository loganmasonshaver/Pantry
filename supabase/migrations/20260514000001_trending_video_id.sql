-- Track the YouTube video that sourced each trending meal so the cron can dedup
-- against recently-used videos. Without this the same viral video can resurface
-- weeks later and produce a different-named recipe from the same source — looks
-- like fresh content but is a stealth repeat.
ALTER TABLE trending_meals ADD COLUMN IF NOT EXISTS video_id TEXT;

-- Index supports the dedup query: "have we used this video_id in the last 90 days?"
CREATE INDEX IF NOT EXISTS idx_trending_meals_video_id_recent
  ON trending_meals (video_id, generated_at DESC)
  WHERE video_id IS NOT NULL;
