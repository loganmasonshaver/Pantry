# Pantry Post-Mortem — the recurring mistakes (fuel for the manuals)

Mined from ~851k tokens of past Claude Code sessions + transcripts, 2026-07-06.
This is the raw material. Every manual/CLAUDE.md rule below is earned from a real
failure that cost time — not generic best practice.

---

## The 8 recurring failure patterns

### 1. Onboarding → profile persistence (the #1 time sink)
Same class of bug hit repeatedly across May 8, May 16, May 31, Jun 5, Jun 6:
- Profile data silently lost after onboarding reset (carbs/fat/goals missing)
- `upsert` overwriting fields instead of merging
- Empty meal data persisted; goalDelta wheel pick not honored in plan reveal
- dietary_restrictions / food_dislikes mapping getting dropped
**Root cause class:** onboarding is one giant file writing to `profiles` via upsert;
any change to it silently drops fields downstream.
**Lesson → rule:** After ANY onboarding change, verify every profile field round-trips
(write → read back → assert). Never trust the upsert to preserve untouched columns.

### 2. Cache invalidation
- Meal cache regeneration broke on timezone boundary
- Second corruption: image-loading writes clobbering the cache
- Dashboard meal carousel desync
**Lesson → rule:** Meal cache is keyed by date+timezone. Writes during image load can
corrupt it. Any cache change needs a same-day AND next-day-boundary verification.

### 3. Duplicate / double artifacts — often ENVIRONMENTAL, not code
- Double notifications firing simultaneously → root cause was multiple app installs
  on the device + iOS persisting stale notifications, NOT the code
- Duplicate meal rendering, dessert-slot duplication
**Lesson → rule (this IS the bug-hunter thesis, validated by your own history):**
Reproduce first. Rule out environment (multiple installs, stale notifications, hot-reload
ghosts) BEFORE touching code. Multiple sessions were burned "fixing" code that was fine.

### 4. Reverts from shipping too early
- Native Google Sign-In shipped to prod → reverted to WebView OAuth next session
**Lesson → rule:** Risky auth/native changes get a throwaway spike + device test before
they touch main. A revert costs two sessions.

### 5. Client-trust security holes
- `promo_active` written client-side from an AsyncStorage flag → later moved to a
  server-side `redeem_referral_code` RPC (SECURITY DEFINER)
- validate_referral_code was SECURITY DEFINER but the premium-granting write stayed
  client-controlled
**Lesson → rule (this IS the security-sweep target, validated):** Anything that grants
access/money/premium must be written server-side. A client can set any column you trust it to.

### 6. Pre-existing TypeScript errors surprising Claude
- "Pre-existing TS errors in onboarding flow" / "in modal files unrelated to my changes"
  came up repeatedly — Claude kept re-discovering them and second-guessing its own diffs
**Lesson → rule (CLAUDE.md):** There is a known baseline of pre-existing TS errors in
onboarding + modal files. Run `tsc` for a baseline before editing; don't claim to have
introduced or fixed errors that were already there.

### 7. Code-review noise / false positives
- One review flagged 87 "logic issues"; another 27 low-severity; a "missing Apple full
  name persistence" finding was a false positive
**Lesson → rule:** Reviews must rank by real exploitability/impact and explicitly separate
"actually reachable" from "theoretical." Noise wastes a whole triage session.

### 8. "Don't touch" landmines (recurring warnings to future sessions)
These got re-explained session after session — they belong in CLAUDE.md permanently:
- **Image generation** — globally cached, doesn't scale per-user; don't "optimize" it
- **Yearly IAP ($29.99)** — working; don't touch when fixing Monthly
- **Stripe** — web only; never put Stripe in the app code (Apple rejection risk)
- **Discover expiry filter** — an aggressive expiry filter on Discover (not the diet
  bands) was the culprit for meals disappearing

---

## Meta-patterns worth encoding

- **handoff.md is your continuity spine** — nearly every session opens/closes on it.
  Formalize it: a manual for what a good handoff contains.
- **Marketing surface that keeps recurring:** Superwall campaign routing, product pricing
  display, sandbox tester auth loops, paywall variant config. Half your "bugs" are really
  paywall/metadata config, not code — worth its own manual.

---

## What each manual should be SEEDED with (not generic)

| Manual | Seed it with |
|---|---|
| bug-hunter | Pattern #3 — reproduce + rule out environment (multi-install, stale notifs, hot-reload) before code. Pattern #1 — round-trip every profile field. |
| security-sweep | Pattern #5 — client-trust premium/promo writes. Supabase RLS + SECURITY DEFINER + Superwall webhook trust. |
| project-setup | Expo/EAS, Supabase migrations, Superwall, secrets in `.env` — NOT the generic web checklist. |
| build-planner / PRD | Pattern #1+#4 — force the decisions that changed on Pantry (monetization gate, onboarding data model, auth method) up front. |
| honest-advisor | Pattern #7 — rank by real impact, name false positives. |
| metadata-audit (NEW, marketing) | Superwall paywall copy + App Store screenshots/description, reviewed as a skeptical non-converting user. Premium-only framing (no free tier). |
