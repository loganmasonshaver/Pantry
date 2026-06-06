-- Enforce the creator daily-post limit (2/day) on the SERVER. It was client-only, so a
-- user could replay the INSERT or remount to bypass it and flood trending_meals (each post
-- also burns up to 2 OpenAI calls for macro/title estimation).

-- Server-trusted insert time. The trigger forces this to now() for creator posts, so a
-- client can't backdate generated_at to dodge the daily window.
ALTER TABLE trending_meals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION enforce_creator_daily_post_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Only creator-submitted meals are capped. System/cron inserts use the service role and
  -- trend_source != 'creator', so they're unaffected.
  IF NEW.trend_source = 'creator' AND NEW.creator_id IS NOT NULL THEN
    NEW.created_at := now(); -- never trust a client timestamp for the limit window
    SELECT count(*) INTO v_count
      FROM trending_meals
     WHERE creator_id = NEW.creator_id
       AND trend_source = 'creator'
       AND created_at >= date_trunc('day', now()); -- UTC calendar day (matches the client count)
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'daily_post_limit_reached' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_daily_post_limit ON trending_meals;
CREATE TRIGGER trg_creator_daily_post_limit
  BEFORE INSERT ON trending_meals
  FOR EACH ROW
  EXECUTE FUNCTION enforce_creator_daily_post_limit();
