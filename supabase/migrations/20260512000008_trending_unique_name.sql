-- Belt-and-suspenders against the YouTube/Groq trending generator inserting
-- two recipes with the same name on the same day (the "two oatmeal" bug).
-- Partial index so creator recipes aren't constrained — two different
-- creators may legitimately post recipes with the same dish name.

CREATE UNIQUE INDEX IF NOT EXISTS trending_meals_yt_name_per_day_uniq
  ON trending_meals (name, generated_at)
  WHERE trend_source = 'YouTube trending';
