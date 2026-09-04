-- Records where a trending meal's macros came from, so the app can stop presenting a computed
-- number as if the creator stated it.
--
-- Found by reading two source videos on 2026-09-04. "Pepperoni Pizza Pasta" carries
-- @mealswithmax's own figures verbatim ("Approximately 540 calories and 48g protein per serving").
-- "Jello" carries numbers the creator never published — the description is an ingredient list and
-- five steps. In the database and in the app the two are indistinguishable. For a macro-tracking
-- app that is the difference between a source and a guess.
--
--   'creator'  — stated in the video description, used verbatim
--   'computed' — our own arithmetic over the creator's ingredient list (deterministic, auditable)
--   'model'    — neither could be trusted; the language model's own number
--
-- Existing rows are backfilled to 'model' rather than 'creator': every one predates the field, so
-- which of the three it was is unknown, and 'model' is the claim that overstates least.
alter table trending_meals add column if not exists macros_source text default 'model';
comment on column trending_meals.macros_source is
  'creator | computed | model — where the macro numbers came from. Backfilled to model for rows predating 2026-09-04.';
