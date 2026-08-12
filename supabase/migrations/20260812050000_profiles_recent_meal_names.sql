-- Durable anti-repeat memory for meal generation. Previously the "don't suggest these again" list
-- lived only in device AsyncStorage (12 names ≈ 4 generations), so a user who spent their daily
-- rerolls flushed the whole window and saw yesterday's dinner again the next morning. A reinstall
-- or second device wiped it entirely.
--
-- Server-owned so the window survives the device, and so generate-meals can enforce the exclusion
-- in code instead of trusting the model to obey a prompt line.
alter table public.profiles
  add column if not exists recent_meal_names text[] not null default '{}';

comment on column public.profiles.recent_meal_names is
  'Most-recent generated meal names (newest first, trimmed to 30 by generate-meals). Read + written server-side only.';
