# Handoff — 2026-09-17 (early morning, CDT)

Replaces the 2026-09-16 evening handoff. Reasoning for every change is in `git log de97a46..HEAD`.
**The list is `docs/PRELAUNCH.md`.** Every item below also lives there; pointers are `§section · "searchable
title words"` because line numbers move. Logan asked for this handoff to carry every unverified item,
everything planned but not built, and what testing needs.

---

## 0. State right now

- **Git:** all work committed and pushed. Uncommitted and not ours: `skills-lock.json`,
  `.claude/skills/higgsfield-*`; `.claude/launch.json` is the preview config (`metro-fresh`).
- **Metro is NOT running** (the session restart killed it). Start it before any device test:
  preview_start `metro-fresh` (port 8081). The phantom check reads its logs from Metro, so the session
  that analyses the scans must be the one that started Metro.
- **tsc 139 / app-code 16** (was 135: +4 Deno/esm.sh lines from the new `swap-meal`; CLAUDE.md updated).
  **Tests 731** as of the Discover session's last commit `6f05b61` (`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).
- **Discover session (2026-09-16 → 17 evening) is in §5 below.** `generate-trending-meals` deployed =
  `6f05b61`; Discover client changes `54c7fbc` `fade012` `f44eaef` are NOT in any device build yet.
- **Deployed this session:** `generate-meal-image` (per-phase `[timing]` logs; user requests get the link
  before the cache write), `generate-meals` (`withSpares` → 3 spares in `meal_spares`; also shipped the
  other session's `7f109c8` after its patterns flagged 0 of 180 Cook Now ingredient names), `swap-meal`
  (new).
- **Migrations applied:** `20260917054742_restock_pantry_items_rpc`, `20260917063311_api_keep_warm_cron`,
  `20260917064945_meal_spares`. `meal_spares`: RLS on, no policies, no anon/authenticated grants (checked).
- **Vault:** new secret `anon_key` (read by the keep-warm cron). **Cron:** `api-keep-warm` every 2 min.
- **LaunchAgent:** `com.kobalabs.pantry-db-backup`, 04:30 local → `~/Backups/pantry-db` (log:
  `backup.log`). Manual run and launchd kickstart both succeeded (7.0 MB data, 55 tables).
- **Scheduled task:** `weekly-ai-model-digest` — Mondays ~9:15 local, HTML email, ANY vision model vs
  gpt-5.4, every claim tagged High/Med/Low. First run and a format test email were sent 2026-09-17.
- **Logan's account:** `scan_usage` rows for pantry / meal_gen / image_gen deleted ~02:10 CDT for the
  phantom check — and still empty at handoff, i.e. **no phantom-check scan has run yet**.
  `ai_consent_accepted_at` re-stamped (consent test). `promo_active = false`, sandbox subscription
  (unchanged from 2026-09-16).

---

## 1. Needed for testing

### 1a. The phantom 5-scan check — IN PROGRESS, not started (§3 · "DECIDE: keep the review screen")
Decides whether the scan review screen is removed. Logan does, one at a time, from the **Pantry tab**:
1. Fridge main shelves → 2. fridge door → 3. freezer → 4. pantry shelves → 5. counter in dim light.
On each review: **uncheck anything not really there** (wrong food counts as not there; right food, wrong
variety stays checked), optionally type in misses, **Add all → "Maybe later"**.
Analysis (Claude): pull `[scan-items]` / `[scan-labels]` from Metro; phantom rate overall, for anchors
(protein / carb / main produce / leftovers) and by confidence band (30–59 / 60–79 / 80–100); then for each
scan, see whether meals built from ONLY that scan's items use an unchecked item as a main ingredient.
That new-user case cannot go through generate-meals' `?dryRun=true`: it requires the service-role key as
the bearer, which is not on this Mac (Supabase secrets are write-only; Vault holds only `cron_secret` and
`ops_user_id`). Workable routes: a fresh Gmail +alias test account whose first scan IS its pantry (memory
`reference_paywall_on_device` — the sandbox subscription follows the phone), or Logan pastes the
service-role key into a local, uncommitted env var for the run. Either way, count meals whose main
ingredient was unchecked.
Decision: anchor phantoms ≈ 0, overall ≤ 5 %, 0 broken meals for a new user → **remove the review**;
phantoms cluster under one confidence line (≤ ~15 % of items below it) → **short "Double-check these N"**
or raise `SCAN_CONFIDENCE_FLOOR` (server setting, currently 30); spread across high confidence → keep the
review and fix the scan first. Never the 77-item wall.

### 1b. Built this session — verify on device (tell = how to know)
| What | Tell | PRELAUNCH |
|---|---|---|
| Restocks in one request (`restock_pantry_items`) | next scan's Metro line `pantry save: … restocked in` well under 1 s (was 6,825 ms) | §3 · "the Add-all spinner sat 8.1 s" |
| Photo link before the cache write | next scan's `photo URL back in` drops ~3 s; edge logs show `[timing] REPLIED` then `OK` | §3 · "the photo link returns before the cache write" |
| Plating wait = the scan story (step C) | tap See what you can cook within ~10 s of review → story, then deck with photos; wait 30 s first → no plating screen; Maybe later during plating → next scan doesn't open on it | §3 · "(C) BUILT" |
| No second blank photo wait on the reveal | only when photos are slower than the 25 s cap: deck appears ~1.4 s after the reveal starts, cards fill in | §3 · "the reveal waited ANOTHER 20 s" |
| Consent answer cached on the phone | reload, go straight to Pantry, tap Scan → no pause (first launch after the change still waits once) | §3 · "waited ~3 s for the AI-consent check" |
| Home polish: meal-log photos, bigger type; Browse Discover only at the cap | Home → rows show a 44 pt photo (utensils tile when none); nudge shows "Not feeling these? ↻ New picks" until the cap; look for an old Discover log with a 16:9 thumbnail (centre-crop) | §3 · "Home polish" |
| Spares saved server-side | after the next Cook Now generation, `meal_spares` has ≤ 3 rows for Logan and the funnel row's `sparesOffered` names them (swap-meal untested until the swap UI exists) | §3 · "SERVER HALF BUILT + DEPLOYED" |
| Nightly backup | tomorrow `~/Backups/pantry-db/backup.log` shows `backup ok`; **a restore has never been tested** | §3 · "free nightly database backup" |
| Weekly digest format | Logan checks the "(format test)" email in Gmail dark mode: tags readable, table fits | §3 · "Weekly vision model digest" |
| Parallel meal-prefetch reads | measured 0.6 s and 1.2 s (was 1.5 s) — works; keep watching | §3 · "now parallel (2026-09-17" |
| Home shows the saved scan's meals | **VERIFIED by Logan 00:44** | §3 · "Home showed the PREVIOUS meals" |

### 1c. Open issues that need a device or a measurement
- **Camera ~1.1 s after a tap ~4 s post-launch** (Scan queued behind Discover's background preload).
  Tell: tap Scan with the app open 15+ s (expect ~0.45 s); repeat on a release build. §3 · "Scan tapped ~4 s after launch".
- **Froze once after tapping Continue on the consent prompt; not reproduced.** If it recurs:
  `idevicesyslog -p Pantry`, grep "Attempt to present" / "already presenting". §3 · "FROZE ONCE".
- **API cold-start stall (Free-plan Nano, ~250 MB swap).** Burst test after 15 quiet min: 3.70 / 3.83 s
  without the ping, 2.71 s with it. Re-run after the Pro upgrade. §3 · "INVESTIGATED 2026-09-17"; §2c · "New data point".
- **FAL once took 34 s for three photos** (released together; normal is ~1.2 s inference). Watch the
  `[timing]` lines' `fal1` and `falTimings1`. §3 · "PHOTOS TOOK 40 s".
- **Release build never measured** — settles the dev-vs-release numbers (API stall, camera delay,
  Discover tap-to-paint). §2c · "Confirm on a release build".
- **Cron/Discover checks for the 08:00 UTC run** (other session's work) — top of PRELAUNCH, "TOMORROW, 2026-09-17".

### 1d. Carried from earlier sessions — still unverified on device
- **Scan flow (§3):** review "add an item buzzed 5-10 times"; review "grouped by aisle … each aisle a card";
  "weekly scan limit is told up front"; "View recipe from the in-scan reveal" (tell 4 of the VERIFIED
  item); "previous scan's meals no longer flash"; "one image fetch per photo at a time"; "Walk the whole
  flow start to finish"; "Re-test the camera on device".
- **Subscriptions (§1):** "Draft Submission holds the group + Monthly + Annual" — attach to the 1.0
  version and submit together; leave Family Sharing off.
- **Cook Tonight quality (§0c, §2g, §2n, §2o, §2p):** structural vs garnish "Need:"; multi-serving meals on
  a 6-meal profile; run-48 fixes (slot coverage, `nameFormGaps`, calorie-dense shrinking); run-51 prompt
  rules (seasoning, step times/doneness/preheat/reheat, egg dishes need no carb, carb-ban protection);
  the pantry-limit protein line; knife work in ingredient names.
- **Home (§6b, §6c):** no dark gap between shimmer and photo; regenerated photos reach the device;
  "Log to which meal?" lists your slots; Daily meal log card; Pantry tab rebuild (two passes); Pantry tab
  load speed; multi-photo gallery pick; ✕ during a scan asks before discarding photos.
- **Food log screen (§6g):** mock v2 + 17 findings; the three follow-ups; "Per" row in Edit nutrition;
  finish pass; 4/4/9 warning; the modal safe-area class fix.

### 1e. Tools and prerequisites for testing
- **Scan / meal / photo limits:** reset SQL in memory `reference_scan_cap_reset_sql` (reset image_gen with
  meal_gen). Run with `npx supabase db query --linked "…"` (the MCP SQL tool is read-only).
- **Paywall:** memory `reference_paywall_on_device` — never Reset Onboarding on the main account.
- **Burst test (API cold stall):** after 15 quiet minutes, 50 parallel
  `curl -s -o /dev/null -w "%{time_starttransfer}\n" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
  "https://fdafjnkqqtpsjtddbfdz.supabase.co/rest/v1/trending_meals?select=id&limit=1"` via
  `seq 1 50 | xargs -P 50`; report median / fastest. `$ANON` from `.env` `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- **Edge-function logs:** the Management API `logs.all` endpoint (CLI token read from the macOS keychain
  item "Supabase CLI"; Logan approves the prompt) **retires Sep 23** — after that, the dashboard.
  Never print the token; mask whole lines, not values.
- **Scan timeline:** dev builds print `[perf]` marks and a `── scan timeline ──` block per scan.
- **pantry-eval** (`scripts/pantry-eval`): needs `OPENAI_API_KEY` locally (not on this Mac); 17 photos,
  only 3 with ground truth, drafted and never verified by Logan — label more before any model decision.
- **Release build:** `npx expo run:ios --configuration Release`.

---

## 2. Planned, not built

### 2a. Specced this session (build order)
1. **"Missing something?"** — one grey link under the reveal's deck, acting on the card in view (Logan:
   not on Home cards, not on the meal screen). Sheet: "What don't you have?" → chips for the meal's
   HAVE ingredients → Update marks the matched pantry rows OUT OF STOCK (needs `pantry-check` to return
   matched rows, not a boolean), "Marked missing · Undo", no alert → second state: **"Swap this meal"**
   (when `pickSpare` finds one) or keep it. Start photos for the top 2 spares when the sheet opens. Log
   `phantom_reported`. §3 · "SPEC (Logan + Claude 2026-09-17)" item 1.
2. **Swap wiring (client):** `replaceMeal` in `useMealSuggestions` (same card slot, meal cache rewrite,
   bus publish so Home swaps too), `recordSpareSwap` fire-and-forget, hold the swap until the spare's
   photo is on the device. Server half is deployed (`meal_spares`, `swap-meal`, `lib/mealSpares.ts`,
   `lib/spareChoice.ts`). §3 · SPEC item 3.
3. **Pantry tab "From your last scan · N items · Review" card** (24 h or until opened) and the **Edit
   sheet** it opens (same sheet as the reveal's "N items added · Edit" if the review goes): remove (NEW row
   → delete; RESTOCKED → back to its prior in_stock, so the save must record new vs restocked and the
   prior state), "Add something we missed", "Something off? Tell us" (LLM maps a sentence to edits, shown
   for OK). §3 · SPEC items 1b and 2.
4. **Remove the review OR replace it with "Double-check these N"** — only after the phantom check and
   only once 1–3 exist. §3 · "DECIDE".
5. **Step B — parallel per-photo vision:** rewrite the prompt's COUNT CHECK first; ship only if the wait
   drops ≥ 15 s with no phantom rise and ≤ 2 points recall loss (+20–25 % cost). POST-LAUNCH #2.
6. **Upgrade Supabase to Pro** (then Micro; Small if swap remains), rerun the burst test, remove the
   keep-warm cron. POST-LAUNCH #1 (Logan: after launch; Claude recommended at TestFlight).
7. **Replace `gpt-4o`** in `estimate-meal-macros` (primary, photo) and `parse-receipt` (fallback) before
   Snap & Log is switched back on. §3 · "before re-enabling Snap & Log".
8. **Camera-delay fix** (start Discover's preload only after ~2 s without a touch) — only if a release
   build still collides. §3 · "Scan tapped ~4 s after launch".
9. **Consent → scan modal handoff via the consent Modal's `onDismiss`** — only if the freeze recurs. §3 · "FROZE ONCE".
10. **Label more pantry-eval photos** before testing Gemini 3.8 Flash (the digest's first "worth testing").

### 2b. Planned earlier, still not built (pointers)
§2e trial reminder notifications (researched) · §2h scale instead of regenerating · §2i pantry variety
unlock (post-launch) · §2j Discover freshness signal (not specced) · §2m popularity signals (post-launch)
· §2n scan inside onboarding as a Superwall A/B (post-launch; MY-EXPERIMENTS Q2) · §4 "Skip onboarding"
paywall variant · §5 sentiment-gated rating prompt · §6d decided, not built · §7 onboarding trailer ·
§8 App Store screenshots · §11 TestFlight · §12 submission.

---

## 3. Decisions not to reopen without new evidence
- **Review screen:** lean remove (Logan saved 3/3 scans untouched), but only after the phantom check and
  after "Missing something?" + swap exist. Never the 77-item wall.
- **"Missing something?" placement:** one grey link under the reveal deck (Logan). Per-card and per-row
  versions were rejected as clutter.
- **Browse Discover** appears only at the generation cap (Logan).
- **Step D dropped:** meals reached the phone 0.1 s after insert; server-started photos save < 0.5 s.
- **Photo link before the cache write:** user requests only; the Discover pipeline still waits.
- **Keep-warm ping kept** (~30 % off the cold stall); it is not the fix. Batching does not shorten the
  shared cold wait — batch only screens with many sequential round trips.
- **Stay on Free until launch** (Logan); Pro is POST-LAUNCH #1.
- **Spares enter history only when swapped in** — an unseen spare in history would block it later.
- **Consent:** cached per user on the device; a failed read is not a "no".
- **`gpt-4o` is not a live v1 bug** — Snap & Log is off (`ENABLE_AI_PHOTO_LOG = false`).
- **Digest scope:** baseline gpt-5.4 only (Gemini flash-lite is just its fallback); any vision model
  (closed, open-weight via a paid API); HTML; confidence tags; max 3 "worth testing".

## 4. Mistakes worth not repeating
- **A value-regex mask printed a secret.** `PGPASSWORD="…"` was quoted, the pattern missed it, and a
  temporary 5-minute DB login reached the transcript. Mask whole lines, or pipe without printing.
- **Described the eval set without looking:** "18 photos, hand-labelled" was 17 photos, 3 labelled, never
  verified. Open the folder before describing it.
- **Called `gpt-4o` a live bug before checking reachability** — the feature flag had it off since May.
- **A missing `}` took the Metro bundle to 500** for a minute. Bundle-check after every edit (the check caught it).
- **Asked the user to test before the logging was on:** check the build is live (bundle 200 + reload)
  before handing over a test.


---

## 5. Discover pipeline — handoff from the Discover session (2026-09-16 → 2026-09-17 evening)

**Goal Logan set:** 12–18 clean recipes a day from the 08:00 UTC cron, no junk ingredient lists, right
shelves, repeats capped. **Where it stands:** PRELAUNCH top ("▶ TOMORROW, 2026-09-18") has the checks and
the results table; §0 has the reasoning; `git log 8417648..6f05b61` has every why. This section is only
state, tells, levers and decisions.

### 5a. State
- **Deployed:** `generate-trending-meals` = `6f05b61`. Shards ON (6 videos per parallel call, ≤ 5 calls per
  attempt; `_shared/attempt-budget.ts`). Model `gemini-3.1-flash-lite` — decided, see 5d. Photo step: 143 s
  in-run deadline + cron job 6 `trending-images-daily` 08:05 UTC (`?stage=images`, only rows without an AI
  photo). Cron jobs: 1 recipes 08:00, 6 photos 08:05, 2 health 08:20, 5 ops report 14:00, 7 keep-warm.
- **Client (needs a build to see):** page-wide family cap (`lib/dishFamily.ts`: 4 of a narrow family
  such as cheesecake/brownie/paneer, 10 of a broad one such as pasta/salad), `salads-bowls` shelf, and
  `lib/discoverPublish.ts` — a recipe does not show until its AI photo exists.
- **Data on the 17th:** cron 815 stored 18 (cap) in 130 s; forced run 827 (first real sharded) 13 in 45 s,
  3 junk rows deleted by Logan → **10 live for the 17th; pool 239**. 40 shelf moves + 5 repairs done by hand
  this week; the shelf rule in the prompt is one precedence (dessert → snack → cuisine → morning →
  salads-bowls → comfort; fusions take their sauce's cuisine).
- **Daily report email** failed on the 17th ("SSL certificate has expired" on the Mac at 9:06); Logan said
  ignore for today. The report row itself was built. Runs pane of task `pantry-daily-report-email`.

### 5b. How to run and read a run (exact)
- Fire (dry or real) with the CLI and the Vault secret — the MCP SQL role cannot decrypt Vault; memory
  `reference_fire_pipeline_run_from_sql` has the one-liner. Real = `?refresh=true`; dry = `&dryRun=true`;
  **replay** = `&replay=<pipeline_runs id>&dryRun=true` re-runs only the model stage on that run's stored
  candidates for ~1 YouTube unit (a full run is ~1,300; 7 a day). `&shards=N` and `&model=` are dry-only.
  Photos alone: `?stage=images` (no quota).
- **Read `pipeline_runs`, not `net._http_response`** (pg_net purges it after ~6 h and the keep-warm job
  buries it in minutes): `timing`, `attempts[]` (shardMs, errors), `llm_Google.rejected`, `rejectedDetail`,
  `droppedDetail` (src + got), `titleRepeats`, `compilationTitles`, `nonRecipeTitles`, `dishListTitles`,
  `nameTranslationChecks`, `candidates` (the 18-52 titles the model saw). `cron.job_run_details` says
  whether a job fired.
- **A forced same-day run REPLACES the UTC day's rows** (swap-then-cleanup) and sees a THIN list: the
  morning's video_ids are in the 90-day guard, so the 17th's second run had 18 candidates where the
  cron had 52. Treat a forced run as a code check, never a yield measurement; yield is measured on the
  08:00 cron (fresh quota, searches rotate by day of year).
  **Corrected 19:10 UTC:** the thin list holds only for the FIRST forced run. The guard is a read of
  `trending_meals` and the swap hard-deletes, so replaced rows' videos become eligible again (46 of
  815's 52 are, right now). A further real run today would re-pick the morning's videos and delete the
  10 audited live rows. Same-day checks = `&dryRun=true` until append mode exists — PRELAUNCH ▶ item 10.
- **Every audit ends by reading each new row's first six ingredients by eye.** Both days, the counters
  passed and the junk was obvious to a human. Keep doing it until a week runs clean.

### 5c. Recurring issue classes → the lever, and how to prove a new rule before shipping it
| Recurs as | Lever | Proof before deploy |
|---|---|---|
| Junk ingredient lists (chapters, tag blocks, benefit bullets, link blocks, hashtags, meal slots, dish-name compilations, sauces-only lists) | `_shared/recipe-integrity.ts`: `NON_INGREDIENT_PATTERNS` (whole-line rules), `isDishList`, `quantifiedGhosts`; `_shared/title-dedup.ts`: `compilationTitle`; `nonDishName` for names | Export every stored row's ingredients (`npx supabase db query --linked … trending_meals`), run `isNonIngredientLine` / the new function over all of them: a rule may flag ONLY known junk. The "no quantities = not a list" idea was measured and rejected (3 of 5 real). |
| Repeats of pool dishes | Title filter before the model (`filterTitleRepeats`), containment name dedup, `dupVideo`, client family cap. The model ignores a do-not-pick list (measured) — remove repeats from its reach, don't ask. | Same-list replay before/after; `nearDup` counts. Repeat share grows with the pool; post-launch rotation is the real fix (memory `project_v2_meal_rotation`). |
| Thin day (< 12) | Candidates are the ceiling now, not the model: `afterIngredientGate` (52 → 18 stored 18 → 13). Levers left: search volume 13 → 26 (~2× quota, 3 runs/day, post-launch); STORE_CAP 18 (Logan's range; 26 and 30 kept were cut to 18 on the 17th). NOT the model (5d). | `llmRaw`/`llmYields` per attempt; if attempt 1 keeps most of what it sees, the list was the limit. |
| Wrong shelf / too much of one cuisine | Prompt precedence (index.ts, "SHELF_TAG — REQUIRED"), data moves guarded on the old tag; Indian share ≤ 15 % of a batch by ingredients (region bias `2d0a374` works: 26 % → 10 %) | Read `shelf_tag` per new row; the count query at PRELAUNCH check 5. |
| Untranslated names or steps | Names net (title OR language field + names copied word-for-word → separate translation call) and steps net; `nameTranslationChecks` shows each decision | Replay: every check with `copied >= 2` appears in `ingredientNamesTranslated` or `untranslatedDropped`. |
| Slow / 504 | Attempt budget (loop now ~20-30 s), image deadline, 08:05 photo step; a 3.8-Flash-class model does not fit (60-90 s per shard) | `timing.totalMs` < 150 000; `attempts[].errors` free of "aborted"/429. |

### 5d. Decisions not to reopen without new evidence
- **Model stays Lite; shards on.** Same-list replays 2026-09-17: Lite one call 19/15 kept in ~60 s; Lite
  sharded 30 kept in 26 s; 3.8 Flash 15 in 92 s (one attempt fits); gpt-5.4-mini 11 (116 of 139 with zero
  macros); gpt-4o-mini fallback works (7). Model variance on an identical list ≈ 4 recipes — a one-day gap
  under that is noise. Untested lever if ever needed: 3.8 Flash with thinking off.
- **100 % ingredient retention stays a product rule** (CLAUDE.md) — never widen it for a thin day.
- **The dedup gates are right not to call Raspberry Cheesecake a repeat of Chocolate Cheesecake**; variety
  is the client cap's job, not the pipeline's.
- **Deletes of junk rows are Logan's** (the agent repairs, never hard-deletes); the SQL is always in
  PRELAUNCH next to the finding.
- **`net._http_response` is not the cron's record** (see 5b).

### 5e. Known gaps, deliberately left (all in PRELAUNCH ▶ TOMORROW item 9 / §0)
- Truncation guard reads a translated name as cut off ("paprika" ⊂ "Paprikapulver"; run 808, unbuilt).
- Non-Latin benefit lists (Telugu) become the source list and the recipe is lost — correctly rejected,
  but a 2.7M-view dosa is gone; no rule can read every script.
- `nearDup` at Jaccard 0.7 is harsh on 3-vs-4-word names ("Chocolate Protein Ice Cream" vs "Chocolate
  Strawberry Protein Ice Cream", rejected three times); left because the family cap hides a 17th ice cream.
- Generic names slip the prompt ("Breakfast Bowl", "Salad Bowl" live); variety, not junk.
- STORE_CAP cut 26 → 18 and 30 → 18 on the 17th; raising it costs ~$0.003 a photo per row — Logan's call.
- The "Mexican Tuna Salad" title repeat is borderline (a variant of pool "Tuna Salad"), kept as is.
