-- Diet/allergen tags on each trending meal so Discover can build a per-user feed
-- (filter the shared daily pool by the user's diet_type + allergen restrictions)
-- instead of just hiding non-matching meals client-side.
--
-- compatible_diets: which diet identities a meal satisfies. Nested — a vegan meal
-- satisfies all four; a chicken meal only 'Classic'. Computed from ingredients at
-- generation time.
alter table trending_meals add column if not exists compatible_diets text[] default array['Classic'];
alter table trending_meals add column if not exists is_dairy_free boolean default true;
alter table trending_meals add column if not exists is_gluten_free boolean default true;
alter table trending_meals add column if not exists is_nut_free boolean default true;

-- Existing rows keep the permissive defaults (Classic-only / allergen-free unknown);
-- they age out of the rolling window within a few days and get replaced by tagged
-- rows from the next generation run.
