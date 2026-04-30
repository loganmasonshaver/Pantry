-- Add category tagging to trending_meals so users can see snacks and desserts
-- alongside full meals. Values: 'meal' | 'snack' | 'dessert'.
ALTER TABLE trending_meals ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'meal';
