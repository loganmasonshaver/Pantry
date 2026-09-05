# Pantry — Official Pre-Launch Checklist

**This is the canonical list.** When Logan asks "what's next for pre-launch", answer from this file.
Everything else in `~/my-briefing/todos/active.md` is either post-launch or stale until triaged —
that list was reviewed on 2026-08-30 and ~80% of its non-checklist items were stale.

Ordered by what should be done first. Later items depend on earlier ones.

---

## 1. Verify App Store Connect products  *(do first — external lead time)*
- [x] **Products exist and are correctly configured** — checked in App Store Connect 2026-09-04.
      Real product IDs are `com.kobalabs.pantry.monthly` (1 month) and `com.kobalabs.pantry.annual`
      (1 year) — NOT `pantry_monthly` / `pantry_annual` as this checklist previously said. Group is
      "Pantry Premium", Apple ID 6763233845 (monthly). Per-subscription localization is filled
      ("Pantry Premium" / "Unlimited AI meals, scans, and macro tracking"), tax category matches the
      parent app, availability is all countries.
      **"Prepare for Submission" is NOT an error** — it is the normal pre-submission state and does
      not mean anything is wrong. Two genuinely missing fields, below.
- [ ] **Review screenshot is EMPTY on both products.** Review Information -> Screenshot -> "Choose
      File" with nothing uploaded. Apple requires a shot of the purchase UI per auto-renewable
      subscription; this is the usual cause of a product sitting in Missing Metadata. Upload a
      screenshot of the Superwall paywall showing both prices — the same image serves both products.
- [x] **Subscription GROUP localization — DONE 2026-09-04** ("Pantry Premium", English (U.S.),
      "Use App Name"). Was empty; this is a separate field from the per-subscription localization.
- [x] ~~Subscription GROUP localization is EMPTY.~~ The "Pantry Premium" group's Localization
      section shows only a Create button. Separate field from the per-subscription localization
      that IS filled. Create English (U.S.) with display name "Pantry Premium" — this is what users
      see in iOS Settings when managing the subscription.
- [x] **Prices CONFIRMED 2026-09-04** — $9.99 monthly / $29.99 annual.
- [ ] **Leave Family Sharing OFF.** Currently off on monthly. Enabling it CANNOT be undone and lets
      one purchase cover up to six people.
- [ ] **Attach to the app version and submit TOGETHER.** App Store Connect states it twice on
      these pages: "Your first subscription group must be submitted with a new app version" and
      "Your first auto-renewable subscription must be submitted with a new app version." They
      cannot go on their own. Submitting the app WITHOUT them attached leaves the IAPs in limbo —
      the most likely explanation for the half-remembered "not approved".
- [x] **Superwall mapping CONFIRMED correct** (2026-09-04). "Pantry Main" paywall: primary =
      `com.kobalabs.pantry.annual` $29.99/year 7d trial, secondary = `com.kobalabs.pantry.monthly`
      $9.99/month 7d trial. Exact ID match with App Store Connect, prices match canonical pricing.
- [ ] **⚠️ Superwall shows "Missing required metadata" under BOTH products — this is NOT a Superwall
      problem.** Superwall reads product metadata from Apple, and Apple withholds it until the IAP
      has every required field. It is the SAME gap as the missing review screenshot / group
      localization above, surfacing in a second dashboard. Do not go looking for a fix in
      Superwall. **Use it as the verification signal instead:** once App Store Connect is complete,
      reload Superwall's products page and this warning should disappear. If it does not, Apple
      still considers something incomplete.
- Context: Logan recalls App Store Connect or Superwall reporting "not approved" at some point.
  Banking/Mercury is confirmed complete, so that is NOT the cause. Most likely remaining causes:
  products in "Missing Metadata", not attached to a version, or a Superwall mapping pointing at
  product IDs that no longer exist. Do this early — anything needing Apple review has lead time.

## 2. Trending pipeline — continued auditing, review and testing  *(major ongoing workstream)*
Not a single task. This is the largest piece of engineering still in flight and it has produced
significant findings on every pass — 13 fixes on 2026-08-30 alone, including two live rows serving
3x and 8x protein overclaims and a gate that had been silently dead for 19 days. Assume more remain.
- [ ] Keep re-running the cron and re-auditing the pool. Full standing procedure, open items and
      the measurement methods live in **`docs/TRENDING-OPEN.md`** — read it before each pass.
- [ ] Settle whether daily yield is variance or a defect. Identical code, sequential runs gave raw
      24 vs 5 and stored 17 vs 4 — so a once-daily cron takes ONE sample from that spread and the
      swap makes it permanent. Needs ~10 SEQUENTIAL `?dryRun=true` runs. If variance confirms, the
      fix is architectural (run 2-3x, keep the best batch) and no amount of prompt work helps.
- [ ] Finish the OpenAI fallback verification — one call:
      `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`
- [ ] **Four fixes shipped 2026-08-30 affect GENERATION only and are still unproven** — the method
      checklist, the truncation guards, the decimal parser fix and the junk gates. One run confirms
      all four; the exact SQL and pass criteria are in the "CONFIRM ON THE NEXT PIPELINE RUN"
      section at the end of `docs/TRENDING-OPEN.md`. Do not claim any of them work until then.
- [ ] Treat "it looks fine" as untested. Hand-verify every count before believing it.

**QUOTA BUDGET — the binding constraint on all of the above.** YouTube allows 10,000 units/day,
resetting at MIDNIGHT PACIFIC. A run costs ~1,314 units (13 search.list @ 100 + 14 videos.list @ 1),
so the day holds exactly **7 runs**. `?dryRun=true` costs the same — it skips DB writes and image
generation, not the YouTube calls. The cron was moved to 08:00 UTC (01:00 Pacific) on 2026-08-30 so
it draws from a fresh bucket instead of the previous day's leftovers; budget **1 run for the cron,
6 for testing**. Run tests SEQUENTIALLY — 3 fired concurrently starved each other and dropped the
candidate gate from 61 videos to 8.

## 3. Pantry scan flow — end to end + UI  *(blocks the trailer)*
- [ ] Walk the whole flow start to finish on a real device and confirm the UI holds at each step.
- [x] ~~Delete or wire the dead review screen first~~ — DELETED 2026-08-30. It was not a
      delete-vs-wire fork: step 55 is a strictly better version of the same review-and-confirm
      screen (photo grid, dedup'd list, search-doubles-as-add, keyboard handling), so step 6 was a
      superseded draft, not a missing feature. Removed the JSX block plus `toggleItem`,
      `checkedCount`, `grouped` and 8 orphaned style keys — 125 lines, no behaviour change.
      Live path is unchanged: 1 → 4 → 5 → 55.
- [ ] Re-test the camera on device: it has not been checked since the 16-photo cap and the
      full-width scan pill landed, and the bottom bar now carries filmstrip + shutter + full-width
      button. If the viewfinder feels cramped, hide the tips pill after the first photo.

## 4. "Skip onboarding" paywall variant
- [ ] Let skeptical users skip onboarding to explore first, then show a paywall tailored to
      browsers. Must be in the build that goes to TestFlight, and likely appears in screenshots.

## 5. Rating prompt — sentiment-gated, never the native popup first
Review count is the durable moat against a copycat: a competitor can clone the UI in a weekend but
cannot clone 400 reviews. Must be in the TestFlight build.
- [ ] Ask at a **success moment**, not on launch or on a timer. Candidates: 3rd meal cooked, first
      pantry scan that returns a full shelf, a meal saved. Must not collide with the paywall or the
      onboarding trailer.
- [ ] **Own modal first.** "How's Pantry working out?" → two paths, no App Store branding on it:
      - Loves it → THEN fire the native prompt (`StoreReview.requestReview()`).
      - Doesn't → route to an in-app feedback form, never to the App Store. Bad reviews land in a
        private pool that feeds the roadmap instead of the public rating.
- [ ] Needs `expo-store-review` — **not currently a dependency.** Add it before building the flow.
- [ ] Needs an in-app feedback form — **does not exist yet.** Nothing in `app/` collects written
      user feedback today (the "feedback" hits in the codebase are all haptics). Simplest version:
      a text field writing to a `feedback` table with RLS insert-only for `auth.uid()`.
- [ ] Ask once, then never again for that user unless they engage. Persist a `review_prompted_at`
      on the profile — an unsaved flag re-asks on every reinstall.

**Two constraints that decide the design — read before building:**
- **iOS caps the native prompt at 3 per user per 365 days,** and it silently no-ops past that with
  no callback and no error. So the gate is not just a rating filter — it is how you avoid burning a
  scarce prompt on someone who was going to leave 2 stars. That is the real argument for it.
- **App Store Review Guideline 5.6.1 says Apple "will disallow custom review prompts."** The
  sentiment-gate is a gray area: it is shipped by large apps and rarely rejected, but it is against
  the letter of the rule. Keep the pre-screen worded as a satisfaction question, not a review ask —
  no stars, no "rate us", no App Store logo. If it says "rate us" it is a custom review prompt and
  it is rejectable.
- **On a premium-only app the review pool is small.** Nearly everyone who could review is a trialist
  or subscriber, so gating too aggressively can leave you with 12 reviews instead of 40. Volume at
  the ask matters more than purity of the filter — do not set the bar so high that almost nobody
  reaches the native prompt.

## 6. End-to-end test AI meal generation
- [ ] Full path on device, not simulator.

## 6b. Home screen — verify the next-day behaviour  *(CANNOT be tested same-day)*

Four changes shipped 2026-09-02 that only reveal themselves on the FIRST OPEN OF A NEW DAY. They
are invisible today because today's cache already exists, so none of this can be signed off in the
session that wrote it.

- [ ] **"Yesterday's picks · fresh ones cooking"** appears above the Cook-from-pantry carousel on
      the first open of a new day, with yesterday's three meals shown while today's generate
      underneath — instead of a 6-8s skeleton. Label disappears when today's land. (`43d7055`)
- [ ] **No blank gap.** The section holds its place and shimmers from first paint; it must never be
      absent for 2-3s and then push the page down when it appears. (`9237e47` — this part IS
      testable same-day.)
- [ ] **Discover hero is a dish not served before**, and does not change again once the page has
      settled. (`a14c9b4`)
- [ ] **"Almost in your kitchen" does not lead the page every day**, and its internal order differs
      from the previous day. (`37b9ba1`)

- [ ] **Photo-gated meal swap.** When a generation lands while meals are on screen, the old meals
      hold until the NEW hero's photo is ready, then cross-fade in (300ms). The tell is the ABSENCE
      of a shimmer beat between old and new. Testable same-day with the refresh button — it does not
      need a day rollover. (`08771ab`)
- [ ] **Category icons and colours.** Every pantry category should now have a real icon, not a grey
      box, and the three overlapping condiment rows should be one. Testable on any reload; the
      backfill is already applied and verified at zero off-list rows. (`750f4d6`)
- [ ] **Pantry "Add an item".** Header pill is now a `+` icon; a dashed "Add an item" row sits at the
      end of the category list. Testable on any reload. (`129fe3c`)
- [ ] **⚠️ COLD-START DEFECTS — Logan could not verify these, they need a NEW DAY's first open.**
      Both were found from the 11:21 screenshots on 2026-09-04 and both are fixed blind.
      - [x] **Calorie/protein goals must NOT flash the wrong numbers.** VERIFIED ON DEVICE 2026-09-04. The ring used to animate to
            a hardcoded 2,400 kcal / 180g before the profile landed, then re-animate to the real
            2,100 / 160g. Goals now hydrate from AsyncStorage on mount. **This part is testable
            TODAY** — force-quit and reopen: the ring should animate exactly once, to your numbers.
      - [ ] **No shimmer between yesterday's meals and today's.** `HERO_IMAGE_WAIT_MS` was 8000,
            calibrated against the cached-image path (~50ms); a dish nobody has generated before
            needs a ~10s Flux render, so the gate always timed out and swapped in the shimmer
            anyway. Raised to 22000. **Needs a day rollover.** Tell: yesterday's photo holds until
            today's photo replaces it, with no shimmer beat between them.
      - [x] **The sweep bar reads as activity — VERIFIED ON DEVICE 2026-09-05.** Logan: "it
            behaved as it should, looked like something was cooking in the background."
      - [ ] **NEW 2026-09-05, UNVERIFIED: no dark gap between the shimmer and the photo.**
            Ending the skeleton at `meals.length > 0` ended it when the TEXT arrived, so the card
            sat over MealImage's flat #1A1A1A for 1-2s while the photo downloaded — visible
            precisely because the sweep bar had just made the screen look busy. Home now holds the
            skeleton until the hero photo PAINTS (`onLoad`), capped at 2500ms, and only when there
            is a URL to wait for. Sequence should be sweep bar -> shimmer -> photo, with no dark
            beat. (`bf41c61`)
      - [ ] **NEW 2026-09-05, UNVERIFIED: regenerated photos actually reach the device.**
            Storage uploads with upsert, so a regenerated image overwrites the same path and every
            client keeps serving its cached copy forever — three corrections to the Protein Jello
            photo were invisible on device for this reason. URLs now carry `?v=<timestamp>`.
            (`34707fe`)

- [ ] **Repeat/variety fixes need DAYS, not a reload.** The base-food ban, the deduped 30-dish
      window and the protein-family guard only prove themselves across several generations. Watch
      for: no cottage-cheese/potato run, and no two meals that are the same dish reworded.
      (`8de4e00`, `ef1c4b4`, `a38a9b9`)

**How to test without waiting:** these all read the DEVICE clock (`dayOfYearNow`, `todayStr`), not
the database — no SQL can simulate a new day. Either wait for tomorrow, or set the iPhone forward a
day (Settings > General > Date & Time > off "Set Automatically"). Expect a Supabase token refresh
when the clock jumps; there is a `refreshSession` path for it, worst case sign in again.

---

## 6c. Home + Pantry layout — OPEN DESIGN QUESTION, needs a decision before the trailer

Not a bug list. The layout of these two tabs is unresolved and item 7 films them.

- [ ] **Decide how Home presents the three meals.** Today it is a hero carousel auto-rotating every
      6250ms, so meals arrive one at a time even on an idle device. Logan's objection: the old
      Pantry "Cook Tonight" list showed all three AT ONCE and was better for choosing. The code
      admits the tradeoff at `app/(tabs)/index.tsx:519` — "so all 3 are surfaced over time". The
      rotation is compensation for a layout with room for one meal, and ~44 references of
      loop/recentring machinery exist to serve it.
- [ ] **Constraint that killed the obvious fix:** Discover already opens on a big photo hero. Give
      Home one too and both tabs lead with the same visual move, so neither has an identity. Any
      proposal has to say what makes Home look different from Discover.
- [ ] **Decide whether the Pantry tab shows meals at all.** It currently does (Cook Tonight,
      restored). Measured cost: ~700pt of an 852pt screen before a single ingredient is visible, on
      the tab called "My Pantry".
- [ ] **Scan-card placement.** Probably state-gated rather than fixed — an empty pantry has nothing
      else to show and scan IS the content; a stocked one should not be pitched a feature it has
      already adopted. Logan pushed back on demoting scan and that pushback is recorded.
- [ ] **Scan Pantry card illustration** — the line drawing does not read as a shelf with food on it.
      Same root problem as the category icons: line art asked to carry meaning at a size where it
      reads as abstract shapes.

---

## 6d. RAISED BY LOGAN 2026-09-04 — decided, not built  *(work these before anything below)*

These came out of a working session and existed ONLY in that conversation until now. Each has a
decision attached; do not re-open the decision, build it. Ordered by how directly Logan asked.

**The original complaint — Pantry categories sit below the fold.**
Measured from the stylesheet: ~926pt of chrome above the first category row against a ~710pt
viewport, so categories start ~215pt below the fold. Agreed fix, then parked when Logan pivoted to
Home ("drop all of those design changes for now") — parked, NOT rejected:
- [ ] Render NOTHING when `buildInsight` returns `tone === 'affirm'`. That state is terminal: the
      pantry can only grow (see the depletion item below), so once you have no gaps you see the
      same sentence and four checkmarks forever. The eight `gap` messages are good and stay —
      including the log-driven protein nudge at `lib/pantryProfile.ts:258`, which IS dynamic.
      Banner then survives exactly where the trailer films it (a fresh pantry has gaps).
- [ ] Cut "Cook tonight" from the Pantry tab. It duplicates Home's three meals from the same hook,
      and Home's "See all →" points AT it, so "See all" currently leads to less. Home's "See all"
      goes with it. Frees ~426pt and removes the cold-day double-generation race.
- [ ] Scan cards stay exactly as they are, full size, second on the screen. Logan pushed back on
      demoting scan TWICE and he is right — scan is the acquisition hook. It is also not needed:
      banner + Cook tonight alone are 614 of the 926pt.
- [ ] Result: header 78 + scan 130 + search 68 + categories header 36 = 312pt, rows land at 720.

**Pantry category rows carry two data points for 68pt each.**
- [ ] Colour the icon circles at rest. `app/(tabs)/pantry.tsx:184` already has `category.iconColor`
      and only applies it when the row is EXPANDED, so all six read as identical grey. One line.
      This is also where the tab's visual identity comes from once the banner is gone.
- [ ] Add 2-3 item names as a muted subtitle ("chicken, ground beef, salmon…"). Same height, triple
      the information, answers "what's in there" without a tap.

**⚠️ The pantry cannot deplete — and meal generation is built on top of that.**
- [ ] Every `in_stock` write in the app sets TRUE (`lib/pantryInsert.ts:41`, `grocery.tsx:374`,
      `pantry.tsx:558`). The only path to FALSE is the manual toggle at `pantry.tsx:486`, buried
      inside a collapsed category below the fold. So `useMealSuggestions.ts:106` generates from a
      pantry that only accumulates — an ever-growing fiction — and "Ready to cook" is a claim the
      app cannot back. Likely a contributor to the repeat problem: a 55-item pantry keeps every
      stale ingredient in the prompt forever. Needs a decision (log a meal → offer to mark its
      ingredients used? a "still have this?" nudge on items untouched for N weeks?), not a patch.
      Blocked on confirming `pantry_items.created_at` exists — the table is not in any migration.

**Home layout — knobs left unspent after the 2026-09-04 compression.**
Shipped: LOG_PEEK reserve, ring 170→124, header crunch, slot rows slimmed. Still available:
- [ ] `LOG_PEEK` 128 → 170 shows most of Lunch, costs ~42pt of photo. One constant.
- [ ] Move the day nav inside the calorie card (~20pt).
- [ ] Drop "Let's start tracking today" (~18pt, loses a dynamic line).
- [ ] Calorie card → number-left / ring-right, macros as a 3-tile row (~60pt, and it retires the
      "Show carbs & fat ▾" disclosure). Biggest win; the Cal AI move Logan shared.

**Smaller, all confirmed by reading the code or the screenshots:**
- [ ] Pantry tab icon is `UtensilsCrossed` (`app/(tabs)/_layout.tsx:96`) — a MEAL icon on the
      ingredients tab. Should be a shelf/basket/box.
- [ ] "Other" holds 12 of 56 pantry items — 21% still uncategorised after the 2026-09-03 backfill.
      Either the scan model punts to Other freely or the canonical list has a gap.
- [ ] Saved Meals runs 4 filters over 5 meals. Show filters past a threshold (~8) or they read as
      scaffolding.
- [ ] Grocery: "Just 2 items left to complete your list" at 0/2 — "left" implies progress made.

**DECIDED — "Made from your pantry" is post-launch, and it is an ARCHIVE, not an expansion.**
- [ ] Not "Cook tonight but longer". `RECENT_MEMORY = 30` is the no-repeat window, so expanding
      Cook tonight means "3 fresh picks + 27 you already passed on", and stale rows carry unbackable
      readiness badges. Reframed: a separate section BELOW the categories, "Made from your pantry —
      18 dishes", different promise from both Home (tonight) and Discover (the internet's food).
      Cheaper than the design in `docs/todos.md` because moving the entry point off Home's carousel
      removes the terminal-card-in-an-infinite-loop problem that doc calls the real build risk.
      Hard-gate below ~12 dishes or it looks broken in the trailer. Sharpest objection on record:
      Saved Meals already holds the ones worth keeping, so the honest pitch is "the one you forgot
      to save".

---

## 6e. Security follow-ups from the 2026-09-04 sweep

The critical finding (a published, permanent premium bypass) is FIXED and verified in prod — see
`git log` for `20260904151500` / `152600` / `153900`. Never exploited: 0 redemptions all time.
What that sweep left open:

- [x] **Replacement comp code minted 2026-09-04** via `scripts/creator-code.sh` — shared, 25 per
      rolling 30 days, expiring. Value lives in the DATABASE and in Claude's local memory only.
- [x] **Anon-callable `insert_saved_meal` overload DROPPED** — SECURITY DEFINER, no `auth.uid()`
      check, took the target account as a parameter, executable by `anon`. Third instance of the
      leftover-overload trap. (`cc9d43b`)
- [x] **Creator comp codes rebuilt** — `scripts/creator-code.sh`, rolling 25-per-30-days budget,
      denied attempts no longer eat it, attribution can no longer be silently overwritten. The live
      code is in Claude's memory, never in this repo.
- [ ] **🚫 STANDING RULE — a code value never enters this repo.** It has leaked TWICE now:
      `PANTRY_CREATOR` in the 2026-05 seed, and `CREATORS-D9929`, hand-written into
      `20260904171500` about an hour after the first was removed. Both were rotated rather than
      edited out, because the repo is public and git history keeps the value. To touch the live
      code from SQL, match on a property (`grants_premium`, `cap_window_days`, `creator_name`),
      never on the literal. `scripts/creator-code.sh` is the only sanctioned way to create one.
- [ ] **`validate_referral_code_v2` is still an anon oracle** returning `grants_premium` for any
      guess, and PostgREST calls bypass the edge functions' rate limiter entirely. It cannot simply
      be revoked: onboarding calls it at step 16, BEFORE createaccount, and step 3325 skips the
      paywall on the result. Entropy + a redemption cap is what makes the oracle worthless; real
      rate-limiting needs an identity anon does not have.
- [x] **⚠️ The migration tree does not match production — DIFFED 2026-09-04, and it found a live
      hole.** `insert_saved_meal` had TWO overloads in prod; the superseded 9-arg one was SECURITY
      DEFINER, had NO `auth.uid()` guard, took the target account as a parameter, and was executable
      by **anon**. Dropped in `20260904161200` and verified: one overload left, guarded.
      Also confirmed benign: `handle_new_user()` and `rls_auto_enable()` are in no migration but
      both return `trigger`/`event_trigger`, so neither can be invoked directly. `rls_auto_enable`
      is wired to `ensure_rls on ddl_command_end` and never disables RLS — it is why every table
      had RLS on. Every remaining anon-executable DEFINER function is either uncallable (trigger)
      or guarded internally by `auth.uid()`.
      **Standing rule this produced: audit against `pg_proc`, never against the migration tree.**
- [ ] **Item 10 downgraded, see below.**

---

## 7. Onboarding trailer  *(after 3 — the app must be final before filming)*
- [ ] BLOCKED ON A DECISION: is any cached meal image hero-grade enough to hold 2.4 seconds? That
      frame is a third of the film.
- [ ] Shot list: https://claude.ai/code/artifact/766f88c0-a922-463a-ad84-09059a351b14

## 8. App Store screenshots + description  *(after 3)*
- [x] **NAME DECIDED 2026-09-04 — `Pantry: AI Meal Planner` (23/30), already live in ASC.**
      A 2026-04-07 decision renamed it to "Pantry: Food Tracker" to drop "AI"; that rename was
      never applied and has now been dropped rather than completed. Reasoning: dropping "AI"
      optimised for brand taste at a stage where the name's only job is discovery — zero users
      means no brand equity to protect, and the name field is the heaviest-weighted keyword
      surface in App Store search. Cal AI, the direct benchmark, carries "AI" in the same
      category. "Food Tracker" was also the wrong fight: that term belongs to MyFitnessPal /
      Lose It / Cal AI, and Logan's own positioning is "instead of getting the macros we make
      the food" — the differentiator is generation, so "Meal Planner" is where it lives.
      No conflict with the no-sparkles rule: that governs UI craft, this is a discovery surface.
- [ ] **Subtitle proposed: `Scan your pantry, track macros` (30/30)** — picks up the *pantry
      scan* and *macro tracking* keywords the name gives up. Not yet set in ASC.
- [ ] **⚠️ The name/subtitle call was reasoned from structure and the Cal AI precedent, NOT from
      live search-volume data.** A real ASO check belongs here before the copy is written.
- [ ] Screenshots must be AI-generated, not Figma re-skins.

## 9. Unset SCAN_CAP_WEEK  *(after the trailer and screenshots are shot)*
- [ ] `npx supabase secrets unset SCAN_CAP_WEEK` — unset is correct; scan-pantry falls back to 7.
      Held raised deliberately until app fixes and filming are done. Preflight fails until reverted.

## 10. Clean git history of leaked secrets  *(DOWNGRADED 2026-09-04 — not a blocker)*
The `.env` committed at `eb9a624` contained ONLY `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Both ship inside the IPA by design and are public keys. No
service-role, OpenAI, FAL or FatSecret secret is in history. Real hygiene, not a launch gate.
- [ ] BFG Repo-Cleaner — anon key still in old commits.

## 11. TestFlight beta
- [ ] Everything above must be in the build.
- [ ] **Prove the email system end to end here, not at launch.** It had NEVER worked before
      2026-08-30 (`4c016c2`) — loops-sync selected `email`/`full_name` from `profiles`, which have
      never been columns there, so every call failed on the unknown column and no contact or event
      ever reached Loops. Now reads identity from `auth.users`. Needs a real signup + purchase to
      confirm.
- [ ] **Verify the engagement counters move.** `touchLastActive`, `trackCookTonightUsed`,
      `trackMealSavedEngagement` and `trackGoalsCustomized` had never been called by anything
      (`8977f41`). Use the app — save a meal, open a Cook Tonight pick, change a goal — then re-read
      the profiles row. Until this is checked the Loops sequences are unproven.

## 12. App Store submission
- [ ] App Review demo account: `appreview@heypantry.app`, `promo_active=true`, entered in App Store
      Connect. REQUIRED AT EVERY SUBMISSION — a missing one is an automatic rejection.
- [ ] Paste the prepared App Review Notes into the Notes field.
- [ ] Submit.

---

## Unresolved — surfaced 2026-08-30

Four of the five originals are fixed (orphan Discover row deleted, grocery evening date bug, mock
data removed from the bundle, `last_active` schema drift). The email and engagement items moved into
step 10, since TestFlight is where they can actually be proven. What is left unowned:

- **`CODE_REVIEW.md` — TRIAGED 2026-08-30, and it is CLEAN where it matters.** All 3 criticals and
  all 15 highs were re-verified against live code and the live database: **18 of 18 are closed**.
  The results table is at the top of that file. Two are worth knowing: C1 (promo_active bypass) is
  fixed by a TRIGGER and not by RLS — the policy is still blanket `auth.uid() = id`, so anyone
  auditing this must check `trg_enforce_server_premium`, not the policy. And H13 is by design:
  onboarding proceeds without a purchase because every feature is gated downstream, which is the
  behaviour item 4 formalises.
  The 42 medium and 27 low findings were NOT checked. Given an 18-of-18 stale rate on the severe
  ones, a fresh `/security-review` would carry more signal than triaging the rest.

## Deliberately NOT on this list

Decided with Logan on 2026-08-30 — do not re-add without asking:

- **Stripe web checkout** (3 items) — Apple IAP alone is sufficient to launch.
- **Paywall A/B tests** (pricing, hard-vs-soft, placement) — cannot be run without traffic.
- **Creator recipes** — a v2 feature. The single orphan row was deleted so it does not render.
- **2FA**, Instagram import, Whisper transcripts, share extension, custom vision/macro models,
  dessert and trending feature scoping, content-lead hiring and UGC scaling.
- The 13 content-idea screen recordings are launch marketing, not submission blockers.
