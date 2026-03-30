-- Add carbs and fat columns to meal_logs
ALTER TABLE meal_logs ADD COLUMN IF NOT EXISTS carbs int4;
ALTER TABLE meal_logs ADD COLUMN IF NOT EXISTS fat int4;

-- Add carbs and fat goal columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS carbs_goal int4;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fat_goal int4;
