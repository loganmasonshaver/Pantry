-- M5 #5: enforce one creator profile per user at the database level.
-- The client only ever creates a creator row for the signed-in user, but without a
-- server constraint a retry/race could insert duplicate profiles for the same user_id
-- (and there's no app-level guard that survives concurrent requests).

-- Step 1: repoint any trending_meals attributed to a duplicate creator row onto the
-- earliest creator row for that user, so removing dupes below never orphans a meal.
WITH ranked AS (
  SELECT id, user_id,
         first_value(id) OVER (PARTITION BY user_id ORDER BY created_at, id) AS keep_id
  FROM creators
  WHERE user_id IS NOT NULL
)
UPDATE trending_meals tm
SET creator_id = r.keep_id
FROM ranked r
WHERE tm.creator_id = r.id AND r.id <> r.keep_id;

-- Step 2: delete the duplicate creator rows, keeping the earliest per user.
DELETE FROM creators c
USING (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM creators
  WHERE user_id IS NOT NULL
) d
WHERE c.id = d.id AND d.rn > 1;

-- Step 3: enforce uniqueness going forward. Partial index (user_id IS NOT NULL) so
-- admin-created affiliate creators with no linked user can still coexist — Postgres
-- would treat their NULLs as distinct anyway, but the WHERE makes the intent explicit.
CREATE UNIQUE INDEX IF NOT EXISTS creators_user_id_unique
  ON creators(user_id) WHERE user_id IS NOT NULL;
