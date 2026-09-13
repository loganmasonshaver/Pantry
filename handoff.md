# Handoff — 2026-09-13 (afternoon)

Replaces the 2026-09-10 handoff. `git log 61b9c06..HEAD` carries the reasoning for every commit since.
**The to-do list is `docs/PRELAUNCH.md`, and only PRELAUNCH.** This file holds order, decisions not to
reopen, and mechanisms. Logan switched chats mid-issue; start where §1 says.

**State:** everything committed and pushed; `generate-meals` deployed at the tip; migration
`20260912061834_cook_tonight_report_line` applied. **TS baseline 135 / 16 app-code. 567 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). The 9 untracked Higgsfield skill dirs
are another session's — leave them. Metro: Logan's runs on **8082** (the Sep 7 one on 8081 was killed);
if the phone cannot connect, Ctrl+C and `npx expo start` from `/Users/loganshaver/pantry`.

**Pre-launch, no users.** Logan is the only person who has used the app.

---

## 0. UPDATE 2026-09-13 evening — read this before §1
§1 items 2 and 3 are DONE (image cache keyed on name + ingredient fingerprint, `bef4170`; knife work
named on the ingredient line, `f8baf8b`); item 1 was left as is by Logan. PRELAUNCH §0 (Discover) has
its root causes found and deployed — the retention count collapsed split lines, attempts are now
unioned and rotated — with PASS pending two scheduled runs ≥ 12 (Sep 14, 15). Tests 588. YouTube quota
used 4/7 on Sep 13. Everything below §0 is the state as it was at the chat switch.

## 1. FIRST — Logan's words: "this issue needs to be addressed first" *(items 2-3 done, see §0)*

The **Egg White and Vegetable Scramble** on his phone (pipeline_runs 601, 13:26 today). Three things, in
the order he raised them:

1. **Does the portion fix undershoot his 40g?** He first read the card as wrong; it was not — 504g (2 cups)
   of egg whites IS 57g. The fix (`4be9c7c`) clamps egg whites to 350g (1½ cups) = 38g, which is 95% of
   target and above the ranker's 85% floor, and the calorie up-resize now grows rice/butter instead of
   protein. His worry: "cutting to one cup would put it under 40g." Answer to give with numbers: the cap
   is 1½ cups, not one; 38g qualifies; for any dish with a real anchor (chicken, beef) `topUpProtein` still
   drives protein TO the target; an egg-white-only scramble at 350g lands ~390 kcal, under the 394 kcal
   floor, so it is REPLACED by a better candidate rather than inflated. If he still wants 2 cups allowed,
   `anchorCap` in `_shared/scale-recipe.ts` is one constant (egg whites 350, eggs 250, meat 250, powder
   60). Do not change it without the sweep + depth (`scripts/cook-tonight-sweep/`).
2. **The photo does not match the recipe** — paprika visible, no greens, onion not diced. Confirmed from
   `image_cache`: the image was generated **2026-09-02 14:49 for a DIFFERENT recipe with the same name**
   (egg whites, onion, cauliflower, cheese, potatoes, paprika). Today's recipe reused it because the cache
   key is the MEAL NAME only — PRELAUNCH §2l, now confirmed a third time. This needs a DECISION, not just a
   fix: keying on name + a fingerprint of the main ingredients raises cache misses and therefore image
   cost (CLAUDE.md: image generation is globally cached; do not change it casually). Options in PRELAUNCH.
3. **Onions "diced"** — step 1 says "add diced onions" but no step dices them and the visual says "¼ medium".
   Small prompt/step-format point; note it, do not chase it before 1 and 2.

Then **PRELAUNCH §0 — the Discover pipeline** (yield 13 → 9 → 5 → 2): Logan asked for it at the very top of
the checklist, for a Fable 5.1 session. The lead is written down there (multi-section recipes fail the
retention COUNT because one food is listed at two quantities). Do not widen retention tolerance.

## 2. What is verified vs not (Cook Tonight)

Verified: the production path end to end (row 503: `dry_run=false`, history, images); a week of real
history on Logan's pantry 7/7 clean days; two consecutive sweeps after the portion fix, 29/38 and 32/38,
failing only in the accepted kinds; the pantry-limit line SEEN on device (then its trigger corrected);
the daily-report line live (Logan can verify tomorrow's 9:05 email).
Not verified: the next real generation on the current code (`portionsClamped`, `proteinTopUps` in the
funnel say what moved); the pantry-limit line in its corrected form (needs a genuinely thin pantry).

## 3. DECISIONS ALREADY MADE — do not reopen without new evidence

- **The floored cookability gate stays.** ~3% of meals on a thin pantry need one item the user lacks;
  the card says "Better with: X". A short deck was judged worse.
- **The "light on protein" line tests the CAUSE**: deck short AND target ≤ 70g/meal AND the pantry's own
  sources cannot reach it (`lib/proteinCeiling.ts`). Few sources is not the test; whether they can carry
  a meal is. Logan caught the first version blaming the pantry when he raised the goal.
- **Ranker: clash → not-cookable → tier (complete AND ≥ 85% protein) → fresh → fit**, then slot coverage
  that may not promote a dish under the protein floor. PROTEIN_FLOOR lives in `_shared/rank-deck.ts`.
- **Dietary restrictions are enforced in code and never floored**; the pantry is filtered by the
  restriction before the prompt. `diet_type` is now sent by the client (it never was).
- **Protein is sized deterministically** (`topUpProtein`, then `scaleToTarget` dense-first both ways);
  condiments are never an anchor (the first draft grew soy sauce to 7¾ tbsp).
- **Home hero rotates all three equally** — Pantry-tab slot order is not worth verifying.
- Never paste `CRON_SECRET` into chat, never rotate it.

## 4. MECHANISMS

- **Dry-run the generator for any pantry:** `?dryRun=true` with the `sb_secret_` key as bearer (fetched
  from `npx supabase projects api-keys --reveal`; never on disk). `asUser=<uuid>` reads that user's
  history. Returns `{ meals, funnel }`. The app's anon key is rejected.
- **Sweep / depth / rescore:** `scripts/cook-tonight-sweep/run.mjs` (17+ cases × N), `depth.mjs <pantry>
  <profile> 7` (a week with real history under a synthetic user, cleaned up after), `rescore.mjs
  results/<dir>` (re-grade offline). ~14s and ~$0.03 a generation. Deck-clean counts swing ±4 between
  identical runs — compare failure KINDS, not the count.
- **Funnel per generation** (`pipeline_runs`, provider `generate-meals-funnel`, `dry_run=false` for real):
  `rankCandidates` (p/c/f/tier/repeat/notCookable/slot), `proteinTopUps`, `portionsClamped`,
  `dietViolations`/`droppedByDiet`, `pantryHiddenByDiet`, `stepIssuesShown`, `flavourAxesShown`,
  `slotPromoted`, `duplicateBackfill`, `dryStapleOverload`, `nameGapDetail`, `macros` (FatSecret trace —
  the MATCH label, not the recipe's ingredient). A failed generation writes `failed: true`.
- **Daily email** reads `ops_report_data()`; the Cook Tonight line is red on: any failure, any savory
  clash shown, unseasoned > 30%, uncookable-shown > 10%, protein-floor misses > 20%.
- **Eye-test digest**: the scratchpad file was sent to Logan; regenerate from any sweep's `raw.json`.

**Mistakes this session worth not repeating:** claimed a stale bundle from `index.bundle` (not the Expo
Router entry — check `node_modules/expo-router/entry.bundle`); built a warning on the symptom instead of
the cause; let a calorie up-resize inflate a protein to 2 cups; let "combine all ingredients" strip a
smoothie to one scoop. Each was caught by replaying real rows through the code, or by Logan's eyes —
never by "it should work".
