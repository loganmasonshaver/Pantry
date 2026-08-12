-- Attribution columns so a cook can be traced back to WHERE it came from.
--
-- Why this is urgent and everything else about Discover personalisation isn't: features can be
-- built at any time, but data not captured is gone. Without these columns the question
-- "of the meals shown in the Post-Gym shelf, what fraction got cooked?" is permanently
-- unanswerable, and every ranking decision downstream depends on being able to ask it.
--
-- Today meal_logs records what was eaten (user_id, meal_name, calories, protein, carbs, fat, slot)
-- and nothing about where the user found it. A cook from Discover, the pantry hero, search, and
-- manual entry are indistinguishable.

-- Where the user was when they logged this.
--   'discover_featured' | 'discover_rail' | 'discover_grid' | 'pantry_hero'
--   | 'search' | 'saved' | 'scan' | 'manual'
alter table meal_logs add column if not exists source text;

-- Which shelf/section, for the Discover sources — e.g. 'protein-chicken', 'new', 'desserts'.
-- Separate from `source` because the surface and the shelf are different questions: "Discover
-- drives cooks" and "the Post-Gym shelf drives cooks" need different answers.
alter table meal_logs add column if not exists shelf_key text;

-- Rank within that shelf, 0-based. Without it shelf quality can't be separated from position
-- bias — position 1 always wins, and a shelf that merely sits high would look like a good shelf.
alter table meal_logs add column if not exists shelf_position int;

-- Deliberately a plain uuid with NO foreign key. trending_meals rows are deleted by the retention
-- cleanup (RETENTION_DAYS), and a FK with ON DELETE SET NULL would erase the attribution exactly
-- when the meal ages out — destroying the history this column exists to preserve. Keeping a bare
-- id means joins work while the row lives, and aggregate counts survive after it's gone.
alter table meal_logs add column if not exists trending_meal_id uuid;
alter table meal_ratings add column if not exists trending_meal_id uuid;

-- Analytics reads are "group by source/shelf over a date range", so index the grouping keys.
create index if not exists meal_logs_source_idx on meal_logs (source);
create index if not exists meal_logs_shelf_key_idx on meal_logs (shelf_key);
create index if not exists meal_logs_trending_meal_id_idx on meal_logs (trending_meal_id);

-- All nullable with no default: existing rows stay untouched and pre-attribution logs read as
-- "unknown" rather than being silently misfiled into a bucket they never came from.
