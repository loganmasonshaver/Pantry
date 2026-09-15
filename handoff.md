# Handoff — 2026-09-15 (12:55 CDT / 17:55 UTC)

Replaces the 2026-09-14 handoff. `git log d8f52d6..HEAD` carries the reasoning for all 29 commits.
**The to-do list is `docs/PRELAUNCH.md`, and only PRELAUNCH.** This file holds order, mechanisms, and
decisions not to reopen. Start at §1.

**State:** everything pushed (the only uncommitted files are `skills-lock.json` + the 9 Higgsfield
skill dirs, another session's — leave them). **Tests 654** (`node --test lib/*.test.ts
supabase/functions/_shared/*.test.ts`), **tsc 135 / 16 app-code**. Four migrations applied today
(`…173237` last_confirmed_at, `…173554` its backfill, `…174602` recategorise, `…174909` cron
timeout) — `bash scripts/preflight.sh` should show the ledger in sync. **One edge function
deployed this session: `generate-trending-meals` (2dcea32, the wall budget)**; preflight's other
`?` lines on functions are the pre-existing ones. Metro: THREE
instances from the main repo — **the device build is on 8081** (`expo run:ios --device`, PID 51570),
8082 and 8083 are idle `expo start`s that should be closed. Logan's phone is a dev build reading
8081, so a pushed change is on it after a reload (`r` in that terminal); the earlier "stale bundle"
scare was caches that needed one warm-up pass, not a stale server.

**Pre-launch, no users.** Logan is the only person who has used the app.

---

## 1. FIRST — the Discover cron FAILED both days; the fix is in, the test is tomorrow 08:00 UTC

The Sep-13 handoff's one open question. **Sep 14 and Sep 15 scheduled runs stored 0 and wrote no
`pipeline_runs` row.** `cron.job_run_details` says "succeeded" for both — that only means
`net.http_post` QUEUED the request. `net._http_response` for the Sep 15 run: `timed_out = true` at
5003 ms (pg_net's DEFAULT 5 s; Sep 14's row is already purged by pg_net's TTL). The health check
at 08:20 found 0 on Sep 15 and got "Gateway Timeout" reading the table on Sep 14.

What changed underneath: a run is ~85 s since attempts were unioned on 2026-09-13; the earlier
crons (Sep 5/6/10/11 stored 14/12/13/9) ran on after the 5 s disconnect and stored anyway. The first
two crons on the new code produced nothing. Whether the longer run dies with its client or overruns
the ~150 s edge wall budget (the function's own comment at `index.ts:1042` names it) could not be
told from here — **this session had no function-logs tool.** What was in reach: migration
`20260915174909` keeps the client attached (`timeout_milliseconds := 200000`; 30 s for the health
check), verified in `cron.job`. Side effect: tomorrow's `net._http_response` row will carry the
cron's real status and body for the first time.

**Dry run at 17:47 UTC on the then-deployed code: HTTP 504 `IDLE_TIMEOUT` at exactly 150 s, no
row.** So the plumbing fix alone was not enough — the function itself overruns the gateway's
150 s request limit. The loop had no wall budget: its own comment assumed "~70s a run, so five
attempts fit"; Gemini answers in ~45-50 s per call today (Sep 13: ~17 s). **Second fix, commit
2dcea32, DEPLOYED:** no attempt starts after 50 s, a call's timeout is clamped to end by 85 s,
`attemptsSkippedForTime` lands in the funnel. **Dry run on the deployed code at 17:54 UTC: HTTP
200 in 59 s, wouldStore 10, llmRaw [19], 1 attempt, 5 skipped, funnel row 793.** The cron will
now RETURN; yield depends on Gemini's latency that hour (one attempt = ~10 today). YouTube quota
used today: 3 of 7 — do not fire manual runs before the 08:00 UTC cron.

**PASS tomorrow = `net._http_response` status 200, not timed out, AND ≥ 12 rows for 2026-09-16, AND a
`pipeline_runs` row with `provider = 'Google'`.** Read it with:
```sql
select created, status_code, timed_out, left(error_msg,120), left(content::text,300)
from net._http_response where created >= '2026-09-16 07:59+00' order by created desc limit 3;
select generated_at::date, count(*) from trending_meals where trend_source='YouTube trending'
group by 1 order by 1 desc limit 3;
select id, created_at, stored, funnel->'llmRaw', funnel->'llm_Google'->'rejected'
from pipeline_runs where provider='Google' order by created_at desc limit 2;
```
If it RETURNS but stores under 12 because only one attempt fits, the next single variable is
per-call latency, not the budget: the provider list carries OpenAI as its second entry, and a
17 s call fits twice where a 50 s call fits once — measure `[stage] … t+ms` in the function
logs (dashboard) before touching `ATTEMPT_START_DEADLINE_MS` / `LLM_LOOP_END_MS`. If it does not
return at all, the tail (ranking, macros, images, insert) is over ~65 s and the remaining move is
to answer early and finish under `EdgeRuntime.waitUntil`. **Never widen the retention tolerance.**

## 2. What is verified vs not

**Verified on device (Logan, 2026-09-14):** Home's three-row Cook Tonight list, the fold at Breakfast
(+43pt), readiness line, empty-slot tap; the meal picker listing `meal_slots`; the food log screen
v1 (QTY keypad first tap, Done bar, pinned Log); the spinner fix (synchronous open from cache); the
Home cold-start flash fix; the "Per" row and Edit nutrition; the meal-log card (protein per row,
swipe-to-delete, totals); the in-Modal SafeAreaProvider fix ("verified, all good" on the search
screen). **Verified in the DB:** the correction machinery end to end on Logan's own account
(`fatsecret:800`, basis 244 g, serving 18); `pantry_items.last_confirmed_at` backfilled from
`created_at` (158/158); recategorisation applied (Other 30 → 1 overall, 0 for Logan).

**Not verified:** the Sep 16 cron (the wall budget is proven by a dry run, not by a scheduled
run); the Pantry tab rebuild (grouped SectionList, scan pills, status strips, the
"Still have these?" sheet) — tells in PRELAUNCH §6c; the 4/4/9 warning; the food-screen finish pass
(no duplicate "100 g", whole-gram prefill, Save gated, inline details, Delete entry); the redo row
under the cards. Expect **"54 items untouched for 3+ weeks"** on Logan's first open of the Pantry
tab — his pantry was scanned in July/August; that is honest, and "Keep all" exists for it.

## 3. DECISIONS ALREADY MADE — do not reopen without new evidence

- **Discover's attempt loop has a wall budget** (start deadline 50 s, loop end 85 s). A thinner
  union beats a run that never returns; the fix for a thin union is latency, not the budget.
- **The item's NAME decides its category** (`normalizeCategory`); the scan model's category is a
  tiebreaker among the aisles the name allows, and the answer only for a name the table cannot read.
  The table's own calls Logan may revisit: Salsa, Pickles, nut butters → Canned & Jarred; Maple Syrup
  → Baking; Protein Powder → Beverages (no Supplements aisle).
- **Corrections are entered per the LABEL's serving** ("Per 2 tbsp"), stored per ONE serving with the
  serving's weight as basis; weight portions stored as typed. A correction bridges ml↔g by ratio.
- **4/4/9 is a WARNING past 15% or 20 kcal, never a block** — beer, sugar-free, high-fiber foods are
  real and do not add up.
- **Whole grams in the correction sheet** (one decimal only below 1 g). No − n + stepper anywhere.
- **Delete is swipe-left** on Home's log rows and the Pantry rows; the edit screen has "Delete entry".
- **The redo lives under the cards** as text with the count, not in the header.
- **Every `<Modal>` that uses safe-area has its own `<SafeAreaProvider>`** — `lib/modalSafeArea.test.ts`
  fails the suite otherwise. Six modals had the bug; it is intermittent, which is why it kept
  coming back.
- **The meal picker lists `profiles.meal_slots`, nothing pre-selected, no "+ Custom meal".**
- **Centred-ring macro card: deferred** until Logan has seen the ring with data in it (PRELAUNCH §6c
  has the break-even variant with numbers).
- **Home's readiness line waits for the pantry** (blank placeholder of the same height).
- Never paste `CRON_SECRET` into chat, never rotate it. 100% ingredient retention in Discover is a
  product requirement, never a tuning knob.

## 4. MECHANISMS — the exact tells

- **The Supabase MCP SQL tool is READ-ONLY.** `UPDATE` is refused (25006). Data fixes go through
  migrations (`npx supabase db push`, and `ls supabase/migrations` immediately before). Commit
  964a183 claimed a backfill via MCP that never ran; 3fbbb93 is the real one.
- **`add column … default now()` stamps EVERY existing row with the migration's moment**, so a
  same-file `where col is null` backfill matches nothing. Backfill by value; CLAUDE.md gotcha 6.
- **Which Metro is the phone on?** `lsof -nP -iTCP -sTCP:LISTEN | grep 808` → the `expo run:ios`
  process is the one. To prove a change is servable: `curl "http://localhost:8081/node_modules/
  expo-router/entry.bundle?platform=ios&dev=true&minify=false" | grep -c '<marker string>'`.
- **Dry-run Discover:** `generate-trending-meals?refresh=true&dryRun=true` with the `sb_secret_` key
  as bearer (`npx supabase projects api-keys --project-ref fdafjnkqqtpsjtddbfdz --reveal`, captured
  into a shell variable, never on disk, never printed). YouTube quota: 7 runs a day, resets at
  midnight Pacific; dry runs cost the same.
- **Caches the app now keeps on disk** (all user-stamped except the food records, which are
  FatSecret's and shared): `pantry_food:<id>`, `pantry_overrides:<uid>`, `pantry_recent_foods:<uid>`,
  `pantry_day_logs:<uid>:<date>`, `pantry_week_logs:<uid>:<week>`. First use writes them; the
  second use is the fast one — a "nothing changed" report right after a cache change is usually
  the warm-up pass.
- **Correction lookups are a map**, `hooks/useMacroOverrides.ts`; every write goes through it.
- **`pantry_items.last_confirmed_at`** — every write that touches an item resets it; stale = in
  stock AND 21+ days (`lib/pantryAge.ts`).
- **The 8081 bundle, tests, and tsc delta are the gates**; the tsc DELTA caught a duplicated style
  key, dead branches inside a new guard, and a JSX comment in a ternary this session — each a real
  defect, none an error-count change worth ignoring.

## 5. Mistakes this session worth not repeating

- **Reported a backfill as applied when the tool had refused it** (964a183). The commit was written
  before the result was read. Read the result, then write the message.
- **Watched the wrong Metro** (8082) for hours while the phone was on 8081. Check `lsof` first.
- **A tell built on a row that was not Logan's** ("~148 kcal"): the correction belonged to a test
  account. Check `user_id` before promising a number.
- **A commit message with a remembered test count** (649 → 650; it was 645). Paste the number.
- **Migration with `default now()` and a null-check backfill** — every row read "confirmed today".
- **A readiness placeholder with 0 height**, so the card still jumped. Placeholders need the size
  of what they hold.
- Two syntax breaks (a JSX comment inside a ternary; a duplicated style key) — both caught by the
  gates before commit, which is the point of running them every time.
