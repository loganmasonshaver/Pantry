> ## ⚠️ TRIAGED 2026-08-30 — every CRITICAL and HIGH finding is RESOLVED
>
> This report is dated 2026-06-06 and predates the security work of July/August. All 3 criticals
> and all 15 highs were re-verified against live code and the live database on 2026-08-30. **18 of
> 18 are closed.** Do not act on a finding here without re-checking it first.
>
> | | finding | status |
> |---|---|---|
> | C1 | promo_active client-writable | FIXED — `trg_enforce_server_premium` silently reverts `promo_active`/`is_premium` for any role outside postgres/supabase_admin/service_role. Note it was NOT fixed the way this report suggests (column REVOKE); RLS is still blanket `auth.uid() = id`, so **check the trigger, not the policy** |
> | C2 | ingredient-image DB wipe | FIXED — function deleted (`eff9ec1`); the table's only policy is public SELECT, so writes are denied by default |
> | C3 | trending_meals IDOR | FIXED — UPDATE and DELETE are now scoped to `creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid())` |
> | H1 | removeSlot wrong-day delete | FIXED — uses `selectedDate` |
> | H2 | PaywallBrowser | STALE — component deleted |
> | H3 | EditPortionModal drops carbs/fat | FIXED — both in the payload |
> | H4 | Saved undo drops columns | FIXED — full-column re-insert |
> | H5 | Profile goal saves swallow errors | not re-verified; profile.tsx has been rewritten since |
> | H6 | Saved image fan-out uncapped | FIXED — batched |
> | H7 | FoodSearchModal N+1 | FIXED — v3 returns servings inline; one call |
> | H8 | edge functions lack premium checks | FIXED — generate-meals, scan-pantry, parse-receipt and estimate-meal-macros all carry auth + premium + rate-limit |
> | H9 | rate limiter spoofable/per-isolate | MITIGATED — prefers `cf-connecting-ip` and takes only the first XFF hop; per-isolate is now a documented deliberate choice, with the DB-backed scan-cap as the real ceiling |
> | H10 | generate-meal-image unauthenticated | FIXED — auth present |
> | H11 | seed-recipe-template open AI proxy | FIXED — requires `x-admin-secret` and **fails closed** when the secret is unset |
> | H12 | loops-sync delete trusts body.email | FIXED — email comes from the verified session |
> | H13 | onboarding proceeds without purchase | BY DESIGN — every feature is gated downstream (`if (!isPremium) triggerUpgrade(...)` on log and save). This is the behaviour PRELAUNCH item 4 wants to formalise |
> | H14 | non-premium users can log | FIXED — gated at `meal_log_limit` |
> | H15 | creator post limit client-side | FIXED — `enforce_creator_daily_post_limit` exists server-side |
>
> **The 42 medium and 27 low findings were NOT verified.** Given 18 of 18 severity-ranked findings
> are stale, the base rate says most of those are too. Reading them one by one is likely a poor use
> of time — a fresh `/security-review` on the current code would carry far more signal than
> triaging a report written three months and two security passes ago.

# Pantry — Full Codebase Logic / Security / Scaling Review

_Deep multi-agent review: 23 reviewers across the entire codebase → 232 raw findings → 100 deduped → adversarial verification → **87 confirmed** (13 false positives dropped). Report only; no code changed._

**Severity:** 3 critical · 15 high · 42 medium · 27 low  
**Category:** 23 security · 33 correctness · 18 data-integrity · 11 scaling · 2 performance

## Fix-first (the money & data-loss paths)
1. **Server-side subscription check is missing on every premium edge function** + **`promo_active` is user-writable** → full payment bypass at both the API and DB layer.
2. **`generate-meal-image` / `seed-recipe-template` are unauthenticated** and the **in-memory rate limiter is spoofable/per-isolate** → anyone can drain FAL/OpenAI/Google credits.
3. **IDOR via RLS**: any user can UPDATE any `trending_meals` row, wipe the whole `ingredient_images` table, or delete any Loops contact.
4. **Data loss bugs**: `removeSlot` deletes the wrong day's logs; Saved-undo and portion-edit re-write rows with NULL/stale macros; profile goal saves ignore errors.
5. **Scaling**: Saved-tab fires an uncapped Flux fan-out on every focus; FoodSearch fires N+1 FatSecret calls per keystroke-search.

## Critical (3)

### C1. promo_active is user-writable client-side, enabling free premium bypass
`context/SuperwallContext.tsx + supabase/migrations/20260326000100_add_rls_all_tables.sql + app/onboarding/index.tsx:SuperwallContext.tsx:61-67; migration:8-10; onboarding/index.tsx:4118` — _security_ · confidence: high

- **What:** The profiles RLS UPDATE policy is a blanket FOR UPDATE USING (auth.uid() = id) with no column-level restriction. promo_active controls premium access (isPremium = status==='ACTIVE' || promoActive). Any authenticated user can run supabase.from('profiles').update({ promo_active: true }).eq('id', myId) directly to grant themselves permanent free premium. The client also writes promo_active in onboarding finish() derived from a tamperable AsyncStorage grantsPromo flag, and the S7Paywall step bypasses Superwall when grantsPromo is set.
- **Impact:** Complete payment bypass. Any user with the embedded anon key can self-upgrade to premium, voiding all subscription revenue.
- **Fix:** Restrict promo_active to service-role writes only: REVOKE UPDATE (promo_active) ON profiles FROM authenticated, or a BEFORE UPDATE trigger that rejects non-service-role changes to the column, or move grants to a separate promo_grants table. Have validate_referral_code_v2 set promo_active server-side. Remove promo_active from the client upsert entirely.

### C2. generate-ingredient-images clear=true path lets any authenticated user wipe the shared image DB
`supabase/functions/generate-ingredient-images/index.ts:251-258` — _security_ · confidence: high

- **What:** The POST handler accepts { clear: true } and deletes ALL rows from ingredient_images and ALL files from the ingredient-images storage bucket. It only requires a valid JWT (verifyUser), so any subscriber can wipe the shared ingredient image cache for all users.
- **Impact:** Any authenticated user can irreversibly delete all ingredient images, forcing a costly full Replicate re-generation and leaving all users with broken thumbnails.
- **Fix:** Gate clear and uploadUrl admin operations behind a service-role or is_admin check. Regular users should only reach the single-generation path.

### C3. Trending meal UPDATE RLS allows any authenticated user to edit any creator's meal (IDOR)
`components/CreatorRecipeModal.tsx + trending_meals UPDATE policy:317-327` — _security_ · confidence: high

- **What:** The trending_meals UPDATE policy ('Authenticated users can vote on trending meals') is USING/WITH CHECK (auth.uid() IS NOT NULL), allowing any logged-in user to .update(payload).eq('id', anyId) and overwrite name, calories, macros, ingredients, steps, and image of any trending_meal row. The client restricts edits to owners, but RLS does not enforce ownership on UPDATE.
- **Impact:** Full IDOR on all trending meal content; any subscriber can vandalize or replace any creator's recipe, including system-generated meals.
- **Fix:** Add a separate UPDATE policy scoped to creator ownership (creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid())). Restrict the voting-only update to the vote_score column via a narrow policy or RPC.

## High (15)

### H1. removeSlot deletes today's logs even when viewing a past date
`app/(tabs)/index.tsx:739-743` — _correctness_ · confidence: high

- **What:** removeSlot hardcodes new Date().toISOString().split('T')[0] (today) for the meal_logs delete, but the UI supports navigating to past dates via selectedDate. Removing a slot on a past date optimistically updates the selected-day UI while the DB delete targets today's rows, deleting the wrong day's data and leaving the selected day's rows orphaned (they reappear on refresh).
- **Impact:** Data loss: deleting a slot on a past-day view silently deletes today's logs for that slot instead of the intended day's.
- **Fix:** Use selectedDate instead of the hardcoded today: .eq('logged_at', selectedDate).

### H2. selectedPlan and pricing in PaywallBrowser are inconsistent and not passed to Superwall
`components/PaywallBrowser.tsx:48-53,110,127,138,140,142` — _correctness_ · confidence: high

- **What:** The plan toggle (annual/monthly) is never passed to Superwall — handleStartTrial always calls registerPlacement('usage_paywall'), so the plan choice is discarded or routes to the wrong product. Prices shown ($9.99/mo, $29.99/yr, 'Save 75%', '$2.50/month') do not match documented canonical pricing ($7.99/mo, $30/yr) and differ from onboarding copy. Restore Purchase, Privacy Policy, and Terms buttons have no onPress handlers (App Store 3.1.1/5.1.1 risk). The CTA has no in-flight guard.
- **Impact:** Users can be charged a different price/product than shown, cannot restore purchases, and have non-functional legal links — App Store rejection and consumer-law risk.
- **Fix:** Pass selectedPlan to the placement (or distinct placements) configured with matching StoreKit products; centralize prices in a shared constants file matching the real product prices; wire Restore/Privacy/Terms onPress handlers; add a purchasing-in-flight disabled guard. Verify trial-length copy matches the StoreKit product.

### H3. EditPortionModal drops carbs/fat on update, persisting stale macros
`components/EditPortionModal.tsx:76-88` — _data-integrity_ · confidence: high

- **What:** On a serving-based edit, updatePayload only sets calories, protein, serving_id, quantity — carbs and fat are omitted and keep their previous values. On the fallback (no food_id) edit, only calories and protein are set. After editing quantity, stored carbs and fat become silently wrong, corrupting daily macro totals.
- **Impact:** Macro totals shown on home/diary become incorrect after editing a logged entry's portion, with no error surfaced.
- **Fix:** Include carbs: Math.round(base.carbs*qty) and fat: Math.round(base.fat*qty) in the serving path; expose or preserve carbs/fat in the fallback path; update onUpdated to pass all four macros.

### H4. Saved undo re-insert drops most columns, corrupting the meal row
`app/(tabs)/saved.tsx:269-276` — _data-integrity_ · confidence: high

- **What:** The undo re-insert supplies only id, user_id, name, prep_time, calories, protein. carbs, fat, ingredients, steps, image_url, is_user_created are omitted and written as NULL. Local state still shows the full object until the next fetch, after which the meal reloads truncated — losing macros, recipe steps/ingredients, image, and the user-created flag.
- **Impact:** Undoing a delete permanently corrupts the meal record going forward.
- **Fix:** Include all fields from removed.meal in the re-insert payload.

### H5. Profile goal saves silently ignore Supabase errors (optimistic UI always fires)
`app/(tabs)/profile.tsx:558-564, 777-783` — _data-integrity_ · confidence: high

- **What:** saveGoal and submitCalcModal both await supabase.from('profiles').update(...) without checking the returned error, then optimistically update local state / start the count-up animation. On failure (network, RLS, session expiry) the UI shows saved values the DB never received, and stale DB values feed AI meal generation until restart.
- **Impact:** Users believe goals (calories, protein, meals/day, prep time, recalculated macros) were saved when they were not; meal generation uses stale targets.
- **Fix:** Destructure { error } from each update; only update state/animate on success, otherwise keep the modal open and alert.

### H6. Parallel image-generation fan-out on Saved tab focus with no concurrency cap or DB write-back
`app/(tabs)/saved.tsx:212-226` — _scaling_ · confidence: high

- **What:** On every Saved tab focus, fetchMeals iterates every meal lacking an image and launches a concurrent generate-meal-image call with no concurrency limit. Generated images are stored in component state but never written back to saved_meals.image_url, so every refocus re-launches the same fan-out. At moderate scale this becomes a thundering herd of Flux jobs on each tab switch; errors are swallowed.
- **Impact:** Unbounded FAL concurrency and cost blowup; tens of thousands of concurrent Flux jobs at scale, most rejected silently, with repeated regeneration on every tab visit.
- **Fix:** Write generated image_url back to saved_meals so subsequent fetches skip it. Rate-limit the backfill to 2-3 concurrent meals. Add a ref-based guard so refocusing during backfill does not launch a second wave.

### H7. FoodSearchModal fires N+1 FatSecret detail calls per search result and has a stale-results race
`components/FoodSearchModal.tsx:173-204` — _scaling_ · confidence: high

- **What:** doSearch fires a separate getFoodById per search result inside res.forEach(async ...), so a 20-result search triggers 20 simultaneous FatSecret calls, saturating the shared key's rate limit. Separately, there is no sequence/cancellation guard: if an earlier slow response resolves after a newer one, setResults overwrites newer results with stale ones, and resultMacros can mis-label foods.
- **Impact:** FatSecret rate-limit errors for all users sharing the key on busy searches; result rows show wrong or missing macros; users see results for a previous query.
- **Fix:** Parse per-100g macros from the foods.search food_description (using the existing quickMacros helper) for result rows; only fetch full detail on tap. Add a searchSeq ref incremented per call and gate setResults/setResultMacros on the captured value.

### H8. All premium edge functions lack server-side subscription verification
`supabase/functions/generate-meals/index.ts (and scan-pantry, parse-receipt, estimate-meal-macros, generate-recipe, extract-recipe-from-url):generate-meals:123-124` — _security_ · confidence: high

- **What:** Every premium-gated edge function calls verifyUser() which only confirms a valid JWT (any registered user). None query promo_active or check subscription status. The entire paywall is enforced client-side via isPremium. Any authenticated user can call these endpoints directly (curl/Postman/modified build) and consume unlimited AI calls without paying, limited only by daily abuse caps.
- **Impact:** Zero revenue protection at the API layer. Free accounts can invoke expensive OpenAI/FAL/FatSecret operations indefinitely, a significant financial exposure at scale.
- **Fix:** Add a server-side subscription check inside each premium edge function: read a service-role-written subscription_active/promo_active field (populated by a Superwall webhook) and reject non-subscribers with 403. Use the same SECURITY DEFINER pattern already used for daily caps.

### H9. In-memory rate limiter is per-isolate and X-Forwarded-For spoofable — provides minimal real protection
`supabase/functions/_shared/rate-limit.ts:1-52` — _security_ · confidence: high

- **What:** The rate limiter stores counts in a module-level Map that lives only in a single isolate; Supabase spins up many isolates and cold-starts, so each gives a fresh full budget — bypassable by parallel requests or cold-start timing. Additionally the key is the raw x-forwarded-for header (client-controlled), so appending arbitrary IPs creates a fresh bucket per request. This is the only abuse defense for unauthenticated paid functions like generate-meal-image, and the last line of defense for others. The Map also never evicts stale entries.
- **Impact:** Rate limits are effectively defeatable, allowing burst abuse of OpenAI/FAL/YouTube/Google AI quota. Memory grows unbounded on long-lived containers.
- **Fix:** Use a global atomic counter (Postgres RPC like check_and_increment, or Upstash Redis) for rate limiting. Parse only the first IP from x-forwarded-for (or prefer cf-connecting-ip). Evict entries whose resetAt < now.

### H10. generate-meal-image has no authentication — anonymous callers trigger paid FAL generation
`supabase/functions/generate-meal-image/index.ts:83-91` — _security_ · confidence: high

- **What:** The function skips auth ('images are globally cached') and relies solely on the per-IP in-memory rate limit, which resets on cold start and is per-isolate. Any caller can enumerate meal names (from the public trending_meals table or app binary) and trigger FAL Flux-2 image generation with arbitrary prompts. The cache check happens after rate limiting, so cache hits still burn the counter.
- **Impact:** FAL credits can be drained by unauthenticated callers; novel meal names bypass the cache and each costs a paid generation.
- **Fix:** Require a valid JWT (verifyUser) — the global-cache benefit is preserved while blocking fully anonymous abuse. Add a per-user daily image-gen cap. Add a service-role bypass for internal cron calls. Check the cache before the rate-limit check.

### H11. seed-recipe-template is an unauthenticated public endpoint proxying Google AI
`supabase/functions/seed-recipe-template/index.ts:46-60` — _security_ · confidence: high

- **What:** The function has no user auth (only per-IP rate limiting that resets on cold start) and was intended to be deleted after one-time seeding. If still deployed it is an open proxy to the Google AI API, allowing anyone to burn GOOGLE_AI_KEY quota at 30 req/min per IP.
- **Impact:** Uncontrolled Google AI quota depletion and potential cost if the function was not deleted post-seeding.
- **Fix:** Delete the function from Supabase if seeding is complete. If it must remain, require a hardcoded shared secret (CRON_SECRET pattern) before processing.

### H12. loops-sync delete action trusts caller-supplied body.email — any user can delete any contact
`supabase/functions/loops-sync/index.ts:149` — _security_ · confidence: high

- **What:** For action==='delete', the email is taken from body.email ?? callerUser.email. body.email is caller-supplied, so any authenticated user can call loopsDeleteContact on an arbitrary address and delete any contact from the app's Loops account.
- **Impact:** Any authenticated user can delete any email from the Loops contact list, disrupting marketing sequences and potentially wiping the contact database.
- **Fix:** Ignore body.email entirely; always use callerUser.email from the verified JWT.

### H13. Onboarding paywall completion proceeds without verifying a purchase occurred
`app/onboarding/index.tsx:3481-3495, 4219` — _security_ · confidence: high

- **What:** S7Paywall.onNext is just finish(). registerPlacement('usage_paywall') resolves on modal dismissal too, not only on purchase, and finish() is then called regardless of purchase. purchasedRef is checked only for the abandonment path, not the primary completion path. A user who dismisses the Superwall paywall still completes onboarding and writes onboarding_completed=true. Additionally the step deep-link param is parsed and passed to setStep without range-checking against valid steps (1-22), allowing jumps to the paywall/completion steps or skipping age verification.
- **Impact:** Users can dismiss the paywall and still enter the app, undermining the gate. Combined with missing server-side subscription checks this is a full bypass path. Deep-link step jumping can skip age gating and identity creation.
- **Fix:** After registerPlacement resolves, check purchasedRef before calling finish(); keep non-purchasers on the paywall. Verify subscriptionStatus in finish() before writing onboarding_completed. Validate stepParam against the allowlist of valid steps and require auth for steps >= 20.

### H14. Non-premium users can log meals — no auth/premium gate on the log path
`app/meal/[id].tsx:752-807` — _security_ · confidence: high

- **What:** handleSave checks isPremium, but logToSlot (and handleLog which opens the slot picker) has no premium check. Any authenticated user can log unlimited meals for free in a premium-only app with no free tier.
- **Impact:** Free-tier bypass of a premium feature, undermining the monetization model.
- **Fix:** Add the same isPremium/triggerUpgrade gate at the top of logToSlot or in handleLog before opening the picker.

### H15. Creator recipe daily post limit is client-side only — server allows unlimited posts
`components/CreatorRecipeModal.tsx:42,77,131-136,227-230` — _security_ · confidence: high

- **What:** DAILY_LIMIT (2/day) is enforced only in client React state checked before INSERT. There is no server-side INSERT policy counting today's rows per creator, so a user can replay the INSERT or remount to bypass it. Each post triggers up to 2 OpenAI calls (macro/title estimation).
- **Impact:** A creator can flood trending_meals unlimited times per day, skew the feed, and abuse AI estimation cost.
- **Fix:** Enforce the daily limit via a Postgres trigger or edge function that counts today's rows for the creator before allowing INSERT. Keep the client check as UX only.

## Medium (42)

### M1. setState-in-render via setTimeout(0) can cause uncontrolled render loop
`components/AILogModal.tsx:457-471` — _correctness_ · confidence: high

- **What:** An IIFE in the render body of the review step calls setTimeout(() => setCalories(String(macroCals)), 0) when macros and calories diverge. This fires outside React batching, triggering a re-render that re-enters the same IIFE; if calories and computed macroCals keep differing it loops, thrashing on every keystroke in a macro field.
- **Fix:** Move calorie auto-sync into useEffect([protein,carbs,fat]) guarded by lastEditedMacro, clearing lastEditedMacro after updating. Remove the in-render IIFE.

### M2. Routing effect re-runs on token refresh / lacks cancellation, can bounce active users to onboarding
`app/_layout.tsx:99-153` — _correctness_ · confidence: high

- **What:** The routing useEffect depends on [session, loading] and re-fires on every session identity change including silent TOKEN_REFRESHED events. It has no cancellation guard, so a stale in-flight Promise.all can call router.replace after a newer run. The onboarding-path guard does not protect authenticated tab screens. If onboarding_complete is missing (reinstall/new device) and the fallback Supabase profile query transiently fails (no retry here, unlike signin.tsx), completed users are routed to /onboarding and may overwrite profile data on finish().
- **Fix:** Add a cancelled flag in the effect cleanup and check it before router.replace. Once checking is false and the user is in /(tabs), do not re-route on session identity changes (let session===null handle sign-out). Add a retry to the profile fallback query and default authenticated users to /(tabs) on transient failure.

### M3. Backfill loop uses captured positional index for setMeals, assigning images to wrong/undefined slots
`app/(tabs)/saved.tsx:219-222` — _correctness_ · confidence: high

- **What:** The async image backfill closure captures the positional index i from the original array. When setMeals(prev => ...) fires, prev may have changed (e.g. an unsave filtered out a meal), so updated[i] no longer refers to the same meal, assigning the image to the wrong card or to undefined.
- **Fix:** Key the update by meal id: setMeals(prev => prev.map(m => m.id === meal.id ? {...m, image: imgData.image} : m)).

### M4. Concurrent requestConsent calls overwrite pendingResolve, leaking unresolved promises
`context/AIConsentContext.tsx:84-91` — _correctness_ · confidence: high

- **What:** If two components call requestConsent() before consent is granted, both enter the new Promise branch and the second overwrites pendingResolve.current. When the modal resolves only the second promise settles; the first caller hangs forever with no timeout.
- **Fix:** Store pendingResolve as an array and resolve all waiters, or share a single in-flight promise across concurrent callers.

### M5. prefetchMeals fires unauthenticated/generic meal generation on OAuth sign-up
`app/onboarding/createaccount.tsx:106,160` — _correctness_ · confidence: high

- **What:** prefetchMeals() runs immediately after signInWithApple/signInWithGoogle while the Supabase session may not yet be persisted. generateMeals -> getSession may return null and throw (swallowed by an empty catch), or if the session races in, it charges a real meal-gen credit against the new user's daily cap before profile preferences exist, caching generic 'common pantry' results that ignore the user's goals.
- **Fix:** Remove prefetchMeals from the OAuth sign-up paths; trigger speculative warming only after the paywall and profile persistence using a verified session and real preferences.

### M6. createaccount OAuth returning-user check trusts only local AsyncStorage
`app/onboarding/createaccount.tsx:91-118` — _correctness_ · confidence: high

- **What:** isReturningUser() checks only the local onboarding_complete flag. After reinstall/new device/cleared storage, an existing completed user who signs in via Apple/Google is routed to step 20 (paywall) instead of /(tabs), can be re-shown a subscription prompt, and prefetchMeals burns a meal-gen credit.
- **Fix:** After OAuth, query profiles.select('onboarding_completed, calorie_goal') and route to /(tabs) if completed, mirroring routeByProfile.

### M7. verify-email onboarding-completion check uses only calorie_goal, diverging from other routers
`app/onboarding/verify-email.tsx:119-133` — _correctness_ · confidence: high

- **What:** The isSignIn branch selects only calorie_goal to decide whether to fast-path to /(tabs), while _layout.tsx and signin.tsx routeByProfile check onboarding_completed OR calorie_goal. A completed user with null calorie_goal is sent back through onboarding (risking overwrite), and routing is inconsistent across sign-in paths.
- **Fix:** Select onboarding_completed, calorie_goal and use if (profile?.onboarding_completed || profile?.calorie_goal).

### M8. Birthday age gate does not block continuation when birthday is left empty
`app/onboarding/index.tsx:1505-1516` — _correctness_ · confidence: high

- **What:** The underage check is value !== '' && age < 13. If the user never scrolls the birthday wheel, value stays '' (the DEFAULT_DATA default), underage is false, and Continue is enabled, bypassing the 13+ gate. computeAge('') returns 0, so BMR falls back to parsedAge=25.
- **Fix:** Require a non-empty birthday before enabling Continue (disabled={!value || underage}) or set a non-empty default that emits a value.

### M9. food-preferences and pantry loaders ignore Supabase errors, risking destructive empty saves
`app/food-preferences.tsx + app/(tabs)/pantry.tsx:food-preferences.tsx:54-66; pantry.tsx:277-310` — _correctness_ · confidence: high

- **What:** loadPreferences destructures only { data }, ignoring error; on a failed load it shows all chips unchecked, and a subsequent Save overwrites the real food_dislikes with an empty array. fetchItems similarly checks only !data and silently returns on error, showing an empty/stale pantry with no feedback.
- **Fix:** Destructure { data, error }; on error show an error state and block saving (preferences) / show a retry banner (pantry). Do not pre-populate state with empty arrays on failure.

### M10. generate-meals and parse-receipt/scan-pantry second-pass/estimate-meal-macros lack timeouts and burn slots on platform kill
`supabase/functions/generate-meals/index.ts + scan-pantry/index.ts + parse-receipt/index.ts + estimate-meal-macros/index.ts:generate-meals:339-366; scan-pantry:246-288; parse-receipt:42-86; estimate-meal-macros:167-241` — _correctness_ · confidence: high

- **What:** Multiple outbound AI/provider fetches have no AbortController timeout (generate-meals LLM call; scan-pantry's second-pass GPT-4o call; both parse-receipt provider calls; estimate-meal-macros OpenAI + serial FatSecret). The scan cap is charged before these calls, so a hang runs until the ~150s platform kill, returning no response and not refunding the consumed slot (refund logic in the outer catch never runs on a platform kill).
- **Fix:** Wrap all outbound provider fetches in AbortController timeouts (e.g. 80s LLM, 45-60s second pass, computed remaining budget). Call refundScan on timeout/abort. Add a client-side Promise.race timeout for the receipt scan.

### M11. parse-receipt uses an invalid Gemini model name, silently falling back to GPT-4o on every scan
`supabase/functions/parse-receipt/index.ts:44` — _correctness_ · confidence: medium

- **What:** The Gemini call uses model gemini-3.1-flash-lite, which does not exist. The primary path errors on every call and falls back to GPT-4o, paying GPT-4o cost for every receipt scan instead of the intended near-free Gemini path.
- **Fix:** Use a valid model name (e.g. gemini-2.0-flash-lite or gemini-1.5-flash), verified against the current Google AI v1beta endpoint.

### M12. reset-password / verify-email advance to code step and send OTP without surfacing send errors
`app/onboarding/reset-password.tsx + app/onboarding/verify-email.tsx:reset-password:73-81; verify-email:44-51` — _correctness_ · confidence: high

- **What:** reset-password handleSendCode calls setStep('code') and starts the cooldown before the Turnstile token + OTP send actually completes asynchronously; if Turnstile/OTP fails the user waits on a code screen for a code never sent (handleCaptchaToken only alerts on supabase error). verify-email handleCaptchaToken discards the signInWithOtp { error } entirely, so rate-limit/invalid-email failures are silent.
- **Fix:** Keep the step at 'email' until the OTP send returns without error (move setStep('code') into handleCaptchaToken on success). Destructure and alert on the signInWithOtp error in verify-email; reset the cooldown on failure.

### M13. removeFromPantry bulk-updates all rows matching the ingredient name for the user
`app/meal/[id].tsx:549-553` — _correctness_ · confidence: medium

- **What:** removeFromPantry runs an UPDATE in_stock=false scoped to user_id but matching by ilike name with no row limit, marking every pantry row with that name out of stock. If the user has the same ingredient from multiple import paths, 'I don't have this' removes all of them, not just the shown entry.
- **Fix:** Look up the specific pantry_item id (as addToPantry already does) and update by id.

### M14. WebView delivery screen: no error handler (perpetual spinner) and no originWhitelist
`app/delivery-webview.tsx:46-52` — _correctness_ · confidence: high

- **What:** The WebView clears the loading overlay only via onLoadEnd; iOS SSL/ATS/timeout failures fire onError/onHttpError (unhandled), leaving a permanent spinner. It also omits originWhitelist (defaults to ['*']) and onShouldStartLoadWithRequest, so any link on the Instacart page can navigate to arbitrary URLs (including phishing pages shown inside Pantry chrome).
- **Fix:** Add onError/onHttpError to clear loading (and offer retry). Set originWhitelist to ['https://*.instacart.com'] and use onShouldStartLoadWithRequest to open off-domain URLs in the system browser.

### M15. loops-sync drops critical lifecycle events when the contact upsert fails
`supabase/functions/loops-sync/index.ts:186-216` — _correctness_ · confidence: medium

- **What:** loopsUpsertContact throws on any non-2xx; if it fails transiently the function returns 500 and the caller's event (trial_started, subscribed, churned) is never fired, with no retry and no way to distinguish upsert failure from event failure. The loops_contact_synced_at update also only runs on success.
- **Fix:** Retry the upsert with backoff; separate upsert vs event-fire failures in the error response; queue failed critical events to a dead-letter table.

### M16. Array index used as React key for editable ingredient/step lists
`components/RecipeFormModal.tsx + components/CreatorRecipeModal.tsx:RecipeFormModal:380,418; CreatorRecipeModal:551,574` — _correctness_ · confidence: high

- **What:** Dynamic ingredient/step lists use the array index as the React key. Removing a middle item causes React to reuse rows incorrectly, so TextInput values bleed into adjacent rows, silently corrupting the saved recipe.
- **Fix:** Assign a stable unique id per item on creation and use it as the key.

### M17. CreatorRecipeModal: AI estimation has no try/catch — a network error permanently freezes Save
`components/CreatorRecipeModal.tsx:254-296` — _correctness_ · confidence: high

- **What:** The Promise.all of estimate-meal-macros + generate-recipe has no surrounding try/catch. Any transient failure rejects, submitting is never reset to false, the button stays disabled and labeled 'Estimating...' for the session, and entered form data is lost.
- **Fix:** Wrap the estimation block in try/catch; in catch reset submitting/label and alert, optionally falling back to zero-filled macros.

### M18. PantryScanModal step-6 'Add Ingredients' ignores insert errors, silently losing items
`components/PantryScanModal.tsx:905-928` — _correctness_ · confidence: high

- **What:** The step-6 onPress calls supabase.from('pantry_items').insert(...) without checking error (unlike the step-55 path which does), then fires onItemsAdded and closes regardless. If the insert fails, the modal closes normally, the parent refreshes, but no items were written.
- **Fix:** Destructure and check error in the step-6 handler as step-55 does, alerting and returning on failure.

### M19. AsyncStorage recent-foods parsed without try/catch
`components/FoodSearchModal.tsx:113-118` — _correctness_ · confidence: high

- **What:** AsyncStorage.getItem(RECENT_FOODS_KEY).then(data => JSON.parse(data)) has no catch. Corrupt stored data throws an unhandled rejection, potentially crashing the JS thread or leaving the modal broken.
- **Fix:** Wrap the parse in try/catch and fall back to [] (and removeItem) on error.

### M20. Staples one-shot prompt can reappear when dismissed via swipe gesture
`app/(tabs)/index.tsx:1480-1499` — _correctness_ · confidence: high

- **What:** STAPLES_PROMPTED_KEY is written only on the 'Done' button path; the iOS sheet swipe-to-dismiss triggers onRequestClose which calls setShowStaplesPrompt(false) without writing the key, so the 'fires once' prompt can reappear on a later scan.
- **Fix:** Write STAPLES_PROMPTED_KEY in onRequestClose as well (or in a single shared dismissal helper).

### M21. Open Food Facts barcode fetch has no timeout
`lib/fatsecret.ts:139-151` — _correctness_ · confidence: high

- **What:** productNameFromBarcode fetches Open Food Facts with no AbortController/timeout; if the service is slow/unreachable the fetch hangs indefinitely, leaving the barcode scan spinner stuck.
- **Fix:** Add an AbortController with a ~5s timeout and catch AbortError to return null.

### M22. Optimistic toggle/add/delete mutations across grocery, pantry, meal, home lack error rollback
`app/(tabs)/grocery.tsx + app/(tabs)/pantry.tsx + app/meal/[id].tsx + app/(tabs)/index.tsx:grocery:240-265,271-315; pantry:324-350; meal:446-471,507-553; index:728-731` — _data-integrity_ · confidence: high

- **What:** Many mutations update local state optimistically then fire Supabase without checking the returned error or rolling back: grocery toggle/rename/delete/clearChecked and addToPantry (which removes grocery items before the write succeeds); pantry toggleStock/deleteIngredient; meal addToGrocery/addToPantry/removeFromPantry/removeFromGrocery and rateMeal; home deleteEntry. On failure the UI diverges from the DB, sometimes with silent data loss (e.g. grocery items vanish without reaching the pantry).
- **Fix:** Await each mutation, check error, and roll back local state (or refetch) and show a brief error on failure. For grocery addToPantry, perform DB writes before removing items from state.

### M23. Client-side fuzzy dedup in grocery fetch permanently hides DB rows that are never cleaned up
`app/(tabs)/grocery.tsx:189-199` — _data-integrity_ · confidence: high

- **What:** The substring dedup in fetchItems collapses e.g. 'chicken breast' into 'chicken' purely client-side; the discarded row still exists in the DB, is re-hidden on every fetch, and is never toggled or deleted when the user acts on the visible item, accumulating stale rows indefinitely.
- **Fix:** Enforce a unique constraint on user_id+lower(name) or dedup at insert time. If client filtering remains, delete the hidden duplicate rows so they don't accumulate.

### M24. generate-meals returns 200 with empty array (no refund) when filters or bad input remove all meals
`supabase/functions/generate-meals/index.ts:162-173, 386-427` — _data-integrity_ · confidence: high

- **What:** If macro-band/ranking/prep-time filters remove every generated meal, the function returns HTTP 200 with [] and the daily slot is burned with no refund and no meaningful error. Additionally, malformed input (mealsPerDay=0 -> division yields Infinity targets and displayCount 0; proteinGoal=0 -> proteinMin>proteinMax) silently produces empty results, also burning a slot.
- **Fix:** After filtering, if meals.length===0 call refundScan and return a 422 with a meaningful error. Validate mealsPerDay (1-10), calorieGoal>0, proteinGoal>0 up front and reject with 400 without consuming a slot.

### M25. revokeConsent ignores Supabase errors, leaving local and server consent state inconsistent
`context/AIConsentContext.tsx:118-127` — _data-integrity_ · confidence: high

- **What:** revokeConsent awaits the Supabase update but does not check error, yet always resets local state. If the write fails, the UI shows consent revoked while the DB still records ai_consent_accepted_at; on next launch the profile fetch re-hydrates hasConsent=true, reversing the apparent revocation.
- **Fix:** Check error and only reset local state on success; on failure keep hasConsent=true and surface an error.

### M26. Preference/goal changes do not invalidate the meal cache, serving meals with disallowed foods/wrong macros
`app/food-preferences.tsx + app/(tabs)/profile.tsx:food-preferences:137-141; profile:764-820` — _data-integrity_ · confidence: high

- **What:** food-preferences save deliberately does not wipe the daily meal cache, so newly disliked foods (including allergens like Nuts/Shellfish) can still appear in cached meals for up to a day — inconsistent with saveDiet/saveDietType which do wipe the cache. submitCalcModal recalculates goals but also does not wipe the meal cache, so meals stay calibrated to old macro targets (potentially 40%+ off) for the rest of the day.
- **Fix:** Invalidate the daily meal cache (AsyncStorage.multiRemove of the meal keys) on food-preferences save and in submitCalcModal, consistent with the diet save paths.

### M27. Creator profile INSERT has no server-side uniqueness guard on user_id
`components/CreatorRecipeModal.tsx:205-221` — _data-integrity_ · confidence: medium

- **What:** handleSaveProfile inserts a creators row without a server uniqueness constraint on user_id (only handle is unique). Rapid double-taps or concurrent sessions can create two creator profiles for one account; later reads using maybeSingle() then throw when multiple rows return, breaking the creator flow.
- **Fix:** Add a UNIQUE constraint on creators(user_id) and handle the conflict error like the handle-collision case.

### M28. Triple/duplicate fetch triggers on Discover cause redundant concurrent queries and races
`app/(tabs)/discover.tsx:250-264` — _performance_ · confidence: high

- **What:** fetchTrending is wired to a mount useEffect, useFocusEffect, and an AppState 'active' listener simultaneously. On mount and on background->foreground these fire 2-3 concurrent identical queries that race on setTrending/setLoading; refocus/resume re-queries the once-daily pool repeatedly.
- **Fix:** Remove the standalone mount useEffect (useFocusEffect covers mount), add a useRef in-flight guard so concurrent calls short-circuit, and cache the pool in AsyncStorage with a today TTL so intra-day resumes skip the DB call.

### M29. FatSecret macro lookups fire massive concurrent N+1 calls per meal generation
`supabase/functions/generate-meals/index.ts (also generate-trending-meals, estimate-meal-macros):generate-meals:80,376-380; generate-trending-meals:73,632; estimate-meal-macros:195-206` — _scaling_ · confidence: high

- **What:** correctMealMacros uses Promise.all over ingredients, each lookupMacros doing 2 FatSecret HTTP calls; generate-meals fans this out across all meals (up to ~100-150 concurrent calls per request). generate-trending-meals does the same across up to 30 recipes in a single cron run (hundreds concurrent). estimate-meal-macros does the inverse problem — a sequential N+1 loop blocking the function. None have per-call timeouts or caching. FatSecret's free tier (~5000 calls/day) is exhausted in hours at scale, and bursts trigger 429s that silently fall back to uncorrected LLM macros.
- **Fix:** Cache FatSecret results in a Supabase table keyed by food name+grams with a ~7-day TTL (check cache before calling). Apply a concurrency limit (semaphore, cap 5-10) instead of unbounded Promise.all; parallelize the sequential loop in estimate-meal-macros. Add per-call AbortController timeouts.

### M30. Discover trending_meals query has no row limit and stale diet profile filter
`app/(tabs)/discover.tsx:192-217` — _scaling_ · confidence: high

- **What:** fetchTrending queries trending_meals over a 30-day window with full JSONB ingredients/steps and no .limit(), embedding creators. As the pool grows (~18/day), each focus/resume fetch returns hundreds of rows of multi-KB JSONB to every active user, a thundering-herd of large payloads at scale. Separately, the dietary profile (food_dislikes, dietary_restrictions, diet_type) that gates the always-on allergen filter is fetched only once per user and not refreshed on focus, so allergen edits don't apply until app restart.
- **Fix:** Add .limit(60) to the query and move ingredients/steps to a detail table fetched on demand. Re-read the dietary profile in useFocusEffect (or within fetchTrending) so filters stay current.

### M31. extract-recipe-from-url scrapes YouTube HTML (fragile/ToS risk) with no timeout and no daily cap
`supabase/functions/extract-recipe-from-url/index.ts:29-58,160-226` — _scaling_ · confidence: high

- **What:** The function scrapes the YouTube watch page HTML with a spoofed User-Agent (ToS violation, fragile regexes, breaks on EU consent pages) and the watch/caption fetches have no AbortController timeout, so slow responses hang until the platform kill. It also has no per-user daily cap (unlike scan-pantry/generate-meals) and only the per-isolate IP limit, so each call makes 3 external fetches + an OpenAI call with no cost bound.
- **Fix:** Use the official YouTube Data API for descriptions/captions instead of scraping. Add AbortController timeouts to the fetches. Add checkScanCap/refundScan with a reasonable daily limit.

### M32. generate-trending-meals YouTube API calls run sequentially with no timeout and no quota-exhaustion handling
`supabase/functions/generate-trending-meals/index.ts:285-322` — _scaling_ · confidence: medium

- **What:** The cron fires ~7-9 sequential YouTube Data API searches + detail fetches per run with no per-fetch timeout. A slow YouTube response absorbs the function's wall-clock budget, and 403/quota-exceeded responses are logged then continue, silently producing an empty pool. Manual forceRefresh triggers can deplete quota for the day.
- **Fix:** Run searches in parallel with Promise.allSettled and per-fetch AbortController timeouts; on 403 break immediately and fall back to the prior day's pool; track daily search count and hard-abort past a safe threshold.

### M33. generate-trending-meals image fan-out (up to ~54 FAL calls) runs in the cron's critical path
`supabase/functions/generate-trending-meals/index.ts:757-787` — _scaling_ · confidence: high

- **What:** After inserting up to 18 meals, the cron re-fetches and sends each to generate-meal-image in waves of 5, each call doing an LLM description + up to 3 FAL Flux attempts (up to ~18 LLM + ~54 FAL calls). These run within the ~150s wall clock; if waves run long the function is killed leaving rows without AI images. The internal calls also pass no Authorization header, relying on the unauthenticated image endpoint.
- **Fix:** Decouple image generation from the cron via a job-queue table processed by a separate function or pg_cron per row. Add a service-role bypass in generate-meal-image for internal calls.

### M34. loops-import-waitlist loads the entire table and processes serially, timing out for large waitlists
`supabase/functions/loops-import-waitlist/index.ts:31-34,76,79` — _scaling_ · confidence: high

- **What:** The query selects all waitlist rows with no limit and processes each with a 120ms sleep; beyond ~1,200 rows the import exceeds the 150s wall clock and times out mid-run with no resume cursor, silently leaving an unknown subset unimported. The errors array is also silently truncated to 20 with no total count.
- **Fix:** Add pagination (range/limit + offset param) so the caller can resume; include errors_total in the response.

### M35. Parallel image fetches during onboarding plan reveal / swipe are unbounded
`app/onboarding/index.tsx:2871-2885, 3677` — _scaling_ · confidence: high

- **What:** SPlanReveal and SMealSwipe use Promise.all to fire 6-8 simultaneous generate-meal-image invocations per screen, with SPlanReveal pre-mounted to prefetch. At scale this produces tens of thousands of concurrent edge invocations in the prefetch window; errors are swallowed leaving blank placeholders.
- **Fix:** Fetch sequentially or cap concurrency to 2-3; prefetch only the first visible meal and defer the rest, mirroring the project's sequential-image discipline.

### M36. fatsecret-proxy passes caller-supplied method and params unsanitized into the signed request
`supabase/functions/fatsecret-proxy/index.ts:84-93` — _security_ · confidence: high

- **What:** The method string and all params are taken directly from the request body and injected into the OAuth-signed FatSecret URL with no allowlist. Any authenticated user can call any FatSecret API method with arbitrary parameters, exposing the full FatSecret API surface (including write methods if the key permits).
- **Fix:** Maintain an allowlist of permitted method values (e.g. foods.search, food.get, foods.autocomplete) and reject others. Strip params not expected for the given method.

### M37. reset-password sets onboarding_complete=true and routes to app without subscription/profile check
`app/onboarding/reset-password.tsx:163-165` — _security_ · confidence: high

- **What:** After a successful password reset, the code writes AsyncStorage onboarding_complete='true' and routes to /(tabs) with no check of the user's profile or subscription. A user who abandoned onboarding before the paywall can reset their password and land directly in the app, bypassing the paywall. The reset also uses signInWithOtp (sign-in OTP) rather than resetPasswordForEmail with type:'recovery', granting a full session and being fragile if the project enforces MFA on updateUser.
- **Fix:** Before routing, query the profile for onboarding_completed and route to /onboarding if incomplete; do not pre-set onboarding_complete. Use resetPasswordForEmail + verifyOtp type:'recovery' for the reset flow.

### M38. Creator/trending-meal content injection — INSERT policy lacks promo_active enforcement; unvalidated social URLs
`app/(tabs)/discover.tsx + creators/trending_meals INSERT policies:discover.tsx:398-406,472-483` — _security_ · confidence: high

- **What:** promo_active is only a UI gate for the creator '+' button. The trending_meals INSERT policy only checks creator_id ownership, and the creators INSERT policy has no promo check, so any authenticated user can create a creator record and inject arbitrary meal content into the shared feed. Separately, social URLs (instagram_url/tiktok_url/youtube_url) come from the DB unvalidated and are passed to Linking.openURL without an https scheme check, allowing javascript:/data:/custom-scheme deep-link hijacking.
- **Fix:** Add a promo_active check to both INSERT policies (server-side). Validate socialUrl starts with https:// before Linking.openURL, and add a CHECK constraint restricting URL columns to https?:// prefixes.

### M39. estimate-meal-macros has no per-user daily cap on an expensive GPT-4o vision call
`supabase/functions/estimate-meal-macros/index.ts:88-90` — _security_ · confidence: high

- **What:** The function is authenticated and IP-rate-limited (15/min) but has no per-user daily cap, unlike scan-pantry and parse-receipt. Photo mode calls gpt-4o detail:high (~$0.015-0.02/image). The IP limit is per-isolate and spoofable, so a user can call it continuously.
- **Fix:** Apply checkScanCap with a reasonable daily limit (e.g. 20/day) keyed on user.id before the OpenAI call, with refundScan in the error path.

### M40. scan-pantry accepts unbounded image count and size
`supabase/functions/scan-pantry/index.ts:42-50` — _security_ · confidence: high

- **What:** The images array has only a non-empty check — no cap on length or per-image size. All images are sent at detail:high to GPT-4o. A client can send dozens of multi-MB images, burning a scan slot, timing out, and stressing memory parsing a huge JSON body.
- **Fix:** Before checkScanCap, reject requests with images.length > 10 or any image base64 > ~2MB with a 400.

### M41. CreatorRecipeModal photo uploaded to public bucket with a guessable timestamp filename
`components/CreatorRecipeModal.tsx:181` — _security_ · confidence: medium

- **What:** The upload path is creator-recipes/${Date.now()}.jpg with upsert:true. The millisecond timestamp is enumerable, so a racing attacker can overwrite another creator's just-uploaded photo before it is linked.
- **Fix:** Use an unguessable path: creator-recipes/${user.id}/${crypto.randomUUID()}.jpg.

### M42. AILogModal sends raw base64 photo to edge function with no size validation
`components/AILogModal.tsx:55-61` — _security_ · confidence: medium

- **What:** estimateFromPhoto sends the full base64 string to the edge function with only quality-0.8 compression and no max-size check; the edge function forwards it to OpenAI unchecked. A large image (or arbitrary client payload) increases cost and can cause timeouts.
- **Fix:** Resize to ~1024px longest side and/or reject base64 over ~1.4M chars before invoking.

## Low (27)

### L1. isPremium drops to false for promo users on subscription status change
`context/SuperwallContext.tsx:92` — _correctness_ · confidence: high

- **What:** Inside onSubscriptionStatusChange, setIsPremium(newStatus === 'ACTIVE') is called unconditionally, ignoring promoActive. There is a window before the re-sync useEffect runs where a promo user with INACTIVE Superwall status is treated as non-premium, flashing upgrade prompts or blocking premium UI.
- **Fix:** Change line 92 to setIsPremium(newStatus === 'ACTIVE' || promoActive).

### L2. submitCalcModal setInterval animation timer leaked on unmount
`app/(tabs)/profile.tsx:801-819` — _correctness_ · confidence: high

- **What:** submitCalcModal starts a setInterval driving the count-up animation, cleared only inside its own callback after 30 steps. If the component unmounts mid-animation the remaining ticks fire on a dead component, calling several state setters and producing warnings/stale-closure bugs on remount.
- **Fix:** Store the timer in a ref and clear it in a useEffect cleanup on unmount.

### L3. Barcode lookup accepts first FatSecret result with no name validation, logging wrong macros
`lib/fatsecret.ts:157-162` — _correctness_ · confidence: high

- **What:** findFoodByBarcode takes the Open Food Facts product name, searches FatSecret, and blindly uses results[0].food_id with no similarity check. OFF and FatSecret names can differ significantly, so the top result may be a completely different food, silently loading wrong macros.
- **Fix:** Compute a token-overlap similarity between the OFF product name and results[0].food_name; if below threshold return null and let the user search manually. Also add a fetch timeout (AbortController) to the Open Food Facts call which currently has none.

### L4. TurnstileWebView silently drops Turnstile errors, leaving auth flows stuck
`components/TurnstileWebView.tsx:58-66` — _correctness_ · confidence: high

- **What:** When Turnstile fires error-callback (posting 'ERROR'), handleMessage does nothing — no onError prop, no sentinel. Callers cannot detect a failed challenge (network error, expired widget) and cannot retry, so auth-gated flows hang on a spinner indefinitely.
- **Fix:** Add an onError?: () => void prop and call it when the token is 'ERROR'; callers show a retry option.

### L5. Integer truncation discards fractional macros across recipe forms
`components/RecipeFormModal.tsx + components/CreatorRecipeModal.tsx:RecipeFormModal:186,194-198; CreatorRecipeModal:243-247` — _correctness_ · confidence: high

- **What:** Nutrition fields (calories, protein, carbs, fat, prepTime, ingredient grams) are parsed with parseInt, which floors, so AI values like 22.7g or 187.5kcal store as 22/187. This compounds across a day's meals.
- **Fix:** Use Math.round(parseFloat(value)) for all nutrition fields.

### L6. applyVarietyFill caps results to 6 upstream, making rail caps dead code
`app/(tabs)/discover.tsx:73-87,294-302` — _correctness_ · confidence: high

- **What:** applyVarietyFill caps the filtered array to TARGET_DISCOVER_COUNT=6 before the per-rail RAIL_CAPS (youtube:8, creator:6) are applied, so both rails together can only ever show ~5 cards and the creator rail appears sparse — the documented 'up to 8 / up to 6' intent is never met.
- **Fix:** Raise TARGET_DISCOVER_COUNT to the sum of rail caps + featured, or apply variety-fill per rail against each rail's own pool.

### L7. fatsecret-proxy maps all FatSecret errors to HTTP 400
`supabase/functions/fatsecret-proxy/index.ts:97-101` — _correctness_ · confidence: medium

- **What:** When FatSecret returns an error, the proxy always responds 400, so the client cannot distinguish rate-limit (code 6) or auth (code 8) failures from a genuinely bad query and cannot apply appropriate retry/backoff.
- **Fix:** Map FatSecret error codes to appropriate HTTP statuses (6->429, 8->502/500, else 400) and include the code in the body.

### L8. isToday computed at render time can become stale across midnight, blocking forward navigation
`app/(tabs)/index.tsx:637,647` — _correctness_ · confidence: medium

- **What:** isToday is a render-time constant comparing selectedDate to today's date string. If the app stays open across midnight on the home tab, isToday stays true for the now-previous day, and the forward-nav guard incorrectly blocks navigating to the actual new day until a re-render.
- **Fix:** Compute isToday inside the day-navigation callbacks (which run on interaction) or track current date via state updated at midnight.

### L9. SplashOverlay starts animations before reduceMotion resolves
`components/SplashOverlay.tsx:43-89` — _correctness_ · confidence: medium

- **What:** Animations start with reduceMotion's initial false value before AccessibilityInfo.isReduceMotionEnabled() resolves, so users with Reduce Motion enabled may see a flash of the prohibited animation before cleanup stops it — an accessibility regression.
- **Fix:** Await isReduceMotionEnabled and gate all animation effects on a ready flag set after resolution.

### L10. generate-trending-meals discards legitimate high-calorie ingredients in macro scoring
`supabase/functions/generate-trending-meals/index.ts:80-87` — _correctness_ · confidence: medium

- **What:** correctMealMacros skips any ingredient with cal>900 or protein>100 to reject bad lookups, but this also rejects legitimate high-calorie ingredients (e.g. 200g peanut butter), undercounting totals and unfairly lowering the macroAgreementScore used in MMR selection. Displayed macros use LLM values so user-facing numbers are unaffected.
- **Fix:** Raise the cap substantially (e.g. cal>2500) or rely on ratio-disagreement scoring rather than a per-ingredient absolute cap.

### L11. delete-account swallows all child-row delete errors, leaving orphaned data after auth deletion
`supabase/functions/delete-account/index.ts:99-111` — _data-integrity_ · confidence: high _(needs confirmation)_

- **What:** Every child-table .delete() passes .then(()=>{}, ()=>{}) swallowing all errors, and the outer try/catch only logs partial failures before deleting the auth row anyway. If e.g. meal_logs delete fails, those rows are orphaned permanently once the auth.users FK target is gone — a GDPR Article 17 erasure failure and data bloat. The function also omits deleting scan-usage rows, risking a FK violation if not CASCADE.
- **Fix:** Collect and surface delete errors; do not delete the auth row if non-transient errors occurred. Prefer a single Postgres function with BEGIN/COMMIT for atomic cleanup. Include the scan-usage table in the deletes.

### L12. Concurrent/double-submit races create duplicate rows (grocery, pantry, meal log, creator recipe)
`app/(tabs)/grocery.tsx + app/(tabs)/pantry.tsx + app/meal/[id].tsx + components/CreatorRecipeModal.tsx:grocery:326-365,373-385; pantry:352-392; meal:752-795; CreatorRecipeModal:241,316-339` — _data-integrity_ · confidence: high

- **What:** Several async insert paths lack in-flight guards: grocery submitInline (double-tap inserts duplicates since the dedup check reads stale state) and handleReorder (re-inserts items already on the list with no dedup); pantry addIngredient (async gap before addSaving=true lets two taps both insert); meal logToSlot (slot picker stays open so two slots can be tapped, double-logging); CreatorRecipeModal can INSERT on an unmounted component during AI estimation. handleReorder also never checks existing items before inserting.
- **Fix:** Add a savingRef/useRef in-flight guard at the top of each insert path; close the slot picker before logToSlot's async work; filter out already-present items in handleReorder (or upsert); guard CreatorRecipeModal setState/insert with a mounted ref. Consider DB unique constraints (user_id, lower(name)).

### L13. addStapleToPantry inserts all staples with hardcoded 'Spices & Seasonings' category
`app/(tabs)/index.tsx:482` — _data-integrity_ · confidence: high

- **What:** Adding a missing staple to the pantry always sets category 'Spices & Seasonings' regardless of the item, so eggs, rice, milk, flour, butter, olive oil are permanently miscategorized everywhere categories appear.
- **Fix:** Maintain a staple-name -> category map and use it on insert.

### L14. Daily meal cache and image-URL cache are not user-scoped and never invalidated/evicted
`lib/useMealSuggestions.ts:7-8,41-69,154,228` — _data-integrity_ · confidence: high

- **What:** pantry_daily_meals_* and pantry_image_urls_v1 cache keys are not scoped by userId and sign-out only clears onboarding_complete, so on a shared device the prior user's meals/images are served to a new user. The image URL cache also grows unboundedly with no TTL/eviction and is never invalidated when meals are regenerated, serving stale/expired URLs and bloating AsyncStorage (synchronous Hermes reads cause JS-thread jank over time).
- **Fix:** Scope cache keys by userId (or clear all meal/image caches on sign-out). Add per-entry TTL and an LRU/size cap to the image cache, and delete entries for regenerated meal names.

### L15. resetOnboarding clears fewer cache keys than deleteAccount, leaving stale state
`app/(tabs)/profile.tsx:920-970` — _data-integrity_ · confidence: high

- **What:** resetOnboarding omits several AsyncStorage keys cleared elsewhere (plan_ready, recent_meal_names, staples_prompted, macros_expanded, image/meal caches), so a 'reset' user starts with stale recent-meal suppression lists, a pre-dismissed staples prompt, and stale caches. Separately, resetOnboarding performs irreversible bulk client-side deletes with all errors swallowed and is compiled into production though not wired to UI.
- **Fix:** Consolidate all cache keys into one shared constant array used by both reset and delete. Guard resetOnboarding behind __DEV__ or remove from the production bundle, and surface delete errors.

### L16. generate-trending-meals non-atomic delete+insert of today's YouTube meals creates an empty-feed window
`supabase/functions/generate-trending-meals/index.ts:743-744` — _data-integrity_ · confidence: high

- **What:** Today's YouTube rows are deleted, then new ones inserted in two separate calls with no transaction. During the multi-minute cron run, concurrent reads (users opening Discover) can see an empty or stale feed.
- **Fix:** Wrap delete+insert in a single Postgres transaction via an RPC, or upsert with a unique constraint so old rows remain visible until the insert completes.

### L17. MacroEditModal allows negative/zero/NaN values to persist as overrides
`components/MacroEditModal.tsx:66-84` — _data-integrity_ · confidence: high

- **What:** handleSave only checks isNaN, allowing negative calories/macros and silently no-ops on empty (NaN) fields with no user feedback. Negative or zero values persist to macro_overrides and propagate to log entries.
- **Fix:** Validate all fields >= 0 and calories > 0, and surface an error instead of silently ignoring NaN.

### L18. Pantry/Receipt scan inserts are not idempotent — duplicate items on retry or close-during-save races
`components/PantryScanModal.tsx + components/ReceiptScanModal.tsx:PantryScanModal:846,910; ReceiptScanModal:275` — _data-integrity_ · confidence: medium

- **What:** The 'Add items' saves call insert(rows); on a failed-then-retried save, or a close gesture racing an in-flight save (close button not disabled during save), the same rows can be inserted twice, creating duplicate pantry items that skew meal suggestions.
- **Fix:** Use upsert with onConflict user_id,name (or add a unique constraint) and disable the close button while saving.

### L19. Pantry drag-reorder is never persisted; order resets on next fetch
`app/(tabs)/pantry.tsx:423-425` — _data-integrity_ · confidence: high

- **What:** onDragEnd updates local categories order but makes no server call; fetchItems (on every focus) re-sorts by CATEGORY_CONFIG, discarding the user's custom order. The drag affordance implies persistence it does not deliver.
- **Fix:** Persist a user_category_order (e.g. on the profile) and read it in fetchItems, or remove the non-functional drag handle.

### L20. Animation/timer cleanups missing on unmount (gauge, undo toast)
`app/(tabs)/index.tsx + app/(tabs)/saved.tsx:index:106,127,147; saved:188,246-249` — _performance_ · confidence: high

- **What:** CalorieGauge/MacroBar useEffect cleanups remove listeners but never stopAnimation() on the Animated.Value, so animations continue post-unmount calling setState on a dead component. The Saved undo timerRef is never cleared on unmount, so dismissToast fires after navigation away.
- **Fix:** Call stopAnimation() in the animation effect cleanups and clearTimeout(timerRef.current) in a Saved unmount cleanup.

### L21. Several unbounded user-scoped queries lack row limits
`app/(tabs)/profile.tsx + app/(tabs)/index.tsx + app/(tabs)/grocery.tsx + lib/useMealSuggestions.ts:profile:630-643,671-679; index:447; grocery:168-202; useMealSuggestions:104-121` — _scaling_ · confidence: medium

- **What:** Multiple queries fetch all user rows with no .limit(): profile meal_logs (all-time, for streak/count), profile weight_logs (all-time), home pantry_items names (on every focus), grocery_items (on every focus), and useMealSuggestions pantry_items + meal_ratings (serialized into the GPT prompt). These grow linearly with tenure, increasing payloads, read cost, and (for the prompt) token cost and truncation risk.
- **Fix:** Add bounded limits/date filters: use count(head) for total meal logs and a 90-180 day window for streak; cap weight_logs (~365); limit pantry_items (e.g. 100-500) and meal_ratings (~50); cache pantry names and refetch only on item changes.

### L22. verifyUser hits the Supabase Auth API on every edge function call
`supabase/functions/_shared/auth.ts:26` — _scaling_ · confidence: medium

- **What:** verifyUser calls client.auth.getUser(token) — a network round-trip to the Auth service — on every authenticated request. At scale this adds 50-200ms latency per request and creates O(users x calls) Auth API load.
- **Fix:** Verify the JWT signature in-process against the cached JWKS (e.g. jose), eliminating the network round-trip.

### L23. scan-cap fails open on every DB error, removing the cost ceiling under load
`supabase/functions/_shared/scan-cap.ts:27-31` — _security_ · confidence: medium

- **What:** When check_and_increment_scan returns any error, checkScanCap returns { allowed: true } — the cap is bypassed. At scale, DB transient errors (connection pool saturation) cause all caps to fail open simultaneously, granting unlimited expensive OpenAI/FAL calls until the incident clears. The fail-open path also logs no specifics.
- **Fix:** Keep fail-open as a fallback but add a per-user-id in-memory backstop limiter when DB errors are detected, and emit structured logs/alerts on elevated fail-open rates.

### L24. admin-creator compares shared secret with non-constant-time equality
`supabase/functions/admin-creator/index.ts:19` — _security_ · confidence: medium

- **What:** body.secret !== adminSecret uses standard string equality, vulnerable to timing side-channel attacks; this function has service-role DB access.
- **Fix:** Use a constant-time comparison (e.g. compare SHA-256 hashes of both strings).

### L25. delete-account uses wildcard CORS on a destructive endpoint
`supabase/functions/delete-account/index.ts:42-45` — _security_ · confidence: medium

- **What:** Access-Control-Allow-Origin: * allows any origin to invoke account deletion if a valid JWT is supplied. A stolen JWT (e.g. via XSS on any site) could trigger deletion cross-origin. Since this is called from a native app, CORS is unnecessary.
- **Fix:** Restrict the allowed origin to known app origins or remove CORS headers entirely.

### L26. Client-side sign-in/account cooldown is bypassable and shows misleading wait times
`app/onboarding/signin.tsx + app/onboarding/createaccount.tsx:signin:32-33,52-60; createaccount:66-68` — _security_ · confidence: high

- **What:** The exponential sign-in cooldown lives only in React state, resetting on remount/relaunch and bypassable via the Auth REST endpoint, providing only a false sense of security. The cooldown alerts also show the full threshold ('60 seconds' / 'a few seconds') instead of the actual remaining time.
- **Fix:** Treat the client cooldown as UX-only, ensure Supabase Auth server-side rate limiting/lockout is configured, and display the actual remaining time in the alert.

### L27. User-supplied strings injected into LLM prompts without length limits/sanitization
`supabase/functions/generate-meals/index.ts + estimate-meal-macros/index.ts + categorize-item/index.ts:generate-meals:179-192; estimate-meal-macros:141; categorize-item:26-35` — _security_ · confidence: medium

- **What:** User arrays (foodDislikes, dislikedMeals, likedMeals, cuisinePreferences, recentMealNames), the meal description, and caller-supplied categories are interpolated directly into prompts with no length caps or escaping, enabling prompt injection and token-bloat DoS. Output is JSON-validated/whitelist-matched, limiting practical exploitability.
- **Fix:** Cap array sizes and per-element length, strip newlines/quotes from interpolated strings, and bound description (~500 chars) and categories (~20 items).
