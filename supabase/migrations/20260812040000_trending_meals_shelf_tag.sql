-- One shelf per meal, assigned at extraction by the model.
--
-- Replaces regex-over-names shelving, which failed for a structural reason: it matched on
-- PROPERTIES (prep time, ingredient count, keyword presence) and properties overlap heavily. Audited
-- against the live pool, most meals satisfied 3-5 shelf rules at once — "Burger Bowl" matched five —
-- so which shelf a meal landed in was decided by the daily rotation, i.e. effectively at random, and
-- changed day to day. Character doesn't overlap the way properties do: a dish is one thing.
--
-- The vocabulary is fixed and deliberately MIXED. Cuisine alone covers only 43% of the catalog —
-- measured — because half of it is fitness-food constructs with no cuisine at all (cloud bread,
-- cottage cheese pancakes, protein bites, yogurt bowls). Vibe alone is fuzzier and harder for the
-- model to apply consistently. Mixing cuisine with format covers everything, and each meal still
-- gets exactly one, which is what keeps shelf membership stable.
--
-- Nullable: existing rows have no tag and fall through to the catch-all until they age out.
alter table trending_meals add column if not exists shelf_tag text;
create index if not exists trending_meals_shelf_tag_idx on trending_meals (shelf_tag);
