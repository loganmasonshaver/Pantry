ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS is_user_created boolean DEFAULT false;
