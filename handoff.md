# Handoff — 2026-09-07 (early hours)

Replaces the 2026-09-05 evening handoff. **24 commits** since `41453b4`.
`git log --since="2026-09-06 18:00"` carries the reasoning for every fix; this file holds only what
git does not — what is UNRESOLVED, what is UNVERIFIED, and the design decisions Logan has already
made so the next session does not re-derive them.

**State:** everything committed, pushed, deployed. Tree clean.
**TS baseline 130 total / 16 app-code.** **348 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).

---

## 1. ⚠️ START HERE — the feedback board, Phase 1, APPROVED AND NOT BUILT

Logan approved the design and asked for **one phase at a time, prompted for the next**, and for the
logic to be reviewed before shipping. Do not build phases 2-3 until he says go.

### The chips — final, agreed after two rounds

> **Seen this too often · Photo doesn't match the dish · Ingredients don't add up ·
> Doesn't fit my macros · Didn't taste good**

Five, not four, because **each drives a different action** and collapsing any two throws away the
distinction that makes them worth collecting:

| Chip | Action | Scope |
|---|---|---|
| Seen this too often | suppress this dish, hard | this user |
| Photo doesn't match | flag image for regeneration — **dish untouched** | global (images are shared) |
| Ingredients don't add up | recipe bug + funnel row — **dish untouched** | global |
| Doesn't fit my macros | recheck their targets; feeds the calorie-band work | this user |
| Didn't taste good | suppress the food family | this user, aggregate → global |

### Why Phase 1 is a GENERATION bug, not a support feature

`meal_ratings` (id, user_id, meal_name, rating, created_at, trending_meal_id) has **no reason
column**, and `dislikedMeals` feeds straight into the meal prompt as "do NOT suggest these or
anything similar". So today every thumbs-down teaches the model the same lesson — and **two of the
five reasons must NOT suppress the dish at all.** A broken photo currently kills a perfectly good
recipe forever. That is the defect Phase 1 fixes; the feedback channel is the side effect.

Only ONE of the five is currently handled correctly, and by coincidence.

### Decisions already made — do not relitigate

* **"Doesn't fit my macros", NOT "macros look wrong."** Users cannot judge accuracy (they would have
  to weigh the food) but they can judge fit — 533 kcal against a 420 slot is obvious. It also maps
  to a measured hole: **14 of 39 meals land above the calorie band and below the drop threshold**,
  where nothing acts.
* **"Didn't taste good" replaces "Just not for me."** Sharper signal, same user intent.
* `meal_ratings.trending_meal_id` **already exists**, so global demotion of a badly-rated shared
  Discover row needs no schema work.
* Known weakness, accepted: the thumbs-down lives on the detail screen, usually BEFORE cooking, so
  taste feedback is weakest exactly where it is collected. The strong version is a post-**Log Meal**
  prompt — that is Phase 4, not now.
* Optional and deliberately deferred: "Photo doesn't match" could **fix itself** — bust the cache key
  and call `generate-meal-image` with `replaceTrending: true`. That whole path was built today. Too
  clever for an unproven signal, cheap to add later.

### Phase 2 — feedback capture (planned, not built)
One private `feedback` table, RLS self-insert only:
`user_id, kind ('bug'|'idea'), body, screen, app_version, meal_id, funnel_run_id, created_at`.
Three entry points: **Profile → "Help & feedback"**, the **"No photo for this one"** card, the **Home
generation-error card**. The last two already exist and already render.

**Profile currently has NO support or contact row at all** — only Privacy Policy and Terms. That is a
submission-readiness gap, not just UX: a user with a problem has exactly one outlet, the App Store.

### Phase 3 — review prompt (Logan confirmed: BEFORE launch)
`expo-store-review` is **not installed**. Fire at the `cook-reveal` peak (the code calls it "THE
PEAK"), gated on ≥2nd session, with a cooldown.

**Compliance is non-negotiable and was researched, not assumed:**
* **No sentiment gating.** Apple treats filtered feedback as review manipulation; stated consequence
  is expulsion from the Developer Program.
* **No question before the prompt.** Apple's HIG: "Don't ask the user any questions before or while
  presenting the rating button or card." This kills the "Enjoying Pantry? 👍/👎" pattern Logan saw in
  a video **even if both branches offer a review**.
* Max **3 prompts per 365 days**; iOS may show nothing. Never build logic that assumes it appeared.
* **`isAvailableAsync()` returns false on TestFlight** — Phase 3 cannot be tested there.

Not building: public voting, roadmap, upvotes, email. The `kind` column makes voting a later table,
not a rewrite.

---

## 2. UNRESOLVED — things Logan raised that have no commit

* **Home screen layout redesign.** He wants the single-meal hero view GONE and the three meals shown
  like the Pantry list. Open question he said he would decide: **all three on one row, or each meal
  its own row.** He leans own-row ("looks better but more space costly") and wants the **daily meal
  log visible half-way up** so it is not scroll-only. Pantry-screen ingredients can move up into the
  space the meal card vacates. My opinion when asked: own-row reads better; the cost is the log
  getting pushed down, which is the thing he explicitly wants to avoid — so the two goals fight and
  he has not picked.
* **Discover freshness signal** (also `docs/PRELAUNCH.md` §2j). Users cannot tell Discover updates
  daily. His ideas: a gold/green "NEW" bracket on recent cards, or ordering each shelf newest-first.
  **Not investigated.** The thing to check first: shelf rotation is deliberately DAY-KEYED to vary
  order, so a strict newest-first sort would fight it.
* **Chocolate protein powder in a fruit parfait.** The 04:46 batch put chocolate powder with
  pineapple when the pantry ALSO has plain "Protein Powder". A flavour-coherence miss, not a bug.
* **Technique lies.** "Grilled Chicken and Pesto Plate" is pan-seared in its own steps. Measured at
  **1 of 51** — deliberately NOT gated, because the pipeline already drops ~25% of candidates and a
  2% failure does not justify a seventh gate. Revisit only if it passes ~10%.

---

## 3. UNVERIFIED ON DEVICE — everything below shipped today and has never been seen

Per the standing rule these must not be assumed working:

* **Servings stepper** on meal detail (1..max, ceiling follows the recipe). Step 1→3 and confirm the
  macro bar does NOT move — it is per serving by design.
* **Pantry refresh lighting Home's sweep bar**, and Home holding the new meals afterwards. Also
  meals 2 and 3 filling in on Home while Pantry ran the generation.
* **The no-photo fallback** — a capped meal shows a static plate icon and "No photo for this one",
  never an endless shimmer.
* **Home's generation-error card** — a failed generation now says why, and hides the CTA on
  `meal_cap_reached`.
* **`restTime`** rendering as "20 min prep · +8 hr rest" on Home card, hero pill, Pantry and detail.
* **The Pantry ↻ button** now reads the SERVER quota; it should grey out on its own after 6
  generations rather than failing when tapped.
* Discover: the 6 repaired images. **Logan's device may still show the old YouTube thumbnails** —
  `expo-image` caches by URI and his deck predates the fix. Not a bug; it self-heals on the next
  fetch.

---

## 4. THINGS THAT WILL BITE THE NEXT SESSION

* **Caps are DERIVED now.** `supabase/functions/_shared/caps.ts` — `MEAL_GEN_CAP_PER_DAY = 6`,
  `IMAGE_GEN_DAILY_CAP = 6 × 3 + 6 = 24`. Do not edit one without the other; they drifted apart once
  and shipped a live bug. `lib/useMealSuggestions.ts` keeps a DISPLAY-ONLY mirror of the meal cap
  because a device build must not import edge-runtime files.
* **Resetting Logan's caps for testing** (he hits them constantly):
  `update scan_usage set count = 0 where user_id = <his> and scan_type in ('meal_gen','image_gen') and day = current_date;`
* **The funnel is now queryable** — this is the single biggest tooling win of the session and it
  should be the FIRST thing consulted before theorising about generation:
  ```sql
  select created_at, stored, funnel from pipeline_runs
  where provider='generate-meals-funnel' order by id desc limit 1;
  ```
  It carries candidates asked/returned, every gate's drops, flagged-vs-fresh, the bans in force, the
  forms shown, and which source set each meal's macros.
* **Two counters lied today and both were caught by reading the funnel, not the code.**
  `droppedByFat` and `notCookable` were each read AFTER their filter, so they reported zero on
  success. If a new gate is added, record its counter where the drop happens.
* **The TDZ trap is real and recurring.** `funnel` used before declaration produced TS2448/TS2454 —
  a ReferenceError on every generation. The baseline moving 130 → 132 caught it in seconds. Watch
  the DELTA, not the total.
* **fal-ai/flux-2 bills per MEGAPIXEL** at $0.012; Pantry renders 512×512 = 0.262 MP ≈ **$0.0031 per
  image**. Resolution is SETTLED — Logan judged the current upscale fine and explicitly dropped it.
  The comment in `generate-meal-image` calling the resolution "the problem" is stale as a
  recommendation.

---

## 5. NEGATIVE RESULTS — do not retry these

* **A naive "berry" entry in `DEFINING_FOODS` does not work.** `tokens()` stems "blueberries" to
  "blueberry", never "berry", so a genuine blueberry smoothie reads as berry-less. It works only as a
  defining food AND a `SYNONYMS` group. The original exclusion comment was right; the conclusion was
  not.
* **"protein" and "powder" cannot be members of `GRAIN_DERIVATIVE`.** The escape hatch reads the DISH
  NAME, so a meal called "Protein Powder and Coffee Overnight Oats" turned the filter off — on the
  exact recipe it was written for.
* **Do not strip "orphan" oils and seasonings from ingredient lists.** "Heat a pan" implies the oil
  and "Season" implies the salt; stripping them UNDERSTATES macros. Only substantive ingredients over
  15 g are phantom. That exemption is the difference between removing 153 kcal of genuine phantom and
  537 kcal, most of it real cooking fat.
* **Do not tighten the upper calorie drop.** The ranking already picks the best 3 of 10, so a meal at
  1.4× target IS the closest the model produced — filtering harder starves the deck. `scale-recipe.ts`
  is the correct version of that instinct: change the food, not the filter.
* **Do not lengthen `RECENT_MEMORY`.** Still 30, still never the problem.

---

## 6. STILL OPEN FROM BEFORE THIS SESSION

* **`docs/PRELAUNCH.md` §2b — the ~1,400 cached images predate the prompt fixes.** Unchanged and
  still the biggest unresolved product risk. Note the catch discovered today: repairing an image
  updates the shared library but **not any deck a user is already holding**.
* **§2h — scale instead of regenerating** on a goal change. Designed, not built. Much of the
  machinery now exists in `_shared/scale-recipe.ts`.
* **§2i — the pantry variety unlock.** Deferred with the numbers, including why the cheap version
  does not work (`missing_ingredients` is empty by design in cookNow).
