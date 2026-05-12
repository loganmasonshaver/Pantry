-- Track how many unique users have logged each trending recipe so we can show
-- "X people made this" as social proof, gated by a UI threshold (>=10).
-- Counts only the first log per user per recipe — repeated logs by the same
-- user shouldn't inflate the number.

ALTER TABLE trending_meals
  ADD COLUMN IF NOT EXISTS log_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_recipe_log_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Only the first log from this user for this recipe name should increment.
  -- The check has a small race window under concurrent inserts; acceptable for
  -- social-proof counters where eventual consistency is fine.
  IF NOT EXISTS (
    SELECT 1 FROM meal_logs
    WHERE user_id = NEW.user_id
      AND meal_name = NEW.meal_name
      AND id <> NEW.id
  ) THEN
    UPDATE trending_meals
      SET log_count = log_count + 1
      WHERE name = NEW.meal_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_meal_log_increment_recipe ON meal_logs;
CREATE TRIGGER on_meal_log_increment_recipe
  AFTER INSERT ON meal_logs
  FOR EACH ROW
  EXECUTE FUNCTION increment_recipe_log_count();

-- One-time backfill so existing logs aren't lost to the counter
UPDATE trending_meals tm
SET log_count = sub.cnt
FROM (
  SELECT meal_name, COUNT(DISTINCT user_id)::integer AS cnt
  FROM meal_logs
  GROUP BY meal_name
) sub
WHERE tm.name = sub.meal_name;
