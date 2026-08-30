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
- [ ] Delete or wire the dead review screen first — `setStep(6)` is never called anywhere in
      `PantryScanModal`, so the "Found N ingredients / review and confirm" screen (~80 lines) is
      unreachable. Live path is 1 → 4 → 5 → 55. Don't QA around a ghost.
- [ ] Re-test the camera on device: it has not been checked since the 16-photo cap and the
      full-width scan pill landed, and the bottom bar now carries filmstrip + shutter + full-width
      button. If the viewfinder feels cramped, hide the tips pill after the first photo.

## 4. "Skip onboarding" paywall variant
- [ ] Let skeptical users skip onboarding to explore first, then show a paywall tailored to
      browsers. Must be in the build that goes to TestFlight, and likely appears in screenshots.

## 5. End-to-end test AI meal generation
- [ ] Full path on device, not simulator.

## 6. Onboarding trailer  *(after 3 — the app must be final before filming)*
- [ ] BLOCKED ON A DECISION: is any cached meal image hero-grade enough to hold 2.4 seconds? That
      frame is a third of the film.
- [ ] Shot list: https://claude.ai/code/artifact/766f88c0-a922-463a-ad84-09059a351b14

## 7. App Store screenshots + description  *(after 3)*
- [ ] Screenshots must be AI-generated, not Figma re-skins.

## 8. Unset SCAN_CAP_WEEK  *(after the trailer and screenshots are shot)*
- [ ] `npx supabase secrets unset SCAN_CAP_WEEK` — unset is correct; scan-pantry falls back to 7.
      Held raised deliberately until app fixes and filming are done. Preflight fails until reverted.

## 9. Clean git history of leaked secrets
- [ ] BFG Repo-Cleaner — anon key still in old commits.

## 10. TestFlight beta
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

## 11. App Store submission
- [ ] App Review demo account: `appreview@heypantry.app`, `promo_active=true`, entered in App Store
      Connect. REQUIRED AT EVERY SUBMISSION — a missing one is an automatic rejection.
- [ ] Paste the prepared App Review Notes into the Notes field.
- [ ] Submit.

---

## Unresolved — surfaced 2026-08-30

Four of the five originals are fixed (orphan Discover row deleted, grocery evening date bug, mock
data removed from the bundle, `last_active` schema drift). The email and engagement items moved into
step 10, since TestFlight is where they can actually be proven. What is left unowned:

- **`CODE_REVIEW.md` holds 87 confirmed findings and ~80 are unchecked.** Its paywall findings were
  verified stale on 2026-08-30 (`handleStartTrial` no longer exists; Restore Purchase, Privacy and
  Terms all have live handlers in `profile.tsx`), and its "canonical pricing" note was itself the
  stale thing — it flagged the live $9.99 as a defect. The report predates a lot of security work.
  Worth one triage pass; expect a mix of already-fixed and genuinely open.

## Deliberately NOT on this list

Decided with Logan on 2026-08-30 — do not re-add without asking:

- **Stripe web checkout** (3 items) — Apple IAP alone is sufficient to launch.
- **Paywall A/B tests** (pricing, hard-vs-soft, placement) — cannot be run without traffic.
- **Creator recipes** — a v2 feature. The single orphan row was deleted so it does not render.
- **2FA**, Instagram import, Whisper transcripts, share extension, custom vision/macro models,
  dessert and trending feature scoping, content-lead hiring and UGC scaling.
- The 13 content-idea screen recordings are launch marketing, not submission blockers.
