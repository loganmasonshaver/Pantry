-- Add image_url to saved_meals so trending meal images persist when saved
-- (previously saved meals re-generated a new image via generate-meal-image)

ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Update the insert RPC to accept + store the image URL
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
BEGIN
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
