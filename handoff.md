# Handoff — 2026-09-05

Replaces the 2026-09-04 handoff (in git history). `git log --since="2026-09-04 14:00"` carries the
reasoning for all 41 commits; this file holds only what git does not.

**State:** everything committed, pushed, deployed. Working tree clean. **265 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). **TS baseline 131 total / 17
app-code** — the total ROSE from 124 because a new edge function adds ~7 Deno-global lines; the
app-code number is the one that must not move. Preflight green except `SCAN_CAP_WEEK`, still held
on purpose.

---

## 0. READ FIRST — two rules this session established

**1. "What's next" means Logan's open items, not the top of a checklist.** Written to memory as
`whats-next-means-logans-open-items`. Capture every issue he raises into `docs/PRELAUNCH.md` THE
MOMENT he raises it, and keep this file current DURING the session. He had to point out that half a
session's issues existed only in the chat.

**2. ⚠️ EVERY UNVERIFIED FIX MUST LAND IN THIS FILE AND IN PRELAUNCH BEFORE THE SESSION ENDS.**
That is what §1 is. A fix nobody can reproduce the reasoning for is worse than no fix, because the
next session re-derives it wrongly. If you ship something that cannot be checked today, write it
down today.

---

## 1. ⚠️ UNVERIFIED — everything shipped today that nobody has confirmed

Nothing below has been seen working. Grouped by what unblocks it.

### Needs tomorrow's 08:00 UTC cron (or a manual dry run)
- **Macro coherence gate** (`6a74275`) — rejects carbs-and-fat-both-zero, and an Atwater gap over
  BOTH 50 kcal and 25%. Tuned so it rejects exactly 1 of 178 live rows.
- **Computed macros** (`130988f`, `46fdfeb`) — when the creator publishes none, the pipeline now
  does the arithmetic itself, but ONLY when it agrees with the model within 25%. Read the
  `macrosSource` split in `pipeline_runs`: **100% `creator` means the model is lying about
  `macros_from_creator`**, the one failure mode with no downstream catch. Two runs gave a healthy
  mix, so it is not lying yet.
- **Group headings excluded from the retention count** (`ce02d20`) — UNEXERCISED. Neither recipe
  that motivated it appeared in run 2's batch of 6.
- **Merged-ingredient recovery** (`19edbd9`) — the deterministic fix for the biggest retention
  killer. Watch `ingredientsRecovered` in the funnel: **large relative to `dropped` means the model
  got worse, not the recipes better.**
- **LLM retry** (`818a7f3`) — 2 extra attempts when the pool is thin, zero extra YouTube quota.
  Watch `llmAttempts` and `llmYields`.
- **Prose filters in the parser** (`0bd816a`, `e695b80`) — long bulleted lines need a quantity;
  `2.)` markers now strip.
- **Image prompt: flavourings** (`48af2dd`) — rewritten to a named colour, never removed.
- **Dish naming rule** (`0c1e9cc`) — a recipe title, not a creator's video-title noun.

### Needs a device reload
- **No dark gap before the hero photo** (`bf41c61`) — skeleton now waits for `onLoad`.
- **Versioned image URLs** (`34707fe`) — regenerated photos actually reach the device.

### Needs a new day's first open
- Carryover, `HERO_IMAGE_WAIT_MS` 22000, Discover hero, "Almost in your kitchen" ordering.
  All still open from 2026-09-04; see PRELAUNCH 6b.

### Verified today, for contrast
Sweep bar reads as activity. Goal-flash fix. App Store Connect group localization + prices.
Superwall product mapping. `truncated = 0` on both dry runs — that closes the LAST of the four
2026-08-30 PRELAUNCH checks.

---

## 2. THE PIPELINE, and the one thing that changes how you test it

**The yield variance is entirely in the LLM.** Two dry runs minutes apart: rawCandidates 644 and
644, afterDedup 455 and 448, sentToLLM 39 and 40 — every stage before the model is stable — and the
model returned 19 recipes then 6, storing 5 then 2.

**Consequence: a single run cannot validate a generation change.** Compare RATES across several
runs, never counts across two. This is the trap I nearly fell into reading run 2 alone.

It also explains 2026-09-03's two meals: no funnel survives, but both rows were written 22 seconds
after the trigger against 60-90s for a full run, and a fast run is a small run. Same variance,
sampled once daily and made permanent by the swap. Not a separate defect.

**You can now run the pipeline yourself from SQL** — the Vault holds CRON_SECRET and it is readable
from SQL, so nothing needs pasting. `docs/TRENDING-OPEN.md` has the exact statements. I spent
several rounds asking Logan to run things I could have run all along.

**`pipeline_runs` now persists every funnel.** Before today a run's result was unreadable: pg_net
abandons the request long before it finishes, so the cron's own output reached nobody.

---

## 3. NEGATIVE RESULTS — do not retry these

- **Prompting cannot stop the model merging repeated ingredients.** Three attempts: the existing
  "never merge two lines" instruction, the `[appears Nx]` marker (blind to it — it keys on the exact
  line and these lines differ), and an explicit "these repeats are deliberate" annotation that was
  verified to render, verified to reach the model, and changed nothing. Same shape as the ban-list
  finding. `19edbd9` recovers mechanically instead.
- **Do not write a "no jello" style rule** for food quality. Keyword rules for that are a measured
  dead end here twice over.
- **The 90-char ingredient cap was an accidental prose filter.** Raising it without replacing that
  job admitted method sentences into ingredient lists. If you touch `MAX_INGREDIENT_LINE`, the
  bulleted-line quantity rule is what keeps prose out.

---

## 4. THE HABIT THAT PAID OFF FOUR TIMES TODAY

**Read the TS baseline DELTA line by line, never the total.** It caught: a `supabase` client that
does not exist in `generate-trending-meals` (it is `db`) inside a try/catch that would have
swallowed the ReferenceError; an implicit-any; a `{}` arithmetic error; and a **TDZ bug I had
already deployed** that would have thrown on every cached image request within minutes.

A related one: **supabase-js reports a refused write as a RETURNED error, not a thrown one.** A
try/catch around `.insert()` catches nothing. Three call sites were silently failing this way.

And: **when Logan says "this looks the same", download the artefact and look at it.** I verified
three times that a regeneration had happened — by size and timestamp, all true, all useless. The
bytes were right; his device was serving its own cache.

---

## 5. OPEN, NOT STARTED

- **§6d in PRELAUNCH** — everything Logan raised on 2026-09-04 about Home and Pantry layout,
  decided but not built. His original complaint (Pantry categories ~215pt below the fold) leads it.
- **~83 rows carry a serving count their ingredients contradict.** Surfaced by
  `scripts/replay-macros.ts`; servings is the divisor for every macro on the card. Start with the
  clean 2x cases.
- **Store the source description** alongside each row. Twice today the discarded source was the
  thing blocking an audit.
- **The app does not show `macros_source`.** The column is populated and nothing reads it, so the
  database knows a number was computed and the user does not.
- **`validate_referral_code_v2` is still an anon oracle** — it cannot be revoked, onboarding calls
  it before account creation. Entropy plus the redemption cap is what makes it worthless.

---

## 6. ENVIRONMENT

- **Metro must run from `/Users/loganshaver/pantry`**, never a worktree.
- Bundler address is solved permanently via the Bonjour name `Logans-MacBook-Air-10.local:8081`.
  Only a delete-and-reinstall breaks it (it wipes `RCT_jsLocation`).
- **Supabase Edge Function secrets are WRITE-ONLY** — `secrets list` returns SHA-256 digests. Get
  keys from the issuing service. **The Vault is different and IS readable from SQL**, which is how
  the cron and every manual run authenticate. Saved to memory as
  `supabase-secrets-are-write-only`.
- `npx supabase db query --linked --file <f>` is how to read prod. There is no `db execute`.
