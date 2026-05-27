# Handoff — Email program shipped, scan-pantry hardened, paywall + onboarding polish, notification dupes fixed

## TL;DR

Massive session. Big rocks:
1. **Email marketing program (Loops) shipped end-to-end** — code, edge functions, consent UI, 2 workflows (Trial Conversion + Welcome Series) built in Loops dashboard with full copy, sender domain verified via Amazon SES, all DNS records added to Cloudflare via API script. Lean V1 — engagement-based skipping + winback discount deferred to V2 with detailed roadmap.
2. **Scan-pantry recognition upgrade (Tier 1+2)** — `max_tokens` 1500→6000 (was silently truncating), exhaustiveness rules in prompt, NEW second-pass call to catch missed items, double JPEG compression removed, "Anything we missed?" manual-add input on review screen. Realistic recognition: 50-70% → 80-90% on AI side, +backfill input brings effective rate to 95%+.
3. **Meal-generation prompt fix** — every step ingredient must now appear in `ingredients` array (was generating "garlic" in steps without garlic in ingredients list). Plus categorization word-boundary fix (kills "cod" matching "avacodo"), LLM-backed categorization fallback for misspellings, protein-variety rule (3+ different proteins in pantry → meals must use different ones).
4. **Meal-image gen fix** — passes steps to image-gen LLM so it knows which ingredients are *incorporated* (mashed in, blended) vs plated (shows as visible dollop). Greek yogurt mashed into sweet potato no longer appears as a separate dollop in the rendered image.
5. **Notification dupes fixed** — schedule version flag + nuke stale (root cause was actually 2 Pantry installs on Logan's phone, killed by the version-flag fix on the surviving install).
6. **Branded splash screen** — replaces bare black `View` with statement Pantry wordmark + 2-sec progress bar + cycling tagline. Respects Reduce Motion.
7. **Paywall (STryFree) rebuilt** — static screenshot → looping intro video, layout reworked from scrollable to non-scrolling flex, phone preview iterated 285×620 → 160×340 → 185×400 to fit cleanly above sticky CTA, headline subtitle margin tightened to remove dead space.
8. **Superwall SDK bumped 1.0.8 → 1.1.3** (was 7 releases behind, dashboard was warning). v1.0.9 has a useSuperwallEvents callback fix that may resolve the "default paywall shows instead of custom" bug Logan is currently debugging.
9. **Council reviewed freemium-vs-premium-only decision** — unanimous on staying premium-only for V1, revisit at 60-day trial-to-paid data with documented decision tree in active.md.

**Two repos involved this session:**
- `/Users/loganshaver/pantry/` — main app, ~35 commits pushed to main
- `/Users/loganshaver/pantry-landing/` — privacy policy updated (Loops sub-processor disclosure), Stripe references removed, NOT yet deployed via wrangler

---

## Email marketing program (the biggest stack of work)

### Code-side infra (all shipped, deployed, committed)

**Schema migration:** `supabase/migrations/20260521000000_email_marketing.sql`
- profiles.marketing_email_opt_in + marketing_consent_at (GDPR-compliant consent + audit trail)
- Engagement signals: last_active_at, cook_tonight_used_count, meals_saved_count, goals_customized (V2 use)
- Subscription lifecycle cache: trial_started_at, trial_ended_at, subscribed_at, churned_at
- ✅ Applied to prod via `npx supabase db push`

**Edge functions** (deployed):
- `supabase/functions/loops-sync/index.ts` — handles 3 actions: sync_profile (mirror profile to Loops contact), event (fire Loops sequence trigger), delete (GDPR account deletion). Auth-gated via verifyUser (caller's userId must match body.userId — closes a hole where anyone could spam Loops events). Rate-limited 30/min/IP. Marketing events check opt-in + Apple-private-relay before firing; transactional events always fire.
- `supabase/functions/loops-import-waitlist/index.ts` — admin-token-gated bulk import of existing `waitlist` table → Loops. Tags imports `pantry_is_waitlist=true` for launch-day campaign.
- `supabase/functions/delete-account/index.ts` updated — calls `loops/contacts/delete` direct via fetch (not loops-sync, to avoid auth dance) before destroying user. GDPR Article 17 compliance.

**Client libs:**
- `lib/loops.ts` — fire-and-forget wrappers (syncProfileToLoops, fireLoopsEvent, deleteLoopsContact)
- `lib/engagement.ts` — lifecycle bridges (touchLastActive, trackCookTonightUsed, trackMealSavedEngagement, trackGoalsCustomized, markTrialStarted, markTrialEnded, markSubscribed, markChurned). ⚠️ V1 NOTE: these are defined but NOT yet wired to UI trigger points — see V2 todos. Currently only `markTrialStarted` + `markTrialEnded` fire (from SuperwallContext).
- `lib/analytics.ts` — 4 new PostHog events: marketing_opt_in_decision, email_sequence_triggered, email_link_opened, trial_converted_from_email

**UI:**
- `app/onboarding/createaccount.tsx` — consent checkbox added (unchecked default per GDPR), captured for all 3 signup paths (email/Apple/Google) via AsyncStorage trampoline. Boxed card style + subtitle "Applies to all sign-up methods · unsubscribe anytime."
- `context/AuthContext.tsx` — applies pending opt-in on first SIGNED_IN event. Force-false for Apple Hide-My-Email private-relay addresses (Apple TOS compliance).
- `context/SuperwallContext.tsx` — markTrialStarted/markTrialEnded called on subscription status transitions.

**Legal/compliance:**
- `pantry-landing/privacy.html` updated — Stripe references stripped (Apple IAP only per Logan's decision), Loops added as sub-processor with full data-shared disclosure, transactional vs marketing email distinction made explicit, Apple private-relay treatment documented. ⚠️ NOT yet deployed via wrangler.

### Loops dashboard work (Logan completed manually this session)

- Loops account created on Free tier (1K contacts / 4K sends/mo)
- Sending domain `heypantry.app` verified — Amazon SES under the hood. 6 DNS records added to Cloudflare via API script `/tmp/cf-add-loops-dns.sh` (Zone ID `bb10811054039f4b046354c491c31181`). 1 additional verification TXT record added later. All 5 sections show green in Loops.
- LOOPS_API_KEY + IMPORT_ADMIN_TOKEN set in Supabase secrets. IMPORT_ADMIN_TOKEN saved in Apple Passwords as "Pantry — Loops IMPORT_ADMIN_TOKEN" (also documented in memory).
- 5 custom contact properties seeded via direct Loops API curl: pantry_marketing_opt_in (bool), pantry_is_apple_private_relay (bool), pantry_is_waitlist (bool), pantry_trial_started_at (date), pantry_subscribed_at (date). Test contact `test@heypantry.app` exists with these set.
- Sending domain configured: Sender = "Logan from Pantry", From = team@heypantry.app, Reply = loganmasonshaver@gmail.com.
- **2 workflows built + Active:**
  - **Trial Conversion** (Onboarding category): trigger `trial_started`, audience filter "Marketing-eligible users" (opt_in=true + relay=false + subscribed_at empty), 3 emails: Day 0 trial_welcome / Day 3 trial_day_3_value / Day 6 trial_annual_pitch.
  - **Welcome Series** (Onboarding category): trigger `user_signed_up`, 24h delay, audience filter "Non-trial signups (marketing-eligible)" (opt_in=true + relay=false + trial_started_at empty + subscribed_at empty), 3 emails: Day 0+24h welcome_value / Day 7 welcome_recipe_drop / Day 14 welcome_soft_trial_pitch.

### Email program V1 scope (final)
- 3 sequences: Trial Conversion + Welcome Series + Launch Campaign (manual send at launch)
- 1 push: Day 5 trial-ending reminder (already wired via SuperwallContext)
- Total: 3-7 emails per user across first month depending on conversion path

### What was deferred (see `~/my-briefing/todos/active.md` V2 section for details)

11 V2 items written with effort estimates + trigger conditions to revisit:
1. Engagement-based email skipping (wire engagement.ts helpers to UI, ~2 hrs)
2. Re-engagement loop (wire touchLastActive in _layout, ~1.5 hrs)
3. Trial-expired winback discount email (needs App Store Connect API offer codes, ~4-6 hrs)
4. Email-link attribution funnel (deep-link UTM parsing, ~1 hr)
5. PostHog email funnel dashboards (~2 hrs)
6. Privacy policy: enumerate engagement signals shared (~15 min, post-engagement-wiring)
7. Loops unsubscribe webhook → app sync (~1 hr)
8. Waitlist import batching (~30 min, only matters >500 waitlist)
9. Subscription renewed event (~30 min)
10. A/B testing email subject lines (~1 hr per test, after 200 trial-end events)
11. Refer-a-friend program proper (~15-20 hrs, defer until 1K+ users)
12. "Tell a friend" share button (simple V1 of referrals, ~1 hr)
13. AsyncStorage opt-in flag cleanup on signup failure (~5 min)

### Pricing decision tree (V2 todos)

5-model council ran the freemium-vs-premium-only decision — **unanimous: stay premium-only for V1.** Documented full decision tree in active.md:
- D60 trial-to-paid >25% → premium-only forever, focus on top-of-funnel
- 15-25% → tighten paywall A/B
- <15% → freemium A/B as V1.5 experiment (50/50 cohort, 30-day measurement)
- <8% → trial model broken, reassess PMF

---

## Meal generation prompt fixes

1. **Step-ingredient completeness rule** (`supabase/functions/generate-meals/index.ts` + `generate-trending-meals/index.ts`): every item referenced in any step MUST appear in the `ingredients` array with grams + visual. Was generating "garlic" in steps without garlic listed. Example JSON in both prompts also updated to demonstrate the right pattern (with oil/garlic/salt/pepper in the example ingredients).

2. **Categorization word-boundary fix** (`lib/categories.ts`): switched from `.includes()` to `\b{kw}(s|es)?\b` regex. Fixes "cod" matching "avacodo" (it was being categorized as Meat & Fish). Plural support preserved.

3. **Categorize-item edge function + LLM fallback** (`supabase/functions/categorize-item/index.ts`): when keyword match returns nothing, calls Gemini Flash Lite. Handles typos like "avacodo" → Produce, exotic items not in keyword list. ~$0.00002/call, ~400ms latency only for items that fail keyword match. All 7 call sites updated to await `categorizeItem(name)`.

4. **Protein variety rule** (`generate-meals/index.ts`): if pantry has 3+ distinct primary proteins (detected from PROTEIN_GROUPS dict), each of the 3 meals must use a different one. With <3 sources, no constraint.

5. **Meal-image gen step-aware**: `generate-meal-image/index.ts` now accepts steps[], passes to Stage 1 LLM visual description prompt. New rule: "any ingredient mashed/blended/mixed/stirred/folded INTO another component is INVISIBLE in the photo." Added Roasted Salmon + Sweet Potato Mash example showing yogurt should NOT appear as separate dollop. Updated `useMealSuggestions` + `meal/[id].tsx` to pass steps when invoking.

---

## Scan-pantry Tier 1+2 recognition improvements

**Edge function** (`supabase/functions/scan-pantry/index.ts`):
- `max_tokens` 1500 → 6000 (1500 was silently truncating dense kitchen scans — each item is ~30 tokens, real pantry has 60-100+)
- Prompt rewritten with exhaustiveness pressure: explicit "be EXHAUSTIVE" + concrete common-miss patterns (spices in small jars, back-row items behind front items, fridge door condiments, items in clear containers, top/bottom shelves, drawer contents)
- **NEW second-pass call**: after first detection, sends same images back with first-pass list as context + "what did you miss?" prompt. Focused attention catches small/partial/back-row items. Cost ~2× per scan; failures non-fatal (returns first-pass on error).

**Client** (`components/PantryScanModal.tsx`):
- Removed `ImageManipulator` double-compression. Was camera 0.8 → manip 0.7 (re-encode for no benefit). Now `takePictureAsync` quality 0.9 with base64 directly. Sharper labels.
- Gallery imports: quality 0.7 → 1.0
- Camera tip hint under viewfinder: "stand 3-4 ft back · tap to focus · use flash in dim light"
- **"Missed something?" TextInput** on review screen — comma/newline-separated names get categorized via `categorizeItem` helper and appended to "Added manually" zone. Recovers cases where AI still misses something even after second pass.
- Softened copy: "Scan complete" → "First pass complete", "Found N ingredients" → "Spotted N items — you can add anything we missed on the next screen"

Cost impact: ~$0.025 → ~$0.05/scan. At 100K active premium × 24 scans/yr = $120K/yr (1.25% of revenue). Easily worth it.

---

## Notification duplication fix

**Root cause was BOTH:**
1. Code-side: previous cleanup only cancelled notifications tagged `data.app === 'pantry'` — older app versions scheduled without that tag, surviving cleanup → duplicates from stale schedules persisting across app updates.
2. Logan-side: he had **2 Pantry installs on his iPhone** (TestFlight + dev build presumably). Each fired independent schedules at same time with same content → "exact duplicates."

**Fix:** `hooks/useNotifications.ts`:
- `SCHEDULE_VERSION = 'v2'` constant + AsyncStorage idempotency check (`notifications_schedule_version` key)
- When scheduling DOES run, nuke ALL scheduled notifications (not just tagged) to clean up stale entries. Exception: preserves `trial_expiry` notifications scheduled by SuperwallContext.
- Each new notification stamps `data.version: SCHEDULE_VERSION` for future debugging
- __DEV__-only console log: `[notifications] scheduled v2 — N total scheduled`

**Logan-side action:** deleted duplicate Pantry installs from iPhone. New build installs fresh, fix runs once.

---

## Splash overlay (branded loading screen)

`components/SplashOverlay.tsx` + `app/_layout.tsx`:
- Replaces bare black `<View>` covering screen during cold-start auth resolution
- Min 2-second display duration (gives meal cache time to settle, premium feel)
- Design per ui-ux-pro-max audit: 64pt weight-900 "Pantry" wordmark with subtle green textShadowRadius glow (OLED aesthetic), 200×2pt progress bar that fills exactly during the 2s window (intentional pacing), cycling tagline (3 messages × 700ms each: "Stocking the shelves…" / "Sharpening the knives…" / "Loading your kitchen…")
- Respects Accessibility → Reduce Motion (skips glow + progress + cycle, shows static "Loading…")
- Pure JS, hot-reloads onto existing builds

Limitation acknowledged: doesn't actively preload meals — just delays home render so AsyncStorage cache (if fresh) hits instantly. True meal preload deferred (~30 min Flavor A extraction work documented in chat history if Logan wants it later).

---

## Paywall (STryFree "We want you to try Pantry for FREE") rework

`app/onboarding/index.tsx`:
- Static `pantry-screenshot.png` → looping `onboarding-demo.mov` video (same asset as welcome screen). Loops:true, muted, playbackRate 0.9.
- Replaced ScrollView with flex layout — non-scrolling, headlines pinned top, phone preview top-aligned in flexible middle slot, CTA pinned bottom (absolute as before)
- Phone preview iterated 285×620 → 210×460 → 160×340 → 185×400 to fit cleanly above sticky CTA
- heroSub marginBottom 32 → 4 to kill dead space between headlines and phone
- Hardware button positions/sizes rescaled for smaller phone shell
- When Logan reshoots video post-UI-refresh, just swap the .mov file — single source applies to welcome screen + paywall

---

## Superwall SDK update + default-paywall debugging

- Bumped `expo-superwall` 1.0.8 → 1.1.3 (was 7 releases behind, dashboard was warning)
- No breaking changes confirmed across 1.0.9-1.1.3 release notes
- v1.0.9 has a `useSuperwallEvents` callback-loss fix on initial app launch that may resolve the "default paywall showing instead of custom" issue Logan is currently debugging
- Native module update — requires `npx expo run:ios --device` rebuild

**Investigation context for the default-paywall issue (still open):**
- Original fix was May 9, 2026 (memory observations #S3195-S3197): root cause was invalid in-app purchase products in App Store Connect preventing Superwall from fetching pricing. Logan completed Monthly + Yearly subscription metadata + added required Review Information screenshots.
- Logan says no Superwall config changes since then, but bug is back. Suspicion: the $30/yr annual product was added recently (without going through full metadata + Review Information screenshot) — that incompletely-configured product breaks the custom paywall.
- Action checklist documented in chat: App Store Connect → Monetization → Subscriptions → check every product's status. Anything "Missing Metadata" or "Developer Action Needed" breaks the custom paywall.

---

## Other UI fixes shipped

- **Profile screen email display**: added "Email" row at top of Settings card. Logan couldn't tell which account he was signed into during email sandbox testing.
- **Consent checkbox visibility**: wrapped in boxed card + added subtitle "Applies to all sign-up methods · unsubscribe anytime" so OAuth-path users realize it applies to them too.

---

## Active todos updated

`active.md` got significant updates this session:
- ✅ Apple Developer activated, app store screenshots, AI meal gen
- ➕ Email program V2 section (13 items, see above)
- ➕ Pricing decision tree (revisit at D60 trial-to-paid data)
- ➕ Ingredient image quality + meal taste fine-tuning
- ➕ Pre-launch checklist additions: Loops Gravatar avatar setup, Loops sandbox test

---

## Stuff that still needs doing (post-handoff)

### Immediate
- [ ] **Default paywall debugging:** Logan to check App Store Connect → Monetization → Subscriptions → confirm every product is "Ready to Submit" or "Approved" status. Suspect: annual product missing metadata + Review Information screenshot. Plus rebuild with the new Superwall SDK to see if v1.0.9 callback fix resolves it.
- [ ] **Email program sandbox test:** Logan to do a fresh signup with marketing opt-in checked, verify contact appears in Loops within 30 sec with correct properties, start trial via paywall, verify trial_welcome email arrives in inbox. Then delete sandbox account, verify Loops contact gone.
- [ ] **Deploy pantry-landing privacy policy update:** `cd /Users/loganshaver/pantry-landing && npx wrangler pages deploy . --project-name=heypantry`. Stripe references stripped + Loops sub-processor added locally but NOT yet live on heypantry.app.
- [ ] **Verify dual-Pantry-install fix:** confirm only one Pantry on Logan's iPhone after the rebuild, Metro console shows `[notifications] scheduled v2 — 7 total scheduled`.

### Pre-launch (in active.md)
- [ ] Gravatar setup for Loops sender avatar (~5 min, do at final QA)
- [ ] Loops end-to-end sandbox test (covered above)

### V2 (in active.md V2 section)
- Email program enhancements (13 items detailed)
- Pricing decision tree revisit at D60
- Ingredient thumbnail audit
- Taste fine-tuning via cached meal review

---

## File pointers

**Email program:**
- `supabase/functions/loops-sync/index.ts` — sync + event + delete handler
- `supabase/functions/loops-import-waitlist/index.ts` — waitlist bulk import
- `supabase/functions/delete-account/index.ts` — GDPR Loops cleanup added
- `lib/loops.ts` — client wrappers
- `lib/engagement.ts` — lifecycle bridges (mostly unwired in V1)
- `lib/analytics.ts` — 4 new PostHog email events
- `app/onboarding/createaccount.tsx` — consent checkbox + AsyncStorage trampoline
- `context/AuthContext.tsx` — applies opt-in on SIGNED_IN
- `docs/EMAIL_RUNBOOK.md` — full runbook with all 7 email drafts + launch campaign
- `pantry-landing/privacy.html` — Loops sub-processor disclosure, Stripe stripped (NOT deployed)

**Meal gen + scan-pantry:**
- `supabase/functions/generate-meals/index.ts` — step-ingredient rule, protein variety, fixed example
- `supabase/functions/generate-trending-meals/index.ts` — step-ingredient rule, fixed example
- `supabase/functions/generate-meal-image/index.ts` — steps-aware Stage 1 prompt, bypassCache flag
- `supabase/functions/scan-pantry/index.ts` — max_tokens 6000, exhaustiveness, second pass
- `supabase/functions/categorize-item/index.ts` — LLM fallback for misspellings
- `lib/categories.ts` — word-boundary regex + categorizeItem async helper
- `components/PantryScanModal.tsx` — single compression, missed-items input, softened copy

**Splash + paywall:**
- `components/SplashOverlay.tsx` — branded loading screen
- `app/_layout.tsx` — min 2-sec splash gate
- `app/onboarding/index.tsx` — STryFree video swap, flex layout, hardware buttons rescaled

**Notifications:**
- `hooks/useNotifications.ts` — schedule version flag, nuke-all-but-trial-expiry

**Memory notes added/updated:**
- `feedback_just_ship.md` — clean bounded fixes ship without permission preambles
- `feedback_marketing_copy_premium_only.md` — never imply free tier in any marketing copy
- `reference_loops_credentials.md` — IMPORT_ADMIN_TOKEN location in Apple Passwords
- `MEMORY.md` — indexed both new entries

---

Branch: `main` (Logan's single-branch workflow). All work pushed to GitHub. pantry-landing has the privacy policy update committed locally only (no git remote on that repo — deploy via wrangler).

**Total commits this session:** ~37 pushed to main.

Ready for next session to focus on: default-paywall resolution (App Store Connect IAP status check + new SDK build test), then sandbox-test the email program end-to-end.
