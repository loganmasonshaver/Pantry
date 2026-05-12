-- Step 1: clean up pre-existing same-name/same-day dupes among YouTube-source
-- rows so the partial unique index in the next migration can be built. Keep
-- the lowest-id row so any vote_score history on the earliest one survives.
-- Split into its own migration so the cleanup commits before the index
-- attempt — a single-transaction file would roll back the DELETE on
-- index failure and the next push would fail again.
DELETE FROM trending_meals a
USING trending_meals b
WHERE a.trend_source = 'YouTube trending'
  AND b.trend_source = 'YouTube trending'
  AND a.name = b.name
  AND a.generated_at = b.generated_at
  AND a.id > b.id;
