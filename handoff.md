# Handoff — Pantry — 2026-07-22 (meal-card UX, meal-gen quality, personalized pantry insight)

## TL;DR
Big session: **28 commits, all pushed to `main`** (`999b3c2..92da706`). Two `generate-meals`
**edge-function deploys to prod** (fat ceiling + real-dishes + form/state, then a fat-floor fix).
Built a **goal- & diet-personalized "what to stock next" pantry insight** (new feature, replaces
the item-count banner), tested to ~85k fuzz scenarios.

⚠️ **Almost nothing this session is device-verified by you.** I test nothing on your phone. The
lists below mark what needs YOUR eyes. TS baseline held at **197** the whole session.

---

## ✅ SHIPPED (committed + pushed)

### Meal-detail screen UX (a long, iterated cleanup)
- **Ingredient rows: one clear tap = add to grocery** (`35d9e37`). Killed the old whole-row tap
  that silently wrote to `pantry_items` (a real footgun). Rows: NEED taps → grocery; HAVE = read-only;
  BASICS = the "assumed" opt-out only.
- **Cart icon for "Added"** (not a check — check = "in pantry") (`942afda`).
- **Removed the "+" vs bulk-pill redundancy**; then **removed the bulk "Add all to grocery" pill
  entirely** — per-row "Add" is the only mechanism now (`1a77486`, `81a970a`).
- **Merged "Pantry Basics (assumed)" into IN YOUR PANTRY** with a marker (`206fd7a`), which then
  iterated: pill → asterisk → teal → **neutral-grey `*` on a subtle round button** (tappable via
  shape, distinct from the green "have it" check) (`af438d2`,`3517e96`,`22fe24d`). Only the `*` is
  the opt-out target; there's an **undo toast** for accidental opt-outs (`57d013a`).
- **Cooking-oil staples bug**: pantry Cook-Tonight used a stale local staples list → "cooking oil"
  leaked into NEED. Deduped to canonical `isAssumedStaple` + honored `staples_excluded`/diet
  exclusions (`192f063`, `083701e`).

### Macro colors unified app-wide (`b09495d`, `82249c5`)
Canonical tokens in `constants/colors.ts`: **protein green, carbs blue (#60A5FA), fat purple
(#A78BFA), cals white, prep amber (#F59E0B)**. Fixed everywhere (home dashboard, meal detail, all
macro modals) — carbs was wrongly orange (colliding with prep), fat wrongly blue.

### Meal generation quality — DEPLOYED TO PROD ⚠️ verify in real output
- **Fat ceiling** (`5f40681`): there was NO fat constraint (only protein/calorie). Added a per-meal
  fat cap; **fat-floor fix** (`95d59e2`) so a fatty pantry doesn't collapse to 1 meal.
- **Real established dishes only** — no invented "Power Bowl" fusions; named after the real dish.
- **Correct ingredient form AND state** (`03e959e`): shredded/melted cheese not cold slices; raw
  vs ready-to-eat protein; bread ≠ tortilla; non-dairy milk not a savory dairy swap; egg whites ≠
  whole eggs; condiments are finishers.

### Bug fixes
- **Sign-out wiped the user's daily meals** → forced regen → burned the 3/day server cap → "Couldn't
  generate meals" (`1e447d3`). Fix: cache stamped with `userId`, ownership checked on read; sign-out
  no longer wipes meals. **Same user re-login restores meals; other account on shared device
  regenerates (no leak).**
- **Error messaging** (`6412348`, `9f9fd2a`): the real reason (esp. daily-cap) was hidden behind an
  opaque "non-2xx" error. New `lib/edgeError.ts` unwraps the server body → user-facing message +
  code. Cook-Tonight/cook-reveal show the real reason and hide a pointless "Try again" on cap.
  Applied to meals, AI-log, recipe-gen, URL-import.

### Onboarding trailer (⚠️ SUPERSEDED — see NEEDS ACTION)
Iterated a native composed trailer (Cal-AI form → hero → full-bleed stories → one continuous
cinematic shot, `6db6f91`) + a **first-time Grocery-toggle "peek"** (`2efe108`). **You then decided
the whole composed approach is wrong** — it can't be accurate to the real app. **The plan is now a
real screen recording** (see NEEDS ACTION #1).

### NEW FEATURE: personalized pantry insight (`lib/pantryProfile.ts` + pantry hero banner)
Replaces the shallow item-**count** "Stock Level" with a goal- & diet-aware **"what to stock next"**
line + one-tap "Add to grocery". Pure, heavily-tested rule engine.
- **v1** (`9cbd249`, hardened `e163fa7`): reads `fitness_goal`, `diet_type`, `dietary_restrictions`,
  `food_dislikes`. Rule tiers: protein-absence → produce/fiber → goal tuning → diet nudges →
  positive affirmation. Four filters (diet → allergies → dislikes → already-have) guarantee **no
  forbidden food is ever suggested**. Uses the item's real store `category` (robust), biases toward
  silence when ambiguous. Food suggestions only (no micronutrient/supplement claims), stocking-not-
  intake language, positive non-shaming tone. Research-grounded (fiber is the #1 real gap; most
  people have enough protein → no protein nag).
- **Step A — cuisine-tailored** (`88e0550`): ranks suggestions toward `cuisine_preferences`
  (Asian/Mexican/Italian/Mediterranean/American), after the safety filter.
- **Step B — cooking-skill/prep-tailored** (`92da706`): low-effort cooks (`cooking_skill`
  'minimal' or `max_prep_minutes` ≤ 15) get ready-to-eat picks ranked ahead of raw ones.
- **Spec:** `PLAN.md` (full design + §13 adversarial review of 9 cracks).

---

## 🔴 NEEDS YOUR ACTION (only you can do these)

1. **REDO the onboarding preview trailer as a REAL screen recording.** We agreed the composed native
   trailer can't be accurate to the app → bad-review risk. Capture ~7s on device: (0–2s) pantry
   scan → (2–4s) items populate → (4–5.5s) Cook Now meal cards w/ real photos → (5.5–7s) tap a meal
   → macros + "you already have everything". Record slightly slow, good lighting, best meals loaded.
   Then I trim/compress it, wire it in as a video, and delete `components/OnboardingTrailer.tsx`.
2. **Update the App Store screenshots.** (You flagged this.) Real AI-generated per your rule; the
   Pesto Chicken / meal-detail shots are strong candidates. Needs the real meal photos (FAL, #3).
3. **App Store preview VIDEO** (separate asset, Apple 2.3.4: real capture, NO device frame). Not
   started; the in-app trailer can't be reused there.
4. **FAL account cleanup** (carryover): pick the permanent account, set `FAL_KEY` in Supabase Edge
   secrets, verify meal IMAGES render, revoke the old `9eaf` key.
5. **Paywall + pricing mismatch** (carryover): paywall NOT live; memory/marketing say $7.99/$30 but
   handoff notes moved to ~$9.99/$29.99. Reconcile every price surface before submission.

---

## 🟡 IN PROGRESS — personalized pantry insight (continue here)

Order agreed: **A ✅ → B ✅ → C → D → E** (F=freshness was explicitly SKIPPED). Doing one step at a
time, tested + self-reviewed before each push.

- **Step C — "Pantry Check" coverage scorecard (NEXT, not started).** Add `coverage: {label,ok}[]`
  to the `Insight` return (Protein / Produce / Carbs / Fats → good/⚠, weighted to goal), render a
  chip strip in the card. I was about to refactor `buildInsight` to compute coverage once and append
  to every return. **No code written yet.**
- **Step D — rotation.** Cycle the top 2–3 gaps (or gap→tip→affirm) so the banner isn't the same
  line every visit (crack H — no dismissal yet).
- **Step E — `meal_logs` analysis.** Weekly averages vs goals (e.g. "averaged 110g protein vs your
  160g goal → keep protein on hand"). Columns: `calories, protein, carbs, fat, logged_at`. Powerful
  but edges toward coaching — **non-judgmental framing, sensitive for cutters**. Bigger build.
- **THEN: presentation pass** (you flagged separately): the hero banner may be too cramped for
  headline + detail + coverage strip + CTA → **may need to restructure/replace the hero card**, plus
  wording polish. Do this after the logic steps.

**buildInsight signature:** `(items, fitnessGoal, dietType, restrictions[], dislikes[],
cuisinePrefs[], cookingSkill, maxPrepMinutes)`.

---

## ⚠️ NEEDS DEVICE VERIFICATION (built + tested, NOT confirmed by you)

- **Meal-gen quality (DEPLOYED):** reset your cap (SQL below), regenerate → confirm 3 meals (not 1),
  leaner (no ~75g-fat bombs), **real dish names** (not "Power Bowl"), **melted/shredded cheese** in
  steps. This is the highest-value check.
- **Sign-out meal persistence:** generate meals → sign out → back in → same meals return, no loader,
  no cap burn.
- **Pantry insight banner:** no-veg pantry → "Add fruits & veg"; no-protein → "Add a protein source"
  (diet-appropriate); well-stocked → affirmation; tap "Add … to grocery" lands items. Cuisine/skill
  tailoring surfaces sensible picks.
- **Meal-detail UX:** NEED tap adds to grocery (doesn't jump to pantry); assumed `*` reads tappable
  & opts out w/ undo; macro colors correct (carbs blue, fat purple).
- **Error messages:** hitting the cap shows "Daily meal limit reached (3/day)" not a generic red line.
- **Grocery-toggle peek** (still in code): first Pantry visit pulses the "Grocery" pill once.

**Reset your daily meal-gen cap to test (Supabase → SQL):**
```sql
delete from public.scan_usage where scan_type = 'meal_gen' and day = current_date
  and user_id = (select id from auth.users where email = 'YOUR_APP_LOGIN_EMAIL');
```

---

## 🧪 TESTS (pantry insight)
Standalone Node scripts in the **scratchpad** (NOT committed — no test runner in repo):
`fuzz.js` (~85k scenarios, 0 forbidden-food leaks), `behavior.js`, `edge.js`, `cuisine.js`,
`effort.js`. To run: compile `lib/pantryProfile.ts` to a dir with tsc, then `node <script>.js`.
The fuzz uses an independent oracle that also flags any NEW catalog item that wasn't vetted. If you
want this permanent/CI, ask me to wire jest.

## 🔵 CARRYOVER / LANDMINES (from prior handoff, status unknown)
- **Revert `SCAN_CAP_WEEK`** if still lifted for testing (`supabase secrets unset SCAN_CAP_WEEK`).
- Onboarding profile upsert is the #1 bug source — stayed out of the data path; re-run a full
  onboarding + verify the row survives if you touch it.
- Meal images are globally cached — don't do per-user "optimizations".

## KEY FILES THIS SESSION
- `lib/pantryProfile.ts` — NEW pure classifier + rule engine (the insight brain).
- `lib/edgeError.ts` — NEW shared server-error unwrapper.
- `PLAN.md` — NEW full spec for the pantry insight + adversarial review.
- `app/(tabs)/pantry.tsx` — insight banner + CTA, staples/diet fetch.
- `app/meal/[id].tsx` — the ingredient-row UX rework, macro colors, assumed `*`.
- `constants/colors.ts` — macro color tokens.
- `supabase/functions/generate-meals/index.ts` — fat ceiling/floor, real-dishes, form/state (DEPLOYED).
- `components/OnboardingTrailer.tsx` — composed trailer (TO BE DELETED once the recording replaces it).

## COMMIT RANGE
`999b3c2..92da706` on `main`, all pushed (28 commits). `generate-meals` deployed to prod twice.
