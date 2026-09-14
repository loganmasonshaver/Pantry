# Handoff — 2026-09-14 (00:46 CDT / 05:46 UTC)

Replaces the 2026-09-13 handoff. `git log 39eb197..HEAD` carries the reasoning for all 12 commits.
**The to-do list is `docs/PRELAUNCH.md`, and only PRELAUNCH.** This file holds order, mechanisms, and
decisions not to reopen. Start at §1.

**State:** everything pushed (the only uncommitted file is `skills-lock.json` + the 9 Higgsfield skill
dirs, both another session's — leave them). **Tests 611** (`node --test lib/*.test.ts
supabase/functions/_shared/*.test.ts`), **tsc 135 / 16 app-code**. Metro runs on **8082** in Logan's
own terminal; the app is built and working on device. Deployed at the tip: `generate-meals`,
`generate-trending-meals`, `generate-meal-image`, `audit-ingredient-lines`. Migration
`20260913204647_cook_tonight_zero_axes` applied.

**Pre-launch, no users.** Logan is the only person who has used the app.

---

## 1. FIRST — the two scheduled Discover runs are the open question

`PRELAUNCH §0`. The 08:00 UTC cron had **not yet fired** when this session ended (05:46 UTC); today's
`trending_meals` count was 0 and yesterday's forced run left 12. **PASS = a SCHEDULED run stores ≥ 12,
two days running (Sep 14 + Sep 15).** A manual fire does not count and burns quota the scheduled run
needs, which is why one was not fired at the end of this session.

Read the result with:
```sql
select generated_at, count(*) from trending_meals
where trend_source='YouTube trending' group by 1 order by 1 desc limit 3;
select id, created_at, stored, funnel->'llmRaw', funnel->'llmYields',
       funnel->'llm_Google'->'rejected', funnel->'llm_Google'->'servingsInferred'
from pipeline_runs where provider='Google' order by created_at desc limit 2;
```
If a thin day recurs, compare **KINDS, not counts** (they swing ±4): low `llmRaw` on every attempt is
the model; a high `rejected.dropped` is the parser. **Never widen the retention tolerance.**

Also unmeasured: the raw-meat table change lowers computed calories on Discover recipes with
chicken/steak/pork. Projected offline as a clear win (23 of 47 affected rows GAIN `computed` macros,
0 lose) but not yet seen on a real cron — check `macrosSource` against the 2026-09-13 baseline
(creator 3 / model 5 / computed 4).

## 2. What is verified vs not

**Verified on device or in production:** the garnish-vs-structural split ("Need:" vs "Better with:",
Logan confirmed); gram rounding; protein funding; `underTarget` 0 across five runs; the image cache
keyed on name + ingredient fingerprint; raw meat pricing (run 786 trace reads
`chicken (raw, local table)@120/100g`); the funnel row surviving (row 679 after the lone-surrogate fix).

**Not verified:** the two scheduled Discover runs (§1); the daily report going red on a zero-axis
savory meal (never had cause to fire); the image fingerprint's device tell, which needs a repeat of a
meal NAME carrying different mains; the 4 hard protein misses flagged in the flavour sweep.

## 3. DECISIONS ALREADY MADE — do not reopen without new evidence

- **Raw is the default for meat** (Logan, 2026-09-14). A recipe's grams are what the cook puts on the
  scale, and a cook weighs raw. Cooked figures live only on rows that NAME the state.
- **Raw meat prices from the local table, not FatSecret.** That service's top hit for a bare meat name
  is its cooked entry and nothing in the name or description says so, so no result-ranking can fix it.
- **Flavour ranks inside a tier, above freshness.** On a finite pantry the "fresh" candidates are the
  model's oddest recombinations; a seasoned repeat beats a dish built on water.
- **A ban never takes cheese or peanut butter.** They are the pantry's flavour carriers. The old rule
  said banning them "costs the deck nothing" and it cost run 678 its umami.
- **No hard protein cut at 100% of target.** It empties the deck on the vegan and carb-heavy sweep
  pantries. The tier ranks; the floor still shows something.
- **100% ingredient retention in Discover is a product requirement**, never a tuning knob.
- Never paste `CRON_SECRET` into chat, never rotate it.

## 4. MECHANISMS — the exact tells

- **The macro trace is in the DB row, NOT the response.** A dry run's returned `funnel` has no
  `macros` key; `pipeline_runs` does, for dry runs too. Reading the response instead of the row is
  what let a half-finished FatSecret fix look complete for a day. Always:
  ```sql
  select m->>'name', it from pipeline_runs p,
    jsonb_array_elements(p.funnel->'macros') m, jsonb_array_elements_text(m->'items') it
  where p.provider='generate-meals-funnel' order by p.created_at desc limit 20;
  ```
- **Dry-run Cook Tonight:** POST `generate-meals?dryRun=true&asUser=<uuid>` with the `sb_secret_` key
  as bearer (`npx supabase projects api-keys --reveal`, never on disk). The legacy service_role JWT is
  **NOT** accepted as internal by these functions — it reads as anonymous.
- **Dry-run Discover:** `generate-trending-meals?refresh=true&dryRun=true`, same key. ~85s a run.
- **YouTube quota resets at MIDNIGHT PACIFIC**, not UTC. 7 runs a day, dry runs cost the same. The
  cron at 08:00 UTC is deliberately 1 hour after the reset. This session spent all 7 of Sep 13's.
- **Sweep:** `RUNS=2 node scripts/cook-tonight-sweep/run.mjs`; results land gitignored under
  `scripts/cook-tonight-sweep/results/<timestamp>/`. Deck-clean counts swing ±4 — compare kinds.
- **iOS build:** `ios/.xcode.env.local` pins node's absolute path and is gitignored. A brew upgrade
  that moves node breaks the build with a Hermes script-phase failure ~2,000 lines into the log; grep
  it for `No such file or directory`. Now pinned to `/opt/homebrew/bin/node`, the stable symlink.

## 5. Mistakes this session worth not repeating

- **Proved a server healthy and shipped Logan something his phone could not reach.** Metro was started
  detached with `nohup`; every check passed (process alive, status endpoint, a 19 MB bundle in 2s) and
  the phone had never once connected, because a detached process never does the device handshake. A
  green server is not a green path.
- **Contradicted Logan's own sentence.** He wrote "my phone wasn't plugged in so it says no script URL"
  and got told the cable does not carry the bundle. It does. The fix was in his message.
- **Reported a fix verified by the wrong artifact** (FatSecret raw matching, above).
- **Fixed the one instance instead of the class.** "beef gelatin" was 1 of 8 ingredients priced as the
  wrong animal; the scan took a minute and found bouillon priced as raw chicken breast.
- Each real finding this session came from replaying actual rows through the code, never from
  reasoning about what the code should do.
