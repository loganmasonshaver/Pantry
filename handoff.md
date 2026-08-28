# Handoff — 2026-08-28

14 commits today. **`git log` carries the full reasoning for every one of them** — what was tried,
what was rejected, why. This file deliberately holds only what git and the code do NOT: unfinished
work, dead ends worth not repeating, and things that need a human.

Read `git log --since="2026-08-28"` first. Nothing below repeats it.

---

## 1. BLOCKING — clean these up before shipping

### Debug instrumentation is still in four screens
20 `perfMark()` trace calls (`MOUNT`/`UNMOUNT`/`FOCUS`/`BLUR`/`RENDER`) in `app/(tabs)/index.tsx`,
`discover.tsx`, `saved.tsx`, `pantry.tsx`. They are `__DEV__`-gated so **nothing reaches
production** — safe to leave, noisy to keep. They exist for the unsolved black-screen bug below;
delete them when that closes, not before.

### `generate-meals` is committed but not deployed
Last deploy Aug 12, last commit today. `npx supabase functions deploy generate-meals`.
(Only the dead-Groq-line removal — harmless if it waits, but preflight will keep flagging it.)

### `deno.lock` is untracked
A byproduct of `deno check` runs. Either commit it or gitignore it; it just makes preflight noisy.

---

## 2. UNSOLVED — the black screen, and the five things it is NOT

Switching tabs occasionally renders a black screen. Intermittent, cosmetic, clears on navigation.
**I recommended cutting it for launch and Logan has not overruled that.**

Do not re-run these. All were tested and eliminated:

| Excluded | Evidence |
|---|---|
| Screen teardown | No `UNMOUNT` ever fires on a tab switch |
| Focus handover | `FOCUS` fires every time |
| Rendering | `RENDER` fires and the screen is *still* black |
| Network stalls | Home's 3 focus queries measured 135–250ms every time |
| Background render leak | Real bug, fixed (see git), black screen persisted |
| Expo Go memory ceiling | Reproduces on a real dev build |
| Memory pressure | Native log: 0 jetsam events, 0 Pantry faults while black |
| `react-native-draggable-flatlist` | Pantry-only; Discover and Saved go black too |
| Tab-distance / `animation: 'shift'` | Pantry↔Saved (2 apart) fails, Home↔Discover (2 apart) does not |

**Everything JS-side is excluded by measurement.** React renders and the native view does not show
it — a compositing problem. The only remaining lead is **20 packages out of sync** (`expo 55.0.6`
vs expected `55.0.30`, `expo-router` 13 patches behind, RN 0.83.2 vs 0.83.10). `expo install --fix`
ERESOLVEs on an `expo-router` / `@expo/log-box` peer conflict — it needs a deliberate session, not a
patch. **I attempted it, it half-applied, and `npm ci` was needed to restore node_modules.** Do not
retry casually.

---

## 3. NEEDS LOGAN — cannot proceed without input

### The onboarding trailer
Flagged as needing "a good amount" of tweaking. **The specifics were never captured — ask before
touching anything.** The fix may be a new recording rather than code.
Asset: `assets/onboarding-preview.mov`, played via `expo-video` in `app/onboarding/index.tsx`
(~L2917), framed in a phone shell on the welcome step. That file is the repo's #1 bug source; read
the CLAUDE.md gotcha before editing.

### The remaining billing migrations
Done: FAL, Supabase, Apple (membership + payouts), OpenAI, Northwest.
Left: **Google AI** (this is the primary meal generator on Tier 1 Prepay — not a side service),
PostHog, Cloudflare (the `.app` domain renews annually), Loops, FatSecret, YouTube Data.

---

## 4. WATCH AFTER LAUNCH — numbers, not code

- **Generations per DAU and FAL spend.** Auto-generation was restored today; the commit that
  originally removed it said to watch this. That number has never actually been observed, because
  Pantry auto-generated the whole time the "manual" gate existed on Home.
- **`[funnel]` lines** in `generate-trending-meals` logs. Two matter: `ingredient-list gate` (~28%
  survive — the biggest loss, upstream of everything) and `dropped` (recipes that kept <100% of the
  creator's ingredients). Those are the only real yield levers.
- **The health-check push.** It was dead from the day it shipped — `profiles.expo_push_token` did
  not exist. Column added today. **Logan must open the app once on his phone with notification
  permission granted to populate the token**, then confirm:
  `select id, expo_push_token from profiles where expo_push_token is not null;`
  Until a row comes back, missed trending runs are still silent.
- **`shelf_tag` distribution.** Today's manual run stored 9 meals, 9/9 tagged, but skewed heavily
  Indian/South Asian. If that persists across a few days the query stride is sampling adjacent
  phrases; widen the spread in `buildCategoryConfigs`.

---

## 5. TOOLS BUILT TODAY — re-runnable, don't rebuild

Two eval harnesses. Both concluded **keep the current model** — that is a real result, not a null
one, and it means the model question is settled until new models ship.

```bash
# vision — pantry scan. 17 photos incl. 14 of Logan's own kitchen at 24MP.
# FULL=1 restores the 3 reference rows (gpt-4.1 control, 5.4-mini, Gemini).
OPENAI_API_KEY=sk-... node scripts/pantry-eval/run.mjs

# text — generate-recipe, verbatim production prompt
OPENAI_API_KEY=sk-... node scripts/text-eval/run.mjs
```

**The lesson worth carrying:** list price lies. `gpt-5.6-terra` advertised 20% cheaper than
production and measured **85% more expensive**, because it emitted 2531 output tokens where
gpt-5.4 emitted 582. Always measure real usage tokens.

`gpt-5-nano` is disqualified for any drop-in text swap: it spends the entire `max_tokens` budget on
reasoning and returns empty content at production's 2000 cap.

---

## 6. PROCESS NOTES — two mistakes worth not repeating

- **Never `git add ... 2>/dev/null`.** A commit today claimed two file changes and contained
  neither: one pathspec no longer existed, `git add` aborts entirely on a bad pathspec, and the
  suppressed stderr hid it. Check `git status` between staging and committing.
- **`git stash`/`git stash pop` during a TS baseline check rewrites files**, which Fast Refresh
  turns into a remount on the connected device. It corrupted a debugging session by producing
  MOUNT/UNMOUNT pairs that looked like an app bug. Don't stash while Logan is testing on device.

---

## 7. NOT DONE, deliberately

- **782 stale meal images.** Regenerating in place reaches nobody: filenames derive from the meal
  key and are served `cache-control: max-age=31536000`, so a regenerated image lands at a URL every
  client has cached for a year. A real backfill needs **versioned filenames** first.
- **Blurhash placeholders.** Biggest remaining perceived-speed win. Requires computing the hash at
  generation time — inside the image pipeline, marked do-not-touch — plus a backfill of ~1000
  images. Logan's call.
- **Parallelising the trending search loop.** 13 configs × 2 fetches ≈ 10s of a ~150s budget. Fits
  today. Next lever if wall-clock gets tight.
- **Widening the ~28% ingredient-list gate** by reading captions or pinned comments instead of only
  the video description. Structurally the largest yield win available, and a project rather than a
  patch.
