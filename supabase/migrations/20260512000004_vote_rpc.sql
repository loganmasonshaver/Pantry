CREATE OR REPLACE FUNCTION increment_vote_score(meal_id UUID, delta INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE trending_meals
  SET vote_score = vote_score + delta
  WHERE id = meal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_vote_score(UUID, INT) TO authenticated;
