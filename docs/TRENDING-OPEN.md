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

### Logged 2026-09-01 from Logan's device review — DEFERRED by him, do not start unprompted

- [ ] **"Jello" — 100 kcal / 20g protein / 2g carbs / 0g fat, and it does not close.** 20*4 + 2*4
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
