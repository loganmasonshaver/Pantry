# Handoff — Pantry — 2026-07-27 (meal-gen quality, keyboard-trap sweep, onboarding reveal)

## TL;DR
**18 commits, all pushed to `main`** (`6c8ce52..71f71ae`). TS baseline held at **197** every single
commit. Big themes: meal-generation honesty rules, an app-wide keyboard-trap sweep, image cost
control, and a lot of onboarding-reveal iteration that **ended unresolved — Logan is still not happy
with how that screen looks.**

⚠️ **Two edge functions have committed changes that are NOT deployed** (see below). Nothing from the
meal-quality or image work is live until they are.

⚠️ Almost nothing here is device-verified. I don't test on the phone.

---

## 🔴 DEPLOY FIRST — committed but NOT live
```bash
npx supabase functions deploy generate-meals
npx supabase functions deploy generate-meal-image   # if not already done
```
`generate-meals` carries: defining-ingredient rule, cut/form awareness, quantity + equipment
realism, meal-slot tagging, and the dish-naming rules. **None of it is live yet.**
(Logan confirmed deploying `generate-meal-image` earlier for the cache-key change; re-check.)

---

## ⛔ THE ACTUAL LAUNCH BLOCKERS (Aug 1 target = ~5 days)
Everything below this line in "SHIPPED" is quality work. **None of it gates submission.** These do:

1. **Paywall products are "Incomplete" in Superwall.** Root cause found: **Review Information →
   Screenshot is empty** in App Store Connect on both products. Localization IS done. Fix: upload a
   screenshot of the paywall to `Pantry Monthly` AND `Pantry Annual` → Save → **Add for Review**.
   - Expect Superwall to keep saying "Incomplete" until Apple approves the app — a first
     auto-renewable subscription can't be approved standalone (ASC says so in a banner). **Sandbox
     purchases still work**, so test the paywall on device regardless.
   - Still unverified: the **Pantry Premium subscription GROUP** has its own localization.
2. **FAL account cleanup** — pick the permanent account, set `FAL_KEY` in Supabase secrets, verify
   images render, revoke the old `9eaf` key. **This gates screenshots.**
3. **App Store screenshots** — hard requirement, can't submit without them. Needs #2.
4. **Onboarding preview video** — real screen recording to replace `OnboardingTrailer.tsx`. Optional
   for submission (screenshots aren't). Drop this first if time runs out.

**Pricing changed to $9.99/mo** (was $7.99). Updated in 6 places incl. the App Review Notes text and
`~/founder-research/GOALS.md` unit economics. Annual is now 75% off vs 69%, which strengthens the
annual-default play.

---

## 🟡 OPEN / UNRESOLVED — the onboarding plan reveal
**Logan is still not happy with this screen.** Six commits today, net effect below. Do NOT just
iterate on it again without a plan.

What changed today (all shipped):
- Slot tags (BREAKFAST/LUNCH/DINNER) removed earlier — they were the "meal-planner" tell.
- Generate-plan step: AI sparkle + orange "All done!" replaced with a recap of the user's own
  answers (goal / diet / meals a day / cook time) — `1a2edf0`.
- Sample-meals card → replaced with an honest next-step card ("Next: scan your kitchen") — `71f71ae`.
  Reason: "Meals from your kitchen" was a claim the app can't back (they haven't scanned yet), and
  the 3-row list looked half-finished.

**Failed attempt, fully reverted (`572f0b3`)** — a "scan teaser" animation in that card. Three
versions, each worse:
1. Reused the pantry tab's SVG fridge → that art is drawn for a 160×70 thumbnail and degrades into
   crude green boxes at full width.
2. Diet-aware chips + bounded loop → fixed real flaws, didn't fix the visual.
3. Real fridge photo → portrait image in a 168px letterbox with `cover`, cropped to a slice of blur.

**Lesson written into global `~/.claude/CLAUDE.md`:** never drop an image or borrowed art into a
container without checking source-vs-target aspect ratio; if the art doesn't fit the slot, the answer
is different art *made for that slot*, not a different `resizeMode`. And: when I can't see the
result, say so rather than iterating on visuals more than once.

**If picking this up next session:** the screen's real payoff is the trajectory/macros card. The
open question is whether anything should sit below it at all, or whether the reveal should end there
and go straight to the CTA. Get a design decision before writing code.

---

## ✅ SHIPPED (all pushed)

### Meal generation — honesty + realism (prompt work, NEEDS DEPLOY)
- **Cook Now can only miss OPTIONAL finishing items** (`01c1951`). The "stretch" meal used to allow
  1-2 missing staples with no notion of what's load-bearing — it produced *Thai Peanut Chicken
  Noodles* for a pantry with no chicken AND no pasta, while ignoring the ground beef sitting there.
  New test: does the missing thing change what the dish IS? Never missing: protein, main carb,
  primary fat/dairy, anything in the title.
- **Name the specific variety** — "pasta" is vague; rice noodles suit Thai, penne doesn't. Prefer the
  exact pantry item when there is one.
- **Respect the cut/form** (`d22da13`) — chuck/brisket need low-and-slow and can't appear in a
  25-minute dish; ground meat → tacos/bolognese; tender cuts → sear, not braise.
- **Quantity + equipment realism** (`a9eae96`) — the pantry records WHAT, never HOW MUCH, so meals
  can't hinge on a dozen eggs. Recipes may only REQUIRE stove/oven/microwave/basic blender.
- **Meal-slot tagging + time-of-day display** (`a9eae96`) — generation spreads meals across eating
  occasions and tags a `slot`; the **pantry list sorts by time of day at display**. Split
  deliberately: meals generate once a day, so generating "breakfast" at 8am would strand the user
  with oats at dinner.
- **The name must describe what the steps do** (`90350d5`) — real output was "Garlic Butter
  Pan-Seared Chicken" whose steps were *plate the chicken salad alongside sautéed potatoes*. Nothing
  seared, no chicken cooked. Also: pre-prepared items (chicken salad, hummus, rotisserie chicken) are
  already cooked — use as-is, never name as if cooked from raw. And if the honest name is
  unappealing, the MEAL is wrong, not the name.
- Client: `Need: X` → **`Better with: X`** — anything listed is optional by construction now.
- Client: **thin-pantry hint** on the Pantry tab (no in-stock protein, or <8 items).

### Images — cost + accuracy
- **Tightened `normalizeKey`** (`ec9d544`) — image cost scales with UNIQUE KEYS, and "Easy Chicken
  Parmesan" / "Classic Chicken Parmesan" / "Chicken Parmesan" were three paid images of one dish.
  Strips effort/vibe words, framing phrases, folds plurals. **Deliberately does NOT collapse cooking
  methods** (grilled ≠ fried ≠ baked — those plate differently). Checks BOTH the new and legacy key
  and backfills, so the existing library isn't orphaned.
- **Processed ingredients render as their finished form** (`a8a6aab`) — granola came out as raw oats.
  Now: granola = golden baked clusters, tortilla chips ≠ tortillas, peanut butter ≠ peanuts.

### Keyboard traps — app-wide sweep
Logan hit the ✕ on the scan-review screen to dismiss the keyboard and it discarded **57 detected
items** (unrecoverable — the vision call was already spent). Audited every screen with a TextInput
and guarded **15 sites**:
- HIGH: `ReceiptScanModal` (✕ + Cancel), `RecipeFormModal` (← Back), Home "Log a Meal" backdrop,
  `PantryScanModal` row ✕ during rename.
- MEDIUM/LOW: food-preferences, createaccount, signin back arrows; meal slot-picker backdrop; pantry
  add-ingredient Cancel; grocery clear-checked; saved import Cancel; FoodSearchModal back;
  MacroEditModal; EditPortionModal; CreatorRecipeModal.
- New `hooks/useKeyboardVisible.ts` for sites needing render state; `Keyboard.isVisible()` for
  handler-only guards.
- **Rule saved to global `~/.claude/CLAUDE.md` + `~/founder-research/PLAYBOOK.md`** (★ HARD).

### Auth — real bug
- **`onboarding_complete` now cleared on sign-out** (`b56d67e`). It's device-scoped, so after any
  sign-out the NEXT account created on that device was routed straight to `/(tabs)` — **skipping
  onboarding and the paywall**. On a premium-only app that's a revenue bug. Safe because `_layout`
  already falls back to the server profile and re-sets the flag.

### Home screen
- Daily meal generation: bare `ActivityIndicator` → **card-shaped skeleton with narrated status**
  ("Checking what's in your pantry" → "Matching recipes to your goals" → "Plating today's picks"),
  clamped on the last line so a slow gen doesn't loop (`6c8ce52`, `8975146`).
- Hero keeps narrating while the photo loads ("Plating your dish…" + utensils mark) instead of going
  silent behind a black rectangle (`a59ba0a`).
- **`MIN_SPLASH_MS` 2000 → 1200** — 2s of brand made no sense when the screen behind it needs ~15s.
- **NEW TODAY badge was built then pulled** (`3203b4b`) — badging a batch as "new" only holds up if
  the meals are visibly different, and name-suppression only covers the last 12. Over-promising costs
  more trust than the badge buys.

### Scan flow
- Camera: **"Start with your fridge"** (was three options at once); hero title opens large/centered
  for 5s then settles; tips pill replaces a dead tip line; brackets pushed toward the edges;
  redundant "?" removed.
- Hub: **area tiles are now a coverage checklist** (green check + photo count + "tap to add more").
  Counting rather than a boolean is what makes multiple fridges/counters work. Headline is
  **"More ingredients, tastier meals"**.
- Review: **search-or-add field** (typing filters the list), duplicate prevention mirroring
  `lib/pantryInsert.ts`, KeyboardAvoidingView, visible caret, tap-out to dismiss.
- Tap a captured thumbnail to view it full-screen.
- Camera **Back returns to the areas hub** instead of killing the whole scan.

### Docs
- **`PLAN-meal-reuse.md`** (`2b7e464`) — post-launch plan to serve pantry-cookable meals from
  `trending_meals` (images already cached) instead of generating new ones. Kills both the photo wait
  and most image spend. Sequenced: measure pool hit rate → extract ONE shared pantry matcher →
  serve a capped share. **The landmine is called out**: a second divergent copy of the cookability
  check is exactly how "Cook Now showed a meal you can't cook" shipped once already.

---

## ⚠️ NEEDS DEVICE VERIFICATION (built, typechecks, NOT confirmed)
- **Image warm — never confirmed end-to-end.** Do a genuinely FRESH scan with Metro running and check
  whether **cards 2 and 3 arrive with photos** when swiping at a normal pace. This is the one I most
  want verified; it's the difference between the reveal feeling instant or not.
- After deploying `generate-meals`: does it **use your ground beef**? Do dish names match their steps?
- **Onboarding → profile write-back test** (CLAUDE.md rule after ANY onboarding change). Today's
  onboarding edits were rendering-only, but verify every field survives anyway.
- Sandbox-purchase both tiers once the ASC products go green.
- Scan-review: search filters, no duplicates, ✕ dismisses keyboard before closing.

---

## 🧨 LANDMINES / CARRYOVER
- **TS baseline = 197.** Held all session. Don't claim to have introduced/fixed those.
- **Onboarding profile upsert is the #1 bug source.** Today's changes were display-only; anything
  touching the data path needs a full write-back test.
- **`app/(tabs)/index.tsx` and the meal cache are date-keyed** — cache changes need day-boundary
  verification, not same-day.
- **No way to bust a bad image in production.** Four cache layers (meal cache → device image cache →
  `image_cache` table → Storage) and the storage filename is deterministic, so a regeneration reuses
  the same URL. Post-launch: add a hash/version suffix so regeneration mints a new URL.
- **`~/my-briefing/todos/active.md` keeps regenerating** and dropped my in-session edits twice. Git
  history is the reliable record.
- Empty pantry falls back to FAKE ingredients (`chicken breast, rice, eggs, broccoli`) in
  `useMealSuggestions` — gated by `pantryNames.size > 0` today, but it's a trapdoor.

## KEY FILES THIS SESSION
- `supabase/functions/generate-meals/index.ts` — all the honesty/realism rules (NEEDS DEPLOY)
- `supabase/functions/generate-meal-image/index.ts` — cache key + processed-ingredient rules
- `app/onboarding/index.tsx` — generate-plan recap, reveal next-step card
- `components/PantryScanModal.tsx` — camera copy, hub checklist, review search, keyboard guards
- `hooks/useKeyboardVisible.ts` — NEW
- `context/AuthContext.tsx` — the sign-out flag fix
- `app/(tabs)/index.tsx`, `app/(tabs)/pantry.tsx` — loading states, thin-pantry hint, slot sorting

## COMMIT RANGE
`6c8ce52..71f71ae` on `main`, all pushed (18 commits). TS 197 throughout.
