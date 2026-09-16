# Handoff — 2026-09-16 (00:0x CDT)

Replaces the 2026-09-15 handoff. `git log 4eceabd..HEAD` carries the reasoning for every commit
below. **The to-do list is `docs/PRELAUNCH.md`, and only PRELAUNCH** (119 open items after a
closing pass today). This file holds state, tells and decisions not to reopen.

**State:** everything committed and pushed; the only uncommitted files are another session's
Higgsfield skill dirs and `.claude/launch.json` (mine, see below). **tsc 135 / 16 app-code**,
**tests 663** (`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). No migrations and
no edge-function deploys today — app code and docs only.

**The phone is on a RELEASE build (installed 00:01), not the dev build, and Metro is NOT running.**
To get back to normal development:

```bash
npm start                                # Metro on 8081, from /Users/loganshaver/pantry
npx expo run:ios --device 00008150-0001691A3688401C --no-bundler   # reinstall the Debug build
```

---

## 1. What shipped today, and what Logan verified on device

All verified by Logan unless marked otherwise.

- **Pantry tab, second pass** (`dbc6512`, `2a95614`, `e167c46`, `ccb57f7`): the ✚ is gone (search
  doubles as add), search is a field not a card, the notice strips are one grey line above the list,
  ages show nowhere in the list, Out rows are struck and faded in place, dividers inset, Meat & Fish
  leads the aisles, tab icon is a fridge.
- **Motion Phase 1** (`e0a0e41` `462f6b0` `15310d6` `2e3e063`): all ten dead `LayoutAnimation` calls
  replaced or removed; Home's log, Grocery and Saved close their gaps with Reanimated; the calorie
  ring moved to the UI thread and stopped ~100 renders per Home load for a value rendered nowhere.
- **Motion Phase 2** (`b02670f`…`5932d3f`, ten commits): haptics on ~20 commits that had none, moved
  to after the result on Save and Extract Recipe, removed from openers and no-touch events.
- **Home:** the "· N left today" pick count removed (`9742a2f`).
- **Discover preload** (`abcaba8`): the tab is built in the background after launch, so it opens
  finished instead of on a skeleton. Also fixed there: a pool fetched while Discover was off screen
  was parked until a blur that had already happened, so a morning resume opened on yesterday's feed.
- **Pantry tab load** (`8b84fd7`): it had no local copy of the list at all. Now a disk mirror
  (`pantry_items:<uid>`, written on every change) painted on mount, plus the same preload treatment.
  Grouping moved to `lib/pantryGroup.ts` (+5 tests) so cache and network build an identical list.
- **Pantry scan** (`b7250b4`, `c8a2959`, `087dd9e`): multi-select from the gallery capped to what is
  left of the 16-photo limit; a "Preparing photos…" spinner from the instant the picker closes; ✕
  asks before discarding unscanned photos.

## 2. Motion: the method, the numbers, and where it stops

Plan, budget and phases: **`docs/PLAN-motion.md`**. Measured in RELEASE builds on the phone with
Instruments' Animation Hitches template:

| Run | Hitch time ratio | Verdict |
|---|---|---|
| baseline (pre-Phase-1) | 0.99 ms/s | good |
| Phase 1 | 1.24 ms/s | good |
| Phase 2 | 1.52 ms/s | good |

Apple's band is < 5 ms/s. Each step is one or two hitches of walkthrough noise — Phase 2's gap is a
single 66.7 ms launch hitch (1.08 ms/s without it). **If Phase 3 adds another step, stop and look
before continuing.** Phases 3 (ReanimatedSwipeable), 4 (transition consistency) and 5 (onboarding)
are unbuilt and optional.

How to measure, from the repo:

```bash
bash scripts/motion-trace.sh <label>          # one traced walkthrough + printed summary
bash scripts/motion-compare.sh <before> <after>  # before-build must already be installed as Release
node scripts/motion-trace-read.mjs <file.trace>   # re-read any trace
```

**Disk landmine, paid for once today:** every recording spools 0.5–5.5 GB of raw trace into
`$TMPDIR` as `instruments*.ktrace` and xctrace never deletes it. Eighteen of them filled the Mac
(1.1 GB free) and crashed a save mid-walkthrough. `motion-trace.sh` now refuses under 12 GB free and
deletes its own spool; if a trace ever dies again, look there first.

## 3. Decisions not to reopen without new evidence

- **A tap that changes a row's state never relocates it out of view.** An "Out of stock" section at
  the end of the Pantry list read as a delete next to swipe-to-delete. Out rows fade in place and
  sink on the next load.
- **No emoji as item glyphs, and the Pantry tile redesign is scrapped** (Logan: "it looks fine how
  it is now"). Research and mocks kept: the field study and the emoji-vs-photo comparison are linked
  from PRELAUNCH §6c. The 298 Flux ingredient photos stay unused; the meal screen dropped them in
  May for a 5–10% wrong-food rate.
- **`LayoutAnimation` is dead in this app** (Reanimated disables it on the New Architecture). Now a
  CLAUDE.md landmine. Zero calls remain.
- **`quality: 1` in the gallery picker is a SPEED setting.** expo-image-picker only takes its fast
  path (copy the original file) at quality >= 1; lowering it decodes and re-encodes every photo.
- **The scan ✕ confirmation is a deliberate exception** to the no-confirmation rule, which covers
  reversible actions. It asks only when unscanned photos exist.
- **The tab-bar selection tick stays** — Logan did not ask for it to go.
- **The splash hang is closed as a remote-launch artifact.** It only ever stuck when xctrace launched
  a freshly built binary; Logan tapping the icon on a fresh build works. One check survives in §11:
  do the same on the first launch of the TestFlight build.

## 4. Mistakes worth not repeating

- **Reported a "slide" that never animated.** The Pantry Out-row sink was built on `LayoutAnimation`,
  which is a no-op here; it jumped in one frame. Check the mechanism actually runs before describing
  motion to Logan.
- **Let a 150 s trace start with 11 GB free** and filled the disk. The guard now lives in the script.
- **Deleted a failed trace before reading it**, losing the one data point that might have explained a
  stuck launch.
- **Put a JSX comment above a component's root element**, which broke the parse. tsc caught it.

## 5. Where to pick up

Order is PRELAUNCH's, not this file's. The launch path:

1. **§1 App Store Connect** — the review screenshot is still missing on both subscriptions, which is
   also what Superwall's "missing metadata" warning is reading. Then attach them to the version.
2. **§3 Pantry scan flow end to end on device** — blocks the trailer; the camera has not had a full
   pass since the 16-photo cap and today's changes.
3. **§4 skip-onboarding paywall variant** and **§5 rating prompt** — neither is built; the rating
   prompt needs `expo-store-review` added and a feedback form that does not exist yet.
4. **§7 trailer** (blocked on Logan's photo decision), **§8 screenshots + subtitle**, **§9 unset
   `SCAN_CAP_WEEK`**, **§11 TestFlight**, **§12 submit**.

Also open, off the launch path: the two meal-count sources that can drift (§6c), the anon referral
oracle (§6e), notification taps going nowhere (§2l), scan-import plan steps 2–3 (dev timers, then
bounded concurrency — the ~5 s picker wait is Apple's, now merely visible), and ~100 Cook Tonight and
pipeline audit notes from Sep 4–13 that would read far better after a triage pass.

**One flag Logan closed as stale but worth knowing:** the Discover cron's two fixes from Sep 15 (the
200 s client timeout migration and the attempt-loop wall budget) have never been proven on a
scheduled run. If Discover stops gaining recipes, that is the first place to look —
`net._http_response` and `pipeline_runs`, the SQL is in git history at `c2f8aee`.
