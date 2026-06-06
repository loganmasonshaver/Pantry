# Handoff — Onboarding intro video polish (captions + ripples + logged pop) & session recap

**Branch:** `main`. Everything below is committed & pushed. Metro is running from
`/Users/loganshaver/pantry` (localhost:8081); the dev build is installed on Logan's
physical iPhone ("Logan's iphone", UDID `00008150-0001691A3688401C`). To see JS
changes: open the app → shake → Reload (phone must be on the same network / Personal
Hotspot per the iOS USB setup note).

---

## 🚧 THE BIG REMAINING TASK — onboarding intro video overlays

Logan delivered a **new** preview video (already in place at
`assets/onboarding-preview.mov`, **24.97s**, ~9MB). The intro screen plays it inside a
phone mockup with two Ken-Burns zooms. Logan wants to layer on, **synced to the video**:

1. **Captions** — short benefit lines that fade/slide in at each key moment, building
   toward the paywall. Approved copy (finalize/tweak voice as you build):
   - **~1–2s** (dashboard / Scan Now): **"Scan your pantry in 30 seconds"** ← 30s claim is approved
   - **~5–7s** (live count / detection): "AI finds everything you have" (the in-app live
     counter is now captured in the footage — see below)
   - **~13s** (3 meal cards): "Instant meals from what's already there"
   - **~15s** (recipe / YOU HAVE ingredients): "Built around your macros"
   - **~19s** (logging): "Logged in one tap"
   - **~23s** (Discover): **add a Discover caption** — draft: "Plus a feed of trending recipes"
2. **Tap-ripple beats** — a finger-pulse/ripple over the mockup at:
   - **~1s** on the **"Scan Now"** button (bottom-center of the dashboard frame)
   - **~13s** on a **meal card** (the "Cook tonight" list)
   - Goal: signal "this is effortless" + subconsciously teach the gesture.
3. **"✓ Logged" success pop** at **~19s** — clean checkmark pop for completion dopamine.

**After building, Logan explicitly asked: re-watch the WHOLE video again and verify every
overlay lands on the right frame.** Don't trust the timestamps blindly — extract fresh
frames and confirm (see method below).

### Video flow → timestamp map (from frame extraction; near-identical to prior cut)
| Video time | Screen |
|---|---|
| ~1s | Dashboard — calorie ring, "Unlock recipes built around what you already have", **Scan Now** |
| ~3s | Camera — "Now photograph your fridge" |
| ~5s | **Live count** — "3 items spotted / Uploading photos…" (the new in-app counter, captured) |
| ~7s | "First pass complete — Spotted N items" / View Results |
| ~9–11s | Detected Items list (by shelf) |
| ~13s | Pantry "Cook tonight" — 3 meal cards |
| ~15s | Meal detail — parfait, macros, "YOU HAVE" ingredients |
| ~17s | Recipe instructions |
| ~19s | "Logging…" |
| ~21s | Back to pantry |
| ~23s | Discover (featured + trending) |

⚠️ These are from the **previous** 24.57s cut + the new frames at 1/3/5s (which matched +
showed the live counter). The new video is 24.97s. **Re-extract frames to confirm exact
times before finalizing** — `ffmpeg`/`ffprobe` are installed:
```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 assets/onboarding-preview.mov
for t in $(seq 1 2 24); do ffmpeg -loglevel error -ss $t -i assets/onboarding-preview.mov -frames:v 1 -vf scale=230:-1 /tmp/vf/f_${t}s.jpg; done
```
(`montage`/imagemagick is NOT installed — read frames individually.)

### Where & how to implement (the animation system)
All of this lives in the **W1 intro component** in `app/onboarding/index.tsx`:
- Video player: `useVideoPlayer(require('../../assets/onboarding-preview.mov'))` at **line ~235**,
  `playbackRate = 0.9` (so 24.97s footage = ~27.7s of wall-clock playback).
- The phone mockup + video render starts at **line ~341** (`w1.phoneWrap` / `w1.phone` / `w1.video`).
- The timing engine is the `runCycle()` effect (**lines ~244–330**):
  - `phoneAnim` drives enter(1s)/hold/exit(1s). Video `play()` is scheduled at
    `1000 + START_HOLD_DELAY` (=1250ms) after cycle start.
  - **Zooms** fire via `setTimeout(triggerZoom, 1000 + START_HOLD_DELAY + t)` where `t` is in
    `ZOOM_AT` (currently `[15000, 18400]`). **triggerZoom PAUSES the video** for one
    `ZOOM_CYCLE` (~1160ms) — so wall-clock ≠ video time. Conversion: `t = videoMs / 0.9`
    (+ `ZOOM_CYCLE` for any beat after the first zoom, to compensate for the pause).
  - `BASE_HOLD = 27800` controls when the loop exits; must cover the full video
    (24.97s / 0.9 ≈ 27.7s + zoom pauses). **Bump if the loop still cuts off early on the new cut.**
- **Captions/ripples/pop should be new `Animated.Value`s scheduled the SAME way** as the zooms
  (setTimeout off cycle start, cleared in `runCycle`'s `pending` array and the cleanup), so they
  reset cleanly every loop. Use the `t = videoMs / 0.9 (+ pauses)` conversion to align to video time.
- The two zooms have **fixed focal points**: zoom1 pans up to bottom meal cards (deep 1.30×) →
  3 meal cards ~13s; zoom2 centered 1.15× → recipe ~15s. Verify these still frame correctly on
  the new cut; the timing was set for the prior 24.57s video and may need a small nudge.

### Already done (do NOT re-do)
- The **live item count-up is a real feature in the app** now (`components/PantryScanModal.tsx`),
  NOT a video overlay — it ramps 0→N live during the scan and settles to the true total. It's
  captured in the new recording, which is why the 5s frame shows "3 items spotted / Uploading photos".
- The two **zooms** already exist and are roughly timed (just re-verify on the new cut).

---

## 📦 Everything else shipped this session (context for continuity)

**Scan pipeline**
- Daily **scan cap 5/day** per user, server-side, both `scan-pantry` + `parse-receipt`
  (`_shared/scan-cap.ts`, migration `20260530000000_scan_daily_cap.sql`, atomic RPC, refund on fail).
- **Photo downscale to 2048px / q0.95** before upload (pantry + receipt) — fixed multi-minute
  `req.json()` stalls (was uploading full-res multi-MB base64).
- **Recall fixes**: scoped the pet-food exclusion (was over-skipping real food), lowered second-pass
  gate 20→12 per photo, added systematic SCAN METHOD + egg-tray/back-row prompt guidance.
- Pet-food / non-edible exclusion added to both pantry and receipt prompts.

**Meals / cost control**
- **Meal-gen daily cap 3/day** server-side (`generate-meals`, scan_type `meal_gen`, refund on fail) —
  closes the regen cost leak (cache-invalidation + retries previously dodged the client `MAX_DAILY_REGENS=1`).
- Food-dislike changes no longer wipe the meal cache (diet/allergen changes still do).
- LLM made a **generous extractor** (15-20 candidates, no self-skip) — fixed thin trending counts.

**Trending / Discover (diet decouple)**
- Fixed trending cron auth via a **`CRON_SECRET`** shared secret (value:
  `4745ed4c77f8af82bd04058dfd2cbed0bed3861a150fc063`, set as function secret + must match vault
  `cron_service_role_key`). The old service-role-key match kept 401'ing.
- Trending now stores a **full ~18-meal tagged pool** (`compatible_diets[]`, `is_dairy_free/gluten_free/nut_free`),
  generated by `generate-trending-meals` (eager image gen in **waves of 5** to avoid FAL rate-limit).
- **Discover builds a per-user feed** by `diet_type` + allergen tags with variety + backfill
  (`app/(tabs)/discover.tsx`). New `profiles.diet_type` column + editable **Diet** row in Settings.
- Memory written: `project_trending_diet_pool.md`, `project_v2_meal_rotation.md`, `project_scan_cap.md`.

**Auth / onboarding**
- **`profiles.onboarding_completed`** flag (migrations `20260606000000` + `..0001`) — routing no longer
  infers completion from `calorie_goal` (which is skippable). `finish()` sets the flag AND defaults goals
  (2000 kcal / 150g) so the dashboard never breaks. signin.tsx + `_layout.tsx` route on the flag, with a
  server-profile fallback when the local AsyncStorage flag is missing (reinstall-proof). Hardened the
  profile check (`.maybeSingle()` + retry) so a transient query failure can't dump a real user into onboarding.
- Sign-in shows a friendlier error for bad creds (Supabase returns generic "Invalid login credentials" for
  both no-account and wrong-password — can't distinguish, so we nudge to "Create account").

**UI**
- Meal screen: removed strikethrough on HAVE ingredients (opacity 0.9), **tap an ingredient to move it to
  YOU HAVE**, full-bleed hero image (height 500), hero pulled to top.
- Home: hero card 360→300 (was cut off), carousel only cycles **image-ready** meals, **shimmer** skeleton
  while images load, prefetch hero images, pantry refresh after scan (carousel replaces "unlock" card).
- Discover rail cards 200→175 wide (2.5 peek) + tighter inset so pills don't wrap.
- Scan modal: removed pre-scan tips screen (tips now rotate inline by the shutter), close collapses cleanly.

**Spawned task chip (pending, may be unstarted):** "Downscale receipt photo before upload" — already done
inline, the chip is redundant; dismiss it.

---

## Current state / test checklist
- Metro running; app on device. **Reload** to pull all the above JS.
- Test: pantry scan → live count ramps then settles; meal screen tap-to-HAVE; Discover diet filtering
  (flip the Settings → Diet between Classic/Vegetarian); sign-in with a completed vs incomplete account.
- Trending: if Discover is empty, re-trigger generation (needs the vault `cron_service_role_key` = the
  CRON_SECRET above); see `project_trending_diet_pool.md`.
