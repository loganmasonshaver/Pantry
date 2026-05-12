-- One-off: remove the @jordanshrinks test creator and their recipes.
-- Used during early creator-flow testing — not real content.

DELETE FROM trending_meals
WHERE creator_id IN (SELECT id FROM creators WHERE handle = 'jordanshrinks');

DELETE FROM creators WHERE handle = 'jordanshrinks';
