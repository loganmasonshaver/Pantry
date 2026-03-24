---
name: debug
description: Systematically debug a bug or error in the Pantry app using root cause analysis
---

A bug or error has occurred in the Pantry app: $ARGUMENTS

## Phase 1 — Understand Before Touching Anything

Before reading any files or suggesting fixes, answer these questions from the error description:

1. **What is the exact failure?** Error message, wrong behavior, or silent failure?
2. **Where does it originate?** UI layer, Supabase call, API (FatSecret/OpenAI/RevenueCat), auth state, or React state?
3. **Is it consistent or intermittent?** Intermittent = timing/async issue. Consistent = logic bug.
4. **What changed right before this broke?** New code, new package, env variable, or Supabase migration?

Do not read files yet. State your hypothesis about the root cause based on these answers.

## Phase 2 — Targeted Investigation

Now read only the files relevant to the hypothesis. Do not read unrelated files.

- Check the exact error location first (stack trace line numbers)
- Trace the data flow: where does the value come from, where does it go wrong?
- For async bugs: check for missing await, unhandled promise, state updates before render
- For Supabase bugs: check RLS policies, column names, insert shape vs table schema
- For auth bugs: check if useAuth() is inside a Modal (known issue — use supabase.auth.getUser() instead)
- For React Native Modal bugs: check for missing GestureHandlerRootView wrapper
- For state bugs: check if setState is async (it is) and if a ref is needed for synchronous guards

List ALL plausible causes before picking one. Rank them by likelihood.

## Phase 3 — Fix the Highest-Probability Cause

- Fix only the most likely root cause first
- Add targeted console.log if the root cause is still unclear — do not guess
- One fix at a time. Do not fix multiple things simultaneously unless they are provably the same root cause
- After fixing, explain in one sentence why this was the actual cause

## Phase 4 — Verify and Check for Related Breakage

- What would confirm the fix worked? (specific log output, UI behavior, Supabase row)
- Does this fix affect any other screen or component that uses the same function/hook/table?
- Is there a try/finally missing that could leave state stuck (e.g. `saving`, `loading` stuck true)?

## Stack Context
- React Native 0.83 + Expo SDK 55, iOS only
- Expo Router file-based navigation
- Supabase (auth + database) — auth inside Modals often returns null, use `supabase.auth.getUser()` directly
- OpenAI GPT-4o / GPT-4o-mini
- RevenueCat for subscriptions
- FatSecret API (OAuth 1.0, free tier — `food.find_id_for_barcode` NOT available, use Open Food Facts → FatSecret search)
- expo-camera CameraView for barcode scanning — barcode fires multiple times before state updates, use useRef guard
