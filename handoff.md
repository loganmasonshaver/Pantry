# Handoff — 2026-09-10 (evening)

Replaces this morning's handoff. **39 commits** since `c630b46`; `git log c630b46..HEAD` carries the full
reasoning for every one. This file holds only what neither git nor `docs/PRELAUNCH.md` does: the ORDER of
the checks, decisions not to reopen, and mechanisms learned. **The to-do list is PRELAUNCH, and only
PRELAUNCH** (CLAUDE.md "ONE LIST UNTIL LAUNCH") — every item below points there.

**State:** all work committed and pushed. The 9 untracked files are a Higgsfield skills install from
another session — not this work; leave them. Migrations synced. **TS baseline 135 / 16 app-code** (was 136;
trending-health-check lost its `OPS_USER_ID` Deno line). **503 tests** —
`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`. Preflight flags categorize-item,
estimate-meal-macros and generate-recipe as "committed after deploy" only because `_shared/sanitize.ts`
gained exports they do not use — no redeploy needed.

**Pre-launch, no users.** Logan is the only person who has used the app — frame urgency as launch
readiness (memory `feedback_prelaunch_no_users`).

---

## 1. Checks, in the order they unblock → PRELAUNCH §2k (and §2l for the Cook Tonight ones)

1. **Tonight after 7pm** — NEW TODAY borders still show (rolling 24h from `created_at`).
2. **Sep 11 after 3am — the most important check.** First SCHEDULED run on today's cron-auth fix, time
   split, ordered phases, translation net and emoji strip (all were proven tonight by a forced DRY run, not by
   the scheduler). SQL is in §2k.A and now expects `phased = meals`. Also confirm 0 untranslated and 0 emoji:
   re-run the detector in `_shared/translate-steps.ts` / the emoji count if anything looks off.
3. **Sep 11 ~9:05am** — the daily report email arrives by itself, sectioned HTML format. If not: was the
   Claude desktop app open? Did Logan press "Run now" once on `pantry-daily-report-email` to store the
   Gmail/Supabase approvals? (Asked twice; not confirmed.)
4. **Sep 11, Discover** — note All's hero, flip through the chips, come back: same dish (fix `d8449ea`;
   today's pick was already rewritten by the bug, so only tomorrow proves it).
5. **Next Cook Tonight generation** — read the funnel (below): `savoryClashShown` 0, `incompleteShown` 0,
   `belowProteinFloorShown` 0, `notCookableMissing` free of bread/pasta/noodles. Image counts ("3 eggs") are
   still unexercised.
6. **Sep 11 ~1pm** — the Sep 10 batch loses its NEW TODAY border; the new batch gains it.

**One decision waiting on Logan (§2l):** should "complete + protein floor" outrank freshness in the Cook
Tonight ranker? Replaying run 47 shows the trade exactly. Do not build either way without his call.

---

## 2. DECISIONS ALREADY MADE — do not reopen without new evidence

Made today:
- **PRELAUNCH.md is the only list until launch.** Handoffs point; memory records facts; todos.md is frozen.
- **Daily report = an email from Claude's scheduled task** (Gmail → Logan), not Loops and not a push. The DB
  cron `ops-daily-report` is LOG ONLY. Exactly one message a day. Sectioned HTML (TO FIX / MOST DISLIKED /
  singles). Rejected: push (APNs works now, but Logan prefers email), Loops (he did not want it).
- **The Discover hero stays "newest unseen", not "most liked"** — popularity is a post-launch SHELF (§2m).
- **Only the All feed records the day's hero**; chips show their own best match without writing it.
- **Card time = busy minutes + the wait as a word.** A waiting dish's pill takes its OWN ROW on Discover
  cards. Shrinking the font to fit one row was ruled out: it needs ~6pt against 10pt pills.
- **Detail time = ordered phases with arrows**, in the MODEL's list order plus one rule ("a Creami base is
  frozen BEFORE it is spun"). A per-phase step-number sort was tried and REVERTED — measured 3-4 of 24
  misordered against 1 of 24.
- **NEW TODAY placement = random, seeded by the day, inside the first page.** Rejected on device: new-first
  (stacked at top), plain alternation (every new card in the right column — the grid is 2-up), checkerboard.
- **Discover's cache holds the FULL pool** (`full: true`); a 60-meal slice opened every visit on 2 shelves.
- **Dislike sheet:** no extra question; flavour row inside the taste step; neutral chips (water, oil, salt,
  spray) filtered. Nothing acts on flavours automatically yet — the report is where a pattern would show.
- **Cook Tonight ranker order: clash → fresh → tier → fit.** Tier counts "no carb base" and "under 75% of
  the protein target" equally. Freshness-vs-tier is the one OPEN question (above).
- **Flavour:** flavoured-vs-plain GATING stays dead (the morning's measured zero). The savory clash —
  protein powder or a sweet-flavoured product in a savory dish — is a separate, narrow check with its own
  evidence (the rice soup; 1 flag in 113 meals, no false positives).
- **Ice and water are 0 kcal** in macro correction, and ice is an assumed staple on the client.

Carried from the morning, still true:
- Protein "Stage 2" (ban absent food like penne) is DEAD by its own test.
- Discover keeps the day-keyed shelf rotation; no "Today's picks" shelf.
- "Almost in your kitchen": at most 2 missing AND hold at least as many as you lack; below 2 recipes, no shelf.
- Yogurt variant swap + macro recompute: not now (Logan).
- **Never paste `CRON_SECRET` into chat, never rotate it.** Vault `cron_secret` must equal it.

---

## 3. MECHANISMS BUILT OR LEARNED TODAY

- **Force-run the pipeline without adding recipes:** the cron's own `net.http_post` with `?refresh=true&dryRun=true`,
  the Bearer from `vault.decrypted_secrets` (`cron_secret`), `timeout_milliseconds := 180000`, fired via
  `npx supabase db query --linked --file`. Read `net._http_response` through the CLI and parse in PYTHON with
  `json.JSONDecoder().raw_decode` — the body can hold lone surrogates that make Postgres `::jsonb` fail, and
  the CLI appends text after the JSON. The dry-run funnel carries `timeSample` (times + phases per recipe).
- **`backfill-trending-times` modes:** default (time split), `mode: 'phases'` (orders FIXED totals),
  `mode: 'translate'` (repairs untranslated step detail). All dryRun-by-default, resumable.
- **Cook Tonight funnel:** `pipeline_runs` where `provider = 'generate-meals-funnel'` — `rankCandidates`
  (complete/tier/clash/repeat/fit per dish), `incomplete`, `pantryCarbsOffered`, `notCookableMissing`,
  `savoryClash`, `macros` (per-ingredient FatSecret traces — the MATCH NAME, not the recipe's ingredient).
- **The Supabase MCP connects as `supabase_read_only_user`.** A read-only function it must call needs an
  explicit `grant execute` to that role (done for `ops_report_data`); anon/authenticated stay revoked.
- **`scripts/simulate-daily-report.sql`** — ~53 dislikes from existing accounts, runs the REAL report, then
  RAISEs so everything rolls back. Use it to re-test any report format change.
- **Expo push:** HTTP 200 even when it rejects the push — read `data.status`; delivery receipts via
  `POST exp.host/--/api/v2/push/getReceipts`. APNs key set up with `npx eas-cli credentials -p ios`
  (`eas.json` added for it).
- **Preview a day-rotated Discover layout:** `DEV_DAY_OFFSET` in `app/(tabs)/discover.tsx` (dev builds only).
  Shifts the hero too. Revert to 0 and never commit.
- **Pre-push AI review fails open** — the hook says "Fix: claude auth login" while `claude auth status` in a
  shell says logged in, so it is the hook's environment (§2l).

**Mistakes made today, worth not repeating:** shipped the Discover card label without computing the 157px
row (23 of 23 waiting cards fell back to a bare word); alternated new recipes without thinking about the
2-column grid; read FatSecret's match label ("Vanilla Whey") as the recipe's ingredient. Each was caught only
because Logan looked at the phone. **Measure the layout, check the grid, read the recipe row — not the trace.**
Measuring before shipping DID catch four others: flour-as-base false positives (on 76 real meals), a
degenerate "random" hash (by sampling 8 days), the translation detector (exactly 6 of 219), the savory clash
(1 of 113).
