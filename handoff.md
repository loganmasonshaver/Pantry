# Handoff — Security/quality review continuation (Lows only remain)

**For the next chat.** The code review (87 findings) is now **done through all Mediums**:
**all Critical + all High + M1–M3 (prior session)** and **M4 (scaling/cost), M5 (security),
M6 (worth-doing nits) — shipped this session.** The ONLY thing left is the **27 Lows**
(polish, listed in `CODE_REVIEW.md`). Everything is committed + pushed to `main`.

## ✅ Shipped THIS session (2026-06-10) — M4 + M5 + M6
**M4 (scaling/cost):**
1. parse-receipt was silently paying GPT-4o every scan (native Gemini endpoint 4xx'd) → switched to the OpenAI-compat endpoint like generate-meals. Real $ fix.
2. estimate-meal-macros: added daily cap (25/day, 'macro_est', photo path only) + 90s timeout.
3. FatSecret N+1: new `_shared/concurrency.ts` `mapLimit()`; capped meal-gen + trending fan-out to ≤15 concurrent.
4. Discover: `.limit(300)` on trending query + removed duplicate mount fetch (useFocusEffect already covers mount).
5. extract-recipe-from-url: `fetchWithTimeout` on all hops (10s scrape / 30s AI) + daily cap (15/day, 'url_extract').
6. generate-trending-meals cron: 15s timeouts on YouTube calls + try/catch so one bad combo isn't fatal. (Image fan-out already waved by 5.)
7. loops-import-waitlist: now resumable via offset pagination (batch 500, returns nextOffset) instead of whole-table load.
8. onboarding image preloads (plan reveal + swipe): batched ×3 instead of unbounded parallel.

**M5 (security):**
1. fatsecret-proxy: method + per-method param allowlist (was signing arbitrary calls on our account).
2. trending_meals INSERT policy: requires trend_source='creator' + owned creator_id + promo_active (migration `20260610010000`); client `safeOpenSocialUrl` only follows http(s) creator links.
3. CreatorRecipeModal: random-UUID photo filenames (was guessable Date.now() in a public upsert bucket).
4. AILogModal: downscale photos to 2048px + 12M-char ceiling before upload.
5. `creators.user_id` partial unique index (migration `20260610000000`, dedupe+repoint first).
6. loops-sync: contact-upsert failure no longer drops the lifecycle event (upsert made non-fatal, surfaces `upsertFailed`).

**M6 (worth-doing nits):** OFF barcode 8s timeout; delivery-webview onError/onHttpError + originWhitelist; AILogModal calorie-sync moved out of render into a useEffect; AIConsentContext resolver queue (was leaking concurrent promises); onboarding birthday gate commits the visible default so age is never null.

**Migrations applied this session (on remote):** `20260610000000_creators_user_id_unique.sql`, `20260610010000_trending_insert_hardening.sql`.

---

**(Prior session — already shipped, do NOT redo: all Critical + all High + M1–M3.)**
Read `CODE_REVIEW.md` (repo root, committed) for the full finding list.

---

## ✅ What's already shipped this session (do NOT redo)

**Critical (3) — DB migrations + edge deploys, live & verified:**
- `promo_active` made server-only (trigger `enforce_server_managed_premium` + `redeem_referral_code` RPC). Onboarding calls the RPC instead of writing the flag.
- `generate-ingredient-images` gated behind `ADMIN_SECRET` (was open; anyone could wipe the shared image table).
- `trending_meals` open UPDATE policy dropped → scoped to creator ownership (was IDOR).

**High Group 1 — Server-side premium enforcement (THE big one), live & verified:**
- New `superwall-webhook` edge function (Svix-signature verified) writes `profiles.is_premium`.
  Events: initial_purchase/renewal/uncancellation/**non_renewing_purchase (lifetime)**/subscription_extended → true; expiration/subscription_paused/refund → false; cancellation/billing_issue/product_change → no change.
- `is_premium` column (server-only, same trigger), backfilled for existing subscribers/trialers.
- `_shared/premium.ts` `requirePremium()` wired into the 6 paid edge fns (generate-meals, scan-pantry, parse-receipt, estimate-meal-macros, generate-recipe, extract-recipe-from-url). Fails OPEN on read error.
- **`PREMIUM_ENFORCEMENT=on`** (kill switch — set to anything else to disable instantly, no redeploy). Verified: non-premium → 403, premium → passes.
- `_layout.tsx` sets `supabaseUserId` Superwall attribute for webhook mapping (identify already uses the Supabase id).

**High Group 2 — abusable APIs, live & verified:**
- `generate-meal-image`: cache-FIRST (free, no auth) → generation requires login + per-user daily cap (`image_gen`, 20/day, refunds on fail).
- `seed-recipe-template` gated behind `ADMIN_SECRET`.
- `loops-sync` delete now uses caller's verified email only (was deletable-any-contact).
- `_shared/rate-limit.ts`: added `clientIp()` (prefers cf-connecting-ip, only first XFF hop) + eviction; 4 authed fns now key the limiter on `user.id` not the spoofable IP.

**High Group 3 — data-loss bugs (client):** wrong-day log delete, Saved-undo column drop, portion-edit carbs/fat drop, profile goal-save error swallowing.

**High Group 4 — scaling (client) + cost tuning:**
- Saved-tab image backfill now persists to `saved_meals.image_url` (runs once, not every focus), batched ×3, ref-guarded.
- FoodSearch: dropped per-result `getFoodById` N+1 → parses macros from description via local `quickMacros`; added search-sequence guard for stale results.
- **Pantry scan cap: 5/day → 7 per rolling 7 days** (new `check_and_increment_scan_window` RPC + `checkScanCapWindow`), **max 8 photos/scan** (client + server). One scan = one whole-kitchen session = 1 cap unit.
- `PaywallBrowser.tsx` **deleted** — it was dead code (never rendered). The live paywall is **Superwall-hosted** (dashboard), which is correct for fast iteration.

**Medium M1 (silent error-swallowing):** food-preferences load-fail guard (prevents wiping dislikes), AIConsentContext.revokeConsent error check, FoodSearchModal recent-foods JSON.parse guard, CreatorRecipeModal AI-estimation try/catch (was freezing Save), PantryScanModal add-ingredients insert-error surfaced. (pantry.tsx loader already safe.)

**Medium M2 (data integrity):** removeFromPantry LIKE-metachar escape, generate-meals empty-result refund, profile goal-change → meal-cache invalidation (saveGoal + recalc modal), grocery exact-dedup (was fuzzy substring hiding distinct items).

**Medium M3 (auth/routing consistency):** verify-email + reset-password + createaccount(isReturningUser) all now use authoritative `onboarding_completed || calorie_goal` (maybeSingle) like signin's `routeByProfile`; `_layout` routing effect got a cancellation guard against the token-refresh race.

---

## ⚠️ State / environment notes (IMPORTANT for the next chat)

- **Trial length is 7 days** (confirmed by Logan). PaywallBrowser copy was fixed to 7 before deletion; the live Superwall paywall must also say 7 days + **$7.99/mo, $30/yr** — **Logan to verify in the Superwall dashboard** (can't be done from code).
- `DEV_FORCE_PAYWALL = false` in `context/SuperwallContext.tsx` — KEEP false for real builds (was flipped true to test, flipped back).
- Secrets set: `PREMIUM_ENFORCEMENT=on`, `SUPERWALL_WEBHOOK_SECRET`, `ADMIN_SECRET`. Kill switch: `supabase secrets set PREMIUM_ENFORCEMENT=off` if real subscribers report being blocked.
- **Migrations applied through `20260610010000_trending_insert_hardening.sql`.** All on remote (latest two added this session).
- **Metro is NOT running** (was killed). Restart from project root for device testing: `cd /Users/loganshaver/pantry && npx expo start`. Client changes this session need a **reload or rebuild** to reach the device.
- **Deploy commands:** `supabase db push --yes` (migrations), `supabase functions deploy <name>`.
- **Service-role key** (for DB verification curls): `supabase projects api-keys --project-ref fdafjnkqqtpsjtddbfdz`.
- **Network quirk:** the project domain `fdafjnkqqtpsjtddbfdz.supabase.co` is intermittently unreachable from the sandbox shell (returns HTTP 000). The Supabase **CLI** works (different host). Retry curls with `dangerouslyDisableSandbox: true`, or test on device.
- **Auth has CAPTCHA (Turnstile)** → password sign-in can't be scripted. To mint a test user session, use the admin **generate_link → /auth/v1/verify (magiclink, token_hash)** flow (this is how premium enforcement + the weekly cap were verified). Clean up test users after (delete profile row first — no FK cascade — then `auth/v1/admin/users/{id}`).
- Per CLAUDE.md: inline `//` WHY-comments on non-obvious lines; commit+push to `main` after each meaningful change; end commits with the Co-Authored-By Claude trailer.

---

## 📋 REMAINING WORK — NONE (review 100% complete)

The full multi-agent code review is **done**: all Critical + High + Mediums (M1–M6)
+ **all 27 Lows (L1–L27)** are shipped, committed, and pushed. Edge-function changes
are deployed; the two new migrations (`20260610000000`, `20260610010000`) are on remote.

**Lows shipped this session (L1–L27), grouped:**
- Correctness: L1 (promo premium flash), L3 (barcode name-overlap check), L4 (Turnstile onError + wired into signin/createaccount), L5 (Math.round macros), L8 (midnight isToday), L9 (SplashOverlay reduce-motion gate), L17 (MacroEditModal validation).
- Data integrity: L11 (delete-account error surfacing + scan_usage), L12 (double-submit guards: grocery/pantry/meal-log/creator), L13 (real staple categories), L14 (cache user-scoping on sign-out + image-cache cap), L15 (unified RESET_CACHE_KEYS + __DEV__ guard on resetOnboarding), L16 (atomic trending swap), L18 (scan-insert savingRef guards), L19 (pantry drag order persisted), L23 (scan-cap fail-open backstop).
- Performance/scaling: L2 (calc-timer cleanup), L20 (gauge/MacroBar/saved-undo animation cleanups), L21 (row limits on profile/home/grocery/meal-suggestion queries), L22 (in-process JWKS JWT verify + getUser fallback).
- Security: L7 (fatsecret-proxy error-code mapping), L24 (admin-creator constant-time secret), L25 (delete-account CORS restricted), L26 (accurate cooldown messages), L27 (`_shared/sanitize.ts` prompt sanitization).
- Discover: L6 (per-rail variety-fill), L10 (raised trending macro reject ceiling).

Intentionally left (decided, NOT a Low):
- **Blanket optimistic-update rollback** across grocery/pantry/meal/home — failures self-correct on refresh; high churn, low ROI.
- **Cosmetic M6 items:** array-index React keys (RecipeFormModal/CreatorRecipeModal), staples prompt reappearing on swipe-dismiss.

There is no outstanding review work. Next session can move to features/launch.

## Workflow reminders
After each change: typecheck (`npx tsc --noEmit` — the codebase has many PRE-EXISTING tsc errors:
VideoView props, profile setState (`onboarding/index.tsx` ~504/3167 "No overload"), ref-callback
returns, DetectedItem `zone` mock, `startsWith` on `never`, JSX namespace — filter those out),
commit, push, and `supabase functions deploy <name>` any changed edge fns.
