-- Feeds scripts/audit-dropped-lines.ts.
select jsonb_agg(jsonb_build_object(
  'name', name, 'video_id', video_id, 'stored', jsonb_array_length(ingredients)
) order by generated_at desc) as all_rows
from trending_meals where video_id is not null;
