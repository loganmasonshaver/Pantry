-- Assumed-staples opt-out. Basics the user tapped "I don't keep this" on, so meal generation stops
-- assuming them and the recipe screen moves them from "basics we assumed" to "you'll need".
-- Default empty array = assume the full staples baseline (the common case, zero setup).
alter table public.profiles
  add column if not exists staples_excluded text[] not null default '{}';
