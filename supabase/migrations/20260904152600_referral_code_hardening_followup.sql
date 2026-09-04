-- FOLLOW-UP to 20260904151500, which reported success and changed NOTHING.
--
-- That migration ran `update referral_codes set active = false where code = 'PANTRY_CREATOR'`,
-- taken from the seed in 20260512000000_promo_codes.sql. Production actually holds
-- 'PANTRY_CREATOR!' — trailing exclamation mark, edited in the dashboard at some point and never
-- reflected back into a migration. The UPDATE matched zero rows, `supabase db push` printed
-- "Finished", and the live premium bypass stayed active and unlimited.
--
-- Caught only because the effect was queried afterwards instead of trusting the exit code. The
-- repo is not the source of truth for this table's DATA; only for its shape.
--
-- Note the leaked value is still the guessable half: the published string plus one character.

-- Deactivate by stem, not by exact literal, so a further dashboard edit of the same code cannot
-- slip past this the way the exact match just did. `_` is a single-char LIKE wildcard here, which
-- is harmless — it can only match the same family of internal codes.
update referral_codes
   set active = false
 where grants_premium and active and upper(code) like 'PANTRY_CREATOR%';

-- Pinned with the LIVE signatures read from pg_proc. The previous attempt guessed them from the
-- repo migration and silently hit the `undefined_function` guard: production's insert_saved_meal
-- takes numeric protein/carbs/fat and has no p_image_url, so the repo's version is not what is
-- deployed. handle_new_user was never in a migration at all — it is the dashboard-created auth
-- trigger that inserts a profiles row on signup, and it runs as definer on every new account.
alter function public.insert_saved_meal(
  p_user_id uuid, p_name text, p_calories integer, p_protein numeric, p_carbs numeric,
  p_fat numeric, p_prep_time integer, p_ingredients jsonb, p_steps jsonb
) set search_path = public;

alter function public.handle_new_user() set search_path = public;
