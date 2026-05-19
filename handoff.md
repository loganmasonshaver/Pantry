# Handoff — Massive day: meal-gen pipeline rebuilt, App Store screenshots done, DMCA registered, privacy + terms updated

## TL;DR

This session reshaped Cook Tonight from the ground up (hybrid 2-strict + 1-stretch + overgenerate-and-rank + macro bands + atomic steps + recent-meal exclusion + 1/day refresh cap), redesigned the Grocery tab into a Reminders-style inline-edit flow, killed the dead delivery integration, built an auto-cycling Ken Burns hero on Home, shipped a code-driven App Store screenshot pipeline at `appstore-screenshots/` (5 PNGs ready at Apple's required 1284×2778), fixed Discover going near-empty on concentrated-content days, and closed several legal gaps — **DMCA Designated Agent registered with the U.S. Copyright Office** ($6, dmca@heypantry.app), privacy policy corrected (removed stale providers, added PostHog/Superwall/Replicate, expanded CCPA), terms.html got a DMCA section, and email forwarders for `privacy@` and `dmca@` are live in Cloudflare.

**Two repos involved this session:**
- `/Users/loganshaver/pantry/` — main app, ~25 commits pushed to GitHub main
- `/Users/loganshaver/pantry-landing/` — heypantry.app marketing + legal site, has commits but NO git remote configured (deploy via `npx wrangler pages deploy . --project-name=heypantry`)

---

## Meal generation overhaul (the biggest stack of work)

Comprehensive rebuild of `supabase/functions/generate-meals/index.ts` and `lib/useMealSuggestions.ts` based on a long iterative debugging conversation about why meals were either repetitive, overshooting macros, or disappearing.

| Change | Why |
|---|---|
| **Hybrid 2-strict + 1-stretch mode** | Cook Tonight now shows 2 pantry-only meals + 1 "with a quick stop" stretch. Gemini was ignoring strict-only constraint; new prompt sets explicit `missing_ingredients: []` for strict and 1-2 staples for stretch |
| **Overgenerate-and-rank** | LLM asked for 5 meals (genCount), filtered against macro bands, top 3 returned by fit score. Solves "today only produced 2 meals" undershoots on bad LLM days |
| **Protein band ±15% with 1.40× filter** | Logan's 144g/3-meal goal → 41-55g target per meal, drops above ~77g. Was generating 96g protein bombs that cause GI distress |
| **Calorie cap = 50% of daily goal** | Per-meal cap (1290 kcal for 2580 goal) catches bombs but isn't tied to mealsPerDay, so high-meal-count users don't get tight bands |
| **Atomic recipe steps** | "Heat oil. Add chicken. Sear 5 min." — one action per step. Was "Heat oil, add chicken, sear 5 min" mega-steps. Easier to glance-do-advance while cooking |
| **CookingSkill-scaled bands** | minimal: 4-7 ingredients / 3-5 steps; moderate: 5-10 / 4-7; adventurous: 6-12 / 5-9; culinary: 7-15 / 6-12. The cookingSkill onboarding field now actually drives behavior |
| **Ingredient cap raised 9 → 12** | Was truncating authentic curries / stews / Mexican which need 10-15 ingredients |
| **`recentMealNames` exclusion** | Last 12 meal names persisted to AsyncStorage and passed to next gen as "DO NOT suggest these" — kills cross-gen repeats |
| **Daily refresh cap = 1** | `MAX_DAILY_REGENS` in `useMealSuggestions.ts`. Bounds image-gen cost. Refresh button greys out after use. Resets at local midnight |
| **`retry()` vs `regenerate()` split** | Error-recovery `retry()` doesn't consume the daily cap (failed gens cost $0). Only successful user-initiated `regenerate()` counts |
| **Killed pantry-diff auto-regen loophole** | Earlier "auto-regen on 3+ pantry items" turned out exploitable via add/remove cycling — reverted |

**Deployed today:** generate-meals version 83 at Supabase. Verified the deployed source matches local with `supabase functions download`.

---

## Cook Tonight UI

- **Shimmer skeleton** on meal thumbnails while images load — sweep gradient, brightened from #2A→#3A2A for visibility on 64×64 thumbs. Component at `components/Shimmer.tsx`, reusable
- **Auto-scroll keyboard avoidance** added to grocery + add-item flows
- Killed the dead freemium "Upgrade to Premium" alert
- "Refreshed today · New tomorrow" subtitle when refresh cap is hit

---

## Home tab — auto-cycling hero meal carousel

`app/(tabs)/index.tsx` (~lines 355-400):

- Hero meal card now **auto-cycles through all 3 generated meals** every 5 seconds with a 450ms crossfade
- **Ken Burns slow zoom** (scale 1.0 → 1.12 over slide duration) while displayed — image stays "alive" between crossfades
- **Pagination dots removed** — they signaled false swipe affordance. Motion alone signals cycling
- **Hero card width fixed** from hard-coded 240px to full-width (parent-driven). Was looking sparse on modern phone screens
- Height bumped 280 → 360 for cinematic proportion
- Section spacing tweaks for better breathing room between macros card / Cook from Pantry / Daily Meal Log

---

## Grocery tab — Reminders-style redesign

Major UX rewrite of `app/(tabs)/grocery.tsx`:

| Change | Before | After |
|---|---|---|
| Add item | Tiny `+` icon in header opens modal | Bottom "Add Item" row transforms inline into editable row with circle on left + TextInput; return to save + autofocus next |
| Add to Pantry | Bottom bar button | Top-right header pill (always visible, greys out when nothing checked) |
| Order delivery | "Browse & Order" + "Order" buttons | **REMOVED** — no real delivery integration existed |
| Edit existing item | Not possible | Tap row text → inline rename input |
| Row tap behavior | Whole row toggles checked | Only circle toggles; text taps open edit; swipe deletes |
| Duplicate detection | Substring match — blocked "chicken thigh" if "chicken breast" existed | Exact (case-insensitive) only |
| Modal dim overlay | Heavy dark dim | Transparent — feels like inline sheet |
| Meal field on add | "Meal (optional)" text input | **REMOVED** — confusing for grocery list |
| Empty state | Small "Tap + to add" hint | Prominent white "Add to List" pill button |
| Multi-add scroll | Input got hidden under keyboard after 2-3 items | Auto-scroll-to-end after each save, keyboard-aware insets |

Also added missing meat-cut keywords to `lib/categories.ts` (sirloin, ribeye, flank, skirt, chuck, brisket, etc.) so "Sirloin" no longer falls through to "Other".

---

## Discover tab — variety-fill + wider window

`app/(tabs)/discover.tsx`:

- **YouTube visibility window 2 → 7 days** — matches the 3-day fallback retention the pipeline keeps
- **`applyVarietyFill`** function: caps each primary protein at MAX_PER_PROTEIN = 2 in the final 6, backfills from past days when today's batch is concentrated
- Mirrored `PROTEIN_KEYWORDS` from the pipeline so client + server agree on what counts as a primary protein
- Atomic steps rule **also added** to `generate-trending-meals/index.ts` prompt — takes effect on next daily cron run

**Root cause of "Discover going empty" earlier today:** today's pipeline only produced 2 meals (chicken + cottage cheese) because YouTube's viral pool was concentrated in 2 protein sources. Strict 1-per-protein dedup capped at 2, the 2-day visibility filter hid the other 17 meals in the DB. Both layers fixed.

---

## App Store Screenshots — full code-driven pipeline at `appstore-screenshots/`

**Output: 5 PNGs at `appstore-screenshots/output/` at 1284×2778** (Apple's iPhone 6.7" Display spec — what App Store Connect was actually asking for; the newer 1320×2868 6.9" got rejected).

Files:
- `template.html` — single HTML template with placeholders, MyFitnessPal-style design
- `frames.json` — per-frame config (headline, accent word, transform, screenshot filename)
- `render.js` — Playwright-driven renderer, inlines screenshots as data URLs (file:// blocked via setContent)
- `package.json` — local playwright dep, `npm install` once

**Design system** (adapted from Logan's Driven brand):
- Dark gradient bg `#131D16` → `#080C09` with radial green halo top
- 168px bold headlines, green accent on key word
- Realistic iPhone 16/17 Pro Max bezel: Dynamic Island, Action button, Volume up/down, Power, Camera Control
- Per-frame phone transforms (slight tilts left/right) for visual variety

**The 5 frames:**
1. `Track Your Macros` — Home screenshot
2. `Scan Your Pantry` — Pantry tab
3. `Discover New Meals` — Discover
4. `Build Your Cookbook` — Saved
5. `Smart Grocery List` — Grocery

**Iteration workflow:**
- Edit `frames.json` (headline, accent, transform)
- Replace files in `raw/` if screenshots get stale
- `node render.js` → regenerates all PNGs in seconds
- Reusable for Driven and future apps

---

## Legal + Compliance (the second half of the session)

Logan watched a video about app legal risks and we audited Pantry against:

| Risk | Status |
|---|---|
| Privacy policy honesty | ✅ Updated `pantry-landing/privacy.html` — corrected 3rd-party list (dropped Anthropic/Groq/fal.ai which aren't actually in code, added PostHog/Superwall/Replicate/YouTube API), expanded CCPA section with explicit opt-out + 45-day window, added `privacy@heypantry.app` |
| Terms of Use missing DMCA | ✅ Added new Section 7 with takedown notice procedure to `pantry-landing/terms.html`, renumbered remaining sections |
| DMCA Designated Agent | ✅ **REGISTERED** with U.S. Copyright Office. Service Provider: Koba Labs LLC, 5900 Balcones Drive Suite 100, Austin TX 78731. Designated Agent: Logan Mason Shaver, dmca@heypantry.app. $6 paid via Pay.gov |
| Email forwarders for legal contact | ✅ Set up in Cloudflare: `privacy@heypantry.app` → loganmasonshaver@gmail.com, `dmca@heypantry.app` → loganmasonshaver@gmail.com |
| California auto-renewal | ⚠️ Apple IAP handles disclosure + cancellation, but Logan should verify Superwall paywall copy mentions auto-renew + cancellation. **Logan said "i don't need to worry"** — flag for double-check |
| CAN-SPAM | 🟡 Not yet sending marketing emails. Logan said "about to set up" — needs physical address + unsubscribe + honest subject lines when activated |
| AI/nutrition disclaimer | ✅ Already in terms.html Section 5 (verified) |

---

## Active todos updated

`active.md` was updated mid-session:
- ✅ Checked off: Apple Developer account, AI meal generation, App Store screenshots
- ➕ Added new section: **"🤖 Android / Google Play (Post-iOS Launch)"** with 17 deferred tasks across Build+Test / Store Setup / Listing Assets / Launch Sequence. Logan explicitly wants this deferred until iOS is shipped and most CTO responsibilities are settled

---

## Stuff that still needs doing (no specific order)

### Immediate / pre-launch
- [ ] **Deploy pantry-landing** to Cloudflare Pages: `cd /Users/loganshaver/pantry-landing && npx wrangler pages deploy . --project-name=heypantry`. Privacy + terms updates are committed locally but NOT yet live on heypantry.app. terms.html in particular has never been deployed at all — visiting heypantry.app/terms currently returns the landing page
- [ ] **Deploy edge functions** (re-run from /Users/loganshaver/pantry):
  - `supabase functions deploy generate-meals` (already version 83 with atomic steps live)
  - `supabase functions deploy generate-trending-meals` (atomic steps rule added to trending pipeline this session, needs deploy)
- [ ] Verify the next Cook Tonight regen shows atomic-step recipes — cached meals from before today's deploy still have multi-action steps. Cache resets at midnight or next pantry-tab visit on a new day
- [ ] **Verify DMCA registration shows "Active"** at dmca.copyright.gov within a few minutes of payment (Pay.gov credit card → Active is usually fast; ACH takes 7 days)
- [ ] Test the privacy@ and dmca@ email forwarders — send a test email and confirm receipt at loganmasonshaver@gmail.com
- [ ] App Store Connect: drag the 5 PNGs from `appstore-screenshots/output/` into the iPhone 6.5"/6.7" Display screenshots slot

### Polish (not blockers)
- [ ] Stretch meal isn't always present — when the LLM happens to generate all 3 as strict, no "Need: X" variety. Could tighten the prompt to require exactly 1 stretch
- [ ] Saved meals — old saved meals frozen with multi-action mega-steps until user re-saves them
- [ ] Replicate vs fal.ai — the privacy policy now lists Replicate, but worth a final code audit to make sure no fal.ai references remain
- [ ] Pre-existing TS errors at `app/onboarding/index.tsx:393` and `app/(tabs)/index.tsx:196`+`:1064` — not introduced this session, not blocking
- [ ] Image:null type errors in `lib/useMealSuggestions.ts` (6 instances) — `image: null` type is too strict, image gets set to URL strings throughout. Pre-existing

### Eventually
- [ ] CAN-SPAM setup when starting marketing emails — physical address (5900 Balcones Drive, Suite 100, Austin TX 78731) + unsubscribe link + honest subjects. Use Resend or Mailchimp; they handle compliance automatically
- [ ] Open Mercury bank account (all docs ready per memory)
- [ ] Android launch — full Google Play track per active.md's new section

---

## File pointers

- `supabase/functions/generate-meals/index.ts` — meal generation prompt + macro bands + variety logic + atomic steps
- `supabase/functions/generate-trending-meals/index.ts` — trending pipeline, NOW with atomic steps rule (line ~393)
- `lib/useMealSuggestions.ts` — daily cache + regen cap + retry split
- `app/(tabs)/index.tsx` — Home with auto-cycling hero (~lines 355-450)
- `app/(tabs)/pantry.tsx` — Pantry tab with Cook Tonight + Shimmer
- `app/(tabs)/grocery.tsx` — Reminders-style inline-edit grocery
- `app/(tabs)/discover.tsx` — variety-fill + 7-day visibility
- `components/Shimmer.tsx` — reusable loading skeleton
- `lib/categories.ts` — grocery auto-categorization keywords (meat cuts added)
- `appstore-screenshots/` — full screenshot pipeline (template.html / frames.json / render.js / raw/ / output/)
- `/Users/loganshaver/pantry-landing/privacy.html` — privacy policy (updated, not yet deployed)
- `/Users/loganshaver/pantry-landing/terms.html` — terms (DMCA added, not yet deployed)

---

Branch: `main` (Logan's workflow — all work goes directly to main, no feature branches). Two repos — main pantry app committed + pushed to GitHub, pantry-landing committed locally only (no git remote, deploy via wrangler).
