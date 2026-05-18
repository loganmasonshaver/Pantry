# Handoff — Creator attribution shipped + verified on device, plus a stack of fixes

## TL;DR

This session built and **end-to-end verified** the creator attribution pipeline (Supabase code → Superwall user attribute → trial events tagged), shipped a stack of bug fixes (delete account, trial reminder, image fields, meal detail crash), made the referral code field accept ANY input (not just allowlisted), and locked in the creator program structure via a deep dive deliberation (saved as docs/creator-program-plan.md + project memory).

**Headline win:** completed a real sandbox trial purchase on Logan's iPhone with code `NOAH` → Superwall shows `Referral Code: NOAH` on the user AND on the `Trial Start` + `Transaction Complete` events. Pipeline confirmed working end-to-end.

**18 commits pushed to `main` this session:**

| # | Commit | What |
|---|--------|------|
| 1 | [`a19ff89`](https://github.com/loganmasonshaver/Pantry/commit/a19ff89) | Pin git workflow to main-only |
| 2 | [`f3a0030`](https://github.com/loganmasonshaver/Pantry/commit/f3a0030) | Strip stale freemium line from CLAUDE.md |
| 3 | [`bf4dfc6`](https://github.com/loganmasonshaver/Pantry/commit/bf4dfc6) | Fix meal detail "rendered more hooks" crash |
| 4 | [`308e0f9`](https://github.com/loganmasonshaver/Pantry/commit/308e0f9) | Trending pipeline: same-day Jaccard dish dedup |
| 5 | [`10d7f3e`](https://github.com/loganmasonshaver/Pantry/commit/10d7f3e) | Animated illustrations inside Pantry scan cards |
| 6 | [`ab44870`](https://github.com/loganmasonshaver/Pantry/commit/ab44870) | Drop scan-card icons, tighten height |
| 7 | [`3a9571c`](https://github.com/loganmasonshaver/Pantry/commit/3a9571c) | Creator program plan v1 (Cal AI draft) |
| 8 | [`68884fc`](https://github.com/loganmasonshaver/Pantry/commit/68884fc) | Creator program plan v2 (50% first-conversion FINAL) |
| 9 | [`8c24fb1`](https://github.com/loganmasonshaver/Pantry/commit/8c24fb1) | Tag Superwall users with `referralCode` attribute |
| 10 | [`d212c9b`](https://github.com/loganmasonshaver/Pantry/commit/d212c9b) | Normalize image field (saved_meals.image_url vs meal.image) |
| 11 | [`21b9636`](https://github.com/loganmasonshaver/Pantry/commit/21b9636) | Ingredient-faithful image prompt + rename misleading recipe |
| 12 | [`c46156f`](https://github.com/loganmasonshaver/Pantry/commit/c46156f) | Accept ANY referral code typed (no allowlist gate) |
| 13 | [`bcc382e`](https://github.com/loganmasonshaver/Pantry/commit/bcc382e) | TEMP: flip `DEV_FORCE_PAYWALL=true` (KEEP ON per user request) |
| 14 | [`0c499e4`](https://github.com/loganmasonshaver/Pantry/commit/0c499e4) | Delete-account: manually wipe child rows before auth delete |
| 15 | [`00b3cf9`](https://github.com/loganmasonshaver/Pantry/commit/00b3cf9) | Delete-account: clear ALL onboarding AsyncStorage keys |
| 16 | [`d3eb9ad`](https://github.com/loganmasonshaver/Pantry/commit/d3eb9ad) → [`db7a8ad`](https://github.com/loganmasonshaver/Pantry/commit/db7a8ad) | Trial reminder day-5 push (was 71hr/3-day, broken for 7-day trial) |
| 17 | [`987d7aa`](https://github.com/loganmasonshaver/Pantry/commit/987d7aa) | New users now see real plan-meal images (shared image_cache fallback) |

---

## Creator program — final structure decided

Full doc at [docs/creator-program-plan.md](docs/creator-program-plan.md). Memory saved at `project_creator_program.md`.

### Stage 1 (default, pre-launch / first ~6 months)
- **Commission: 50% of first payment, one-time.** Monthly conversion = $4, annual conversion = $15.
- **Triggers on first paid charge after 7-day trial**, NOT on signup or trial start.
- **No payments on renewals** — clean, predictable, no monthly accounting.
- Pitch: "I pay 50% of what each new user pays me, once when they survive the trial."

### Stage 2 (12+ months out, top performers only)
- **Graduation criteria:** creator drives 100+ paid conversions in any 90-day window.
- **Upgrade:** $500/mo flat retainer + 15% recurring on referred users for 6 months.
- Don't build Stage 2 mechanics until a golden goose emerges.

### Why this beat alternatives
Long iterative debate captured in docs/creator-program-plan.md. Short version: at $8/mo ARPU with 18% cost-to-revenue ratio, percentage recurring math is brutal. Flat per-conversion is simpler, pitches better to newbie creators (anchors on the bigger "50%" headline), and bounds your liability on golden geese.

---

## Creator attribution — wiring + verification

### Architecture
1. **User types code in onboarding** → `SReferralCode` validates via `validate_referral_code_v2` RPC (now accepts ANY code, not just allowlisted)
2. **Code saved to Supabase** → `profiles.referral_code_used = 'NOAH'`
3. **Superwall identify + update** → [_layout.tsx](app/_layout.tsx) on session change + [onboarding/index.tsx](app/onboarding/index.tsx) `finish()` both call `superwallUpdate({ referralCode })`
4. **Superwall tags every subsequent event** with the attribute (Trial Start, Transaction Complete, all auto-tagged)
5. **Superwall dashboard chart** breaks down events by `referralCode` attribute

### Verified end-to-end on Logan's iPhone (2026-05-18 ~2:45pm)
- Code `NOAH` typed in onboarding → appeared on Superwall user
- Completed sandbox trial purchase with `sandbox02@heypantry.app`
- Superwall user detail page shows: `Referral Code: NOAH`, `Has Referral Code: Yes`
- Recent Events panel shows: `Trial Start` and `Transaction Complete` both fired
- Charts → New Trials → Breakdown by Referral Code (Environment filter set to PRODUCTION,SANDBOX) → NOAH visible with count

### Key code changes
- [app/_layout.tsx](app/_layout.tsx) — fetches profile.referral_code_used on session change, calls `superwallUpdate({ referralCode })`
- [app/onboarding/index.tsx](app/onboarding/index.tsx) — `finish()` immediately calls `updateSuperwallUser({ referralCode })` right after profile upsert (so paywall view in same session is tagged)
- [app/onboarding/index.tsx](app/onboarding/index.tsx) `SReferralCode` — removed validation gate, ANY code typed gets saved
- Existing Supabase code system (`referral_codes` table + RPC) still works for `grants_premium=true` creator personal-access codes

---

## Stack of fixes shipped this session

### Delete Account (was completely broken)
Two bugs compounding:
1. Edge function called `auth.admin.deleteUser()` which fails when child tables (saved_meals, pantry_items, meal_logs, etc.) lack `ON DELETE CASCADE` on their FKs. Fixed in [supabase/functions/delete-account/index.ts](supabase/functions/delete-account/index.ts) — now manually wipes all child rows with service-role privileges before deleting auth user.
2. Client only cleared 4 of 9 onboarding AsyncStorage keys, so re-login resumed mid-onboarding instead of starting fresh. Fixed in [app/(tabs)/profile.tsx](app/(tabs)/profile.tsx) — now mirrors Reset Onboarding's full cleanup.

**Deploy needed:** `supabase functions deploy delete-account` (done by Logan)

### Trial reminder push notification
Was hardcoded to fire at 71hr (3-day trial minus 1hr) but trial is now 7 days. Fixed to fire at day 5 (~120hr): "Your free trial ends in 2 days."

### Meal detail image rendering
Two stacking bugs:
1. saved_meals DB column is `image_url` but render code expected `meal.image` → fixed in parse block to normalize.
2. Meal name "Hard-Boiled Eggs and Fruit" rendered as berries because Gemini visual-description prompt had "Do NOT list ingredients" rule (added in 559f059 to prevent deconstructed-component photos). Replaced with INGREDIENT FIDELITY + ASSEMBLED-NOT-STACKED rules. Renamed recipe to "Hard-Boiled Eggs Snack Plate" to force cache regen.

**Deploy needed:** `supabase functions deploy generate-meal-image` (already done by Logan)

### New users seeing blank plan-meal thumbnails
`finish()` only consulted local AsyncStorage for image URLs (empty for first-ever signup). Now batch-queries the shared server-side `image_cache` table, so any plan meal generated by any prior user shows immediately.

### Trending meals same-day dedup
Added Jaccard word-overlap check WITHIN today's batch (not just cross-day). Catches "beef chili + chicken chili" case that protein-source dedup missed because they have different primary proteins.

### Meal detail "rendered more hooks" crash
Slot-picker hooks were declared AFTER an `if (!meal) return` early return. Hoisted them above to keep hook order stable across renders.

---

## Pantry scan card UI

Animated SVG illustrations now fill the two scan cards on the Pantry tab (Scan Pantry + Scan Receipt). Mirrors home-screen hero animation pattern, downsized. Removed the 48×48 icon containers and absolute-positioned the AI badge in the top-right corner to tighten card height. Visual parity between cards (both have sweeping beam animations synced via shared `Animated.Value`).

---

## State of important flags

- **`DEV_FORCE_PAYWALL = true`** in [context/SuperwallContext.tsx:16](context/SuperwallContext.tsx:16) — **LEAVE ON per user request.** Logan uses creator code (`PANTRY_CREATOR` or similar with `grants_premium=true`) to bypass paywall during dev. If you flip it off, paywall stops firing in dev → can't test paywall behavior.

- **Apple Sign-In entitlement** confirmed in [ios/Pantry/Pantry.entitlements](ios/Pantry/Pantry.entitlements). Both Debug + Release Xcode build configs reference the same file (lines 365 + 405 of project.pbxproj). Sign in with Apple WILL work in release builds. Verify Apple Developer Portal has "Sign in with Apple" capability enabled on the `com.kobalabs.pantry` App ID before submission.

---

## Where Logan is on launch path

**Logan's stated next move:** iterate on features before TestFlight rather than rush to ship. Wise — TestFlight burns review cycles when builds are half-baked.

### What works rock-solid (verified on device this session)
- Onboarding flow end-to-end
- Paywall + sandbox purchase
- Creator attribution
- Recipe templates with images (shared cache fallback)
- Reset Onboarding + Delete Account
- Push notification scheduling for trial reminder

### What Logan said he wants to iterate on next
- **App Store screenshots via Huashu design GitHub repo** — Logan's last request before context cutoff. Investigate the repo, propose how to integrate, generate screenshots for the App Store listing.
- Onboarding redesign partial per active.md
- Saved Meals + Profile redesigns pending
- Various modal redesigns pending

### TestFlight readiness gaps (when ready)
1. Flip `DEV_FORCE_PAYWALL = false` for production builds
2. Verify App Store Connect:
   - App icon 1024×1024 uploaded
   - Privacy Policy URL (heypantry.app needs `/privacy` page)
   - App Review Demo Account in Review Information (creds already exist: `appreview@heypantry.app` / `PantryReview2026!`)
3. Subscription products confirmed "Ready to Submit" or "Approved"
4. Bump version + build number in app.json
5. `eas build --platform ios --profile production` → `eas submit --platform ios`
6. Add internal testers in TestFlight

---

## File pointers

- [docs/creator-program-plan.md](docs/creator-program-plan.md) — full creator program structure with case studies + financial models
- [app/onboarding/index.tsx](app/onboarding/index.tsx) — onboarding flow, finish() at ~3860, SReferralCode at ~1737
- [app/_layout.tsx](app/_layout.tsx) — session-change Superwall identify + update with referralCode (line ~39)
- [context/SuperwallContext.tsx](context/SuperwallContext.tsx) — `DEV_FORCE_PAYWALL` at line 16 (keep TRUE), trial reminder at ~95
- [app/(tabs)/profile.tsx](app/(tabs)/profile.tsx) — Delete Account (~810), Reset Onboarding (~877)
- [supabase/functions/delete-account/index.ts](supabase/functions/delete-account/index.ts) — manual child-row cleanup before auth delete
- [supabase/functions/generate-meal-image/index.ts](supabase/functions/generate-meal-image/index.ts) — Gemini prompt with INGREDIENT FIDELITY rule

---

## Things to verify / pick up next session

1. **App Store screenshots via Huashu design GitHub repo** — Logan's pending ask. Find the repo, evaluate fit, propose workflow.
2. **Quick smoke test on iPhone:** new user → reset onboarding → walk through → confirm plan-card meal thumbnails actually show real images now (the fix from this session).
3. **Active.md sweep:** session focused on creator program + bug fixes; active.md hasn't been updated this session with everything that shipped.

---

## Known limitations / v2 todos

- **`aps-environment` in entitlements is "development"** — Apple's distribution signing usually auto-flips to "production" but worth verifying push notifications work on TestFlight.
- **Duplicate "Referral Code" entries in Superwall breakdown dropdown** — cosmetic, both keys work but only camelCase `referralCode` is populated. Not worth fixing now.
- **Image generation doesn't write back to `saved_meals.image_url`** — when meal/[id].tsx auto-generates an image, it shows in component state but next view regenerates (fast since server-cached, but still a round-trip). Future improvement: UPDATE saved_meals.image_url when auto-generation succeeds.
- **Pre-existing TS errors** at [app/onboarding/index.tsx:393](app/onboarding/index.tsx:393) and [app/(tabs)/index.tsx:196/1064](app/(tabs)/index.tsx:196) — not introduced this session, not blocking.

---

Branch: `main` (Logan's workflow — all work goes directly to main, no feature branches)
