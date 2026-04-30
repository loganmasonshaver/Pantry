-- Daily trending meals cache — refreshed once per day
CREATE TABLE trending_meals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  calories INT NOT NULL,
  protein INT NOT NULL,
  carbs INT NOT NULL,
  fat INT NOT NULL,
  prep_time INT,
  ingredients JSONB NOT NULL DEFAULT '[]',
  steps JSONB NOT NULL DEFAULT '[]',
  image TEXT,
  trend_source TEXT, -- e.g. "TikTok", "seasonal", "viral"
  generated_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Public read, only service role writes
ALTER TABLE trending_meals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read trending meals" ON trending_meals FOR SELECT USING (true);

-- Index for daily lookup
CREATE INDEX idx_trending_meals_date ON trending_meals(generated_at);
