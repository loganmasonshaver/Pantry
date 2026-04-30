-- Server-side abuse cap on saved_meals inserts.
-- The free-tier 5-meal cap is enforced client-side (UX) — a determined user could
-- bypass by hitting the RPC directly. This adds a hard 50-meal ceiling for everyone
-- to prevent storage abuse. Proper premium-aware enforcement (free=5, paid=unlimited)
-- requires a Superwall webhook → is_premium column, which is post-launch work.

CREATE OR REPLACE FUNCTION insert_saved_meal(
  p_user_id uuid,
  p_name text,
  p_calories int,
  p_protein int,
  p_carbs int,
  p_fat int,
  p_prep_time int,
  p_ingredients jsonb,
  p_steps jsonb,
  p_image_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    ingredients, steps, image_url
  ) VALUES (
    p_user_id, p_name, p_calories, p_protein, p_carbs, p_fat, p_prep_time,
    p_ingredients, p_steps, p_image_url
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
