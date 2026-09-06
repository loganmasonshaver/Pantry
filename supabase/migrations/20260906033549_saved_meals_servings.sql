-- A saved multi-serving recipe forgets it is a batch.
--
-- Multi-serving recipes store macros PER SERVING and ingredients at FULL BATCH. The only thing
-- reconciling those two numbers is the line the detail screen prints above the ingredients:
-- "Makes N servings · macros are per serving". saved_meals has no servings column, so saving drops
-- N, the line disappears, and the user is left looking at a 4-egg ingredient list beside "278 cal"
-- with nothing to explain it. Nothing is corrupted — the stored calories are correct for one
-- portion and meal_logs is right — but on a macro app, correct numbers that look wrong cost the
-- same as wrong ones.
--
-- This is NOT new with multi-serving generated meals: 128 of 192 live trending_meals rows are
-- already multi-serving, so two thirds of everything a user can save has been affected all along.

alter table public.saved_meals add column if not exists servings integer not null default 1;

-- Recover the history rather than flattening it to 1. Matching on name is exact and
-- case-insensitive; a saved row whose recipe has since been replaced or renamed simply keeps its
-- default of 1, which is the pre-existing behaviour and never worse than it. Only rows still at
-- the default are touched, so re-running this is a no-op.
update public.saved_meals s
set servings = t.servings
from public.trending_meals t
where lower(btrim(s.name)) = lower(btrim(t.name))
  and coalesce(t.servings, 1) > 1
  and s.servings = 1;

-- CREATE OR REPLACE cannot add a parameter — it makes a SECOND overload and leaves the old one
-- live. That is the exact trap 20260904161200 had to clean up on this very function (and on
-- refund_scan and increment_vote_score before it), so drop first. Old app builds stay compatible:
-- the client calls with named arguments and p_servings defaults, so a 10-argument call still
-- resolves.
drop function if exists public.insert_saved_meal(
  uuid, text, integer, integer, integer, integer, integer, jsonb, jsonb, text
);

create function public.insert_saved_meal(
  p_user_id uuid,
  p_name text,
  p_calories integer,
  p_protein integer,
  p_carbs integer,
  p_fat integer,
  p_prep_time integer,
  p_ingredients jsonb,
  p_steps jsonb,
  p_image_url text default null,
  p_servings integer default 1
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COUNT(*) INTO v_count FROM saved_meals WHERE user_id = p_user_id;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'saved meal cap reached';
  END IF;

  INSERT INTO saved_meals (
    user_id, name, calories, protein, carbs, fat, prep_time,
    ingredients, steps, image_url, servings
  ) VALUES (
    p_user_id, p_name, p_calories, p_protein, p_carbs, p_fat, p_prep_time,
    p_ingredients, p_steps, p_image_url,
    -- A client sending null or 0 must land on 1, not on a row that divides by zero downstream.
    greatest(1, coalesce(p_servings, 1))
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Tightened while it is being recreated. The old grants included PUBLIC and anon, which the body's
-- auth.uid() check already made useless (anon has no auth.uid(), so every anon call raised
-- 'not authorized') — but the anon key ships inside the app bundle, and a SECURITY DEFINER writer
-- that takes the target account as a parameter should not be reachable by an unauthenticated role
-- at all. Defence in depth on the exact function whose unguarded overload was the vulnerability.
revoke all on function public.insert_saved_meal(
  uuid, text, integer, integer, integer, integer, integer, jsonb, jsonb, text, integer
) from public;
grant execute on function public.insert_saved_meal(
  uuid, text, integer, integer, integer, integer, integer, jsonb, jsonb, text, integer
) to authenticated, service_role;
