-- Red-team hardening pass. Each block closes a confirmed-exploitable hole found by an
-- adversarial audit of the anon-key + valid-account attack surface.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Vote stuffing — increment_vote_score was SECURITY DEFINER, granted to
--    `authenticated`, with NO auth check and NO bound on `delta`. Any user could
--    call rpc('increment_vote_score', { meal_id, delta: 1e9 }) directly via the
--    anon key and rocket their own recipe to the top of the trending feed (or bury
--    a rival). The client self-limits delta to {-1,0,1}, but the RPC trusted it raw.
--
--    Fix: back the score with a per-user ledger. Each (user, meal) gets ONE row
--    clamped to [-1,1]; vote_score is recomputed as the ledger sum. A user can now
--    shift a meal's score by at most 1 no matter what delta they send.
-- meal_id is TEXT to match trending_meals.id (a text PK, not uuid). The old RPC declared
-- its param as uuid, which mismatched the text id — so direct votes likely errored all
-- along (the client swallows the rejection). Drop that overload before recreating as text,
-- else PostgREST sees two increment_vote_score signatures and can't resolve the call.
DROP FUNCTION IF EXISTS increment_vote_score(uuid, int);

CREATE TABLE IF NOT EXISTS meal_votes (
  user_id  uuid     NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  meal_id  text     NOT NULL REFERENCES trending_meals(id) ON DELETE CASCADE,
  value    smallint NOT NULL CHECK (value BETWEEN -1 AND 1),
  PRIMARY KEY (user_id, meal_id)
);
-- RLS on, NO client policies: only the SECURITY DEFINER RPC below (which runs as
-- owner and bypasses RLS) may read/write the ledger. The anon key gets nothing.
ALTER TABLE meal_votes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_vote_score(meal_id text, delta int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Reject unauthenticated direct calls (the old version had no identity at all).
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Apply the client's transition as a clamped per-user vote. New value =
  -- clamp(existing + delta, -1, 1). Param is qualified as increment_vote_score.meal_id
  -- everywhere to avoid colliding with the meal_votes.meal_id column.
  INSERT INTO meal_votes (user_id, meal_id, value)
  VALUES (uid, increment_vote_score.meal_id, GREATEST(-1, LEAST(1, delta)))
  ON CONFLICT (user_id, meal_id)
  DO UPDATE SET value = GREATEST(-1, LEAST(1, meal_votes.value + delta));

  -- Recompute the public score from the ledger — never a running client-supplied total.
  UPDATE trending_meals t
  SET vote_score = COALESCE(
    (SELECT SUM(v.value) FROM meal_votes v WHERE v.meal_id = increment_vote_score.meal_id),
    0
  )
  WHERE t.id = increment_vote_score.meal_id;
END;
$$;
GRANT EXECUTE ON FUNCTION increment_vote_score(text, int) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. creators UPDATE policy had USING but NO WITH CHECK — a user could update their
--    own creator row to set user_id to a victim's UID or squat an affiliate_code,
--    because only the OLD row was ownership-checked, not the new values.
DROP POLICY IF EXISTS "Users can update their own creator profile" ON creators;
CREATE POLICY "Users can update their own creator profile"
  ON creators FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()); -- new row must still belong to the caller

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ingredient-images bucket: the INSERT policy was named "Service role insert" but
--    its WITH CHECK only tested bucket_id — and storage policies apply to anon/
--    authenticated (service_role bypasses RLS entirely and needs no policy). Net:
--    ANYONE, even unauthenticated, could upload arbitrary files to this public bucket
--    (malware/phishing hosting on your domain + storage cost). The edge function
--    writes with the service role, so dropping this removes all client write access.
DROP POLICY IF EXISTS "Service role insert ingredient images" ON storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. creator-recipes uploads (meal-images bucket): the UPDATE/upsert policy let ANY
--    authenticated user overwrite ANY object under creator-recipes/* (no owner check),
--    so a leaked photo URL could be defaced. Scope UPDATE to objects the caller owns.
--    Normal uploads use a fresh random-UUID filename (an INSERT), so this only blocks
--    overwriting someone else's existing object — it doesn't touch the happy path.
DROP POLICY IF EXISTS "Authenticated users can update creator recipe photos" ON storage.objects;
CREATE POLICY "Authenticated users can update creator recipe photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'meal-images'
    AND name LIKE 'creator-recipes/%'
    AND owner = auth.uid() -- can only overwrite your own uploads
  );
