-- Give Discover recipes the same three times Cook Tonight has: prep, cook, rest.
--
-- trending_meals held ONE prep_time and the extraction prompt never said what it meant, so the model
-- guessed per recipe. On 2026-09-10 the pool held both failure directions at once:
--   * the wait DROPPED — "Chocolate Oreo Protein McFlurry" freezes 16 hours and showed 10 min, and
--     "Protein Jello" refrigerates 24 hours and showed 15, both eligible for "Ready in 15";
--   * the wait COUNTED AS WORK — "Brownie Batter Protein Ice Cream" showed 1020 min for a 10-minute
--     blend, and "Strawberry Cheesecake Ice Cream" 240.
--
-- cook_time = unattended minutes the cook must stay for (a bake, a simmer, a Creami spin).
-- rest_time = detachable minutes they can walk away from (a freeze, a set, an overnight soak).
-- Both NULLABLE with no default: NULL means "stored before this existed, not yet backfilled", which is
-- a different fact from 0 ("measured: no wait"), and the backfill finds its work by looking for NULL.
-- `if not exists` so a partial apply is re-runnable (CLAUDE.md).

alter table trending_meals add column if not exists cook_time integer;
alter table trending_meals add column if not exists rest_time integer;
