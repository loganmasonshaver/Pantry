---
name: build-planner
description: Turn "I want to build X" into a staged PLAN.md — after forcing the
  decisions that always change to be made up front. Triggers on "plan out how to
  build this", "new app idea", "write the PRD", "how should I build X".
---

# Build Planner — the PRD front-loader

## When it triggers
At the start of any new app or major feature, before any code exists.

## The one rule
**Decide the volatile things before writing code.** On Pantry, the PRD drifted
for months on exactly four decisions; every one caused rework when it changed
mid-build. Force them first.

## The method
1. **The four volatile decisions — ask one at a time, get a committed answer:**
   - **Monetization gate:** free tier or premium-only? Where exactly does the
     paywall sit in onboarding? (Pantry: premium-only, paywall at step 8 — but
     this moved repeatedly. Pin it.)
   - **Onboarding data model:** the complete list of profile fields, their types,
     and the ONE code path that writes them. Onboarding-upsert bugs were Pantry's
     #1 time sink; a single owned write path prevents the class.
   - **Auth method(s):** which providers, native or web flow — and a device-tested
     spike BEFORE committing (the native Google Sign-In revert cost two sessions).
   - **Client/server split:** which writes are client-allowed and which must be
     server-side (entitlements, quotas, anything costing money).
2. **Then the normal questions:** who it's for, the one core loop, what's
   deliberately out of v1.
3. **Slice into stages.** Each stage ends with something visible running on the
   device — never two stages of pure plumbing in a row.
4. **Write PLAN.md.** Per stage: goal, files touched, **verification** (the
   command or on-device check proving it works), and a **scope fence** (what this
   stage must NOT touch).

## The standards
- The four volatile decisions appear at the top of PLAN.md with their rationale —
  so a future session can see WHY before proposing a change
- Every stage's verification is executable, not "should work"
- Stage 1 gets the skeleton on a real device — build/deploy problems surface on
  day one, not launch week
- CLAUDE.md is written at project birth, seeded with the stack's known gotchas

## The output
`PLAN.md` at the project root, ready to hand to a cheaper model or a fresh
session that remembers nothing.

## The honest limits
A plan is a hypothesis — it lowers the intelligence needed to execute, it
doesn't remove it. When reality contradicts a stage, update PLAN.md before
coding past it. And this planner is tuned for solo React Native + Supabase
apps; a web product or a team changes the checklist.
