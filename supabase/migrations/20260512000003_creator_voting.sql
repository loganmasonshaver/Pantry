-- Link creators to auth users so promo users can self-submit
ALTER TABLE creators ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS creators_user_id_idx ON creators(user_id);

-- Vote score on trending meals (upvotes - downvotes)
ALTER TABLE trending_meals ADD COLUMN IF NOT EXISTS vote_score INT NOT NULL DEFAULT 0;

-- Promo users can insert their own trending meals (must link to their creator record)
CREATE POLICY "Creators can insert their own trending meals"
  ON trending_meals FOR INSERT
  WITH CHECK (
    creator_id IN (
      SELECT id FROM creators WHERE user_id = auth.uid()
    )
  );

-- Promo users can read their own creator record
CREATE POLICY "Users can read their own creator record"
  ON creators FOR SELECT
  USING (user_id = auth.uid() OR is_active = true);

-- Promo users can insert a creator record for themselves
CREATE POLICY "Users can create their own creator profile"
  ON creators FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Promo users can update their own creator record
CREATE POLICY "Users can update their own creator profile"
  ON creators FOR UPDATE
  USING (user_id = auth.uid());

-- Anyone can update vote_score on trending meals (authenticated)
CREATE POLICY "Authenticated users can vote on trending meals"
  ON trending_meals FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
