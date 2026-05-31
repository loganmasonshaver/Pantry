# Handoff — Scan-pantry overhaul + premium-only enforcement + trending cron debug

## TL;DR

Sessions over the last ~24h cleaned up the pantry-scan pipeline end-to-end, fixed a recurring close-button clipping bug, removed freemium drift that contradicted the premium-only model, and diagnosed (but did not yet fix) why trending meals aren't generating via cron.

Three things still need Logan's action:
1. **Fix the cron service-role key in Vault** (legacy JWT format, not the new `sb_secret_` format) so the trending-meals daily job can authenticate
2. **Reset `pantry_scan_count` and `receipt_scan_count` on his profile** so he can test scans (the count-gate code is stripped but his row still has the burn-through from yesterday)
3. **Verify scan-pantry works end-to-end** with the new build (force-reload Metro first)

---

## Scan-pantry — full rewrite of the loading / failure / quota path

Across commits `4a3a97f` → `8dfdcd1` → `02ab270` → `59fb4aa` → `0b77fa9` → `b93a151` → `94071ff`:

### Architecture changes

**Barcode enrichment removed entirely.** It was hitting Open Food Facts sequentially for every item GPT-4o read a UPC for — 60-90s of latency on dense pantries and a real scale risk (1000 concurrent OFF requests at 10k MAU). GPT-4o's label-reading gives 90%+ of the canonicalization value with none of the cost. ~50 lines deleted. The `generate-ingredient-images` Storage bucket + edge function were also deleted from scan-pantry in this work.

**Time-anchored loading messages.** Replaced the 2.2s-rotation of 5 random messages with 8 stages indexed by elapsed-ms, each matching a real server-side step. No more "Second pass..." showing 8 seconds in. Hard timeout at 180s flips the UI to error state.

**Per-photo density gate for second pass.** First-pass prompt now returns `photo: <index>` per item. Server computes per-photo density; only runs the ~30s second pass if any single photo has 20+ items (the threshold where GPT-4o attention starts thinning out). Sparse scans skip second pass entirely. Pure score-based — no "items per photo total" averaging, the densest photo decides.

**Stage timing logs throughout.** `[scan-pantry] invoked`, `first pass: Xms, Y items`, `per-photo density`, `second pass: Xms`, `total: Xms`. Next slow-scan debugging is a 30-second log read instead of guessing.

**Explicit 90s timeout on OpenAI vision fetch.** AbortController wraps the first-pass call. Without this, when OpenAI hangs past Supabase's ~150s platform timeout, the function got force-killed with NO logs and NO response. Now we 504 cleanly with `"OpenAI vision timed out (90s)..."` and the client sees a real error message.

### UX changes

**Pre-scan tips screen (step 0).** New onboarding step before the camera opens. 4 tips: pull items forward, light it up, stand 3-4ft back, one photo per zone. Educates users BEFORE bad photos, not after.

**Photo retention + Retry on failure.** Failed scans no longer dump the user to an empty review screen. Loading view flips to red error state with a "Retry scan" button. Photos stay in state, retry just bumps a `retryNonce` that re-fires the scan effect — no re-shoot, and (post the count-gate strip) no charge against quota since there's no quota anymore.

**Close button safe-area fix.** Modal uses `SafeAreaView edges={['bottom']}` so the camera can be full-bleed, but every non-camera step rendered `styles.step` which had only `paddingTop: 8` — insufficient to clear the ~54-59px status bar / Dynamic Island. The close X was rendering BEHIND the status bar on the tips screen, loading screen, results screen, etc. Derived `stepWithSafeTop = [styles.step, { paddingTop: insets.top + 8 }]` once per render and applied to every non-camera step container. Same defect exists latently in `RecipeFormModal.tsx` (uses hardcoded `paddingTop: 56`) — not fixed in this pass.

**All close buttons moved to top-left** for cross-step consistency. Loading screen's absolute-positioned variant got `left: 8, right: undefined` override. Title-bar steps got `<TouchableOpacity ... /><Text style={[..., { marginLeft: 12 }]}>...` layout.

### Removal of freemium count gates

The codebase had drift: three count-based "3 free then paywall" mechanics that contradicted the documented premium-only model.

Stripped in commit `94071ff`:
- `pantry_scan_count` read/check/increment in PantryScanModal
- `receipt_scan_count` read/check/increment in ReceiptScanModal
- `saved_meals` count query + Alert dialog in meal/[id].tsx save flow

All three replaced with the AILogModal pattern (already correct): when `!isPremium`, fire `triggerUpgrade(placement)` immediately. Superwall placements stay wired, they just fire on every gated action instead of after N free uses.

DB columns (`profiles.pantry_scan_count`, `.receipt_scan_count`) are now dead. **Leave them in place** — post-launch cleanup, not blocking.

### Global error capture

PostHog had no auto error capture. Added `setupCrashReporting()` in `lib/analytics.ts` that wires React Native's `ErrorUtils.setGlobalHandler` and the `unhandledrejection` event to PostHog as `app_error` / `app_unhandled_rejection` events with stack traces. Installed at `app/_layout.tsx` module-load time so boot crashes are also caught.

---

## Trending meals — diagnosed but not yet fixed

**Symptom:** Discover row shows 1 stale meal from May 12. Cron is supposed to run daily at 05:00 UTC and write 6 fresh YouTube-sourced meals.

**Diagnosis chain (last night):**
1. `trending_meals` table contains 1 row — `creator` source, 18+ days old, NOT YouTube-sourced
2. `cron.job_run_details` shows the daily job has run successfully every day at 05:00 UTC for the last 5+ days, status: `succeeded`
3. Function logs (`generate-trending-meals` → Logs) show NO boot/shutdown activity at 05:00 UTC — only a single manual May 26 invocation
4. `net._http_response` shows the cron's HTTP POST returns `status_code: NULL` and `content: NULL` — pg_net never received a response
5. Vault secret check: `cron_service_role_key` exists with `length: 41, prefix: 'sb_s', starts_with_jwt_marker: false`

**Root cause:** The vault holds the new `sb_secret_...` format API key (41 chars), but the edge function's auto-injected `SUPABASE_SERVICE_ROLE_KEY` env var is the **legacy JWT format** (~200 chars, starts with `eyJ`). The function does literal string comparison — mismatch → 401 at gateway → function never boots → no logs → null response.

**Fix Logan needs to do:**

1. Get the legacy JWT service-role key from Supabase Dashboard → Project Settings → **API Keys** → "Legacy API keys" section (may need to click "Show legacy keys" — collapsed by default)
2. In SQL Editor:
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'cron_service_role_key'),
     'PASTE_LEGACY_JWT_HERE'
   );
   ```
3. Verify with:
   ```sql
   SELECT length(decrypted_secret) AS key_length,
          decrypted_secret ~ '^eyJ' AS is_jwt
   FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key';
   ```
   Expect `key_length ~200+`, `is_jwt: true`
4. Trigger a test run immediately (don't wait for 05:00 UTC):
   ```sql
   SELECT net.http_post(
     url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true',
     headers := jsonb_build_object(
       'Content-Type', 'application/json',
       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1)
     ),
     body := '{}'::jsonb
   );
   ```
5. Wait ~2 min, then check:
   - Function logs for `[stage]` lines from MMR pipeline
   - `SELECT count(*), generated_at FROM trending_meals GROUP BY generated_at ORDER BY generated_at DESC LIMIT 5` — should show 6 rows from today

### Trending meals MMR refactor (`73e6d13`)

Separately, the trending-meals pipeline was structurally rewritten last night to replace 4 serial kill-filters with score-based MMR (Maximal Marginal Relevance) selection. The whack-a-mole pattern of "only N meals survived" should be structurally impossible now — pipeline always picks the least-bad 6 from whatever pool exists. Won't be visible until the cron auth is fixed and a successful run completes.

---

## Other meaningful work in the session window

- **Native Google Sign-In** (commit `d0e5e34` from prior session, verified working this session) — replaced WebView OAuth with `@react-native-google-signin/google-signin` + custom nonce-handling patch (`patches/`) so we control the OIDC nonce flow that Supabase requires. Native iOS bottom sheet, no Supabase project URL exposed.
- **Meal ingredient redesign** — NEED/HAVE split, bullet dots replacing AI thumbnails (Flux generation removed for quality + cost reasons), Unicode fractions (½, ¼, 1½), bulk "Add N missing items to grocery" CTA, long-press to swap section.
- **Portion display improvements** — `formatHalf` helper, `gramsToProteinScoops` for whey/casein/protein powder (1 scoop ≈ 30g), `gramsToSeedsSpoons` for chia/flax/hemp/sesame, `roundDisplayGrams` (44g → 45g, 58g → 60g for psychologically clean numbers).
- **Whole-unit foods expanded** to include salmon fillet, cod fillet, chicken breast, pork chop, etc. — so the meal screen renders "1 salmon fillet" instead of "1 small fillet salmon fillet".
- **Inverted ingredient name normalizer** — client-side swap so the AI's occasional "juice lemon" / "zest orange" malformations render as "lemon juice" / "orange zest".
- **Meal-image gen prompt** — added explicit "every visible ingredient must appear in the description" rule + raised max_tokens 120→180. Mostly fixes "the image has salmon but not the cucumber from the recipe" bug for future generations.

---

## State Logan needs to verify on next session

### Action required
- [ ] Reset his row's `pantry_scan_count` (and `receipt_scan_count` if at limit) to 0 in `profiles` so he can test scans — the count gate code is gone but his existing row still has the burn-through value:
  ```sql
  UPDATE profiles SET pantry_scan_count = 0, receipt_scan_count = 0 WHERE id = '<his_user_id>';
  ```
- [ ] Fix the cron vault key per the steps above
- [ ] Force-reload the app (shake → Reload, or kill+reopen) so the latest JS bundle loads with the close-button-left positioning, the count-gate removal, and the photo retention / retry UX

### Verify after action
- [ ] Pantry scan: tap "Scan Pantry" → tips screen appears with X on left → take photos → loading screen with time-anchored messages → either success (~50-90s) or clean 504 error with Retry button (if OpenAI hangs)
- [ ] Trending row populates with 6 fresh meals after cron secret update + test run
- [ ] Meal screen: ingredients show NEED/HAVE sections with teal bullets, Unicode fractions, "1 salmon fillet" rendering, "Add N missing items" white pill CTA at top

### Known latent defect (not blocking)
- [ ] `RecipeFormModal.tsx` uses hardcoded `paddingTop: 56` for status-bar compensation instead of `insets.top + 8`. Works on most iPhones but isn't device-correct everywhere. Migrate when convenient.

---

## File pointers

**Scan-pantry work:**
- `supabase/functions/scan-pantry/index.ts` — early log, 90s OpenAI timeout, photo-index density gate, stage timings, no more barcode enrichment
- `components/PantryScanModal.tsx` — step 0 tips, retryNonce + scanError state, stepWithSafeTop derived style, all close buttons left-aligned, count-gate stripped

**Freemium drift cleanup:**
- `components/PantryScanModal.tsx`, `components/ReceiptScanModal.tsx`, `app/meal/[id].tsx` — count gates stripped in commit `94071ff`

**Trending diagnosis context:**
- `supabase/migrations/20260512000012_schedule_trending_cron.sql` — the cron job schedule, references vault secret
- `supabase/functions/generate-trending-meals/index.ts` — MMR refactor lives here, untouched since `73e6d13`

**Global error capture:**
- `lib/analytics.ts` — `setupCrashReporting()` exported
- `app/_layout.tsx` — calls `setupCrashReporting()` at module-load

---

Branch: `main`. Working tree clean as of `94071ff`. Solo dev, no PRs. All work pushed.
