# Handoff — Pantry — 2026-07-06 (scan pipeline + meals + loading animation)

## TL;DR
Long session on **scan accuracy, meal quality, scan-review UX, and the scan loading animation.**
Everything committed + pushed to `main` (range `87a0e01..e81686c`). Two edge functions were
**deployed** (`scan-pantry`, `generate-meals`) and **one DB migration applied** to prod
(`profiles.staples_excluded`). TypeScript baseline held at **198 pre-existing errors** the whole
session (zero net new). The scanner drone animation is the newest, riskiest code and **still needs a
device-tuning pass**; the Phase-2 roll-down transition is not built yet.

---

## ⚠️ MUST DO BEFORE LAUNCH (carried over from prior handoff — verify)
- **Revert `SCAN_CAP_WEEK`** if it's still lifted for testing: `supabase secrets unset SCAN_CAP_WEEK`
  (reverts to safe default 7). Not touched this session — confirm its current value.

## What shipped this session (all on `main`, deployed where noted)

### Scan accuracy pipeline (`supabase/functions/scan-pantry/index.ts` — DEPLOYED)
- `temperature: 0` on the vision call (was defaulting to 1 = the "same photo, different results" cause).
- Confidence is now a **numeric 0–100** per item (was binary high/low), so the floor is tunable.
- **Model migrated gpt-4.1 → `gpt-5.4` at `detail: 'original'`** (full-res patches read small labels;
  gpt-4.1's tile tokenizer downscaled to 768px and shredded them). Eval on Logan's real photos:
  **82% recall vs 63%**. gpt-5.4 needs `max_completion_tokens` and **rejects a forced temperature**
  (we omit it). Gemini fallback keeps its classic params.
- **Second pass DISABLED** — gpt-5.4's single pass out-recalls the old two-pass, halving scan cost
  (~$0.10/scan, near incumbent). Vision timeout bumped 30s→60s for slow original-detail multi-photo.
- **`SCAN_CONFIDENCE_FLOOR` default = 30** (env-overridable in Supabase). The pantry-eval sweep showed
  everything <30 is vague blob-junk and no real ingredient dies until floor 40 → 30 with a buffer.
- **Prompt fixes:** stop inventing container/leftover placeholders ("covered pot of leftovers",
  "food in deli container") and hedged "A or B" names ("Lemon or orange") — name the food or skip it.

### Eval harness (`scripts/pantry-eval/run.mjs`) — needs OPENAI key to run (Logan ran it, not me)
- Hand-verified **ground truth for all 6 test photos** (`scripts/pantry-eval/images/`).
- Model A/B (recall + REAL measured $), and a `SWEEP` mode (confidence-floor tuning + temp-0
  consistency). Current lineup: gpt-4.1, gpt-5.4-mini, gpt-5.4 (gpt-4o removed — deprecated/404s).
  Verdict: **gpt-5.4 single-pass** = the pick. mini was cheap but collapsed on dense fridge shots.

### Meals (`supabase/functions/generate-meals/index.ts` — DEPLOYED; + client)
- Meal gen now **assumes a conservative staples baseline** (salt/pepper/oils, **butter, flour, sugar,
  full spice rack**) — cooking ENABLERS only, never meal-defining items (eggs/rice/produce/proteins,
  which must come from the scan). Fixed "fridge-only scan → impoverished meals."
- **Quality nudge:** "every meal must be genuinely delicious and cohesive, not a random assembly."
- **`staplesExcluded`** honored (user opt-outs). **Diet-aware auto-exclusion**: vegan/dairy-free → no
  butter, gluten-free → no flour (uses `dietary_restrictions`; deterministic, not model-reconciled).
- Shared list: `constants/staples.ts` (client) mirrored in the edge prompt — KEEP IN SYNC.
- **Recipe screen (`app/meal/[id].tsx`)**: ingredients now split 3 ways — YOU'LL NEED / IN YOUR
  PANTRY / **PANTRY BASICS · WE ASSUMED** (muted). Tapping a basic = "I don't keep this" → persists to
  `profiles.staples_excluded` and drops it to "you'll need". `useMealSuggestions` passes the exclusions.
- **Migration applied to prod:** `supabase/migrations/20260706000000_profiles_staples_excluded.sql`
  (`profiles.staples_excluded text[] default '{}'`).

### Scan review UX (`components/PantryScanModal.tsx`)
- Photo demoted to a **compact preview banner** (0.32→0.15 of screen) + auto-pans to the food (uses
  detected-item boxes) — a portrait fridge can't be shown big+whole next to chips; tap Zoom for full.
- **Count-up reveal fixed:** killed the fake live ramp (overshot on slow scans, crawled on short). No
  number while scanning; a fast fixed-duration count-up of the real total on results.
- **Removed the "Also have these? Tap to add" staples dropdown** (redundant now that meals assume
  basics). **Header** now leads with a bold **"N items found"** hero (was generic "Review your scan").
  Placeholder nudges real items ("e.g. chicken, spinach") not assumed basics.

### Scan LOADING animation (`components/ScanTheater.tsx` — NEW, Reanimated 4 + react-native-svg)
- Replaced the empty black scan-frame with a **floating scanner drone** (Halo-Monitor style): glowing
  orb + spinning halo ring + lens eye, casting a laser scan cone, drifting to a **new random vantage
  every ~5s in curved arcs** (X/Y eased on different curves), faint breadcrumb trail, ~3 spots/photo
  then floats to the next. Constant hover-bob + ring spin. Glides to center + "Scan complete" on results.
- **Built blind (I can't see the animation) — NEEDS A DEVICE-TUNING PASS.** Do a FULL reload
  (`npx expo start -c`), not Fast Refresh (it chokes on new Reanimated worklets — threw a stale
  "areaLabel doesn't exist" render error earlier that a clean reload fixed).

---

## NEXT / PENDING
1. **Tune the scanner drone on device** — robot-ness, curve strength, pacing (5s), cone/glow
   brightness (does the fridge read as "being scanned"?), trail faintness, random-spot variety.
2. **Phase 2 — teleprompter roll-down transition** (agreed, not built): on View Results, the scanned
   photo shrinks into the compact preview and the ingredient list rolls up from underneath as ONE
   connected page, **slow ~2.2s teleprompter pace**, with micro-animations: scan-line becomes the
   divider, count ticks up, shelf headers fade in, chips stagger in, green "processed" wash fades off.
3. **Dead-code cleanup** (harmless, left for a pass): in `PantryScanModal.tsx` the old count effects,
   `beamAnim`, `SCAN_STATUS_LINES`, `msgAnim`, `loadingMessageIdx`, `scanCount`/`topTitle` styles are
   now unused; the dropped dropdown left `addStapleChip`, `COMMON_STAPLES`, `STAPLES_BY_CONTAINER`
   unused.

## DECISIONS MADE (don't re-litigate)
- **Skipped Layer 2** (one-time cook-reveal primer) and **Layer 3** (manual bulk staples editor) —
  redundant/workarounds; **diet-aware assumed staples** closed the real gap instead.
- Scan photo = a preview you tap to zoom; the shelf-grouped chips are the review content.
- Confidence floor doesn't fix the "wall of junk" (junk is high-confidence duplicates) — the fix was
  the prompt (no containers/hedging) + numeric floor 30 for genuine blobs.

## OPEN BUSINESS QUESTIONS (from the margin/pricing discussion — undecided)
- **Pricing $7.99 → $9.99:** recommended to **A/B test in Superwall** (net revenue per trial-start),
  not blind-switch. Not decided.
- **Verify Apple Small Business Program enrollment (15%, not 30%)** — worth ~as much as the price hike;
  it's a checkbox in App Store Connect.
- **Meal generation is the biggest, UNCAPPED COGS** (text + image), bigger than scans for engaged
  users. A whale generating ~150+ meals/mo approaches margin-negative. Consider caching/soft cap.

## KEY FILES
- `supabase/functions/scan-pantry/index.ts` — vision scan (gpt-5.4, floor, prompt).
- `supabase/functions/generate-meals/index.ts` — meal gen (staples baseline, diet-aware, quality).
- `constants/staples.ts` — canonical assumed-staples list + `isAssumedStaple` + `dietExcludedStaples`.
- `components/PantryScanModal.tsx` — capture/review flow.
- `components/ScanTheater.tsx` — NEW loading drone animation (WIP).
- `app/meal/[id].tsx` — recipe screen with the "we assumed" tier.
- `lib/useMealSuggestions.ts`, `lib/meals.ts` — meal-gen client plumbing.
- `scripts/pantry-eval/` — model + confidence eval harness (needs API key to run).
