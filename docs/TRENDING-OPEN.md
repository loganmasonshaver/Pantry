# Trending pipeline — open items

Durable copy. `~/my-briefing/todos/active.md` kept getting overwritten wholesale by a
concurrent session (five times on 2026-08-30), so this lives in the repo instead.
Reasoning for every fix is in `git log`; this file holds only what is still open.


## Busting the image cache — BOTH keys, or you regenerate nothing

`generate-meal-image` stores every dish under TWO `image_cache` keys: the normalized one
(`kala chana protein ball`) and a word-SORTED one (`ball chana kala protein`, added in `b523827`
to stop paying twice for reordered names). A lookup tries both.

So `delete from image_cache where meal_key ilike '%kala chana protein ball%'` deletes ONE of them.
The next call hits the sorted sibling, backfills the normalized key with the OLD url, and returns
the old image — while every outward sign says you regenerated. This cost a bogus A/B on
2026-09-05 where both arms came back byte-identical because both were the same cache hit.

Delete by URL instead, which cannot miss a key variant:

```sql
delete from image_cache where image_url like '%<slug>%';
update trending_meals set image = null where name = '<Name>';   -- backfill is `is null`-scoped
```

Also: every size writes to the SAME storage path (upsert). If you generate two variants of one
dish, DOWNLOAD BETWEEN THEM or the second silently overwrites the first.


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

### Logged 2026-09-01 from Logan's device review — DEFERRED by him, do not start unprompted

- [x] **INVESTIGATED 2026-09-04 — Jello was the symptom, not the bug, and it is not the worst row.**
      Measured the whole pool instead of the one row Logan spotted. Of **178 live rows**: 124 within
      5% of Atwater, 42 at 5-10%, 11 at 10-20%, **1 at 64%**.
      - **The actual worst row is `Pepperoni Pizza Pasta`: 540 kcal stated, 48g protein, 0 carbs,
        0 fat.** A pasta dish with pepperoni and cheese, and two macros are simply missing. It is
        348 kcal off. Nobody noticed it precisely BECAUSE the number is large — Jello got caught at
        12 kcal off because 100 is small enough to check mentally.
      - **Jello's 12% is 12 kcal**, and its `fat: 0` is CORRECT (gelatin and water have no fat).
        Percentage is the wrong lens on small dishes: Philly Cheesesteak Pasta is off by 37 kcal —
        three times Jello in absolute terms — at 10.3%.
      - **The 10-14% band is almost entirely protein desserts** (Brownie Muffin, Funfetti Protein
        Cake, two cheesecakes, Mega Protein Ice Cream). That is exactly where sugar alcohols
        (~0.2-2.4 kcal/g vs Atwater's 4) and fiber (~2 vs 4) live. The gap is the approximation
        being wrong about real food, not the data being wrong. Rejecting it would drop good rows.
      - **ROOT CAUSE: the trending pipeline ran no macro check of any kind.** `verifyMacros` is
        imported ONLY by `generate-meals`. This is what "macro coherence is not a per-row verdict"
        actually meant — not a weak verdict, an unwired gate.
      - **FIXED (generation side, UNVERIFIED until a run):** `macroIncoherence` in
        `_shared/macro-estimate.ts`, wired into the sanitize chain as `rejMacroIncoherent`.
        Two rules: carbs AND fat both zero (a missing answer, not a low-carb dish — fat=0 alone
        stays legal), and an Atwater gap over BOTH 50 kcal and 25%. Tuned against the distribution
        above, not guessed: on the live pool it rejects exactly 1 of 178, and it is the right one.
        6 unit tests use the real row values.
      - [x] **`Pepperoni Pizza Pasta` CORRECTED in prod 2026-09-04** to 540 kcal / 48p / 60c / 17f
        (Atwater 585, 8.3% off — inside the normal band). Cause was mundane: the creator published
        only calories and protein, as fitness creators usually do, and the model wrote 0 for what it
        did not have rather than estimating. Their 540/48 were KEPT per the fidelity rule; carbs and
        fat were derived from their own ingredient list (120g dried pasta, 60g mozzarella, 30g
        pepperoni, 250g chicken). **Those two numbers are an estimate, not the creator's** — they
        belong to the "mark amounts the model invented" item below. Re-checked after: zero rows in
        the pool now fail the new gate.
      - [ ] ~~**`Pepperoni Pizza Pasta` is live in prod right now.**~~ The gate is
        generation-side, so it cannot retro-fix a stored row. Needs deleting or correcting —
        Logan's call, it is public content.
      - [ ] **STILL OPEN: `"glass container"` is stored as an INGREDIENT on Jello.** Equipment, not
        food. Belongs with the junk-ingredient class already logged below.
      - [ ] **SHOULD JELLO HAVE PASSED? Answered 2026-09-04: no — but not for the reason it looks
        like.** Logan's read was "looks nasty, weird ingredients". On appearance ALONE that does not
        stand up: protein jello is a genuine fitness-YouTube staple, and at 20g protein per 100 kcal
        it has the best protein-to-calorie ratio in the entire 178-row pool. Taste is not a spec.
        What convicts it is that **the row contradicts itself**, which is testable:
        - **The stored image shows diced fruit. The ingredient list has none** — gelatin, cold
          water, boiling water, salt, vanilla, sweetener, drink enhancer. Either the photo depicts a
          dish this recipe does not make, or the ingredient list dropped the creator's fruit, which
          is a 100%-retention violation. Not yet determined which; the source video would settle it.
        - `"glass container"` is stored as an ingredient — extraction failure on the same row.
        - The pipeline prompt itself asks for "the most **appetizing** high-protein recipes", so
          appetising is already in the spec rather than being an outside opinion.
        - By mass it is 1,900ml water in a ~2,050g batch — **93% water**. A preparation, not a recipe.
      - [ ] **DO NOT write a "no jello" rule.** Keyword rules for food quality are a MEASURED dead
        end here twice over (see the shelving notes in CLAUDE.md). The generalisable, measurable
        version is a real-food-mass ratio: reject when the ingredient list is overwhelmingly water
        plus powders. Worth designing — but not worth bolting on while generation-side changes are
        already stacked up unverified waiting on a run.
      - [x] **SOURCE VIDEO READ 2026-09-04 — hcBwG5_7POU, "The Plant Slant", 8.5M views.** Three of
        the guesses above are now settled, and one of them was MINE and wrong:
        - **The creator publishes NO macros and NO serving count.** The description is an ingredient
          list plus five steps, ending "makes 64 Fl oz". So the stored 100/20/2/0 AND servings=4
          were invented downstream — the pipeline's "READ macros from the description first" rule
          has no branch that marks what happens when there is nothing to read. **This is the real
          trust defect on this row, far more than the 12 kcal.** Generalised as an open item below.
        - **`"64 fl oz GLASS container"` IS in the creator's list.** The parser was FAITHFUL and I
          was wrong to call it an extraction failure — the 100%-retention contract mandated keeping
          it. The tension is real though: retention says keep every line, and a container is not
          food, and it fed the image prompt.
        - **The creator's list contains NO FRUIT** — only "fruit flavored zero sugar water drink
          enhancer". So the stored photo of diced fruit in jelly depicts a dish this recipe does not
          make. Confirmed IMAGE defect, not an ingredient drop.
        - **Protein was ~26% LOW against the recipe's own gelatin.** 120g beef gelatin is ~85-90%
          protein (~355 kcal/100g) = ~108g protein / ~426 kcal per batch, over 4 servings = ~26g and
          ~107 kcal. Logan's original ~30g estimate was closer than the app's 20g.
      - [x] **Jello CORRECTED in prod 2026-09-04** to 107 kcal / 26p / 1c / 0f (Atwater 108, within
        1%), equipment line dropped (8 ingredients -> 7), and BOTH `image_cache` and
        `trending_meals.image` cleared so the photo regenerates under the hardened prompt. Corrected
        rather than deleted, for consistency with Pepperoni Pizza Pasta.
      - [x] **Image prompt hardened** (`generate-meal-image`, deployed): a flavouring named after a
        food must never be drawn as that food ("fruit flavored drink enhancer" is not fruit,
        "strawberry protein powder" is not strawberries), and equipment lines are never depicted as
        food. Both added to the negative prompt too. Measured first: only **1 of 178 rows** carries
        an equipment line, so this is narrow by design rather than a broad filter that would
        misread "1 container greek yogurt" as a container.
      - [x] **BUILT 2026-09-04 — macros are now COMPUTED, not guessed, when the creator published
        none.** `computePerServingMacros` in `_shared/macro-estimate.ts` runs `estimateMacros` over
        the creator's own ingredient list and divides by the serving count. Wired into the sanitize
        chain BEFORE the coherence gate so the gate judges the numbers that will actually be stored.
        `macros_source` column added ('creator' | 'computed' | 'model'), model now required to
        declare `macros_from_creator` and told explicitly that a wrong `true` is the one thing that
        cannot be caught downstream.
        **Deliberately NOT a rejection gate.** Requiring published macros would intersect two
        already-narrow filters — only ~28% of candidates have a parseable ingredient list — against
        a pipeline whose yield problem is measured (24 raw vs 5 on identical runs). Same videos,
        better numbers.
        **Abstains rather than inventing:** returns null on an unweighable ingredient or coverage
        below 0.7, the same guards verifyMacros uses, and the caller then keeps the model's numbers
        and labels them `model`. 4 unit tests.
        Backfill is `model` for all 176 pre-existing rows — which of the three they were is unknown,
        and `model` is the claim that overstates least. The two verified against their videos today
        are marked correctly: Pepperoni Pizza Pasta `creator`, Jello `computed`.
      - [x] **REPLAYED AGAINST ALL 178 LIVE ROWS 2026-09-04 — and it caught a real defect in the
        first version.** `scripts/replay-macros.ts` runs every stored candidate through the new code
        with no quota, no auth and no writes. Findings:
        - **The arithmetic is calibrated: median computed/stored calorie ratio 0.98.**
        - **The coverage guards alone were far too permissive — they passed 175 of 178 (98%).**
          Of those, **83 disagreed with the stored number by more than 25%, some by 2x.** Shipping
          the first version would have overwritten plausible macros with inflated ones on ~a quarter
          of the pool. The guards prove the estimate is COMPLETE; they say nothing about it being
          RIGHT.
        - **A disagreement is genuinely ambiguous.** 43 of the 83 reconcile to a different integer
          serving count and 40 do not, and at that tolerance some of the 43 land on an integer by
          chance. Per row we cannot tell a wrong serving count from a wrong estimate.
        - **FIX: replacement now also requires AGREEMENT** (`COMPUTED_AGREEMENT_BAND = 0.25`).
          Split on the live pool: 92 computed / 83 model-kept-disagreed / 3 model-kept-abstained,
          and 0 of the computed rows fail the coherence gate. Pinned by a unit test.
        - **The disagreement list is now the most useful output of a run** — each line is a
          candidate WRONG SERVING COUNT with the implied value, e.g. "Stuffed Chicken Caesar
          Sourdough, servings=1, batch implies ~2" (958g of food including a 250g sourdough loaf and
          300g of chicken, at one serving). Logged as its own item below.
      - [ ] **⚠️ NEW: ~83 rows carry a serving count the ingredients contradict.** Surfaced by the
        replay above, not yet fixed — it needs the source videos to settle each one, and it may be
        an estimator problem on some. Start with the clean 2x cases: Stuffed Chicken Caesar
        Sourdough, Creamy Garlic Pepper Soya Chunks, Chicken Semolina Momos, Roti, Corn Paneer
        Pakoda. Servings is load-bearing — it is the divisor for every macro on the card.
      - [ ] **STILL UNVERIFIED against a live pipeline run.** None of the above has processed a real candidate.
        On the next run check the `macros_source` split: a run that returns 100% `creator` means the
        model is lying about `macros_from_creator`, which is the failure mode with no downstream
        catch. Expect a mix.
      - [ ] **The app still does not SHOW the distinction.** The column exists and is populated;
        nothing reads it. A computed number should render differently from the creator's own — "~"
        prefix or an explicit label. Until that ships, the database knows the difference and the
        user does not.
      - [x] ~~nothing records whether macros came from the creator or were invented~~ Jello's were invented; Pepperoni Pizza
        Pasta's 540 kcal / 48g protein are verbatim from @mealswithmax ("Approximately 540 calories
        and 48g protein per serving", "SERVES: 2"). Both look identical in the database and in the
        app. For a macro-tracking app that is the difference between a source and a guess. Fix
        shape: a `macros_source` column ('creator' | 'estimated') set by the model, surfaced in the
        UI. Supersedes and generalises the "mark amounts the model INVENTED" item below.
      - [ ] **Still not measured:** whether the Jello macro block agrees with its own ingredients
        (120g gelatin over 4 servings = 30g/serving, which is ~30g protein against a stated 20g).
        The pool-wide coherence work took priority.
- [ ] ~~**"Jello" — 100 kcal / 20g protein / 2g carbs / 0g fat, and it does not close.**~~ 20*4 + 2*4
      = 88 kcal against a stated 100. Separately the ingredient list says 120g unflavoured beef
      gelatin over 4 servings = 30g/serving, which is ~30g protein and ~110 kcal on its own — so
      the macro block disagrees with the ingredients AND with itself. Logan's framing is the right
      one: "someone who can do quick math would look at that and call this app unreliable." Also
      open, and a separate question: should a bowl of gelatin and water have passed the pipeline at
      all, or is this creator trolling? Row: `name = 'Jello'`, `trend_source = 'YouTube trending'`.
      **This is a different failure from the known 38% estimator spread** — that one is variance
      around a correct method; this is an internal contradiction visible without any reference data.
- [ ] **Coriander listed twice on "Green Butter Garlic Chicken"** — `30g coriander leaves` and
      `1 tbsp chopped coriander leaves`. ⚠️ Before touching this: a blanket dedupe is a MEASURED
      DEAD END (see CLAUDE.md and the paprika item below) — a repeat is usually FAITHFUL, the
      creator putting the same ingredient in two sections (here almost certainly the green sauce
      and the garnish). The fix that was actually built for this is `parseIngredientSections`
      (#4754), which preserves the creator's section headings so the two reads as "sauce" and
      "garnish" rather than as a duplicate. **First question is therefore not "why is it
      duplicated" but "does this row predate sections, or is the meal screen not rendering them?"**
      Check `trending_meals.<section field>` on this row before writing any code.
- [ ] **"5g cooking oil spray" — a mass on something nobody weighs.** Two defects in one line.
      (a) Cooking spray is one of the `parseUnquantifiedExtras` recoveries — the creator wrote no
      amount, so 5g was INVENTED downstream. That makes it the same class as the already-logged
      "Mark invented amounts" item further down this file; fix them together. (b) Even given a
      quantity, grams is the wrong unit for oil — this is the inverse of the "cups are a
      measurement" call Logan made (if the creator wrote a volume, keep the volume; do not convert
      a cooking medium into a weight nobody can measure). A spray in particular has no honest
      amount: the right rendering is no quantity at all.

- [ ] **Discover's FIRST open: black screen + a Safari icon, then 3-6s, then a reorder.** Reported
      2026-09-02, DEFERRED. Three separate things in one symptom and they should not be conflated:
      (a) the **Safari-glyph-on-black** is almost certainly a broken/absent image placeholder, not a
      web view — check what `MealImage` renders before a source resolves and what the hero falls
      back to when `image` is null; (b) the **3-6s** is Discover's own first fetch, which is a
      different wait from Home's (no GPT call — this is a 600-row query plus image decode); (c) the
      **reorder a second later** should ALREADY be fixed by a14c9b4 (first paint now waits on
      profile + pantry) — if it survives a reload on that commit, the gate is missing a third async
      wave and the fix was incomplete. Verify which of these three still reproduce before touching
      anything; (c) in particular may be a stale build rather than a live bug.

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

## Instruction depth — why the steps are thin, and what actually fixes it (2026-08-30)

Measured over all 128 meals: **35 (27%) state any cook time, 18 (14%) any temperature**, at 4.2
steps and 351 characters average — while every card displays a confident prep_time.

**The prompt is not the cause.** It already demands atomic steps, scales step count to complexity,
says "PRESERVE THE PREPARATION METHOD exactly as described", and its own worked example carries
timings. The steps are thin because most YouTube descriptions carry an ingredient list and NO
method — the Soya Kebab's carried none — so the model is inferring, and inferring conservatively is
correct behaviour.

- [x] **DEAD END — do not "just require times in the prompt".** With no method in the source the
      model would INVENT them, and an invented "bake chicken at 200°C for 25 minutes" is a
      food-safety claim this app cannot stand behind. Vague beats confidently wrong on meat.
- [x] **Shipped instead: link the source video.** `video_id` had been stored on every row since the
      pipeline began and surfaced nowhere. The video IS the method.
- [ ] **DEAD END (for now) — YouTube captions cannot be fetched.** The obvious next step is to feed
      the caption track to the model so steps come from what the creator actually said. It does not
      work: the watch page still exposes `captionTracks[].baseUrl`, but fetching it returns **HTTP
      200 with a ZERO-BYTE body**. Tested 2026-08-30 across 3 videos (FRyfG33qReo hi/asr,
      ob_rJcS3gOI en/asr, hREGP15njIg en/asr) and 5 endpoint variants (raw, fmt=json3, fmt=srv3,
      fmt=vtt, legacy video.google.com/timedtext). Every one empty. YouTube gates timedtext behind
      session context.
      The official route is worse: `captions.download` needs OAuth as the video OWNER, which is
      impossible for other creators' videos.
      What is left costs money — a third-party transcript API (per-video fee, needs pricing) or
      Whisper on the audio, which is already on the PRELAUNCH "deliberately NOT" list. Do not spend
      another session rediscovering that the free route is closed.

### CORRECTION to the section above (same day)

"Most descriptions carry an ingredient list and NO method" was **half wrong**, and the wrong half
was the actionable one. Measured on 14 sampled source descriptions: **6 publish a full numbered
method**, all of it inside the 2000-char prompt window. The model could already see it and was
summarising it away — "Kala Chana Dosa" published 9 steps, we stored 5, losing "drain the water",
"medium heat" and "flip and cook for another 1-2 minutes".

Fixed by `parseMethodBlock` + a SOURCE METHOD checklist in the prompt, and by removing the
"simple recipes 4-6 steps" instruction that was *causing* the compression. Same remedy as the
ingredient checklist, for the same reason.

- [ ] The video-link approach was built and then **reverted on Logan's call** (`8afcb04`, reverted
      in the commit after). He does not want users sent out of the app. Do not re-propose it.

---



## 2026-09-04 — two dry runs under the new code. Read this before touching retention again.

Fired from SQL with the Vault pattern; both landed in `pipeline_runs`.

| run | raw | sanitized | stored | dropped | nearDup | nameGap | truncated | macroIncoherent |
|-----|-----|-----------|--------|---------|---------|---------|-----------|-----------------|
| 1   | 19  | 5         | 5      | **7**   | 4       | 2       | 0         | 0               |
| 2   | 6   | 2         | 2      | **4**   | 0       | 0       | 0         | 0               |

- [x] **PRELAUNCH check 2 (truncation guards) ANSWERED: `truncated` = 0 on both runs**, the
      documented healthy value. That closes the last of the four 2026-08-30 checks.
- [x] **`macros_from_creator` is NOT being over-claimed.** Splits were `{creator 1, computed 2,
      model 2}` and `{creator 1, computed 1}` — a mix, never 100% creator. That was the one failure
      mode with no downstream catch.
- [x] **⚠️ VARIANCE LOCATED: it is ENTIRELY in the LLM step, not the candidate pipeline.**
      Stage-by-stage across the two runs, minutes apart:

      | stage | run 3 | run 4 |
      |---|---|---|
      | rawCandidates | 644 | **644** |
      | afterDedup | 455 | 448 |
      | afterViewFloor | 145 | 142 |
      | afterIngredientGate | 39 | 40 |
      | sentToLLM | 39 | 40 |
      | **LLM returned** | **19** | **6** |
      | stored | 5 | 2 |

      **Everything up to the model is stable — 644 raw candidates both times, and 39 vs 40 sent.**
      From near-identical input the model returned 19 recipes once and 6 the next. YouTube search
      is not the variance source and neither are the gates; the model's own selectivity is.

      **This makes the architectural fix far cheaper than PRELAUNCH assumes.** That item proposes
      "run 2-3x, keep the best batch" — but a full run costs ~1,314 YouTube units, and the
      expensive half is the half that is already stable. The retry belongs on the LLM CALL, against
      the same 39 candidates, at **zero additional quota**. Re-running the whole pipeline would be
      paying three times over for a stage that does not vary.
      Likely mechanisms to check first: the prompt says "For each video you SELECT", so the model is
      choosing a subset and its appetite varies; and `finish_reason=length` truncation is already
      flagged in this file as something to watch.
- [x] **Yield variance also explains 2026-09-03's two meals.** No funnel exists for it —
      `pipeline_runs` predates that cron — but both rows were written at 08:00:22, twenty-two
      seconds after the trigger, and a full run took 60-90s today. A fast run is a small run. At
      the observed 26-33% survival, 2 stored implies ~6-8 recipes back from the model, which is
      exactly run 4's draw. No separate defect: the same LLM variance, sampled once a day and made
      permanent by the swap.
      Ten-day spread for reference: 15, 2, 11, 18, 4, 18, 4, 9, 7, 13 against STORE_CAP 18.
- [x] **YIELD VARIANCE OBSERVED DIRECTLY: identical code, minutes apart, raw 19 vs 6.** The
      PRELAUNCH item asks whether thin days are variance or a defect; two runs is not the ~10 it
      wants, but the spread is now measured rather than remembered, and it matches the 24-vs-5 seen
      before. **Consequence for all future work here: a single run cannot validate a generation
      change.** Compare rates across several runs, never counts across two.
- [x] **RETENTION IS THE DOMINANT YIELD KILLER** — 7 of 19 and 4 of 6, far ahead of every other
      counter. Two causes, from `droppedDetail`.

### ⚠️ NEGATIVE RESULT — prompting does NOT stop the model merging repeated ingredients

Four of the seven drops in run 1 were the same food listed at different amounts: sugar 3x (Apple
Pie Cottage Cheese Cake), olive oil and garlic 2x each (Cottage Cheese Flatbread), yoghurt,
erythritol and mango 2x each (Mango Cheesecake), chipotle seasoning 2x (Honey Chipotle
Quesadillas). The model consolidates them and the recipe is rejected for the shortfall.

**Tried and FAILED (2026-09-04):** annotating each such line in the source checklist with "[this
food is listed Nx at DIFFERENT amounts — emit a SEPARATE entry for each. Do NOT add them together
or keep only one.]". Verified the annotation renders (all three sugar lines carry it) and verified
the model received it. Run 2 dropped **the same four recipes with the same counts** — Apple Pie
13 vs 15, Quesadillas 12 vs 13, Flatbread 11 vs 13, Hot Honey 9 vs 10.

**Do not spend another attempt on prompt wording.** The existing prompt already says "Never merge
two lines into one entry" in stronger terms than the annotation, and the pre-existing "[appears Nx]"
marker cannot help because `sections` keys on the EXACT LINE and these lines differ. Three
prompt-shaped attempts have now failed; this is the same shape as the ban-list finding logged
earlier in this file, where the model returned banned names verbatim.

- [ ] **The remaining lever is DETERMINISTIC RECOVERY, not prompting.** When the model returns
      fewer entries than the source list, walk the unmatched source lines: if a line's food matches
      an entry already present, append a new entry carrying that line's own quantity. This recovers
      the creator's real data rather than inventing any, and it is mechanical. It is also the only
      approach left that does not depend on the model changing its behaviour.
- [ ] **Untested: the group-heading fix.** Neither of the two recipes that motivated it (High
      Protein Brownies, High Protein Tiramisu Balls) appeared in run 2's batch of 6, so no heading
      case was exercised. Needs another run that happens to include one.

## 2026-09-04 — audit of the 09-04 cron run (15 meals)

Run predates the day's deploys, so it exercises the 2026-08-30 generation changes only.

- [x] **CHECK 1 — method checklist (`ec4a1d1`): CONFIRMED, and it moved a lot.** Against the
      128-row pre-08-30 baseline of 27% time / 14% temp / 4.2 steps / 351 chars, the 15 rows scored
      **67% time, 33% temp, 5.1 steps, 499 chars** — time and temp both ~2.4x. The doc's own caution
      holds: only ~43% of source descriptions publish a method at all, so 67% means the model is
      inferring sensible detail rather than only copying. n=15, so strong signal, not settled.
- [ ] **CHECK 2 — truncation guards (`6cb039d`): STILL UNVERIFIABLE from stored rows.** The counter
      records candidates the pipeline REJECTED, and rejected rows never reach the table. Needs
      `funnel.rejected.truncated`, which is why `pipeline_runs` now exists.
- [x] **CHECK 3 — decimal parser (`561360e`): no evidence of the old bug.** Zero rows store a
      quantity that is only a decimal's fractional part. Ingredient counts avg 8.5.
- [x] **CHECK 4 — junk gates (`50e29c0`): CLEAN.** Zero massless or scaffolding-shaped ingredients.
- [x] **Macro coherence (new): all 15 within 25%, and no row with 0 carbs AND 0 fat.**
- [x] **`source_verified`: 15 of 15.**

### ⚠️ The audit found a real ingredient drop — and a parser bug behind it

- [x] **"Avocado Blueberry Yogurt Clusters" stored 3 ingredients; the creator listed 4.**
      Source `qCMuQxUtLbs`. Missing:
      `3 Tbsp. dark chocolate chips, melted (or 1 1/2 oz. dark chocolate bar, chopped) - optional`.
      Not trivial — it is 3 tbsp of chocolate, and the creator's own steps reference it.
      **ROOT CAUSE: `parseIngredientBlock` capped lines at `>= 90` characters and that line is
      EXACTLY 90.** Drop either the parenthetical or the " - optional" and it parsed; together they
      tipped it one character over. Fixed: cap raised to 140, with a regression test using the real
      line.
      **THE DEEPER PROBLEM, now fixed too: the drop was invisible.** The retention contract compares
      the model's array against `parsed.length`, so a line the PARSER never saw shrinks BOTH sides
      and the contract passes at the lower count. A parser miss cannot be caught anywhere
      downstream. `parseIngredientBlock` now LOGS every line it discards for length.
      Length was never the real filter anyway: unbulleted lines must still pass `QTY_START`, so
      prose without a leading quantity is already excluded.
      - [x] **Row CORRECTED in prod 2026-09-04.** The chocolate line is back at 43g — the
        creator's OWN alternative figure ("1 1/2 oz. dark chocolate bar"), not a conversion of their
        3 Tbsp, because a number they published beats one I derive. Macros then recomputed by
        `computePerServingMacros` over the complete list: **158 kcal / 5p / 14c / 10f**, marked
        `macros_source = 'computed'`, 5% off Atwater. The old 180/8/15/12 were the model's
        invention (that description publishes no macros) and overstated protein by 60%.
      - [x] **ANSWERED 2026-09-04: FIVE rows, and all five lost a REAL ingredient.**
        `audit-ingredient-lines` re-fetches all 178 source descriptions and parses each twice, at
        the old cap and the current one. Runnable from SQL with the Vault pattern — no key handling,
        ~4 quota units, freely repeatable:
        ```sql
        select net.http_post(
          url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/audit-ingredient-lines',
          headers := jsonb_build_object('Content-Type','application/json','Authorization',
            'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_service_role_key' limit 1)),
          body := '{}'::jsonb);
        select funnel->>'rows_that_lost_a_line', funnel->'affected'
        from pipeline_runs where provider='audit-ingredient-lines' order by id desc limit 1;
        ```
        **Getting to 5 took two corrections, and the first two answers were both wrong:**
        - **20** — the simulation stripped long lines BEFORE parsing, which flips the
          `bulleted.length >= 3 ? bulleted : quantified` branch. Fixed with a `maxLine` parameter so
          the parser genuinely re-runs at the old cap. The tell was in the output: one row showed
          nine "lost" lines of 9-28 chars, which no length cap can drop.
        - **6** — one row was method steps numbered `2.)`. `NUMBERED_MARKER` handled `2.` and `2)`
          but not `2.)`, so the marker survived, and `"2.)"` then satisfies QTY_START on its own.
        - **5** — all genuine, all lost to the 90-char cap:
          `Tiramisu Protein Dessert` (40g sugar), `Pepperoni Calzones` (40g pepperoni),
          `Street Corn Sweet Potato Bowl` (1.5 lb ground beef),
          `Loaded Garlic Butter Steak Sweet Potato` (8 oz sirloin),
          `Avocado Blueberry Yogurt Clusters` (already corrected).
      - [x] **HANDLED 2026-09-04 — and the impact is much smaller than the audit implied.**
        Only **2 of the 5** rows had actually lost the ingredient: `Avocado Blueberry Yogurt
        Clusters` (chocolate) and `Tiramisu Protein Dessert` (40g sugar, added). The other three —
        Pepperoni Calzones, Street Corn Sweet Potato Bowl, Loaded Garlic Butter Steak — **already
        held the ingredient**.
        **⚠️ WHY, and it changes how to read this audit: the retention checklist is GUIDANCE to the
        model, not the source of its ingredient list.** The model reads the whole description, so a
        line the parser drops from the checklist can still reach the output. A parser miss weakens
        the CONTRACT (it can no longer detect a drop, since both sides shrink) without necessarily
        causing one. `audit-ingredient-lines` measures checklist damage, not stored damage — the
        two must not be conflated, and the first read of it here did exactly that.
        Macros recomputed only where the arithmetic AGREED: `Loaded Garlic Butter Steak` ->
        844 kcal / 68p / 41c / 47f, `macros_source = 'computed'`. Tiramisu abstained (an ingredient
        the table cannot weigh) and the other two disagreed beyond the band, so all three keep the
        model's numbers and stay marked `model` rather than being silently rewritten.
      - [ ] **Two of them surfaced serving-count suspicion instead**, which is the more useful
        output: `Pepperoni Calzones` servings=7 against a batch implying ~4, and `Street Corn Sweet
        Potato Bowl` servings=4 against ~5. Part of the ~83-row servings item above.
      - [ ] **Store the source description alongside each row.** This audit needed YouTube only
        because the description is thrown away after generation. Keeping it (or its parsed list)
        would make every future fidelity question answerable from SQL, and this is the second time
        today that the missing source has been the blocker.

- [ ] **WATCH, do not act yet: 10 of 15 rows on 09-04 were desserts** (cheesecake x3, brownie,
      crepes, pancakes x2, dessert cups, cheesecake dip). Logan's call is that one day is not
      evidence — revisit once several runs can be stacked. Recorded so it is not lost.

# ⚠️ CONFIRM ON THE NEXT PIPELINE RUN

Everything shipped on 2026-08-30 below affects GENERATION only, so none of it is proven yet — the
existing pool was written by the old code. **One run confirms all four.** Do this before claiming
any of them work.

Run it as a dry run first so it does not swap the day's rows:

```
.../generate-trending-meals?refresh=true&dryRun=true
```

**1. Method checklist — does it raise instruction depth?** (`ec4a1d1`)
Baseline to beat, measured 2026-08-30 over 128 rows: **27% state a cook time, 14% a temperature**,
4.2 steps, 351 chars average. Re-measure against rows written by the new code:

```sql
select count(*) as meals,
       count(*) filter (where steps::text ~* '[0-9]+\s*(minute|min|hour|hr|second|sec)') as has_time,
       count(*) filter (where steps::text ~* '[0-9]+\s*(°|degree)') as has_temp,
       round(avg(jsonb_array_length(steps)),1) as avg_steps
from trending_meals where generated_at > '2026-08-30';
```

Expect a rise, NOT to 100%: only ~43% of source descriptions publish a method at all (6 of 14
sampled). A run where `has_time` does not move at all means the model is ignoring the checklist,
which is a prompt problem, not a parser one.

**2. Truncation guards — do they fire, and do they over-fire?** (`6cb039d`)
The funnel now carries a `truncated` counter. Read `funnel.rejected.truncated` in the response.
Zero is the expected healthy value. Anything above ~1 per run means `truncatedAgainstSource` is
rejecting real food — check the log line naming the ingredient before assuming it is working.
Also watch for `finish_reason=length` in the logs; it drops the trailing recipe.

**3. Decimal parser fix — do ingredient counts go up?** (`561360e`)
`1.5 tsp Salt` used to be discarded or mangled to `5 tsp Salt`. Any description with a decimal
quantity should now yield one more ingredient than before. Confirm no row stores a quantity that
is exactly the decimal's fractional part.

**4. Junk gates — does anything massless or scaffolding-shaped come back?** (`50e29c0`)
Should be zero:

```sql
select t.name, i->>'name', i->>'grams' from trending_meals t, lateral jsonb_array_elements(t.ingredients) i
where t.generated_at > '2026-08-30'
  and (coalesce(nullif(regexp_replace(i->>'grams','[^0-9.]','','g'),''),'1')::numeric = 0
    or i->>'name' ~* '(^(total )?(calories|protein|carbs?|fats?)$|step$|^(dry|wet|batter) mix$)');
```

---

## Next up, AFTER the verification run above

- [ ] **Mark amounts the model INVENTED, so they don't read as the creator's.**

      The creator of `blm9ES-AjaM` ("Air Fryer Chocolate Oats Cake") listed exactly `• Cashew Nuts`
      — no quantity, no placement, and no method section at all. The app displays **"30g · ¼ cup
      cashew nuts"** and the step *"Pour into a cake tin and top with cashew nuts"*. Both are the
      model's inventions and neither is distinguishable from something the creator stated. The
      generated hero image then shows a dense mound of whole cashews, illustrating a topping the
      recipe never specified at an amount nobody gave.

      The invention itself is NECESSARY — macros need grams, and a recipe needs some instruction.
      The defect is that nothing marks it as an estimate.

      **Why this is buildable now and wasn't this morning:** the unquantified case is already
      detected. `parseUnquantifiedExtras` finds bare lines, and the bulleted branch of
      `parseIngredientBlock` keeps a bulleted line whether or not it carries a quantity — which is
      exactly how `• Cashew Nuts` reached the checklist. So the pipeline already KNOWS which
      ingredients the creator left unquantified; that fact is simply thrown away.

      Design: an `estimated: true` flag on the ingredient, set when the source line carried no
      quantity, rendered as "~30g" rather than "30g". Threading is parser -> prompt -> storage ->
      `getMeasuredDisplay`.

      It matches a convention this app already holds: never "Dairy-free", always "No dairy in the
      listed ingredients."

      **Honest sizing before anyone picks this up:** the harm is LOW. An invented 30g of cashews
      misleads nobody into a bad outcome. The dangerous version — invented cook times and
      temperatures on meat — was deliberately NOT built, and must not be: with no method in the
      source the model would fabricate them, and an invented "chicken at 200°C for 25 minutes" is a
      food-safety claim this app cannot stand behind. So this is an honesty improvement, not a
      safety one. Sequenced after the verification run because that run is already gating six
      shipped changes, and this would add a seventh unverified one to the pile.

- [ ] **NOT a defect, recorded so it is not "fixed" by someone later:** `"Baking powder and soda"`
      as one ingredient row is FAITHFUL — the creator wrote "A pinch of Baking Powder & Baking
      Soda" on one line. Splitting it means inventing two amounts from one "pinch". And the obvious
      split rule is a trap: "salt and pepper" splits correctly, "macaroni and cheese" does not.

**5. Region bias — did the candidate pool shrink?** (`regionCode=US&relevanceLanguage=en`)
The keyword search was scoped GLOBALLY while the trending call had always been US-only, so Indian
fitness YouTube flooded the pool: **37 of 128 meals (29%) need besan, poha, suji, atta, chana dal
or maida**, against an audience that is ~90% American. That is not a taste problem — pantry
matching is the core loop and cannot work on ingredients nobody stocks, so "Almost in your kitchen"
never fires for those rows.

Read `funnel.rawCandidates` and compare against the last known figures (634 raw -> 171 past the
view floor -> 61 gated, from 2026-08-30). A modest drop is expected and fine. If it drops
MATERIALLY, widen the query pool rather than reverting — the problem this fixes is real, and yield
is already the binding constraint here (raw output has swung 5 to 24 on identical code).

Then re-measure the mix:

```sql
select count(distinct t.id) from trending_meals t, lateral jsonb_array_elements(t.ingredients) i
where t.generated_at > '2026-08-30'
  and i->>'name' ~* '\m(besan|poha|suji|atta|maida|chana|dal|methi|moong|rajma)\M';
```

**Quota:** ~1,314 units per run against 10,000/day, resetting midnight Pacific. `dryRun` costs the
same — it skips DB writes and image generation, not the YouTube calls. Run tests SEQUENTIALLY.

## 2026-08-30 — item 11 reviewed against source (hPCcDaUmGKw, Bang Bang Salmon Salad)

- [x] **The duplicate paprika and garlic powder are FAITHFUL, not a bug.** The creator publishes
      three sections — Ingredients, Salmon Seasonings, Bang Bang Dressing — and garlic powder
      appears in all three, paprika in two. Same as the duplicate Greek yogurt in "Funfetti Protein
      Cake" (cake vs frosting). **Never add a blanket ingredient dedupe**; it would silently halve
      recipes like these. `countedIngredients` already dedupes for COUNTING only, which is correct.
- [x] **"5g ga" was the Dressing's "1 Tsp Garlic Powder", truncated.** `truncatedAgainstSource`
      catches it — verified against this exact row, which is the first real-data confirmation the
      detector works. Row repaired by hand; backup in the session scratchpad.
- [x] **A 2x quantity error the gates cannot see.** Stored "2 tsp paprika" where the creator wrote
      "1 Tsp Paprika" (it sits directly under "2 Tsp Garlic Powder" in the source — the model
      carried the neighbouring quantity down). Retention compares NAMES, so a wrong amount on a
      right ingredient passes every gate. Repaired. No detector exists for this class.
- [x] **REVERSED — unquantified lines ARE recoverable.** I first called this a dead end on a bad
      measurement: accepting every unquantified non-heading line admitted 160 lines across 15
      descriptions, almost all junk, to recover ~7 ingredients. That test applied NONE of the gates
      that already exist. Logan pushed back on the call and was right.
      Re-measured with `isNonIngredientLine`, the method-heading stop, and two new rules, the same
      corpus gives **~27 real ingredients against 1 junk line**. Shipped as
      `parseUnquantifiedExtras`.
      The two rules that did the work, both from the data rather than a wordlist:
      **the ingredient block starts at the first QUANTIFIED line** (everything unquantified above it
      is the title/hook/promo — this alone removed every stylised-unicode title, which no keyword
      list would have caught), and **strip a leading emoji before any ^-anchored test** (same trap
      already recorded for "🍳 Recipe Steps" and for `\b` being ASCII-only).
      **They are NOT part of the retention contract** — handed to the model as things to include,
      never as things it is rejected for omitting, because "Water for soaking" and "Cooking Spray"
      are lines a faithful recipe may legitimately drop.
      Lesson worth keeping: a "measured and rejected" verdict is only as good as the measurement.
      That one tested the crudest possible version of the idea and killed the idea with it.
