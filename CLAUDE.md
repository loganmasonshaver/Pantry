# Pantry App — Claude Instructions

## Plugins & Tooling Policy
- **`security-guidance` plugin enabled** (official `@claude-plugins-official`) — real-time vuln review while coding. Install: `/plugin install security-guidance@claude-plugins-official`.
- **Plugins: official marketplace only by default.** Community plugins require reviewing their source/components first (plugins run arbitrary code with your privileges — hooks, MCP servers, agents, no sandbox). Never install a plugin from an untrusted Git URL.
- A **global git pre-push hook** AI-reviews risky diffs and blocks on CRITICAL findings (see memory `reference-prepush-ai-review`). Bypass: `git push --no-verify`.

## Git Workflow — IMPORTANT
This repo uses a single main-branch workflow. No feature branches, no PRs for solo work. Every session:
1. **At start:** `cd /Users/loganshaver/pantry && git pull origin main` — sync before any work. If the session was launched inside a `.claude/worktrees/*` path, still `cd` to `/Users/loganshaver/pantry` and do all work there. The worktree is dead weight; ignore it.
2. **During:** commit + push to `main` directly after each meaningful change (no branching).
3. **Metro lives in main too:** the Expo dev server should always be running from `/Users/loganshaver/pantry`, never from a worktree path — otherwise edits won't hot-reload.

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

## Known baselines
- Pre-existing TypeScript errors exist in the onboarding flow and several modal files.
  Before editing those areas, run `npx tsc --noEmit` to capture the baseline — don't
  claim to have introduced or fixed errors that were already there.
- Risky native/auth changes (sign-in methods, IAP) get a device test before touching
  main — the native Google Sign-In revert cost two sessions.
