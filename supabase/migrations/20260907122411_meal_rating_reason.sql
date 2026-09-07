-- Why the thumbs-down happened. Without it, every dislike teaches the generator the same lesson.
--
-- meal_ratings.rating = -1 feeds dislikedMeals, which the meal prompt injects as "do NOT suggest
-- these or anything similar". So a user reporting a WRONG PHOTO on a recipe they liked silently
-- deletes that recipe from their future, forever — and the photo, which is shared across every
-- user, never gets looked at. Two of the five things a thumbs-down can mean must not suppress the
-- dish at all.
--
-- Nullable on purpose: every rating already in the table predates the sheet and has no reason.
-- Those are read as suppressing, which is exactly what they do today, so existing users see no
-- behaviour change.
alter table public.meal_ratings add column if not exists reason text;

-- Which ingredients the user pointed at, when they said it tasted bad and then named the culprit.
-- One tap cannot distinguish "wrong ratio" from "I hate pineapple" from "these two do not go
-- together" — the follow-up can, and the count is itself the signal: one ingredient reads as a
-- disliked food, two or more as a combination that does not work.
alter table public.meal_ratings add column if not exists reason_ingredients text[];

-- Constrained so a client bug cannot quietly poison the routing: an unrecognised reason would fall
-- through every branch and suppress nothing. NULL stays legal for the rows above and for any app
-- build shipped before the sheet exists.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'meal_ratings_reason_check'
  ) then
    alter table public.meal_ratings add constraint meal_ratings_reason_check
      check (reason is null or reason in (
        'too_often',       -- suppress this dish, hard
        'photo_mismatch',  -- flag the shared image; dish untouched
        'recipe_wrong',    -- recipe bug; dish untouched
        'macros_fit',      -- their targets are off; dish untouched
        'taste'            -- suppress this dish, hard
      ));
  end if;
end $$;

-- Reading the flags is a query, not a screen — there is no admin surface and at this volume there
-- should not be. Photo flags on shared Discover rows are the ones worth acting on first:
--   select meal_name, count(distinct user_id) flags
--   from meal_ratings where reason = 'photo_mismatch' group by 1 order by 2 desc;
create index if not exists meal_ratings_reason_idx on public.meal_ratings (reason)
  where reason is not null;
