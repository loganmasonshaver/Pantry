---
name: paywall
description: Gate a feature behind the premium subscription using Superwall
---

Gate the following feature behind the Pantry premium subscription: $ARGUMENTS

## How Superwall is wired in this app

- Context: `context/SuperwallContext.tsx`
- Hook: `const { isPremium, showPaywall } = usePremium()`
- Free tier limits: 1 meal suggestion/day, 5 saved meals max
- Price: $7.99/month

## What to implement

1. **Read the target file** to understand where the gated action happens
2. **Import `usePremium`** from `../../context/SuperwallContext` if not already imported
3. **Add the gate** — when a free user hits the limit or tries a premium action:
   - Show an `Alert` with two options: "Upgrade to Premium" and "Cancel"
   - On "Upgrade to Premium": call `showPaywall('placement_name')` — if it returns true, proceed with the action
   - Track the event: `trackUpgradePromptShown('feature_name')` from `lib/analytics`
4. **Handle loading state** — if `loading` is true, don't show the gate yet
5. **Never block the UI for premium users** — the gate only fires when `!isPremium`

## Pattern used elsewhere

See `app/meal/[id].tsx` for a working example — it gates the save action with a limit of 5 saved meals.

## After implementing

Tell me exactly what triggers the gate and what the upgrade prompt says.
