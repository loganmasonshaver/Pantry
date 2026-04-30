-- Add meal_data jsonb column to store full meal details for re-opening logged meals
ALTER TABLE meal_logs ADD COLUMN IF NOT EXISTS meal_data jsonb;
