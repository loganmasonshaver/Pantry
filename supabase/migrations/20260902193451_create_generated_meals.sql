-- Generation history: every meal generate-meals returns, kept per user.
--
-- WHY NOW, when the page that reads it is V2 work: this is a one-way door. Today nothing persists
-- a generated meal anywhere. Only the NAMES reach the server (profiles.recent_meal_names, capped at
-- 30 for the anti-repeat window) and the full meals live in an AsyncStorage cache that is discarded
-- at the next local midnight. Every generation not written here is gone permanently, so an early
-- user's first weeks of history can never be reconstructed after the fact. The write is cheap; the
-- backfill is impossible.
--
-- Written ONLY by the edge function's service-role client. There is deliberately no insert, update
-- or delete policy: this is a record of what the generator produced, and a client that could write
-- it could also forge it. Users may read their own rows and nothing else.
CREATE TABLE IF NOT EXISTS generated_meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- The full GeneratedMeal, same shape meal_logs.meal_data already stores, so the V2 history page
  -- can hand it straight to /meal/[id] via params exactly as Home does today.
  meal_data jsonb NOT NULL,
  -- Denormalised so a listing or a repeat-check never has to open the jsonb.
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'cookNow', -- 'cookNow' | 'mealPlan'
  -- timestamptz, NOT a date column. The client's day is LOCAL (todayStr) and the server's is UTC;
  -- storing an instant lets the reader group by whichever day it means. Picking one here would bake
  -- in the exact local-vs-UTC confusion already documented against generated_at elsewhere.
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The only query the history page makes: this user's rows, newest first.
CREATE INDEX IF NOT EXISTS generated_meals_user_created_idx
  ON generated_meals (user_id, created_at DESC);

ALTER TABLE generated_meals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own generated meals" ON generated_meals;
CREATE POLICY "Users read own generated meals"
  ON generated_meals FOR SELECT
  USING (auth.uid() = user_id);
