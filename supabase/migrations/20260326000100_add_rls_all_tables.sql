-- RLS for all core tables
-- profiles (uses id = auth.uid(), not user_id)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can read own profile') THEN
    CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- pantry_items
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pantry_items' AND policyname = 'Users manage own pantry') THEN
    CREATE POLICY "Users manage own pantry" ON pantry_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- grocery_items
ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grocery_items' AND policyname = 'Users manage own groceries') THEN
    CREATE POLICY "Users manage own groceries" ON grocery_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- saved_meals
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saved_meals' AND policyname = 'Users manage own saved meals') THEN
    CREATE POLICY "Users manage own saved meals" ON saved_meals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- meal_logs
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meal_logs' AND policyname = 'Users manage own meal logs') THEN
    CREATE POLICY "Users manage own meal logs" ON meal_logs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- meal_ratings
ALTER TABLE meal_ratings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meal_ratings' AND policyname = 'Users manage own ratings') THEN
    CREATE POLICY "Users manage own ratings" ON meal_ratings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- weight_logs
ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'weight_logs' AND policyname = 'Users manage own weight logs') THEN
    CREATE POLICY "Users manage own weight logs" ON weight_logs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- image_cache (block anon/authenticated access, only service role can access)
ALTER TABLE image_cache ENABLE ROW LEVEL SECURITY;
-- No policies = no access via client keys. Service role bypasses RLS.
