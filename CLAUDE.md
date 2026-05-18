# Pantry App — Claude Instructions

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
- 7 screens total — Profile/Stats is currently in progress
- Freemium: free tier (1 suggestion/day, 5 saved meals) + $7.99/month premium

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
