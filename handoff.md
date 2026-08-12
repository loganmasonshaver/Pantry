# Handoff — Pantry — 2026-08-12

Durable project rules live in `CLAUDE.md`, not here. This file carries only what a command
can't tell you: unfinished work, decisions that look wrong from the code, and claims nobody
has verified. Delete lines as they stop being true.

## Run this first

```bash
bash scripts/preflight.sh && npx tsc --noEmit 2>&1 | grep "error TS" | grep -c "^app/\|^lib/\|^components/\|^hooks/\|^context/"
```

Expect **no blocking issues** and **50**. Anything else — investigate before trusting a word below.

This counts app code only, deliberately. The all-in total (207 today) moves by +1 every time any
edge function gains a `_shared` import — noise that has already broken this assertion once and
would have had the next session distrusting a correct file. 50 only moves when real code breaks.

Everything that landed is in `git log --oneline 9cfcb95..HEAD` (reasoning is in the commit bodies,
`git show <sha>` for any of them).

## Next action

**Re-run the trending generation.** The last run aborted correctly at 5 recipes (min 6) and
Discover is serving a stale pool. The fix is deployed and unproven.

```sql
SELECT net.http_post(url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key' LIMIT 1)), body := '{}'::jsonb);
```

Then read the Edge Function logs:

| Log line | Healthy | Meaning if not |
|---|---|---|
| `ingredient-list gate: N/150` | ~40+ | parser precision, not a looser gate |
| `ingredient retention "X": N/N` | all equal | model isn't honouring the contract → prompt |
| `pool ranked + capped: storing N` | ≥6 | aborts again, keeps yesterday's feed |

## Verify tomorrow — needs a day boundary, can't be rushed

Two deployed changes are unprovable today. Both are logs-only; neither is visible in the app, so
they will look fine whether or not they work.

1. **Cook-Now repeat suppression.** Generate meals today, then again tomorrow, and read the
   `generate-meals` logs for `Repeat filter: N/M candidates matched a recent dish`. **N > 0 on day
   two is the proof** — N always 0 means either the window isn't persisting or the model isn't
   producing repeats to catch, and those need telling apart before calling it done.
2. **Trending retention gate**, once the re-run above succeeds — the allergen cross-check and the
   `servings` fix have both only ever been exercised by a single batch.

## In flight

- **100% retention gate** — deployed, has **never completed a successful run**. First attempt
  aborted; cause was the pool being capped to 60 *before* the list gate, so the gate saw 60 and
  kept 17. Fixed by gating first and raising `maxResults` 20→50. Unproven.
- **`shelf_tag`** — column live, **zero meals have one** (only populates on generation). Every tag
  shelf is currently driven by the name-based fallback, which covers 81%. Looks broken; isn't.
- **Cook-Now repeat suppression** (separate chat, same night) — `profiles.recent_meal_names` (30-name
  server window) + a code-enforced drop in `generate-meals` using an order-insensitive dish
  fingerprint, so "Fried Rice with Chicken" is caught as a repeat of "Chicken Fried Rice". Prompt-only
  exclusion and a 12-name device list were the old mechanism; a heavy day (1 auto-fire + 3 rerolls)
  flushed that entire window, which is how a meal carried across a day boundary. Migration applied,
  function deployed, unit-tested — **but never observed across a real day boundary on device.**
- **Discover Phase 1 ~70%** — context line, 3 personalised shelves, intent shelves, browse grid all
  shipped. Card density not started. Phase 2 (weekly drop, cook-rate ranking, per-user shelf
  ordering) not begun. See `PLAN-discover-personalization.md`.

## Open decisions — yours, not mine

- [ ] **Nut-free is treated identically to dairy/gluten in the filter UI.** Dairy wrong is
      unpleasant; nuts wrong is a medical event. Keep as-is, make advisory, or drop pre-launch?
- [ ] Health-check alert pushes to `OPS_USER_ID`. **Unverified whether that secret was ever set** —
      if not, the alert is a silent no-op. Check, or accept it.

## Do NOT repeat these

- **Header/layout via absolute positioning** — failed 3× before I found the cause (no
  SafeAreaProvider, see `CLAUDE.md`). Keep chrome in normal flow.
- **Regex or keyword shelving** — tried twice (protein taxonomy, then intent rules). Fails
  structurally; see `CLAUDE.md`.
- **Rejecting recipes without a parseable ingredient list, at low parser coverage** — correct idea,
  but it only became affordable once coverage improved. At 28% it discards ~72% of candidates, so
  it needs volume compensation, not enthusiasm.
- **Trusting a parser-coverage number measured on stored meals.** I reported 75% twice from bad
  evidence — first mojibake in the test cache, then survivorship bias. Real rate is 28%.

## Why it's built this way

Places where the obvious "fix" is a regression:

- `meal_logs.trending_meal_id` has **no foreign key on purpose** — retention deletes the parent row
  and `ON DELETE SET NULL` would erase the attribution it exists to preserve.
- **Impressions fire on viewport entry, not render.** The grid renders far below the fold; counting
  renders would inflate the denominator and make every shelf's CTR look worse than it is.
- **"Almost in your kitchen" is verified-recipes-only.** An incomplete recipe looks *more* cookable
  than it is and ranks higher precisely because it's missing ingredients.
- **`GRID_PAGE` is 6 for shelves but 24 for "Everything else"** — the catch-all holds hundreds at a
  mature pool; 6 would be ~59 taps to reach the end.
- **The horizontal rail was deleted deliberately.** It consumed the entire daily batch (10 slots vs
  8–15 meals/day), starving the section beneath it.

## Unverified

- Nothing this session is device-verified beyond what Logan checked live: the plan reveal, the
  home hero fit, and the milk serving fix.
- The `servings` fix has produced exactly one correct batch recipe (`Protein Bars`, servings 8).
- Allergen cross-check (model + keyword AND) has never run — needs a successful generation.
- Repeat suppression has never been observed across a day boundary. Confirm by generating on two
  consecutive days and checking the function logs for
  `Repeat filter: N/M candidates matched a recent dish` — the exclusion is only real if N > 0 on
  day two. The dish fingerprint is unit-tested (24 cases, incl. deliberate non-matches like
  Chicken vs Beef Stir Fry) but has never seen live model output.
