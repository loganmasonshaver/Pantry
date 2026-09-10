# Handoff — 2026-09-10

Replaces the 2026-09-07 handoff. **26 commits** since `4058bf2`; `git log 4058bf2..HEAD` carries the full
reasoning for every one. This file holds only what neither git nor `docs/PRELAUNCH.md` does: decisions
not to reopen and mechanisms learned. The to-do list is PRELAUNCH, and only PRELAUNCH.

**State:** all work committed and pushed. The 9 uncommitted files are a Higgsfield skills install and
`skills-lock.json` from another session — not this work; leave them. Migrations synced, `SCAN_CAP_WEEK`
unset. **TS baseline 136 / 16 app-code** (was 130; +6 Deno lines from `backfill-trending-times`, each
read). **452 tests** — `node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`.

**Pre-launch, no users.** Logan is the only person who has used the app. Frame urgency as launch
readiness, never as affecting users — see memory `feedback_prelaunch_no_users`.

---

## 1–2. UNVERIFIED and OPEN → `docs/PRELAUNCH.md` §2k and §2l

Both lists moved there on 2026-09-10 — PRELAUNCH is the ONLY list until launch (see CLAUDE.md "ONE
LIST UNTIL LAUNCH"). Do not re-copy them here. The single most important check is §2k.A, the Sep 11
3am run. Dislike sheet position + text PASSED on device; its step 2 and whether a reason saves did not.

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
