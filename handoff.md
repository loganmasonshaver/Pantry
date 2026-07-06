# Handoff — Pantry — 2026-07-06 session

## TL;DR
A very long session, ~95% focused on the **scan flow** (`components/PantryScanModal.tsx`): capture →
hub → review were reworked end-to-end for UX + polish. Also: a Fable-skills/CLAUDE.md handover and
a full security sweep. **Everything is committed + pushed to `main`** (session range `4046ed1..HEAD`).
`scan-pantry` edge function was deployed several times. App was rebuilt on the physical iPhone
(`expo run:ios --device`). ~1 week to launch. Premium-only hard paywall (trial = access).

---

## ⚠️ MUST DO BEFORE LAUNCH
1. **Revert `SCAN_CAP_WEEK`.** For testing I ran `supabase secrets set SCAN_CAP_WEEK=99999` to lift
   the weekly scan cap. `scan-pantry` reads `Number(Deno.env.get('SCAN_CAP_WEEK') ?? 7)`. Before
   launch: `supabase secrets unset SCAN_CAP_WEEK` (reverts to safe default **7**) or set it to 7.
   Leaving it high = the OpenAI cost cap is wide open in prod. (Tracked as a spawned task.)
2. Re-verify edge deploy: `supabase functions deploy scan-pantry` (deployed this session; confirm).

## Open spawned tasks (chips) — carryover work
- **Revert SCAN_CAP_WEEK before launch** (see above).
- **Lock subscription-lifecycle columns server-side** — `trial_started_at / subscribed_at /
  churned_at` are client-writable (analytics poisoning, NOT an access bypass — real entitlement is
  Superwall + is_premium/promo_active, already trigger-locked). Move writes to the Superwall webhook,
  then extend `enforce_server_managed_premium` to cover them. Low priority, post-launch.
- **Inline AI-consent in URL-import + recipe AI-generate** — `saved.tsx handleImportFromUrl` and
  `RecipeFormModal handleGenerate` call `requestConsent()` from INSIDE a native `<Modal>` (two iOS
  modals can't stack → hangs for a never-consented user). Needs an inline consent step, not the
  root modal. Low priority: the primary AI paths (scan/receipt/AI-log/meal-gen/onboarding) already
  gate consent correctly.

---

## Current scan flow architecture (`components/PantryScanModal.tsx`)
Step machine: **1** (camera) → **4** (hub) → **5** (loading/scan) → **55** (review) → saved.
(Steps 2/3 = dead code, unreachable; step 6 = dead code. Left in place, low priority to remove.)

- **Capture (step 1)** — *single-photo-first*. Full-bleed camera ("Scan your kitchen"), gradient
  scrims for legible copy, corner brackets. Shutter → `capturePhoto(label, 4)` → lands on the hub.
  `pendingLabel` carries the area name when the user adds a specific area from the hub.
- **Hub (step 4)** — header **"More areas, better meals"**. `CAPTURED · N` showcase: photo cards
  with a green "captured" check (top-right) + a **✕ remove** (top-left; removing the last photo
  bounces to the camera). `ADD AN AREA` 2-col grid (Fridge/Freezer/Pantry/Counter/Second Fridge/
  Custom, Lucide icons, green tiles). White **"Scan N Photos"** CTA (safe-area padded, centered).
  Tapping an area → `setPendingLabel` + `setStep(1)` (uses the in-app camera).
- **Review (step 55)** — **list-primary**. Compact pannable photo (**0.32** of screen — a spot-check
  reference, tap to fullscreen-zoom), labeled by the area the scan classified (`photoContainers`,
  e.g. "Fridge · 1/2"). Items grouped by shelf zone. **Tap an item's name → inline rename**
  (`editingId`/`editingText`/`commitRename`); **✕** removes. "Also have these?" staples are
  **collapsed behind a one-line toggle** (`staplesOpen`). "Add missing" input + **"Add N to Pantry"**
  CTA (safe-area padded).

### Confirm → meals flow
Hitting "Add N to Pantry" saves, then on the **first scan ever** auto-launches `/cook-reveal`
(meals generated from what was just added). Later scans get a success step. This is the intended
"scan → meals" payoff. (Backing out of review = nothing saved → stale meals, a past confusion.)

---

## Key decisions this session (and REJECTED alternatives — important context)
- **Detection boxes (tap chip → box drawn on photo): REJECTED.** GPT-4.1's bounding-box coords are
  too imprecise for per-item pins (verified on real scans). The on-photo box overlay code is now
  **dormant** (nothing sets `activeBoxId` since the chip tap was repurposed to rename). Safe to delete.
- **Confidence triage ("double-check these" amber section): BUILT then REMOVED.** Went **trust-first**
  — don't make the AI's uncertainty the user's homework over low-stakes data (a wrong pantry item is
  a 1-tap delete). Confidence is still returned by the scan (potential backend quality telemetry),
  just not shown in the UI.
- **Per-photo pre-classify (`classifyOnly` mode on scan-pantry): BUILT then REVERTED.** Felt
  bolted-on (extra vision call + ~1–2s relabel flicker on the hub). Chose **Option B**: the single
  scan already returns `photoContainers` (location) alongside the food, so the review labels each
  page by area with **no extra call**. The hub stays fast/generic; intelligence lives in the one scan.
- **Single-photo-first capture: chosen** over the old forced pantry→fridge→counter guided march (friction).
- **Camera unify:** "add another area" from the hub now uses the in-app camera (was the iOS system camera).
- **Photo demoted to a 32% reference in review:** the screen's real job is *correcting an imperfect
  list*, not admiring a photo. (0.32 is a starting guess — may need tuning.)

## Backend — `scan-pantry` current output
Returns `{ layout, photoContainers[], zones[].items[] }` where each item is
`{ name, category, photo, box, confidence }`. **`box` and `confidence` are returned but NOT used in
the UI** (dormant — box overlay rejected, confidence went backend-only). `photoContainers[i]` =
`fridge|freezer|pantry|counter|other` per photo, drives review page labels + context-aware staples.
Two-pass gpt-4.1 (Gemini 3.1 Flash-Lite fallback). `classifyOnly` mode was added then reverted (gone).

---

## Fable-skills handover (early in the session — durable artifacts)
- `FABLE_POSTMORTEM.md` (repo root) — recurring failure patterns mined from ~851k tokens of past sessions.
- **5 project skills** in `.claude/skills/`: `bug-hunter`, `security-sweep`, `build-planner`,
  `honest-advisor`, `metadata-audit` (all seeded from real Pantry bugs; trigger on plain sentences).
- **Global** `~/.claude/CLAUDE.md` + `~/.claude/skills/new-app-playbook` (+ build-planner/honest-advisor
  copied global). Backed up in `~/my-briefing/claude-config/`.
- `CLAUDE.md` (project) gained a **Gotchas/Landmines** + **Known baselines** section.

## Security sweep (all findings fixed this session)
- `scan-pantry` weekly cap was hardcoded **99999** ("TESTING ONLY") → now env-var, safe default 7.
- `generate-meal-image`: removed client-controlled `bypassCache` (self-quota-drain vector).
- `categorize-item`: rate limit keyed on `user.id` (was spoofable IP).
- Cleared: entitlements trigger-locked, scan caps atomic (`FOR UPDATE`), referral single-use, all
  secrets server-side, JWT verified everywhere. Strong posture overall.

---

## Testing / environment notes
- Test on the wired iPhone (`expo run:ios --device`; UDID `00008150-0001691A3688401C`). Enable
  **Personal Hotspot** first (device-build reachability). Prefix pod/build with
  `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (CocoaPods ASCII-8BIT fix).
- `SCAN_CAP_WEEK=99999` currently lets you scan freely while testing (REVERT before launch).
- Metro runs from `/Users/loganshaver/pantry` (main), not a worktree.
- `insets.bottom` reports **0 inside the RN `<Modal>`** — that's why CTAs use `Math.max(insets.bottom, 24)`.

## Likely next-session starting points
1. Eyeball the review redesign on device: rename feel, photo at 0.32 (tune?), staples toggle.
2. Any remaining scan-flow polish, then move off the scan flow toward launch (paywall/metadata — see
   `~/my-briefing/todos/active.md`).
3. Knock out the 3 spawned tasks when convenient (SCAN_CAP_WEEK revert is the only launch-blocker).
