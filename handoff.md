# Handoff — 2026-08-29

38 commits. **`git log --since="2026-08-29"` carries the reasoning for every one** — what was
tried, what was rejected, why. This file holds only what git does not: the next task's method,
where the hunt has and hasn't reached, dead ends worth not repeating, and what needs Logan.

Preflight is green: tree clean, everything pushed, migrations match, every edge function deployed
at or after its last source commit.

---

## 1. NEXT TASK — keep hunting the same bug family

Logan's stated next step. **14 bugs found today, none of which had a test before this morning.**
They are all one shape:

> A string/number transformation over **model- or user-written food text**, correct for the case it
> was written for and wrong for a neighbouring one.

### The method that actually worked

Reasoning about the code found almost nothing. What found bugs, in order of yield:

1. **Run the function over realistic inputs and read the output.** Every single bug was visible in
   one line of output and invisible in review. `2% milk` → `% milk`.
2. **Ask what the neighbouring case is.** The clove row was written for garlic; the neighbour is
   the spice. The egg row was written for whole eggs; the neighbour is liquid whites.
3. **Check ordering in any first-match-wins table** (below).
4. Only then read the code.

### Already swept — don't redo

- `lib/ingredientDisplay.ts` — all 13 helpers, 31 tests
- `lib/categoryMatch.ts` — 7 tests
- `supabase/functions/_shared/dish-key.ts` — 9 tests
- `supabase/functions/_shared/macro-estimate.ts` — 17 tests

64 tests total: `node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`

### NOT swept — the actual leads

- **`constants/staples.ts`** — `isAssumedStaple` normalises then does an exact `Set.has`. Read but
  not tested. It is called as `isAssumedStaple(ing.name, …)` at `app/meal/[id].tsx:815` with the
  RAW ingredient name — check what happens when that name still carries a quantity or a
  parenthetical, since the alias set only holds bare forms.
- **`components/PantryScanModal.tsx`** — the scan→pantry path. Names arrive straight from GPT
  vision here, the least curated text in the app, and it already has 4 pre-existing TS errors
  (missing `zone`).
- **`supabase/functions/scan-pantry`** — the other end of that pipe.
- **`lib/recipeTemplates.ts`** — the backfill path used when a saved meal has no recipe data.
  Scales ingredient grams by a calorie ratio; scaling bugs are this family.
- **The Eyeball/Measured toggle end to end** — helpers are tested individually, the composition
  is not.
- **`lib/fatsecret.ts` `parseMacros` / `pickDefaultServing`** — unit conversion over third-party
  data.

### The recurring structural hazard

**Three separate first-match-wins keyword tables were all bitten by declaration order today:**
`WHOLE_UNIT_FOODS`, the macro reference table, and `CATEGORY_KEYWORDS`. If a fourth turns up,
assume it is broken until a shadowing test says otherwise. The test shape that catches it: pin a
canonical example to the row that should own it, for every row.

---

## 2. NEEDS LOGAN — nothing can proceed without these

- **The trailer.** Direction is settled (app-forward, ~8s, five beats — plan artifact:
  `https://claude.ai/code/artifact/f1b2d236-1923-407b-864e-34c954b464d7`). Blocked on: reshoot vs
  work from existing footage. **Before any shoot, raise `SCAN_CAP_WEEK` in Supabase secrets —
  pantry scans are 7 per rolling 7 days, not 5/day, and 7 takes will not survive a session. Put it
  back afterwards.**
- **square_hd.** Every meal image is 512×512 and the recipe hero renders it at ~1500 physical px —
  a 2.9× upscale. Flipping `image_size` in `generate-meal-image` costs ~4× the pixels per image and
  that pipeline is marked don't-touch for cost reasons, so it is a pricing decision. Existing images
  will not change regardless: filenames derive from the meal key and are served
  `max-age=31536000` (verified on a GET; a HEAD misleadingly reports `no-cache`). Logan asked to go
  over this properly and it has not happened.
- **The black screen on tab switch.** Untouched today. Still unsolved, still recommended for cutting
  from launch, 9 hypotheses excluded — see the 2026-08-28 handoff in git history before re-testing
  anything.

---

## 3. WATCH — deployed today, needs real-world numbers

`generate-meals` is deployed with two new gates. Both log; neither has been observed in production.

- **`[macro-check]`** — one line per candidate: `ok` / `skip` / `DROP` with the ratio. A meal is
  dropped only when its ingredients cannot support its claimed macros, and only while ≥3 candidates
  survive. **If `DROP` is common, suspect the reference table before suspecting the model** — a
  false positive deletes good food and the user never learns why.
- **`Repeat filter: dropped N repeat(s)`** — the reworded-repeat detector. **If duplicates still
  appear tomorrow and this line is absent, the similarity threshold needs another look.** The
  evidence that motivated it: 18 remembered meal names, 18 distinct `dishKey`s, zero repeats
  detected, while all three meals shown that day had a near-duplicate in the list.
- **`Macro rank: … N repeat(s) had to fill the deck`** — means the fresh pool was genuinely
  exhausted, not that the filter misbehaved.

Logan generates sporadically (7 active days in a month), so `RECENT_MEMORY = 30` spans **weeks** of
calendar time for him. If the generator starts running out of ideas on a narrow pantry, that window
is the first thing to loosen.

---

## 4. DEAD ENDS — do not repeat

- **Hero tilt parallax: reverted.** It stepped, not stuttered. Animating a **layout** prop commits
  through the shadow tree and does not update per frame; `WORST 8ms` proved the UI thread never
  dropped one. If revisited, the sensor must write a *target* and a frame-synced spring must follow
  it. Full post-mortem in commit `7785f81`.
- **`LayoutAnimation` does nothing.** Expo 55 enables the New Architecture; `configureNext` is a
  no-op under Fabric. Reanimated's `LinearTransition` / `FadeIn` are the equivalent.
- **Reanimated layout animations are per-component.** A parent animating does not carry a child's
  position change, a child does not cover its container resizing. Three separate elements needed
  their own `layout=` on Home before the reflow stopped snapping.
- **Do not tune an animation you cannot see.** Six fixes went into the macros toggle aimed at the
  wrong layer. What solved it was a device screen recording extracted at 60fps and measured per
  frame — 3 visual updates in 117ms on a 120Hz display. Ask for a recording early.
- **`/index.bundle` is the wrong Metro entry** for this app and returns a 4.6MB runtime-only bundle
  with no app code. Use `/.expo/.virtual-metro-entry.bundle` (~18MB) to check what the device is
  actually being served.

---

## 5. NOT DONE, deliberately

- **The "Fresh today" badge is unearned.** `app/(tabs)/pantry.tsx:389` shows it whenever
  `meals.length > 0`; the only other input is whether the *user* has viewed today. It never checks
  whether the meals are new. Now that repeats are actually detected, gating it on a genuinely fresh
  generation is a small honest change.
- **Meal naming** ("Savory Cottage Cheese and Egg Scramble" is a hash — step 1 sautés 150g of
  potatoes). Cosmetic, model output, and meal names feed the image cache key so changing naming
  conventions has cost implications. Argued against; Logan has not overruled.
- **Home still re-renders 5× per macros toggle** (was 8). The hero's `onLayout` feeds `heroFit`
  which feeds the hero's height, so measuring drives layout drives measuring. Invisible now that
  the reflow is native. The fix is to stop deriving the hero's height from a live-measured `y` —
  **not** to defer the measurement, which was tried today and produced a visible delayed jump.
- **782 stale meal images.** Unchanged from yesterday: regenerating in place reaches nobody without
  versioned filenames.
