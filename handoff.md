# Handoff — Security/quality review continuation (Mediums M4–M6 + Lows)

**For the next chat.** This session ran a full multi-agent code review (87 findings) and shipped
**all Critical + all High + the first 3 Medium batches**. What's left: Medium batches **M4
(scaling/cost), M5 (security), M6 (nits)** and the 27 Lows. Everything below is committed +
pushed to `main`. Read `CODE_REVIEW.md` (repo root, committed) for the full finding list.

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
- **Migrations applied through `20260606040000_scan_window_cap.sql`.** All on remote.
- **Metro is NOT running** (was killed). Restart from project root for device testing: `cd /Users/loganshaver/pantry && npx expo start`. Client changes this session need a **reload or rebuild** to reach the device.
- **Deploy commands:** `supabase db push --yes` (migrations), `supabase functions deploy <name>`.
- **Service-role key** (for DB verification curls): `supabase projects api-keys --project-ref fdafjnkqqtpsjtddbfdz`.
- **Network quirk:** the project domain `fdafjnkqqtpsjtddbfdz.supabase.co` is intermittently unreachable from the sandbox shell (returns HTTP 000). The Supabase **CLI** works (different host). Retry curls with `dangerouslyDisableSandbox: true`, or test on device.
- **Auth has CAPTCHA (Turnstile)** → password sign-in can't be scripted. To mint a test user session, use the admin **generate_link → /auth/v1/verify (magiclink, token_hash)** flow (this is how premium enforcement + the weekly cap were verified). Clean up test users after (delete profile row first — no FK cascade — then `auth/v1/admin/users/{id}`).
- Per CLAUDE.md: inline `//` WHY-comments on non-obvious lines; commit+push to `main` after each meaningful change; end commits with the Co-Authored-By Claude trailer.

---

## 📋 REMAINING WORK

### Medium M4 — Scaling / cost (HIGH value; mostly edge functions → need `supabase functions deploy`)
1. **`parse-receipt` invalid Gemini model name → silently falls back to GPT-4o every scan.** `supabase/functions/parse-receipt/index.ts:44` (`parseWithGemini`). Verify the model string (cross-check the working one in generate-meals: `gemini-3.1-flash-lite` via the OpenAI-compat endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`). Receipt should use Gemini primary (cheap); right now it's paying GPT-4o on every receipt. **Real $ impact.**
2. **`estimate-meal-macros` has no per-user daily cap + no timeout** on a GPT-4o (vision) call. `supabase/functions/estimate-meal-macros/index.ts:88-90,167-241`. Add `checkScanCap(req,'macro_est',N)` (reuse `_shared/scan-cap.ts`) + an AbortController timeout like scan-pantry has.
3. **FatSecret N+1 in meal generation** — concurrent per-ingredient macro lookups. `generate-meals/index.ts:80,376-380` (also generate-trending-meals:73,632; estimate-meal-macros:195-206). Batch/limit concurrency (p-limit style) or cache.
4. **Discover trending query: no row limit + stale diet filter, and triple/duplicate fetch.** `app/(tabs)/discover.tsx:192-217` (add `.limit()`), `250-264` (dedupe the effect triggers — performance finding too).
5. **`extract-recipe-from-url` (YouTube HTML scrape): no timeout, no daily cap.** `extract-recipe-from-url/index.ts:29-58,160-226`. Add timeout + per-user cap; it's also ToS-fragile.
6. **`generate-trending-meals` cron:** sequential YouTube calls, no timeout, no quota handling (`:285-322`); image fan-out (~54 FAL calls) in the cron critical path (`:757-787`). Add timeouts; move/queue image gen out of the critical path or wave-limit (it already waves by 5 — verify).
7. **`loops-import-waitlist` loads the whole table + serial processing** → times out for large waitlists. `loops-import-waitlist/index.ts:31-34,76,79`. Paginate/batch.
8. **Onboarding plan-reveal parallel image fetches unbounded.** `app/onboarding/index.tsx:2871-2885, 3677`. Batch like the Saved-tab fix (×3).

### Medium M5 — Security hardening (mix of edge + DB migration)
1. **`fatsecret-proxy` passes caller-supplied `method` + `params` unsanitized** into the signed request. `fatsecret-proxy/index.ts:84-93`. Add an allowlist of permitted methods (foods.search, food.get, foods.autocomplete) + strip unexpected params.
2. **`trending_meals` INSERT policy lacks promo_active/creator enforcement + unvalidated social URLs.** (RLS migration + `discover.tsx:398-406,472-483`). Scope INSERT to real creators; validate/sanitize creator social URLs before render (Linking.openURL on attacker URLs).
3. **CreatorRecipeModal photo → public bucket with guessable timestamp filename.** `CreatorRecipeModal.tsx:181`. Use a random UUID filename.
4. **AILogModal sends raw base64 photo, no size validation.** `AILogModal.tsx:55-61`. Add a size cap before invoke (mirror the pantry downscale).
5. **Creator profile INSERT has no server-side uniqueness on `user_id`.** `CreatorRecipeModal.tsx:205-221`. Add a UNIQUE constraint/index on `creators.user_id` (migration) so a user can't create duplicate creator rows.
6. **(deferred from M2) `loops-sync` drops lifecycle events when the contact upsert fails** — `loops-sync/index.ts:186-216`. Retry/queue or at least surface so the Loops sequence isn't silently skipped.

### Medium M6 — Correctness nits (LOWEST value — cherry-pick; skip pure cosmetics)
Worth doing:
- **Birthday age gate doesn't block continuation when birthday empty.** `app/(tabs)/index.tsx:1505-1516` (note: the review may have meant onboarding age step — verify location). Block Continue when no birthday.
- **delivery-webview: no error handler (perpetual spinner) + no `originWhitelist`.** `app/delivery-webview.tsx:46-52`. Add onError + originWhitelist.
- **Open Food Facts barcode fetch: no timeout.** `lib/fatsecret.ts:139-151`. AbortController.
- **AILogModal setState-in-render via setTimeout(0) → possible render loop.** `AILogModal.tsx:457-471`. Move to a guarded useEffect.
- **AIConsentContext concurrent requestConsent overwrites pendingResolve** (leaks promises). `AIConsentContext.tsx:84-91`.
Likely skip (cosmetic): array-index React keys (RecipeFormModal/CreatorRecipeModal), staples prompt reappearing on swipe-dismiss.

### Deferred earlier (decide whether to do):
- **Blanket optimistic-update rollback** across grocery/pantry/meal/home — failures self-correct on refresh; high churn, low ROI. Left intentionally.
- **G4 Saved-tab backfill captured-index** (`saved.tsx`) — the G4 rewrite still uses the positional index; it's correct because order matches fetch order, but worth a quick re-verify.

### Lows (27) — all in `CODE_REVIEW.md`. Polish only; tackle after M4/M5 if desired.

---

## Suggested order for next chat
1. **M4 #1 (parse-receipt model)** — quick, real $ savings. Then the rest of M4.
2. **M5** — security hardening (one small migration for creators uniqueness).
3. Cherry-pick **M6** (age gate, webview, OFF timeout). Skip cosmetics.
4. Lows only if time.

After each batch: typecheck (`npx tsc --noEmit` — note the codebase has many PRE-EXISTING tsc errors: VideoView props, profile setState, ref-callback returns, DetectedItem `zone` mock, `startsWith` on `never`, JSX namespace — filter those out), commit, push, and `supabase functions deploy` any changed edge fns.
