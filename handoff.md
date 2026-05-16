# Handoff — Snap & Log cut, profile pipeline fixed, recipe templates wired

## TL;DR

This session closed the loop on the deterministic onboarding architecture (templates wired into persistence + backfill for legacy rows), shipped a real-pantry SVG illustration on the Home scan card, cut "Snap & Log with AI" from v1 per council vote, and fixed a chain of profile-data bugs that caused calorie/macro goals on Home to silently fall back to hardcoded defaults after onboarding reset.

**5 commits pushed to `main` since last handoff:**

| # | Commit | What |
|---|--------|------|
| 1 | [`56cf4d3`](https://github.com/loganmasonshaver/Pantry/commit/56cf4d3) | Plan reveal honors SGoalDelta wheel pick (not hardcoded ±10) |
| 2 | [`f3ab850`](https://github.com/loganmasonshaver/Pantry/commit/f3ab850) | Drop duplicate target date from plan reveal caption |
| 3 | [`511324e`](https://github.com/loganmasonshaver/Pantry/commit/511324e) | Wire recipeTemplates into onboarding persistence + lazy backfill |
| 4 | [`4095b96`](https://github.com/loganmasonshaver/Pantry/commit/4095b96) | Cut Snap & Log photo-to-macros from v1 (positioning over feature) |
| 5 | [`5f8f405`](https://github.com/loganmasonshaver/Pantry/commit/5f8f405) | Profile data silently lost after onboarding reset |

Previous session shipped 2 commits ([`91d8188`](https://github.com/loganmasonshaver/Pantry/commit/91d8188) goal-aware chart + plan-ready card, [`0007b7a`](https://github.com/loganmasonshaver/Pantry/commit/0007b7a) curated templates + pantry SVG visual).

---

## Architectural decision: Snap & Log cut from v1

Ran the council. 4 of 5 advisors voted cut. Chairman ruled cut. Reasoning:

> A camera-bracket on a cook-focused app blurs identity at the exact moment pre-launch positioning needs to be sharp. Going head-to-head with Cal AI's $50M/yr moat on their turf with an untuned GPT-4o vision wrapper is the fastest path to one-star "wrong macros" reviews — and those reviews tank the App Store ranking that Pantry's actual differentiator (pantry-scan → personalized meal planning) needs to get discovered.

**Implementation:** `ENABLE_AI_PHOTO_LOG = false` constant at top of [app/(tabs)/index.tsx](app/(tabs)/index.tsx). The green Snap & Log card on Home and the AILogModal mount are both gated behind it. Component, edge function (`estimate-meal-macros`), and modal code are all intact — flip the flag to `true` to bring it back in v2.

**New marketing positioning:** *the macro app for people who actually cook.* Home is now visually 100% cook-from-pantry: scan card + saved meals + manual log via FoodSearchModal. No camera-bracket ambiguity.

**V2 revival path:** logged in `~/my-briefing/todos/active.md` with the council reasoning, the flag location, and the Optimist's suggestion to add confidence ranges ("~420-510 cal") to differentiate from Cal AI's "hide the uncertainty" UX when reviving.

---

## Recipe templates fully wired

Previous session created `lib/recipeTemplates.ts` (94 entries, all images cached in Supabase Storage). This session WIRED IT INTO THE PERSISTENCE FLOW — last session's commit had stub `ingredients: [], steps: [], carbs: 0, fat: 0` left in `SPlanReveal`.

**Current flow:**

```
SPlanReveal mounts
├── pickRecipe() filters curated 94-meal bank by allergens/dislikes/skill/prep
├── For each pick: look up recipeTemplates[name]
├── Scale: ratio = userPerMealCal / template.base_calories
├── Apply scale to every ingredient's grams AND all 4 macros
└── Write COMPLETE meals to AsyncStorage

finish() at paywall
└── insert_saved_meal RPC → saved_meals row has real ingredients,
    real steps, scaled macros (not 0s)

Home/Saved tap a meal
└── meal/[id].tsx renders instantly from the saved row's data
```

**Defensive backfill** added to [app/meal/[id].tsx](app/meal/[id].tsx) — if ANY saved meal opens with empty `ingredients` or `steps`, look up the template by name and backfill at render time (scaled to the saved row's calorie count). Handles legacy rows from users who completed onboarding between the AI-removal commit (`0007b7a`) and the templates-wired commit (`511324e`).

**Verified:** all 94 unique recipe names in the curated bank have matching entries in `recipeTemplates.ts`. No name will ever fall through to the empty-data fallback for a new user.

---

## Profile pipeline fixes

Logan noticed: after reset onboarding, the calorie/macro goals shown on Home didn't match what the plan reveal screen displayed. Three independent bugs in one cascade:

### Bug 1: `finish()` did `.update()` on a deleted row (silent no-op)

`resetOnboarding` on Profile **deletes the profile row entirely** (`supabase.from('profiles').delete().eq('id', user.id)`). The subsequent onboarding's `finish()` then did `.update()` on a row that no longer existed. PostgreSQL returned 0 rows affected. Supabase didn't raise an error. Onboarding data silently vanished.

**Fix:** switched to `.upsert({...}, { onConflict: 'id' })` — recreates the row if missing.

### Bug 2: `finish()` never computed `carbs_goal` / `fat_goal`

Even for users who never reset, only `calorie_goal` and `protein_goal` got persisted. Home's macro card fell back to hardcoded `useState(250)` for carbs and `useState(80)` for fat — completely disconnected from the user's calorie target.

**Fix:** `finish()` now derives both from the calorie target:
- `fat_grams = (calories * 0.27) / 9` — 27% of calories from fat (within ISSN range)
- `carbs_grams = (calories - protein*4 - fat*9) / 4` — remainder after protein

A 1330 kcal cutter now sees **129g protein / 114g carbs / 40g fat** on Home — matching the plan reveal numbers, not random defaults.

### Bug 3: Home's profile fetch used `useEffect([user])`

Fires only when user identity changes. After `finish()` updated the profile and `router.replace('/(tabs)')` navigated back, Home was already mounted as a tab — the effect didn't re-fire. Even successful profile updates wouldn't reach the UI until next cold start.

**Fix:** swapped to `useFocusEffect` — re-runs every time Home gains focus. Post-finish navigation now immediately reflects the new values.

---

## Other polish shipped this session

- **SGoalDelta wheel-pick honored in plan reveal** ([`56cf4d3`](https://github.com/loganmasonshaver/Pantry/commit/56cf4d3)): SPlanReveal was reading `data.targetWeight` (set by STargetWeight) which lose/build users skip — it always showed ±10 lbs regardless of what they picked. Now reads `data.targetWeightDelta` for lose/build, falls back to `targetWeight` for maintain.
- **Duplicate target date** ([`f3ab850`](https://github.com/loganmasonshaver/Pantry/commit/f3ab850)): chart endpoint already labels target date. Caption no longer repeats it — shows just the duration ("~7 months").
- **Real pantry visual on scan card** (from `0007b7a` last session): 3 shelves with depth + 9 varied SVG items (jar, can, cereal box, oil bottle, tuna tin, egg carton, milk carton, jam jar, pasta box) + sweeping scan beam.
- **Scan card copy collapsed**: single confident headline ("Cook tonight without a store run." / "Unlock recipes built around what you already have.") instead of title+subtitle.

---

## Things to verify on device next session

1. **Reset → re-onboard end-to-end test:**
   - Profile → Reset Onboarding
   - Sign back in, walk through fresh with lose 30 lbs + specific height/weight/age
   - **Plan Reveal calories/protein numbers**: write them down
   - Get past paywall
   - **Home macro card numbers should match** (calories, protein, carbs, fat all consistent with plan reveal)
   - **Profile → goals row should match**

2. **Tap a saved onboarding meal:**
   - Should open instantly with real ingredients (scaled grams) + cooking steps
   - No "blank Tuna Poke Bowl" experience anymore

3. **Snap & Log card should be gone** from Home regardless of pantry state.

4. **All 3 goal variants** (lose / maintain / build):
   - Each goes through SGoalDelta correctly (maintain auto-skips)
   - STargetWeight auto-skipped for lose/build, shown for maintain
   - Plan reveal headline matches their goal ("burn fat" / "recomp your body" / "build muscle")
   - Plan reveal weight delta matches their wheel pick

---

## File pointers

- [lib/recipeTemplates.ts](lib/recipeTemplates.ts) — 94 entries, auto-generated, re-runnable via `/tmp/seed_recipe_templates.py`
- [app/onboarding/index.tsx](app/onboarding/index.tsx) — SPlanReveal template scaling at ~2600, finish() upsert + carbs/fat at ~3795
- [app/(tabs)/index.tsx](app/(tabs)/index.tsx) — `ENABLE_AI_PHOTO_LOG` flag at line 52, useFocusEffect profile fetch at ~463
- [app/meal/[id].tsx](app/meal/[id].tsx) — defensive template backfill in the mealData parse block (~line 432)
- [supabase/functions/seed-recipe-template/](supabase/functions/seed-recipe-template/) — temp one-shot admin function for seeding. **Delete after final seeding is done:** `supabase functions delete seed-recipe-template`

---

## Known limitations / v2 todos

- **Snap & Log** — logged in active.md with full revival instructions
- **Template quality** — what Gemini gave us. May need a manual taste-pass.
- **Linear macro scaling** preserves the template's protein ratio. Doesn't bias toward 45% protein for cutters specifically. Fine for v1 since the bank is high-protein authored.
- **94 unique recipes only** for onboarding — less variety than infinite AI generation, but consistent + curated. V2 candidates: expand bank, rate templates, expand SVG item set on scan card.
- **Pre-existing TS errors** at `app/onboarding/index.tsx:393` and `app/(tabs)/index.tsx:196/1064` (the `startsWith` ones) — not introduced this session, not blocking, but worth a future cleanup pass.

---

Branch: `claude/awesome-pare-0f1d0b` (all commits fast-forwarded to `main`)
