# Handoff — 2026-09-16 (evening, CDT)

Replaces the 00:0x handoff from the same day. `git log 5fb6bd1..HEAD` carries the reasoning for
every commit. **The to-do list is `docs/PRELAUNCH.md`, and only PRELAUNCH.** This file holds state,
tells and decisions not to reopen. Everything below that is open is also in PRELAUNCH §3 (and §1
for the subscriptions).

**Two sessions worked this repo today.** This one did the scan → review → reveal flow, the pantry
matcher, subscriptions, caps and paywall testing. Another session did Discover / the trending
pipeline (PRELAUNCH §0 and the Sep 17 check list at the very top of PRELAUNCH) — read that list
from PRELAUNCH, not from here. Stage by explicit path; check `git log -1` after every commit (a
`git add -u` on already-`git rm`'d files silently stopped one commit chain today).

## 1. State

- **Committed and pushed.** Uncommitted and not ours: `skills-lock.json`, `.claude/skills/higgsfield-*`.
  `.claude/launch.json` is this session's preview config (`metro-fresh`), left uncommitted.
- **tsc 135 / 16 app-code. Tests 714** (`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).
- **Deployed today by this session:** `generate-meals` (one pantry matcher, thin-pantry refusal, no
  deck padding) and `scan-pantry` (week-limit `checkOnly`, `_meta` timing/tokens).
- **Preflight "?" lines are expected, not drift to fix blindly:** `_shared/scan-cap.ts` gained an
  additive helper (`readScanWindow`) that only scan-pantry calls, so generate-meal-image,
  parse-receipt, generate-recipe, estimate-meal-macros and extract-recipe-from-url read as "newer
  than deploy" with no behaviour change. `generate-meals` also reads newer because the other
  session changed `_shared/recipe-integrity.ts` at 15:30 (`7f109c8`, additive ingredient-line
  patterns) — redeploy generate-meals only if that change is wanted in Cook Now; ask that session.
- **No migrations today.** `SCAN_CAP_WEEK` is unset (7/week) — PRELAUNCH §9 closed.
- **Logan's account:** `promo_active = false` (turned off for paywall testing; he re-subscribed in
  sandbox, so he is premium through Superwall). Usage today: pantry 4/7 per rolling week, meal_gen
  3/6, image_gen 9/24. 221 in-stock pantry items (inflated by today's test scans). Reset SQL is in
  memory `reference_scan_cap_reset_sql` (reset `meal_gen` and `image_gen` TOGETHER).
- **Metro** was started through the preview tool (`metro-fresh`); a new session should confirm
  8081 is listening before telling Logan to reload.

## 2. Next — the scan wait plan (Logan approved; PRELAUNCH §3 "MEASURED 2026-09-16 17:41")

Measured on Logan's 6-photo scan at 17:41: **vision 39.5 s via gpt-5.4, no fallback**, 42,356
tokens in / 5,479 out / 0 reasoning; save 31 new + 49 restocked in 1.7 s; pantry save 17:41:00.9 →
meals inserted 17:41:02.6 (still generating when he tapped) → photos 17:41:09.7 / 10.0 / 10.3 →
reveal. The ~10 s "Plating your meals…" = ~2 s meals + ~7.5 s photos + <1 s download.

Order agreed:
1. **A — log the whole chain.** Perf marks: scan request start/end on the phone (upload + edge
   overhead + the 39.5 s), prefetch start, meals back, each photo URL, photos downloaded, plating
   start/end. Unknown today: when meal generation STARTED, and the scan's end-to-end phone time.
2. **B — parallel per-photo vision calls.** The 39.5 s is mostly one stream writing 5.5k output
   tokens; per-photo calls write ~0.9k each, so wall time ≈ the slowest photo (estimate 10-15 s —
   measure it). Input tokens ~+33% (the ~2.8k-token prompt repeated per call; image tokens
   unchanged), output ~flat. Quality check needed: each call loses cross-photo context; the review's
   `dedupeDetected` merges repeats. The gpt-5.4 price is not in the repo — get it before quoting cost.
3. **C — keep the big-type story running during plating** instead of a spinner on the button.
4. **D (small) — generate-meals starts the three photo generations itself** the moment meals exist
   (~1-2 s saved). Honest about the size.

## 3. Unverified on device (each is in PRELAUNCH §3 with its tell)

| What | Tell |
|---|---|
| Review: hand-adding an item no longer buzzes 5-10× (`c56b0fd`) | Add an item on "Check these N items" → one tap at most |
| Review: sections are Pantry-tab cards, Meat & Fish first (`c56b0fd`, `cc3a3da`) | Each aisle a dark rounded card, inset hairlines, 16 pt rows |
| Week-limit screen before the camera + "Add items by hand" (`12ca2e1`) | At 7/7 open the scanner → "You've used this week's scans", no camera; Add items by hand → Pantry tab, keyboard up; from Home → switches to Pantry tab |
| View recipe from the in-scan reveal (`5afa8be`) | Modal closes, meal opens; a short Pantry-tab beat here is expected and accepted |
| Two scans in one day: the earlier deck never flashes first (`4d996a6`, reinforced by `autoLoad=false`) | Second scan of the day → reveal's first frame is the new set; `generated_meals` timestamps tell sets apart |
| Subscriptions ride with the app | App Store Connect draft holds group + Monthly + Annual; only "add an app version" remains (§1) — closes at §12 |

Verified today (closed in PRELAUNCH): landscape photos upright; review scroll + headline; review ‹ →
camera, no double spend, button labels; meal-cap success step; one pantry matcher; meal-screen
flash; thin pantry; garnish as OPTIONAL; reveal flash gone; story + reveal; photos ready before the
reveal; Superwall metadata warning cleared.

## 4. Decisions not to reopen without new evidence

- **The reveal lives inside the scan modal.** A pushed route cannot appear until the RN `<Modal>`
  finishes dismissing — measured +2.02 s against a +0.80 s close. `app/cook-reveal.tsx` is only a
  wrapper around `components/CookRevealView.tsx`.
- **Reveal header = FROM YOUR PANTRY + the headline read off word by word, one tick on the number.**
  No lines under it, no placeholder cards, no waiting glow (Logan called the glow wrong). The reveal
  opens only when meals AND photo bytes are on the device (`takeRevealReady`, 25 s cap).
- **The scan-wait story is intentions, never meal claims** (the meals do not exist during the photo
  scan). `lib/scanStory.ts`: facts interleaved with goal lines, 4.5 s per line, ≤ 46 chars, numbers
  green. Ingredient names on reveal cards were TOSSED by Logan.
- **One pantry matcher everywhere** = the server's `_shared/pantry-check.ts`, imported by the app.
  Same-food rule: "banana peppers" ≠ banana; "crushed tomatoes" vs Tomato Sauce is MISSING; bare
  "cloves" vs Garlic Cloves is an accepted cheap false positive.
- **Thin pantry:** floor 6 in-stock items, no deck padding with uncookable meals, one message
  everywhere, refunds on refusal. Home rows are "Need:" or "✓ Ready to cook" only; a garnish shows
  only on the meal screen under OPTIONAL.
- **Scan stays live at the meal cap**; a capped Add all ends on "items added", no reveal.
- **Week-limit screen:** one action (Add items by hand) + ✕. No "go Home" button (redundant CTA).
- **Limits for launch:** pantry scans 7/week, meal generations 6/day. Revisit with PostHog data
  (`trackMealRegenerated`, cap errors, capped Discover-nudge taps), not before.
- **Paywall testing:** the paywall never showed because of `promo_active` + a device-level sandbox
  subscription — not accounts. Never Reset Onboarding on the main account; use Gmail +aliases.
  Memory: `reference_paywall_on_device`.
- **Scan-in-onboarding A/B is post-launch** — PRELAUNCH §2n and `~/founder-research/MY-EXPERIMENTS.md` Q2.

## 5. Mistakes worth not repeating

- **Fixed the wrong back arrow.** Logan's words named "this screen" next to a theatre screenshot; I
  changed the review's ‹. When a screenshot and the words could mean two screens, check which.
- **Said Home and the meal screen shared one definition** when only the optional-ingredient rule was
  unified; the "do you have it" test was still three matchers. Run the claim, don't infer it.
- **Filled a visible wait with a glow** instead of removing the wait. Find what is being waited on.
- **Said parallel scanning was already planned.** The existing "bounded concurrency" item is the
  client's photo preparation, not the vision call.
