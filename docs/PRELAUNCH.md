# Pantry — Official Pre-Launch Checklist

**This is the canonical list.** When Logan asks "what's next for pre-launch", answer from this file.
Everything else in `~/my-briefing/todos/active.md` is either post-launch or stale until triaged —
that list was reviewed on 2026-08-30 and ~80% of its non-checklist items were stale.

Ordered by what should be done first. Later items depend on earlier ones.

---

## 1. Verify App Store Connect products  *(do first — external lead time)*
- [ ] Confirm `pantry_monthly` ($9.99) and `pantry_annual` ($29.99) exist, are priced right, and are
      in a submittable state.
- [ ] Confirm they are attached to the app version being submitted — a first-time IAP is reviewed
      WITH a version, not on its own.
- [ ] Confirm the Superwall product mapping points at those exact product IDs.
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

## 7. Onboarding trailer  *(after 3 — the app must be final before filming)*
- [ ] BLOCKED ON A DECISION: is any cached meal image hero-grade enough to hold 2.4 seconds? That
      frame is a third of the film.
- [ ] Shot list: https://claude.ai/code/artifact/766f88c0-a922-463a-ad84-09059a351b14

## 8. App Store screenshots + description  *(after 3)*
- [ ] Screenshots must be AI-generated, not Figma re-skins.

## 9. Unset SCAN_CAP_WEEK  *(after the trailer and screenshots are shot)*
- [ ] `npx supabase secrets unset SCAN_CAP_WEEK` — unset is correct; scan-pantry falls back to 7.
      Held raised deliberately until app fixes and filming are done. Preflight fails until reverted.

## 10. Clean git history of leaked secrets
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
