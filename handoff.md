# Handoff — Pantry — 2026-08-12 (Discover rebuild, recipe fidelity, allergen safety)

## TL;DR
**41 commits, all pushed to `main`** (`9cfcb95..3d775a3`). Working tree clean, all migrations
applied, every edge function deployed at or after its last source commit — verified with
`bash scripts/preflight.sh`.

Three themes: the onboarding plan reveal was rebuilt Cal AI-style, Discover was rebuilt from a
one-rail feed into a sectioned browse surface, and a chain of **recipe-fidelity and allergen-safety
bugs** was found and fixed. TS baseline moved 197 → 206 (entirely new edge-function files joining
the ~15 Deno files tsconfig already errors on; app code added zero).

---

## 🔴 THE ONE THING TO DO FIRST

**Re-run the trending generation.** The last run aborted (correctly) and Discover is serving a stale
pool. The fix for the abort is deployed but unproven.

```sql
SELECT net.http_post(url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1)), body := '{}'::jsonb);
```

Then read Edge Function logs for:
- `[funnel] ingredient-list gate: N/150` — should be **~40+**. It was 17/60 before the ordering fix.
- `[funnel] ingredient retention "<meal>": X/Y` — must be `N/N`. Anything short is rejected.
- `[stage] pool ranked + capped: storing N` — needs **≥6** or the run aborts again.

If it aborts again, the lever is **more candidates or better parser precision — never a looser
retention threshold.** Logan's requirement is 100% retention, no tolerance band.

---

## Recipe fidelity — the big find

Audited stored recipes against their source YouTube descriptions. **Only ~52% of the creator's
listed ingredients survived extraction.** Not just seasonings:

| Meal | Source → Stored | Lost |
|---|---|---|
| Soya Potato Masala | 14 → 4 | ghee, onion, green chilli, cumin |
| Gnocchi Chicken Sheet Pan | 12 → 4 | a whole eggplant, garlic, olive oil |
| Red Pesto Chicken Gnocchi | 13 → 5 | 2 bags spinach, 2 cups mozzarella |
| Burger Bowl | 22 → 4 | the entire burger sauce, tomato, pickles, lettuce |

This is not cosmetic — it damages taste, understates calories (2 cups of mozzarella ≈ 450 kcal),
and **is the mechanism behind the allergen bug below**.

**Fixed by removing the model's discretion:** the creator's list is parsed mechanically out of the
description and handed over as a contract. Any recipe returning fewer entries than its source list
is **rejected outright** (`050744c`). Videos without a readable list never enter the pool.

**Cost:** only **28%** of raw candidates have a parseable list, so the gate discards ~72%.
Compensated by gating *before* the 60-video cap and raising `maxResults` 20 → 50 (`3d775a3`).

⚠️ **I twice reported optimistic parser-coverage numbers that were wrong** — first from mojibake in
my test cache, then from survivorship bias (measuring descriptions of meals already extracted
successfully). **28% is the real rate.** Don't trust a coverage figure that wasn't measured on raw
candidates.

---

## 🔴 Allergen safety — was actively wrong, now fixed

`passesDietTags` treats `is_dairy_free === true` as safe, so mis-tagged meals were shown to users
who had asked to avoid that allergen. Two independent failure modes, both fixed:

1. **Dropped ingredient** — "Parmesan-Crusted Chicken Sheet Pan" tagged dairy-free because parmesan
   never made it into the ingredients array, despite being in the dish's name. Fixed: tags now scan
   **name + ingredients + steps** (`bc32d98`).
2. **Compound ingredient** — "pesto" contains no dairy keyword, so pesto dishes read as dairy-free
   *and* nut-free; gnocchi and teriyaki read as gluten-free. Fixed: compound-food keyword list, plus
   the **LLM answers `contains_dairy/gluten/nuts` directly and is ANDed with the keyword scan** —
   a meal is "free" only if both agree (`bc31a62`).

**Meal detail now states what was checked, never that it's safe:** *"No dairy in the listed
ingredients. Always check the full recipe before cooking."* That sentence stays true even when the
list is incomplete; "Dairy-free" is a promise the data can't keep.

**Still open (Logan's call):** nut-free is treated identically to dairy/gluten in the filter UI.
Dairy wrong is unpleasant; nuts wrong is a medical event. Worth deciding before launch.

---

## 🔴 Security — trending_meals accepted anon writes

Discovered by accident: a DELETE succeeded using nothing but the **public anon key**, which ships in
the app bundle. Anyone could have wiped Discover for every user.

Locked down in `20260812030000_trending_meals_rls_lockdown.sql` — **applied and verified** (INSERT
now returns `42501`, reads still work). Public SELECT; writes limited to authenticated creators on
their own rows. Cron unaffected (service_role bypasses RLS); voting unaffected (SECURITY DEFINER RPC).

⚠️ I initially reported INSERT and UPDATE as also open. **Only DELETE was confirmed** — the other
probes were inconclusive (a 204 on a nonexistent id, and a schema error that fires before RLS).

---

## Discover — rebuilt

- **Retention 7 → 30 days** on both sides (pipeline `RETENTION_DAYS` and client
  `YOUTUBE_VISIBLE_DAYS`, each commented to point at the other — they had already silently drifted
  3 vs 7, which was throwing away most of the pool).
- **Horizontal rail deleted.** It consumed the entire daily batch (10 slots vs 8-15 meals/day),
  starving the grid section beneath it. One scroll direction now; the hero is the only display moment.
- **Shelves are model-assigned** via `trending_meals.shelf_tag`, one per meal, from a fixed
  vocabulary mixing cuisine and format. Regex shelving failed structurally: it matched *properties*,
  which overlap (Burger Bowl matched 5 rules), so membership was decided by the daily rotation.
  Cuisine alone covers only 43% — the catalog is bimodal (real cuisines vs fitness-food constructs).
- **Name-based fallback tag** covers 81% of existing untagged rows so the page doesn't collapse into
  the catch-all during the 30 days before old meals age out.
- **First-shelf-wins**: each section claims only meals earlier ones didn't take, so no duplicates.
- Personalised shelves (**Almost in your kitchen · Because you cooked X · Fits your remaining kcal**)
  pinned on top, capped at 8, accent-coloured headers. Each self-activates from that user's own data.
- `GRID_PAGE` 6 for curated shelves, 24 for the catch-all.

---

## Analytics — Phase 0 shipped (`a9af415`)

`meal_logs` gained `source`, `shelf_key`, `shelf_position`, `trending_meal_id`; `meal_ratings`
gained `trending_meal_id`. Impressions fire on **viewport entry, not render**. Without these, "of
the meals shown in shelf X, what fraction got cooked?" is unanswerable and all of Phase 2 is
unbuildable. `trending_meal_id` is deliberately **not** a foreign key — retention deletes
`trending_meals` rows and `ON DELETE SET NULL` would erase the attribution.

Planning docs: `PLAN-discover-personalization.md`, `PLAN-onboarding-reveal.md`.

---

## Other fixes worth knowing
- **Onboarding plan reveal** rebuilt as a 7-block scrolling argument (`08a75bf`, `37ec90b`). Step 17
  retired into it. `deriveMacros()` extracted so the reveal and `finish()` can't disagree.
- **Home hero** now measures its own fit (`fe818b6`) rather than a hand-tuned height.
- **Food search**: `pickDefaultServing()` — searching "milk" showed 3g protein because the default
  was FatSecret's 100g entry. Now household servings, in the results list too, via `foods.search.v3`.
- **Trending quality**: 100k view floor (median went ~5k → 1.1M), like-rate ranking (the 7.2M-view
  chia pita had the *worst* like rate at 1.17%), format cap, near-duplicate rejection at Jaccard 0.7.
- **`servings` column** — recipes were being scaled to one portion, producing "0.5 large eggs".
- **Health-check cron** at 05:20 UTC pushes to `OPS_USER_ID`'s device if a day generates <12 meals.
  ⚠️ **Unverified whether `OPS_USER_ID` was ever set** — if not, the alert is a silent no-op.

## Landmines
- **TS baseline = 206.** Watch the *delta*, not the total — ~130 are Deno-global noise from edge
  functions in the tsconfig. A `+1` caught a real `ReferenceError` this session.
- **`app/onboarding/index.tsx` is still the #1 bug source.** Any change → full write-back test.
- **Image cache is immutable** — deterministic filename, so a bad image can't be regenerated away.
- **Nothing this session is device-verified beyond what Logan checked live.**
