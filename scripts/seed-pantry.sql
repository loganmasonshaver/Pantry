-- Seed Logan's pantry with a diverse set of ingredients
-- Run in Supabase SQL Editor (Dashboard → SQL)
-- Enables meals across Italian, Mexican, Asian, Mediterranean, Indian, American cuisines

DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = 'loganmasonshaver@gmail.com' LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Clear existing in-stock items first (optional — comment out to keep existing)
  -- DELETE FROM pantry_items WHERE user_id = uid;

  INSERT INTO pantry_items (user_id, name, category, in_stock) VALUES
    -- Meat & Fish (proteins — critical for high-protein meals)
    (uid, 'chicken breast', 'Meat & Fish', true),
    (uid, 'ground turkey', 'Meat & Fish', true),
    (uid, 'salmon fillet', 'Meat & Fish', true),
    (uid, 'shrimp', 'Meat & Fish', true),
    (uid, 'ground beef', 'Meat & Fish', true),
    (uid, 'canned tuna', 'Meat & Fish', true),
    (uid, 'extra firm tofu', 'Meat & Fish', true),

    -- Dairy & Eggs
    (uid, 'eggs', 'Dairy & Eggs', true),
    (uid, 'greek yogurt', 'Dairy & Eggs', true),
    (uid, 'cottage cheese', 'Dairy & Eggs', true),
    (uid, 'whole milk', 'Dairy & Eggs', true),
    (uid, 'butter', 'Dairy & Eggs', true),
    (uid, 'cheddar cheese', 'Dairy & Eggs', true),
    (uid, 'mozzarella', 'Dairy & Eggs', true),
    (uid, 'parmesan', 'Dairy & Eggs', true),
    (uid, 'feta cheese', 'Dairy & Eggs', true),

    -- Produce — vegetables
    (uid, 'broccoli', 'Produce', true),
    (uid, 'spinach', 'Produce', true),
    (uid, 'kale', 'Produce', true),
    (uid, 'red bell pepper', 'Produce', true),
    (uid, 'green bell pepper', 'Produce', true),
    (uid, 'zucchini', 'Produce', true),
    (uid, 'yellow onion', 'Produce', true),
    (uid, 'red onion', 'Produce', true),
    (uid, 'garlic', 'Produce', true),
    (uid, 'cherry tomatoes', 'Produce', true),
    (uid, 'roma tomatoes', 'Produce', true),
    (uid, 'cucumber', 'Produce', true),
    (uid, 'carrots', 'Produce', true),
    (uid, 'avocado', 'Produce', true),
    (uid, 'romaine lettuce', 'Produce', true),
    (uid, 'mushrooms', 'Produce', true),
    (uid, 'asparagus', 'Produce', true),
    (uid, 'sweet potato', 'Produce', true),
    (uid, 'potato', 'Produce', true),

    -- Produce — fruits & herbs
    (uid, 'lemon', 'Produce', true),
    (uid, 'lime', 'Produce', true),
    (uid, 'banana', 'Produce', true),
    (uid, 'mixed berries', 'Produce', true),
    (uid, 'apple', 'Produce', true),
    (uid, 'fresh basil', 'Produce', true),
    (uid, 'cilantro', 'Produce', true),
    (uid, 'parsley', 'Produce', true),
    (uid, 'fresh ginger', 'Produce', true),
    (uid, 'scallions', 'Produce', true),

    -- Grains & Pasta
    (uid, 'jasmine rice', 'Grains & Pasta', true),
    (uid, 'brown rice', 'Grains & Pasta', true),
    (uid, 'quinoa', 'Grains & Pasta', true),
    (uid, 'whole wheat pasta', 'Grains & Pasta', true),
    (uid, 'rolled oats', 'Grains & Pasta', true),

    -- Bakery
    (uid, 'sourdough bread', 'Bakery', true),
    (uid, 'flour tortillas', 'Bakery', true),
    (uid, 'corn tortillas', 'Bakery', true),

    -- Legumes
    (uid, 'black beans', 'Legumes', true),
    (uid, 'chickpeas', 'Legumes', true),

    -- Canned & Jarred
    (uid, 'crushed tomatoes', 'Canned & Jarred', true),
    (uid, 'coconut milk', 'Canned & Jarred', true),
    (uid, 'chicken broth', 'Canned & Jarred', true),
    (uid, 'marinara sauce', 'Canned & Jarred', true),
    (uid, 'salsa', 'Canned & Jarred', true),
    (uid, 'hummus', 'Canned & Jarred', true),

    -- Sauces & Condiments
    (uid, 'low sodium soy sauce', 'Sauces & Condiments', true),
    (uid, 'sriracha', 'Sauces & Condiments', true),
    (uid, 'pesto', 'Sauces & Condiments', true),
    (uid, 'dijon mustard', 'Sauces & Condiments', true),
    (uid, 'hot sauce', 'Sauces & Condiments', true),
    (uid, 'tahini', 'Sauces & Condiments', true),

    -- Spices & Seasonings
    (uid, 'salt', 'Spices & Seasonings', true),
    (uid, 'black pepper', 'Spices & Seasonings', true),
    (uid, 'cumin', 'Spices & Seasonings', true),
    (uid, 'paprika', 'Spices & Seasonings', true),
    (uid, 'chili powder', 'Spices & Seasonings', true),
    (uid, 'italian seasoning', 'Spices & Seasonings', true),
    (uid, 'taco seasoning', 'Spices & Seasonings', true),
    (uid, 'curry powder', 'Spices & Seasonings', true),
    (uid, 'garlic powder', 'Spices & Seasonings', true),
    (uid, 'red pepper flakes', 'Spices & Seasonings', true),

    -- Oils & Vinegars
    (uid, 'olive oil', 'Oils & Vinegars', true),
    (uid, 'avocado oil', 'Oils & Vinegars', true),
    (uid, 'sesame oil', 'Oils & Vinegars', true),
    (uid, 'balsamic vinegar', 'Oils & Vinegars', true),
    (uid, 'rice vinegar', 'Oils & Vinegars', true),

    -- Baking
    (uid, 'honey', 'Baking', true),
    (uid, 'maple syrup', 'Baking', true),

    -- Nuts & Seeds
    (uid, 'sesame seeds', 'Nuts & Seeds', true),
    (uid, 'sliced almonds', 'Nuts & Seeds', true)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seeded pantry for user %', uid;
END $$;
