# Trending pipeline — open items

Durable copy. `~/my-briefing/todos/active.md` kept getting overwritten wholesale by a
concurrent session (five times on 2026-08-30), so this lives in the repo instead.
Reasoning for every fix is in `git log`; this file holds only what is still open.

## Standing: re-run and re-audit EVERY session

Every time this pipeline has been examined it has produced significant findings — 13 fixes on
2026-08-30 alone, two of them live rows serving 3x and 8x protein overclaims, and one a gate that
had been silently dead for 19 days. Treat "it looks fine" as untested.

1. **Run the cron and read the funnel.** `?dryRun=true` runs everything and writes nothing.
   The response carries `funnel`: rawCandidates → afterDedup → viewFloor → ingredientGate →
   sentToLLM → llm raw/sanitized → stored, every rejection counter, `droppedDetail`, and
   `providerUsed`.
   Run them **sequentially** — 3 concurrent runs starved each other's YouTube quota and dropped the
   gate from 61 videos to 8. Dry runs still spend quota.
2. **Re-audit the stored pool — needs no YouTube quota.** Most findings come from here. Fetch
   `trending_meals` and run `_shared/recipe-integrity.ts`, `diet-tags.ts` and `macro-estimate.ts`
   over it under `node --experimental-strip-types`. Check: name/ingredient gaps, allergen tags more
   permissive than the keyword scan, junk/equipment lines, duplicate ingredients, name- and
   ingredient-Jaccard duplicates, repeated `video_id`, null `shelf_tag`, macro plausibility,
   servings-vs-batch coherence, images still on a YouTube thumbnail.
3. **Hand-verify every hit before believing the count.** An unverified count is a guess wearing a
   number's clothes: "28 mismatches" was really 7, "21% incoherent" was ~6%, and a regex retyped by
   hand "reproduced" a match the real source could never produce.

## Open

- [ ] **Yield: variance or defect?** BLOCKED on YouTube quota (resets midnight Pacific; burned
      2026-08-30 by ~16 runs). Identical code, sequential runs gave raw 24 vs 5 and stored 17 vs 4.
      A once-daily cron takes ONE sample from that spread and the swap makes it permanent — a better
      explanation of "thin days" than any single defect. Method: ~10 sequential `?dryRun=true` runs.
      If variance confirms, the fix is architectural: run the cron 2-3x and keep the best batch, or
      merge instead of replace.
- [ ] **OpenAI fallback — one call finishes it.** Mechanism proven (split-emoji surrogate +
      max_tokens above gpt-4o-mini's 16,384 ceiling, fixed `f8d43b9`); forcing hook added
      (`14a0ce5`). An actual 200 from OpenAI is still unobserved — quota died before the forced run
      reached the LLM. Run:
      `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`
      then read `funnel.llm_OpenAI` and `providerErrors`.
- [ ] `SYNONYMS` narrowing left `maple`, `honey` and `ranch` with no synonyms. Watch for false
      "missing maple" gaps on recipes listing only "syrup".
- [ ] Two stored rows carry `1/2 can` / `1/2 packet` ingredients. Harmless — the gate now correctly
      ignores common kitchen fractions. Noted so they are not re-flagged as findings.
- [ ] **Vague-ingredient class is only PARTLY closed** (2026-08-30, `314ae64`). `fave seasoning!`
      shipped to Discover as a shoppable row with an "+ Add" button. Cause: every rule in
      `isNonIngredientLine` detects lines that are NOT FOOD (headings, macro lines, equipment,
      instructions), and a preference placeholder is food-SHAPED — a generic category noun with a
      preference qualifier. Nothing was looking for "names no specific food".
      The fix is deliberately narrow: preference word IMMEDIATELY followed by a generic category
      noun (1 match across 1300 live names, zero false positives). **Still passing the gate**,
      verified by running it: `whatever you like`, `your choice of protein`, `toppings of your
      choice`, bare `spices` / `seasonings`. None are in the live pool today. Do NOT close these
      with a broad "of choice" rule — `milk of choice` is live, names an actual food, and is
      ordinary substitution phrasing.
      Note the second-order effect: removing a placeholder can drop a recipe BELOW the >=3
      candidate gate. That is the intended direction ("fewer recipes, never incomplete recipes") —
      the sheet-pan row reduced to chicken + salt and its row was deleted.
- [ ] **Whole-unit counts came from grams, not the creator** (2026-08-30, `5fe566a`). The meal
      screen said "5 chicken breasts" where the row stored `visual: "6 pieces"`; 10 of 79 live rows
      that state a count were contradicted. `getWholeUnitDisplay` never received `visual`. Fixed —
      stated count wins, grams is the fallback, weight visuals ("2 lb") are explicitly not counts.
      Constants re-derived from the pool: garlic clove 5g->3g, chicken breast 170g->190g.
      **Remaining:** avocado is 200g in the table but the pool implies ~150g (n=3, range 100-150).
      Left alone — thin evidence and it caused no visible contradiction. Re-check as the pool grows.

## 2026-08-30 — junk-ingredient re-audit (item 1 of a screenshot review)

**The earlier narrow fix (`314ae64`) was not enough.** A full audit of the pool found 36 non-food
entries across 15 meals. Fixed in `<commit>`: name rules for the shapes with a tell, plus
`massBearingIngredients` for the ten that have none ("Superhero", "Gaming", "Band Geeks" — a
creator's channel tags, all 0g). Live rows cleaned: 1297 -> 1261 ingredients.

**36 pre-gate rows deleted.** 22% of the pool was `source_verified=false`, ALL from 2026-08-09..12,
before the 100%-retention gate existed — they had passed no integrity check of any kind. Verified
rows run 08-16 onward with zero overlap, and the insert sets `source_verified: r._sourceVerified
=== true` where that flag is only set inside the filter that returns true, so current code cannot
produce one. Pool is now 128, all verified. Backup: scratchpad `deleted_36_unverified_rows.json`.

- [x] **DEAD END — do not add a "creamy"/"cheesy" name-gap rule.** `nameIngredientGaps` misses
      "Creamy Fajita Chicken" twice over: `cream` is not in `DEFINING_FOODS`, and `singular()` only
      strips plurals so "creamy" never stems to "cream". Fixing both LOOKS right and is wrong.
      Measured over the pool, 4 meals have "creamy" with no literal cream and only ONE is a real
      gap — the other three are satisfied by cashew cream, paneer and **vodka sauce**. The rule
      would reject 3 good recipes to catch 1. Same profile as the digit-plus-time-unit and
      fractional-gate dead ends.
- [ ] **Macro coherence is still NOT a per-row verdict.** Re-confirmed: `verifyMacros` fails 39% of
      VERIFIED rows, matching the "rejects a third of the feed" figure already recorded in
      `recipe-integrity.ts`. Most failures point the wrong way (ingredients suggesting MORE than
      claimed = table overestimation, not a drop). Use it to corroborate a hand-checked case, never
      as evidence on its own.
- [ ] **Vague names WITH mass are still uncaught** — "20g topping", "5g ga", "1 tsp oil", "5g Roas".
      Neither signal reaches them: they are not 0g and not patternable. Open as items 9-12 of the
      screenshot review.

## 2026-08-30 — "No-Fry Soya Kebab" reviewed against its source video (item 7)

Verified line-by-line against video FRyfG33qReo. The 21-item list is **accurate and the creator's
own** — the length is not a defect. Two real problems, one fixed in code, one still open.

- [x] **A decimal quantity was parsed as a numbered-list marker.** `\d+[.)]` matched the decimal
      point, so "1.5 tsp Salt" read as list item "1." + "5 tsp Salt". In a non-bulleted description
      the line was discarded outright (the ingredient vanished from the checklist AND from the
      retention contract built from it, so the gate never noticed); in a bulleted one it survived
      with the quantity inflated 3.3x. Fixed with a lookahead, and the parser was moved to
      `_shared/ingredient-parse.ts` because it could not be tested where it lived.
- [ ] **Model-truncated ingredient names are undetected.** The stored row read "Roas" for the
      creator's "1 tsp Roasted Jeera Powder". The PARSER produced the full name correctly — the
      model truncated it. All three truncated names in the pool were the LAST ingredient of their
      array, which is the signature of output truncation. `finish_reason` is currently read only
      when `JSON.parse` FAILS; when the model closes the JSON gracefully at the token limit the
      batch is accepted with a mangled tail. Candidate fixes: reject on `finish_reason === 'length'`,
      and/or flag an ingredient name that is a mid-word prefix of a source-checklist item.
      The Soya Kebab row was repaired by hand from the source; backup in the session scratchpad.
- [ ] **Instructions are too thin to cook from.** Measured over all 128 meals: only **35 (27%)**
      mention any time and **18 (14%)** any temperature, at 4.2 steps and 351 characters average —
      while the card displays a confident "30 min". For the kebab the missing step is squeezing the
      boiled soya, which is the difference between a kebab and a pile: "drained" is not "squeezed".
      Note the source description carried NO method at all, so every step was inferred.
