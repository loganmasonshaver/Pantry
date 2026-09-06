-- Per-USER meal structure, not per-day.
--
-- Home rebuilt its slot list from meal_logs rows on every refetch, plus three hardcoded defaults.
-- "+ Add Meal" only pushed into React state, so a custom slot with nothing logged in it vanished on
-- the next day change, tab focus, pull-to-refresh or foreground — the slot only ever existed
-- through its own log rows.
--
-- A day's structure is a property of the USER, not of Tuesday: someone eating six times should not
-- recreate "Meal 4" every morning. MyFitnessPal treats meal names the same way — a persistent,
-- customisable setting, up to six.
--
-- Default is FOUR, not three. Snacks is the pressure valve: it absorbs everything that is not a
-- main meal, so most users never customise at all and the 3-vs-4-vs-6 question mostly disappears.
alter table public.profiles
  add column if not exists meal_slots text[] not null default '{Breakfast,Lunch,Dinner,Snacks}';

comment on column public.profiles.meal_slots is
  'Ordered meal slot names for this user. Home renders these every day. Historical slots found in meal_logs but absent here are still displayed, so renaming or removing one never hides past data.';
