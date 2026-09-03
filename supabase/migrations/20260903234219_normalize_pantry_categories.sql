-- Coerce historical pantry categories onto the canonical STORE_CATEGORIES list.
--
-- The scan prompt gave the vision model no allowed-values list — only two EXAMPLES using "Dairy"
-- and "Carbs", neither of which exists in lib/categoryMatch.ts — so the model invented its own
-- vocabulary and it was written straight through. Measured 2026-09-03: 97 in-stock items on names
-- the app has no icon or colour for, which is why the pantry rendered as a column of grey boxes,
-- and why "Condiments", "Condiments & Spices" and "Spices & Seasonings" appeared as three separate
-- rows for overlapping food.
--
-- New writes are fixed at the source: the prompt now states the sixteen allowed values, and
-- addPantryItemsDeduped runs every row through normalizeCategory. This is the backfill.
--
-- Alias mapping only. normalizeCategory prefers the ITEM'S NAME over the alias table because the
-- name is the better signal, but reproducing that keyword matcher in SQL would be a second copy of
-- it drifting out of sync — the exact failure the matcher was extracted into its own file to avoid.
-- A historical row therefore gets a good bucket rather than a perfect one; anything genuinely
-- mis-binned is one tap to recategorise, and every NEW item gets the accurate answer.
UPDATE pantry_items SET category = CASE lower(trim(category))
  WHEN 'dairy'               THEN 'Dairy & Eggs'
  WHEN 'eggs'                THEN 'Dairy & Eggs'
  WHEN 'carbs'               THEN 'Grains & Pasta'
  WHEN 'grains'              THEN 'Grains & Pasta'
  WHEN 'protein'             THEN 'Meat & Fish'
  WHEN 'meat'                THEN 'Meat & Fish'
  WHEN 'condiments'          THEN 'Sauces & Condiments'
  WHEN 'condiments & spices' THEN 'Sauces & Condiments'
  WHEN 'sauces'              THEN 'Sauces & Condiments'
  WHEN 'spices'              THEN 'Spices & Seasonings'
  WHEN 'seasonings'          THEN 'Spices & Seasonings'
  WHEN 'pantry staples'      THEN 'Other'
  WHEN 'staples'             THEN 'Other'
  WHEN 'fruits'              THEN 'Produce'
  WHEN 'vegetables'          THEN 'Produce'
  WHEN 'fruits & vegetables' THEN 'Produce'
  WHEN 'drinks'              THEN 'Beverages'
  WHEN 'oils'                THEN 'Oils & Vinegars'
  WHEN 'canned'              THEN 'Canned & Jarred'
  WHEN 'nuts'                THEN 'Nuts & Seeds'
  WHEN 'bread'               THEN 'Bakery'
  ELSE 'Other'
END
WHERE category IS NULL OR category NOT IN (
  'Produce','Bakery','Meat & Fish','Dairy & Eggs','Frozen','Grains & Pasta','Legumes',
  'Canned & Jarred','Nuts & Seeds','Snacks','Sauces & Condiments','Spices & Seasonings',
  'Oils & Vinegars','Baking','Beverages','Other'
);
