# Pantry App — Claude Instructions

## Plugins & Tooling Policy
- **`security-guidance` plugin enabled** (official `@claude-plugins-official`) — real-time vuln review while coding. Install: `/plugin install security-guidance@claude-plugins-official`.
- **Plugins: official marketplace only by default.** Community plugins require reviewing their source/components first (plugins run arbitrary code with your privileges — hooks, MCP servers, agents, no sandbox). Never install a plugin from an untrusted Git URL.
- A **global git pre-push hook** AI-reviews risky diffs and blocks on CRITICAL findings (see memory `reference-prepush-ai-review`). Bypass: `git push --no-verify`.

## Git Workflow — IMPORTANT
This repo uses a single main-branch workflow. No feature branches, no PRs for solo work. Every session:
1. **At start:** `cd /Users/loganshaver/pantry && git pull origin main` — sync before any work. If the session was launched inside a `.claude/worktrees/*` path, still `cd` to `/Users/loganshaver/pantry` and do all work there. The worktree is dead weight; ignore it.
2. **During:** commit + push to `main` directly after each meaningful change (no branching).
   **The commit body carries the WHY** — what was tried and rejected, what the non-obvious
   constraint was, what's still unproven. `git log` is the project's real memory: handoff files
   deliberately skip anything recoverable from it, so a "fix stuff" commit doesn't just lose
   reasoning, it silently shifts that burden onto a file that gets deleted. One-line subject,
   then prose for anything a reader would otherwise have to re-derive.
3. **Metro lives in main too:** the Expo dev server should always be running from `/Users/loganshaver/pantry`, never from a worktree path — otherwise edits won't hot-reload.
4. **One writer at a time.** Logan sometimes runs two chats against this repo. Only one may edit
   files; the other is read-only. Two writers on one working tree means `git add -A` in either
   sweeps up the other's in-flight edits, and neither change can be tested — there is one Metro
   server and one device. Stage by explicit path (`git add <files>`), never `git add -A`.
5. **Re-`ls supabase/migrations` immediately before `db push`.** Two sessions generate the same
   `YYYYMMDDHHMMSS` prefix from the same clock-hour. A collision aborts the OTHER migration
   mid-push and leaves a bogus ledger row — this silently removed `trending_meals.source_verified`
   from prod on 2026-08-12. Recovery: `npx supabase migration repair --status reverted <version>`,
   renumber, re-push. Always write `add column if not exists` so a partial apply is re-runnable.

## On Session Start
1. `cd /Users/loganshaver/pantry && git pull origin main` (per Git Workflow above)
2. Read ~/my-briefing/todos/active.md (clone it locally first if needed)
3. Summarize what's in progress and what's next
4. Tell me where to start today based on priority

## During Session
After completing each feature or fix, immediately update ~/my-briefing/todos/active.md:
- Check off completed tasks
- Add any new bugs discovered to the Bugs section
- Add a content idea to the 📱 Content Ideas section (e.g. "Show [feature] in action — 60s screen recording")
Do this after each task — not just at session end — so progress is saved if the session cuts off.

## On Session End
1. Do a final update of ~/my-briefing/todos/active.md (tasks, bugs)
2. Ensure all code changes are committed + pushed to `main` before the session closes

## App Context
- React Native + Expo, iOS only
- Supabase, OpenAI GPT-4o, Superwall, PostHog
- Pure black (#000000) background, white cards
- Premium-only ($7.99/month via Superwall + Apple IAP) — no free tier

---

## Design Conventions
- Background: `#000000` (pure black)
- Cards / elevated surfaces: `#1A1A1A` or `#111111`
- Accent green: `#4ADE80`
- Accent teal: `#00C9A7`
- Text white: `#FFFFFF`
- Text muted: `#888888`
- Always use `COLORS` from `@/constants/colors` — don't hardcode theme values except for local one-offs
- Border radius: 12–16 for cards, 30 for pills/buttons
- All primary action buttons: white background, black text, `borderRadius: 30`
- `SafeAreaView` with `edges={['top']}` on every screen

## Supabase Schema (profiles table — key columns)
| Column | Type |
|---|---|
| calorie_goal | int4 |
| protein_goal | int4 |
| dietary_restrictions | text[] |
| food_dislikes | text[] |
| food_prefs_banner_dismissed | bool |
| food_intro_popup_dismissed | bool |
| cooking_skill | text |
| max_prep_minutes | int4 |
| meals_per_day | int4 |
| height_cm | int4 |
| weight_kg | float4 |

## Key Patterns
- Meal generation reads `food_dislikes` from the profile and injects them into the GPT prompt
- Onboarding is step-based (1–9) in a single file with inline step components
- After step 7 (Food Preferences) → navigates to `/onboarding/createaccount` → routes to step 8 (Paywall) → step 9 (Complete)
- `useMealSuggestions` hook handles all profile + pantry fetching before calling `generateMeals`

## Commands
```bash
npm start          # start Expo dev server
npx expo run:ios   # build and run on iOS simulator
```

## Gotchas / Landmines — DO NOT relearn these

### Onboarding → profiles is the #1 bug source
- Onboarding writes to `profiles` via upsert from one giant step file. Any edit there
  can silently drop fields (goals, carbs/fat, dietary_restrictions, food_dislikes).
- After ANY onboarding change: write a test profile through the full flow, read the
  row back, and assert every field survived — including ones you didn't touch.
- Never assume upsert preserves untouched columns. Check the payload you're sending.

### Duplicates/double-fires: rule out environment before code
- "Double notification" and "duplicate meal" bugs have twice been environmental:
  multiple app installs on the test iPhone, iOS persisting stale notifications,
  or hot-reload ghosts. Check for these BEFORE editing code.

### Cache
- Meal cache is keyed by date + timezone; image-loading writes have corrupted it once.
  Any cache change needs verification at a day boundary, not just same-day.

### Don't touch
- **Image generation** — globally cached across users; per-user "optimizations" break the cost model.
- **Yearly IAP ($29.99)** — works. When debugging Monthly, leave Yearly alone.
- **Stripe** — web checkout only. Never import or reference Stripe in app code (App Review rejection).
- **Discover expiry filter** — aggressive by design; it (not the diet bands) is why meals disappear.

### Security invariant
- Anything granting premium/access (`promo_active`, referral redemption) is written
  server-side via SECURITY DEFINER RPC only. Never trust a client write for entitlements.
- RLS on public-content tables must be checked, not assumed. `trending_meals` silently
  accepted anonymous DELETE until 2026-08-12 — the anon key ships in the app bundle, so
  anyone could have wiped Discover. When adding a table, verify anon can only SELECT.

### There is no SafeAreaProvider in this app
- `useSafeAreaInsets()` returns **0 everywhere**. `SafeAreaView` still works because it's a
  self-measuring native view, so nothing looks broken — but any layout maths using insets is
  silently wrong. Cost three failed attempts at one header. Absolutely-positioned children also
  escape SafeAreaView's padding; keep chrome in normal flow.

### Recipe fidelity rules (trending pipeline)
- **100% ingredient retention is a product requirement, not a tuning knob.** A recipe that keeps
  fewer ingredients than the creator's published list is rejected. Never widen the tolerance to
  fill a thin day — the levers are candidate volume and parser precision.
- Ingredients are stored at the creator's FULL BATCH scale with a `servings` count; macros are
  per serving. Never scale ingredients to match per-serving macros (that produced "0.5 large eggs").
- Only ~28% of raw YouTube candidates have a parseable ingredient list. Any coverage figure
  measured against meals already in `trending_meals` is survivorship bias — those are the ones
  extraction already succeeded on.
- Allergen tags derive from ingredients, so a dropped ingredient becomes a false "free" tag.
  `classifyDietTags` scans name + ingredients + steps AND is ANDed with the model's own allergen
  answer. Fail safe: when in doubt, "contains".
- Never claim "Dairy-free" in UI. Say "No dairy in the listed ingredients" — true even when the
  list is incomplete.

### Discover shelving
- Shelves come from `trending_meals.shelf_tag`, assigned once by the model. Regex/keyword shelving
  was tried twice and fails structurally: it matches properties, properties overlap (one meal hit
  5 rules), so membership becomes rotation-dependent and unstable.
- Pipeline `RETENTION_DAYS` and client `YOUTUBE_VISIBLE_DAYS` must match. They drifted 3 vs 7 once
  and silently threw away most of the browsable pool.

## Known baselines
- **TS baseline = 149** via `npx tsc --noEmit 2>&1 | grep -c "error TS"`. Split: **45** in
  app code (`app/ lib/ components/ hooks/ context/`) and **104** Deno-global noise from
  `supabase/functions` being inside the tsconfig. Watch the DELTA, not the total — a +1 caught a
  real ReferenceError once, and a −4 on 2026-08-29 was the TDZ bug in `app/meal/[id].tsx` that
  made every meal render the previously-viewed meal's photo. The app-code number is the one that
  matters.
- **TS5097 is gone** (was 46, now 0). `allowImportingTsExtensions` is on, so `_shared` imports in
  edge functions and `./foo.ts` imports in unit tests no longer raise the count. Adding one is no
  longer free noise — if the number moves, something real moved.
- **Unit tests run under plain node, no Deno CLI and no jest:**
  `node --test lib/tilt.test.ts supabase/functions/_shared/macro-estimate.test.ts`
  Node 25 strips types natively. Test files are typechecked by `tsc` too — keep them compiling.
- `bash scripts/preflight.sh` reports the three places state drifts: uncommitted files,
  unapplied migrations, and functions whose source is newer than their deploy. Run it at session
  start instead of trusting any written claim about deploy state.
- Pre-existing TypeScript errors exist in the onboarding flow and several modal files.
  Before editing those areas, run `npx tsc --noEmit` to capture the baseline — don't
  claim to have introduced or fixed errors that were already there.
- Risky native/auth changes (sign-in methods, IAP) get a device test before touching
  main — the native Google Sign-In revert cost two sessions.
