---
name: bug-hunter
description: Hunt a bug by reproducing it before touching any code, ruling out
  environment first, then testing one hypothesis at a time. Triggers on sentences
  like "this is broken", "you said it was fixed and it isn't", "the app is doing
  X twice", "why is this happening again".
---

# Bug Hunter — Pantry edition

## When it triggers
Any report that something is broken, regressed, duplicated, or "fixed but isn't."

## The one rule
**No code changes until the failure reproduces on demand.** A fix you can't
verify against a reproduced failure is a guess, and guesses on this codebase
have cost whole sessions.

## The method
1. **Reproduce.** Get the exact failing case: which screen, which account, which
   device, what was expected vs seen. If it can't be reproduced, that IS the
   finding — say so and stop.
2. **Environment sweep BEFORE code.** On this project the bug has twice been the
   environment, not the code:
   - Multiple Pantry installs on the test iPhone (double notifications root cause)
   - iOS persisting stale scheduled notifications across app updates
   - Metro hot-reload ghosts / stale bundles (r3 render error) — force-quit + rebuild
   - Metro running from a `.claude/worktrees/*` path instead of the repo root
   Only after these are ruled out does code become a suspect.
3. **Read what the error actually says.** The literal message, the literal line.
   Not what it probably means.
4. **One hypothesis at a time.** State it, predict what you'll observe if true,
   test it, record the result. Never stack two speculative changes.
5. **Fix the cause, not the symptom.** If the symptom is a missing profile field,
   the cause is usually the onboarding upsert payload — fix the write, not the read.
6. **Prove it.** The exact case that failed in step 1 must now pass. Run it.
7. **Sweep for siblings.** Same mistake elsewhere: if one upsert dropped fields,
   grep every other `.upsert(` on profiles.

## The standards
- The reproduction is written down before the first edit
- Each hypothesis has a recorded prediction and result
- The fix commit message names the cause in one sentence
- Known baseline respected: pre-existing TS errors in onboarding/modals are not
  "new breakage" — check `npx tsc --noEmit` baseline before claiming anything

## The output
The bug fixed with proof (failing case now passes), the cause in one sentence,
and the result of the sibling sweep — then commit + push per repo workflow.

## The honest limits
Three dead hypotheses in a row → stop. Package the evidence (repro steps, what
was ruled out, logs) into a handoff block instead of thrashing the codebase.
Bugs living in Superwall dashboard config, App Store Connect, or sandbox tester
accounts can't be fixed in code at all — identify and say which dashboard.
