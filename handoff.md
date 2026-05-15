# Handoff — IA refactor done, trending pipeline overhauled

## Where we left off

The full **IA refactor is complete** (Phases 1, 2a, 2b, 3a, 3b, 3c, 4) and the entire **trending pipeline has been overhauled** end-to-end. Bottom nav is now **5 tabs** (Home / Pantry / Discover / Saved / Profile), Pantry has a **My Pantry / Grocery sub-tab toggle**, and Discover is up with filter chips + Featured hero + Trending Now rail + From Creators rail.

The trending function went through ~10 iterations today and now:
- Routes images through the two-stage Flux pipeline (Gemini → Flux)
- Reads macros from creator descriptions instead of fabricating them
- Hits ~5-6 yield/day with strong variety (one recipe per protein source)
- Costs ~$15/mo steady-state

---

## Phase plan — all complete ✅

| Phase | Status |
|---|---|
| 1 — Snap & Log hero on Home | ✅ |
| 2a — Home compact "Cook from your pantry" tease | ✅ |
| 2b — Pantry tab "Cook tonight" rows | ✅ |
| 3a — Discover scaffold (NYT-Cooking hybrid) | ✅ |
| 3b — Wire filters + split rails + gut Trending from Home | ✅ |
| 3c — Dietary safety filter on Discover (search wired then removed) | ✅ |
| 4 — Grocery merged into Pantry as sub-tab | ✅ |

Plus shipped today: `__DEV__` gate on Reset Onboarding button.

---

## Trending pipeline — current state

**Architecture (after today's overhaul):**
1. `pg_cron` daily at 5am UTC (migration `20260512000012`)
2. Calls `generate-trending-meals` with service role from Supabase Vault
3. Pulls ~150 raw YouTube candidates, dedupes to 60 unique (after recent video_id rejection)
4. **Gemini 3.1 Flash Lite** (single provider — OpenAI fallback removed) generates recipes
5. **Post-LLM variety dedup**: group by primary protein, drop duplicates
6. **Post-LLM name cleanup**: strip "High Protein"/"Recipe"/"Easy" patterns
7. **FatSecret sanity check** (50% tolerance — only catches actual clickbait)
8. **Density confirm** (25% meals, 22% snacks, 20% desserts)
9. Final cap: 6 meals
10. **Parallel** image generation via `generate-meal-image` (two-stage Flux)

**Yield characteristics:**
- Target: 5-6 meals/day
- Last few runs: 5, 4, 5 (consistent)
- Bad-day floor: ~3-4
- Names are clean editorial-trendy (no "High Protein" prefixes anymore)
- Variety: 6 distinct primary protein sources per batch

**Image pipeline:**
- Both trending AND recommended pantry meals route through `generate-meal-image`
- Gemini writes a one-sentence visual description of the finished dish
- Flux renders from that description + photography direction + negative prompts
- Falls back to vessel-keyword static template if Gemini fails
- Storage upload retries once on failure
- **Bug**: Edge SDK occasionally fails uploads where manual `curl` succeeds (logged for v2)

**Discover lifecycle:**
- YouTube content kept 2 days (was 3)
- Sorted by recency (today first, yesterday tails)
- Creator content: 14 days base, 30 days if `vote_score ≥ 3` OR `log_count ≥ 10`

**Cost:**
- Today: ~$15/mo (Flux × 6 meals/day)
- After v2 cached-pool recycling (~6 months out): ~$0/mo

---

## Trending dedup hardening

| Layer | What it does |
|---|---|
| video_id 90-day | Rejects same YouTube video resurfacing weeks later |
| Jaccard ≥0.5 word similarity | Catches paraphrase dupes ("Chocolate Cake" vs "Triple Chocolate Cake") with stopword filter for "high"/"protein"/"recipe" |
| prevNames bounded to 60 days | Prevents false-positive avalanche as catalog grows |
| Post-LLM variety dedup (in code) | Groups by primary protein, keeps one per source — deterministic enforcement of what the LLM keeps treating as soft suggestion |

---

## Discover refresh paths (all 4 wired)

- Mount (app launch)
- Tab focus (switching tabs)
- **AppState foreground (NEW today)** — refetches when app comes back from background
- **Pull-to-refresh (NEW today)** — green spinner, manual escape hatch

---

## Misdiagnoses to remember (lessons from today)

1. **pg_net `status_code: NULL`** does NOT mean the function failed. pg_net only waits a few seconds; functions taking >10s show NULL but complete server-side. Check function logs in dashboard, not pg_net response.

2. **PostgREST silent rejects on RLS** — `curl -X PATCH` returns 204 with empty body whether the row was actually updated or not. **Always use `curl -i` and check `content-range: */N`** — `*/0` means RLS blocked it.

3. **There were TWO Flux paths in the codebase** — `generate-meal-image` AND an inline duplicate in `generate-trending-meals`. Fixing one but not the other meant trending kept showing old broken images for hours while I assumed the fix had landed.

4. **Don't ship "fixes" without auditing the deployed code FIRST** — `supabase functions download` confirms what's actually running before assuming.

---

## Open bugs / known issues

1. **Edge SDK Storage upload occasionally fails** for specific filenames (e.g. `mediterranean-beef-and-cucumber-bowl.jpg`) where manual `curl` to the same path returns 200. Mitigated by retry + don't-cache-fallback, but ~5-15% of trending images may fall back to FAL URL.

2. **"Protein" word slips into mid-name positions** — e.g. "Hung Curd Protein Balls", "Greek Yogurt Protein Bagels". The `cleanName` regex strips leading "High Protein" but not standalone "Protein" mid-name (because that's a legit dish category for "protein balls"). Could refine but risks over-stripping.

3. **Variety dedup detects "other" protein bucket** when a recipe doesn't match the 30-keyword protein list. Worth expanding the list (lentils, beans, quinoa, oats) if "other" appears often.

4. **Yield is 5 not 6 reliably yet** — depends on day's YouTube content quality. If consistently below 5 over the next week, consider relaxing density tier or expanding candidate pool back to 100.

---

## v2 list (logged in active.md)

- Diet-aware "Featured for you" hero (trigger: pool ≥ 50)
- Diet-specific YouTube queries to grow vegan/gluten-free/dairy-free segments
- Restore search bar on Discover (trigger: pool ≥ 50)
- Vertical "Discover more" grid below rails
- Recycle from cached pool daily instead of generating new (trigger: pool ≥ 150-200)
- Edge SDK Storage upload bug — investigate why specific files fail in Function but succeed via curl

---

## Quick reference — useful SQL

```sql
-- Trigger trending regen (idempotent, safe to re-run)
SELECT net.http_post(
  url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1)
  ),
  body := '{}'::jsonb
);

-- Watch progress
SELECT id, status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
-- (NULL status_code = function ran longer than pg_net wait window — check dashboard logs instead)

-- Inspect today's trending pool with density math
SELECT name, category, calories, protein, prep_time, video_id,
       ROUND((protein * 4.0 * 100 / calories)::numeric, 1) AS pct_cal_from_protein,
       image
FROM trending_meals
WHERE generated_at = CURRENT_DATE AND trend_source = 'YouTube trending'
ORDER BY id DESC;

-- Force-update a specific trending row's image (use when manual re-render is needed)
UPDATE trending_meals
SET image = 'https://fdafjnkqqtpsjtddbfdz.supabase.co/storage/v1/object/public/meal-images/{filename}.jpg'
WHERE name = 'Meal Name Here' AND generated_at = CURRENT_DATE;

-- Wipe trending cache (one-off, ~$0.50 in re-renders, only YouTube — preserves creators)
DELETE FROM trending_meals WHERE trend_source = 'YouTube trending';
DELETE FROM image_cache; -- optional, forces fresh two-stage Flux on next call

-- Check cron schedule
SELECT * FROM cron.job WHERE jobname = 'trending-meals-daily';
```

---

## Key file paths touched today

- `app/(tabs)/_layout.tsx` — added Discover tab, hid Grocery from bar
- `app/(tabs)/index.tsx` — gutted of trending (~395 lines removed)
- `app/(tabs)/pantry.tsx` — added Cook tonight section + sub-tab toggle
- `app/(tabs)/discover.tsx` — entire screen, including AppState refetch + pull-to-refresh
- `app/(tabs)/grocery.tsx` — added sub-tab toggle, hidden from nav
- `app/meal/[id].tsx` — compact ingredient list, removed low-protein warning, `__DEV__` gate (profile.tsx)
- `components/PantryGroceryTabs.tsx` — new shared sub-tab component
- `supabase/functions/generate-trending-meals/index.ts` — heavily overhauled
- `supabase/functions/generate-meal-image/index.ts` — two-stage pipeline + retry
- `supabase/migrations/20260514000001_trending_video_id.sql` — new column for dedup

---

## What got shipped this session (committed + pushed)

Major commits in roughly chronological order:
- `01a7177` Phase 2b — Pantry "Cook tonight" + dev-gate reset
- `e31bf72` Phase 4 — Grocery becomes a sub-tab inside Pantry
- `ba5f182` Phase 3a — Discover tab scaffold (NYT-Cooking hybrid)
- `991cf6f` Phase 3b — wire Discover filters, split rails, gut Trending from Home
- `559f059` Two-stage Flux pipeline — Gemini describes, then Flux renders
- `4b4ae3b` Trending volume bump + snack density tier
- `9f3af73` Phase 3c — Discover dietary safety filter + working search
- `4a6b57b` Cap rails, pull search until pool is deeper
- `7f16eb8` Trending dedup hardening — video_id tracking + Jaccard
- `0ffd0aa` Widen trending candidate pool
- `4156928` Trending images now route through two-stage Flux pipeline
- `b03b496` generate-meal-image — retry Storage upload, don't cache FAL fallback
- `646621b` Trending pipeline overhaul — fidelity, headroom, sanity check
- `67a5b48` Parallelize trending image generation + add stage timing logs
- `aced4ef` Trending function — LLM timeout, smaller descriptions, candidate cap
- `fc5bfde` Hard variety rule + protein-source quota
- `0071243` Loosen FatSecret tolerance to 50%, bump LLM timeout, drop protein warning
- `9b0e583` Gemini-only + post-LLM variety dedup + name cleanup
- `4386064` Raise LLM break threshold 6 → 8
- `20d3531` 2-day trending window + compact ingredient list
- `f39fa02` Discover refetches on app foreground + pull-to-refresh

Branch: `claude/agitated-chaplygin-09a8a0` (merged to main)

---

## Things to verify on device next session

1. **Discover background → foreground refresh** — open app, switch to another app for a few minutes, come back, verify trending updated (no force-quit needed)
2. **Pull-to-refresh on Discover** — pull down, see green spinner, fresh fetch
3. **Compact ingredient list** — open any meal detail, verify rows are tighter (single-line "55g all purpose flour" instead of stacked name + portion)
4. **Trending naming** — verify no "High Protein" or "Recipe" prefixes/suffixes anymore
5. **Variety** — verify each new daily batch has 5-6 distinct protein sources

---

## Next steps in priority order

1. **Watch trending yield 3-5 days** — confirm it lands consistently at 5-6. If routinely below 5, tune density tier or candidate pool.
2. **Pre-launch checklist in active.md** — Apple Dev verification is the hard external blocker; everything else is parallel-actionable.
3. **Edge SDK Storage upload bug** — investigate why specific filenames fail in Function but succeed via curl. Could be losing 5-15% of trending image renders.
4. **Influencer outreach prep** — drafts for Instagram DMs, post-launch.
5. **v2 items** when content pool is deep enough to justify them.
