-- One-off: wipe today's YouTube-sourced trending rows so the next home-screen
-- visit triggers generate-trending-meals fresh under the new variety rules
-- (broader query pool, prompt-level diversity constraints, name dedup).
-- Creator-posted recipes are untouched.

DELETE FROM trending_meals
WHERE generated_at = CURRENT_DATE
  AND trend_source = 'YouTube trending';
