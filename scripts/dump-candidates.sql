-- Feeds scripts/replay-macros.ts. Pipe through the extractor in that file's header comment.
select jsonb_agg(jsonb_build_object(
  'name', name, 'servings', servings, 'calories', calories,
  'protein', protein, 'carbs', carbs, 'fat', fat, 'ingredients', ingredients
)) as all_rows from trending_meals;
