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
- [ ] Settle whether daily yield is variance or a defect (blocked on YouTube quota).
- [ ] Finish the OpenAI fallback verification (one call, blocked on quota).
- [ ] Treat "it looks fine" as untested. Hand-verify every count before believing it.

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

## 11. App Store submission
- [ ] App Review demo account: `appreview@heypantry.app`, `promo_active=true`, entered in App Store
      Connect. REQUIRED AT EVERY SUBMISSION — a missing one is an automatic rejection.
- [ ] Paste the prepared App Review Notes into the Notes field.
- [ ] Submit.

---

## Unresolved — surfaced 2026-08-30

Four of the five originals are now fixed (orphan Discover row deleted, grocery evening date bug,
mock data removed from the bundle, `last_active` schema drift). What remains:

- **`CODE_REVIEW.md` holds 87 confirmed findings.** Its paywall findings were verified stale on
  2026-08-30; the other ~80 have not been checked. Worth one triage pass — some are certainly
  already fixed, some may not be.
- **Email system needs one real end-to-end test.** It had NEVER worked: loops-sync selected
  `email` and `full_name` from profiles, which have never been columns there, so every call
  failed on the unknown column and no contact or event ever reached Loops (fixed `4c016c2`).
  Subscription lifecycle now recorded server-side by superwall-webhook. Proving it needs a real
  purchase or expiration through Superwall — worth doing during TestFlight rather than at launch.
- **Engagement trackers wired but not device-verified.** `touchLastActive`,
  `trackCookTonightUsed`, `trackMealSavedEngagement` and `trackGoalsCustomized` had never been
  called by anything; they are now wired (`8977f41`). They fire on real interactions and write
  server-side, so confirm by using the app and re-reading the profiles row. Until that is checked,
  treat the Loops email sequences as unproven.
