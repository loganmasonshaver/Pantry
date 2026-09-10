# Handoff — 2026-09-10

Replaces the 2026-09-07 handoff. **26 commits** since `4058bf2`; `git log 4058bf2..HEAD` carries the full
reasoning for every one. This file holds only what git does not: what is UNVERIFIED, what is still OPEN,
and the decisions already made so the next session does not re-derive them.

**State:** all work committed and pushed. The 9 uncommitted files are a Higgsfield skills install and
`skills-lock.json` from another session — not this work; leave them. Migrations synced, `SCAN_CAP_WEEK`
unset. **TS baseline 136 / 16 app-code** (was 130; +6 Deno lines from `backfill-trending-times`, each
read). **452 tests** — `node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`.

**Pre-launch, no users.** Logan is the only person who has used the app. Frame urgency as launch
readiness, never as affecting users — see memory `feedback_prelaunch_no_users`.

---

## 1. UNVERIFIED — grouped by what unblocks each

### A. Tomorrow's 3am run (Sep 11, 08:00 UTC) — the most important check

The cron auth was fixed today and proven by hand, but the SCHEDULED pipeline has not yet run on it, and
this is also the first run that splits time three ways at extraction rather than via the backfill.

```sql
select count(*) meals, count(rest_time) split, count(*) filter (where rest_time >= 240) overnight
from trending_meals where generated_at = '2026-09-11';
```
- **Pass:** `meals > 0` AND `split = meals` (every new row has rest_time — NULL means the pipeline did not
  write it). Then the health check's body in `net._http_response` (the 08:20 row) reads `"healthy":true`.
- **The pipeline's own `net._http_response` row will say `timed_out: true`. That is EXPECTED** — pg_net
  gives up at 5000ms and the pipeline takes ~50s. That table only proves failure (a 401), never success.
- **Also watch:** whether `pipeline_runs` gets a row from the pipeline itself. Today's 13-meal forced run
  and Sep 6's 12-meal run wrote none; Sep 7's 2-meal run did. Hypothesis, unconfirmed: bigger batches
  exhaust the function's wall-clock AFTER image generation, before the final log write. Meals and images
  survive; the per-run audit row is lost. A missing row again tomorrow strengthens it.

### B. A device reload (Metro is running from the repo root on :8081)

On Discover, **switch tabs once after opening** — it paints from a cache written before `created_at`
existed and parks the fresh pool until blur.

- **Dislike sheet** — NOT confirmed after the second fix (`0bc3751`, provider moved to outermost). The
  first fix still rendered it wrong. Tell: sheet sits at the BOTTOM, nothing under the Dynamic Island.
- **"Almost in your kitchen"** — new rule, just shipped. Tell: **7 recipes**, none "Missing 3", led by
  Cottage Cheese Crepes (have it all). Frozen Yogurt Fruit Melts is gone from it.
- **Greek yogurt counted as owned** — open any recipe needing "greek yogurt"; it should sit under
  IN YOUR PANTRY now. Same for "large eggs".
- **New recipes lead their shelves**, none behind "Show more".
- **"Ready in 15"** — no frozen desserts on it.
- **Hero** — if it is a waiting dish, its pill reads e.g. `10 MIN + OVERNIGHT`.
- **Cook Tonight nudge** — "Still not feeling it? Browse Discover →" from the 3rd generation of the day.
  The cap BUTTON needs 6 generations; likely not worth forcing.
- **Ice** not under YOU'LL NEED on a smoothie; a 3-minute dish reads `5 min`.

Already confirmed on device today, do not re-check: backgrounding rescue, NEW TODAY border + green colour,
grey-frame fix, card time labels ("30 MIN CHILL"), detail breakdown ("10 min prep · 2 hr rest"), the
re-rendered smoothie and McFlurry images.

### C. The passage of time

- **Tonight after 7pm:** NEW TODAY borders must still show. The removed "Today's picks" keyed on the UTC
  date and vanished 7pm–3am; the border uses a rolling 24h from `created_at`.
- **Tomorrow ~1pm:** today's 13 recipes (created 12:51 CDT) lose the border; tomorrow's batch gains it.

---

## 2. OPEN — found, deliberately not fixed

- **Untranslated recipes.** "Mango Protein Ice Cream" and "Cheesecake" have German steps despite the
  pipeline's translate-everything rule. Count how many before fixing.
- **"Beef Pasta Meal Prep" dropped two seasonings** (~8g butter seasoning, ~8g garlic & herb) from its
  ingredient list — they are in the step text only, so they never reach a grocery list. Violates the 100%
  ingredient-retention rule. WHY the retention check let it through is uninvestigated. Its step 4 also
  says "onions", which the creator never listed (creator's own error, copied faithfully).
- **"Marinate chicken with ingredients listed above" (Sukiyaki).** The creator's grouping IS stored —
  `ingredients[].section = "chicken marinade"` — but the detail screen regroups by pantry status and
  discards it. Proposed: expand back-references from the stored section on the detail screen. Offered,
  not accepted yet.
- **Cup-measured produce drawn whole** (Sukiyaki: "1 cup shiitake", "2 cups cabbage"). The extractor should
  name the prepared form ("sliced shiitake").
- **The health check shares the pipeline's credential**, so a future auth failure silences both — how three
  days went unnoticed. Fix: a SQL-only cron that checks `trending_meals` and pushes via Expo directly.
- **Pre-push AI review fails open on every commit** ("Allowing push (fail-open by design)"). It is not
  actually reviewing anything, including both cron migrations.
- **"fruit" never matches a specific fruit** — needs a category taxonomy.
- Carried from 2026-09-07, still undecided: **Home layout redesign** (own-row vs one row), **feedback board
  Phase 2** (Profile has no support/contact row at all), **image cache key is the meal name only** —
  confirmed a second time today: "Greek Yogurt and Granola Power Bowl" lists pineapple and shows a July
  photo with banana.
- Cleanup: Pantry's 19 hardcoded `'#4ADE80'` → `COLORS.accentGreen`; unify the two singularisation rules
  (`pantry-check` vs `recipe-integrity`, the latter is better).

---

## 3. DECISIONS ALREADY MADE — do not reopen without new evidence

- **Flavour plan steps 3 and 4 are DEAD.** 8 opportunities, 0 mismatches across 9 runs. A measured zero.
- **Protein "Stage 2" (ban absent food like penne) is DEAD** by the plan's own test — after the base-ban fix,
  candidates recovered to 5–7 and only 1–2 per run die to absent food.
- **Do not change the ranker's freshness rule.** Run 32 put a 33g meal first, run 33 a 48g one — same
  saturated window, opposite outcomes. The repeat window is COUNT-based (last 60 meals), not time-based.
- **Discover:** keep the day-keyed rotation; no "Today's picks" shelf (first-shelf-wins means it PULLED new
  recipes out of their home shelves); NEW TODAY border on a rolling 24h.
- **"Almost in your kitchen":** at most 2 missing AND hold at least as many as you lack; below 2 recipes, no
  shelf. Measured: Logan's rule alone kept the recipe he reported; "hold 2x" left only 2 recipes.
- **Yogurt variant swap + macro recompute: not now** (Logan). Note the matcher now treats non-fat and
  full-fat as the same ingredient, so a full-fat recipe shows "in your pantry" with full-fat macros.
- **Never paste `CRON_SECRET` into chat**, and never rotate it. Vault `cron_secret` must equal it.

---

## 4. MECHANISMS BUILT OR LEARNED TODAY

- **Run a cron job by hand** (MCP is read-only): execute its STORED command —
  `npx supabase db query --linked "do $$ declare c text; begin select command into c from cron.job where jobname='trending-meals-daily'; execute c; end $$;"`
- **Re-render a Discover image with no secret in any shell:** `net.http_post` to `generate-meal-image` with
  the Bearer read from `vault.decrypted_secrets` server-side, body built from the row, `timeout_milliseconds
  := 120000`. Put SQL in a file and use `db query --file`. Saved in memory `reference_supabase_secrets_write_only`.
- **`backfill-trending-times`** — internal, `dryRun` defaults TRUE, resumable (picks up `rest_time IS NULL`).
- **A new internal edge function needs `verify_jwt = false` in `supabase/config.toml`**, or the gateway 401s
  the vault secret as `UNAUTHORIZED_INVALID_JWT_FORMAT` before your code runs.
- **Measure before building held again, four times:** the protein floor, the curd-dairy mechanism, the
  keyword time backfill and the stricter shelf ratio were each shown wrong by data before they shipped.
