# Pantry — Official Pre-Launch Checklist

**This is the canonical list.** When Logan asks "what's next for pre-launch", answer from this file.
Everything else in `~/my-briefing/todos/active.md` is either post-launch or stale until triaged —
that list was reviewed on 2026-08-30 and ~80% of its non-checklist items were stale.

Ordered by what should be done first. Later items depend on earlier ones.

---

## ▶ TOMORROW, 2026-09-17 — every cron + Discover check, in this order  *(Logan 2026-09-16: "anything left to verify with the cron and Discover goes at the top")*
The 08:00 UTC cron (3am CDT) is the FIRST scheduled run of everything shipped on Sep 16, on the
CURRENT model (`gemini-3.1-flash-lite`, shards OFF):
- **pipeline** (`3deb55d` … `303f098`): retry on the untried tail; compilation, non-recipe and
  title-repeat filters; parser fixes (emoji macro lines, "= N g protein", oat flour); junk-list gate;
  attempt budget + image deadline; ONE shelf rule incl. the fusion / stir-fry / parfait / soup lines
  and the `salads-bowls` tag.
- **new 08:05 UTC photo step** (cron job 6, `?stage=images`).
- **app**: page-wide family cap `54c7fbc` · Salads & bowls shelf `fade012` · no recipe before its AI
  photo `f44eaef`.
- **data**: 40 shelf moves (24 + 16) and 3 junk-ingredient rows repaired or deleted.
**Do not change the model, turn shards on, or fire a manual run before 1-5 are read** — the result
must be attributable. Reasoning for each item: §0 below and the commit bodies. `<id>` below = the
08:00 run's `pipeline_runs` id (the first query in 1 returns it).

- [ ] **1. It ran, returned, and every recipe has its photo.** PASS = HTTP 200, `timing.totalMs` < 150 000.
  `select id, created_at, stored, funnel->'timing' timing, funnel->'attemptsSkippedForTime' t, funnel->'attemptsSkippedForList' l, funnel->'imagesSkippedForTime' img from pipeline_runs where dry_run = false and funnel ? 'rawCandidates' order by created_at desc limit 1;`
  `select id, created, status_code, timed_out, error_msg, left(content, 160) from net._http_response order by id desc limit 3;`
  (08:00 run, 08:05 photo step, 08:20 health check). The photo step's body reads
  `{"stage":"images","rows":N,...}`; `rows` 0 = the 08:00 run finished every photo. `imagesSkippedForTime`
  on the 08:00 row = FAL was slow and the deadline worked — not a failure if the 08:05 step finished them.
  A recipe without its AI photo is HIDDEN from Discover now, so this must return ZERO rows after 08:05:
  `select name from trending_meals where generated_at = current_date and (image is null or image not like '%/storage/v1/object/public/%');`
- [ ] **2. Yield, and where the rest went.** Goal ≥ 12; **expected 10-13** on this code.
  `select funnel->'llmRaw' raw, funnel->'llmYields' kept, funnel->'attempts' attempts, funnel->'llm_Google'->'rejected' rej from pipeline_runs where id = <id>;`
  `select d->>'attempt' a, d->>'kind' kind, d->>'name' name, d->>'why' why from pipeline_runs, jsonb_array_elements(funnel->'rejectedDetail') d where id = <id> order by 1, 2;`
  Tells: every attempt `provider` = Google (OpenAI only right after a Gemini attempt that returned
  nothing); `listSize` shrinks attempt to attempt; `dupName` + `dupVideo` ≈ 0 (retry-on-tail working);
  no `attempts[].errors` containing "aborted" (one = the 1.25x attempt estimate under-predicted). Read
  every `nameGap` note's `listed:` half — a copycat ("Low Calorie Nutella") or made-of dish ("Zucchini
  Tortilla") rejected there is a false positive to fix. Later attempts returning 0-2 raw on a fresh
  list = the model has nothing it wants in the tail → the ceiling is candidates or model → item 7.
- [ ] **3. The pre-model filters removed the right videos.** Read every entry of
  `funnel->'titleRepeats'`, `funnel->'compilationTitles'`, `funnel->'nonRecipeTitles'`. A single-dish
  video in compilationTitles, or a new dish in titleRepeats, is a false positive to fix that day.
- [ ] **4. The stored rows are clean.** Every query returns ZERO rows:
  `select video_id, count(*) from trending_meals where generated_at = current_date group by 1 having count(*) > 1;`
  `select name, i->>'name' from trending_meals, jsonb_array_elements(ingredients) i where generated_at = current_date and (i->>'name') ~* '^(high|low)[- ](protein|fib)|^(no|gluten[- ]free|dairy[- ]free)$|^(made|loaded|packed) with|^(perfect|great|good) for|thank you|save this|feedback';`
  `select t.name, p.name from trending_meals t join trending_meals p on p.generated_at < current_date and lower(t.name) like '%' || lower(p.name) || '%' where t.generated_at = current_date;`
  `select name from trending_meals where generated_at = current_date and name ~* 'meal plan|what i eat|protein powder$|spice mix$';`
  Parser fixes (`6b2fd9c`) — no rejected recipe's SOURCE list still counts a macro line:
  `select d->>'name', src from pipeline_runs, jsonb_array_elements(funnel->'llm_Google'->'droppedDetail') d, jsonb_array_elements_text(d->'src') src where id = <id> and src ~* '^[^a-z0-9]*[0-9.,]+\s*(g|kcal)?\s*(protein|eiwei|kohlenhydrat|fett|carbs?|fat|calories)\s*$|=\s*[0-9.,]+\s*g\s*protein';`
- [ ] **5. Every new row is on the right shelf.** The order, stop at the first that fits: dessert →
  snack (sweet or savoury) → savoury dish with a clear cuisine (a FUSION takes its sauce and staples'
  cuisine: paneer / schezwan / soya pasta → indian; a stir-fry with no clearer cuisine → asian) →
  morning food (incl. parfaits) → cuisine-less salad or bowl → american-comfort (incl. soups,
  sandwiches, lunch wraps). Read each:
  `select name, shelf_tag, category from trending_meals where generated_at = current_date order by shelf_tag;`
  Indian share of the batch, watch line ≤ 15%:
  `select count(*) filter (where shelf_tag = 'indian' or name ~* 'paneer|soya|dal|masala|dosa|paratha|chilla|vada|momos') indian, count(*) total from trending_meals where generated_at = current_date;`
- [ ] **6. On the phone.** Needs a build with `54c7fbc` + `fade012` + `f44eaef` (the Sep 16 00:01 release
  build has none). After any DB change, switch tabs and come back so Discover refetches.
  - Whole page: ≤ 4 cheesecakes, ≤ 4 brownies, ≤ 4 paneer dishes, ≤ 10 pasta; search "cheesecake"
    still finds all ~22. **Sep 18:** the four visible cheesecakes are DIFFERENT ones (daily rotation).
  - Shelves: Protein snacks has NO salads; Indian night holds Paneer Pasta, Lauki Pasta, Paneer Pizza,
    Paneer Manchurian, the momos, Green Butter Garlic Chicken, Konjac Noodles, Mexican Inspired Rajma
    Salad; Breakfast holds the chia puddings, smoothie/yogurt bowls and Greek Yogurt Berry Parfait;
    Comfort holds Creamy Tomato Tofu Soup, Tofu Sandwich, Ham and Cheese Protein Wrap, Pepperoni Pizza
    Skillet; **Salads & bowls** shows more than 2 salads WHEN it rotates in (6 of 12 shelves render a
    day — it may not appear on the 17th).
  - No card anywhere on a YouTube thumbnail; NEW TODAY badges on the cron's rows; no re-layout when
    the pool loads.
  - Daily report (~9:05 CDT) reads "Discover: N new recipes, all have photos".
- [ ] **7. Shards and model — BUILT (`303f098`), measured here, decided by the rule below.** Only after
  1-5 are read. Each is a same-list replay of the 08:00 run: ~1 YouTube quota unit, nothing written to
  Discover, one `pipeline_runs` dry row. Fire ONE AT A TIME (each ~1-2 min):
  `npx supabase db query --linked "select net.http_post(url := 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/generate-trending-meals?refresh=true&dryRun=true&replay=<id><EXTRA>', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)), body := '{}'::jsonb, timeout_milliseconds := 200000)"`
  - **A** `<EXTRA>` empty — Lite, one call per attempt: the baseline on this exact list
  - **A2** `<EXTRA>` empty again — the model's own variance on an IDENTICAL list (settles §2's "variance
    or defect" question for ~1 unit instead of ~10 full runs)
  - **B** `&shards=6` — Lite in parallel pieces
  - **C** `&shards=6&model=gemini-3.8-flash`
  - **D** `&shards=6&model=gpt-5.4-mini`
  - **E** `&provider=openai` — the real outage fallback (gpt-4o-mini), never exercised on this code
  Read: `select id, stored, funnel->'model' model, funnel->'shardSize' shards, funnel->'timing' timing, funnel->'attempts' attempts from pipeline_runs where funnel->>'replayOf' = '<id>' order by id;`
  and for each: `select count(*) filter (where t->>'name' ~* 'paneer|soya|dal|masala|dosa|paratha|chilla|vada|momos') indian, count(*) from pipeline_runs, jsonb_array_elements(funnel->'timeSample') t where id = <replay id>;`
  **Decision rule (set in advance, 2026-09-16):** turn shards ON by default (`SHARD_SIZE_DEFAULT`) if B
  stores ≥ A + 2 AND that gap is bigger than the A/A2 spread, it finishes well inside 150 s, and no
  `attempts[].errors` read as rate limits. Switch the model only if C or D stores ≥ 3 more than B on the
  same list, its Indian share stays ≤ 15%, AND it costs ≤ ~$7/month at one run a day (3.8 Flash ~$6
  paid, free tier exists; gpt-5.4-mini ~$7+). Otherwise stay on Lite. One day's list is one sample:
  repeat A-D on Sep 18's run before switching models — not before turning shards on. E passes if it
  returns 200 with recipes. Pricing checked 2026-09-16: "LEVER 3" in §0.
- [ ] **8. Known false positive to fix — the truncation guard reads a translation as a cut-off name.**
  Run 808 rejected "High Protein Cannelloni One-Pot" (3.5M views) because the model translated the
  German "Paprikapulver, edelsüß" as "paprika", which is a prefix of the German word, so
  `truncatedAgainstSource` called it truncated. It is the ONLY `truncated` reject in any funnel row
  that carries detail. Check tomorrow's: `select d->>'name', d->>'why' from pipeline_runs, jsonb_array_elements(funnel->'rejectedDetail') d where id = <id> and d->>'kind' = 'truncated';`
  Fix, NOT built: skip the check when the video declared a non-English language, or when the source
  line is one compound word the model translated. It does not widen retention — the ingredient is there.
- [ ] **9. The last unmeasured Aug 30 generation fix — the decimal parser (`561360e`).** A creator's
  "1.5 tsp" must not be stored as "5 tsp". On tomorrow's rows, compare any source line with a decimal
  (the `droppedDetail` `src` arrays and the videos behind stored rows) against the stored amount. Low
  priority; the other three Aug 30 checks passed on 2026-09-16 (see §2).

---

## 0. DISCOVER PIPELINE — yield collapsing, 13 → 9 → 5 → 2  *(Logan 2026-09-13: solve this with Fable 5.1, top of the list)*
**AUDIT 2026-09-16 (Logan: "only 3 meals showing") — the Sep 16 08:00 UTC cron stored 3.**
Plumbing held: `net._http_response` 261 = HTTP 200, funnel row 800, 3 rows at 08:00:53, all with
photos, whole run **58 s of the gateway's 150 s**. The pool is intact (233 rows visible in 30 days);
"3" is today's increment. Funnel: 640 raw → 445 dedup → 180 view floor → **48 sent** (normal-to-high)
→ attempt 1 Gemini **raw 9** → 3 kept (nearDup 3, nameGap 2, dropped 1) → attempt 2 **gpt-4o-mini**
raw 4 → 0 kept (noMacros 3, nearDup 1) → **attempts 3-6 skipped for time**. Variety: all three are
"Creamy … Pasta". What the audit found, in order of cost:
- [x] **2026-09-16, THE WHOLE DAY IN ONE TABLE — six runs on the same day's candidates, deployed
  code is `7c66a52`.** Every gate and number below is from `pipeline_runs` (`funnel.attempts`,
  `rejectedDetail`, `timing`, `titleRepeats`, `candidates` all persist now).

  | run | code | stored / would | what it showed |
  |---|---|---|---|
  | cron 800 | old | **3** | attempt 2 went to gpt-4o-mini; attempts 3-6 cut by a fixed 50 s deadline |
  | dry 803 | C/A/B `be54721` | 9 | 3 Gemini attempts; 12 of 24 raw were pool repeats at Jaccard 1.00 |
  | dry 804 | + do-not-pick list, break at 18 (`91126c8`) | 9 | list had **no effect** — same five repeats; no renaming backfire yet |
  | **real 805** | same | **10 LIVE** | 84 s; tail after the model: 1.7 s + 9.2 s images (reserve had been 55 s) |
  | dry 806 | + title filter, copycat/made-of, retune | 14 | **inflated**: 2 same-video pairs, 2 non-dishes, 2 renamed pool dishes |
  | dry 807 | + dupVideo, containment, notADish (`3fde183`) | 9 | gates right; 8 honest (Tiramisu Bites = 3rd rename of a pool dish, fixed in `7c66a52`) |
  | **real 808** | same + image deadline, parser fixes after (`05179ea`, `6b2fd9c`) | **9 LIVE** (8 after a hand delete) | 128.9 s: images took 29.8 s (9.2 s an hour earlier) — 21 s from a 504; 3 recipes lost to two parser rules |

- [x] **What is now enforced in code, all deterministic, all unit-tested (696 tests, tsc 135/16):**
  OpenAI only after a Gemini attempt that returned nothing · tail reserve 5 s + 1 s/recipe, attempt
  estimate 1.25× slowest (`_shared/attempt-budget.ts`) · union stops at STORE_CAP 18 · **title
  filter**: a candidate whose title contains every word of a pool name is removed before the model
  (16-19 of ~460 today, every one checked, all genuine; skips itself over a 40% drop share) ·
  **one video, one dish** (`dupVideo`) · **containment** name dedup (known name + ≤ 1 word; ball/
  bite/truffle one word; kebab/kebabs one word) · **notADish** on names and titles (meal plan,
  what I eat in a day, full day of eating, haul, hair/skin health; hashtags stripped first) ·
  copycat brands (Low Calorie Nutella) and made-of carriers (Zucchini Tortilla) no longer trip
  nameGap · pasta shapes and tuna species are synonyms.
- [x] **nameGap is NOT a lever — closed with data.** With the ingredient list captured on every
  reject, all three remaining on 807 were correct: the burrito "pasta" video's list has no pasta
  line, the tuna salad's has no tuna, the Korean beef bowl's is the sauce alone. The creators put
  the food in the video, not the description. Gate stays.
- [x] **SAFETY, from real run 808 (`05179ea`, DEPLOYED):** the image stage is bounded — no wave starts
  inside 8 s of 143 s, every image call aborts at 143 s, a row that misses keeps its YouTube
  thumbnail for the next run's self-heal (`funnel.imagesSkippedForTime`); the `pipeline_runs` row
  is written BEFORE images and updated after. Base reserve 5 → 10 s. Without this, 808's loop
  running to its 117 s allowance would have been a 504 with nothing logged.
- [x] **PARSER PRECISION, from 808 (`6b2fd9c`, DEPLOYED, replayed offline, NOT yet run):** emoji-led
  macro lines ("💪 43,1 g Protein") and "= N g protein" annotations are no longer ingredients — the
  cannelloni contract 14 → 11, the smoothie 10 → 5, both would have stored; oat flour counts as
  oats ("Marble Baked Oats"); a name ending in protein powder / spice mix is not a dish; hashtags
  and "most" out of titles (the 6M-view tiramisu balls now filtered before the model). On 808's
  candidates that is **+4 (9 → 13) with no widening of any tolerance.** The row "Homemade Desi
  Protein Powder" was deleted from today's live rows by hand (the new gate would have rejected it).
- [x] **MOVED to ▶ TOMORROW items 1-4.** ~~PASS: Sep 17 08:00 UTC cron.~~ HTTP 200 · `timing.totalMs` < 150 000 · every attempt Google
  unless one returned nothing · no two rows share a `video_id` · no name contains a pool name ·
  `imagesSkippedForTime` absent (present = the deadline did its job on a slow FAL day, not a
  failure). **Yield: 10-13 expected on this code; ≥ 12 is the goal.**
  `select stored, funnel->'timing', funnel->'attempts', funnel->'afterTitleDedup', funnel->'imagesSkippedForTime' from pipeline_runs where dry_run = false and funnel ? 'rawCandidates' order by created_at desc limit 1;`
  `select video_id, count(*) from trending_meals where generated_at = current_date group by 1 having count(*) > 1;`
- [x] **WHERE 808's 25 CANDIDATES WENT (the `candidates` list makes this readable per run now):**
  9 kept · 3 parser false rejects (fixed above) · 1 oat-flour false reject (fixed) · 4 correct pool
  repeats (2 tiramisu videos, paneer pasta — 2 of them now caught by title before the model) · 1
  correct nameGap (a "Korean beef bowl" whose list is the sauce alone) · **7 never picked, 5 of
  them compilations** ("3 snacks in 5 minutes", "7 ready-to-eat snacks", "6 ladoo", "my
  smoothies", "4 soya recipes" — the last yielded one generic pick). Later attempts spent ~25 of
  39 picks re-asking about videos already kept or terminally rejected.
- [x] **1 + 2 BUILT + DEPLOYED (`3deb55d`; Logan: "lets do 1 and 2 then 3 if theres still problems").
  NOT RUN — quota spent. Sep 17's cron is the first measurement.**
  1. **Retry on the untried tail.** A video retires when kept, or rejected as a pool/in-run repeat,
     duplicate name or ingredient set, not a dish, or a name gap the CREATOR's list shares
     (`nameIngredientGaps(name, srcList)`); `dropped` and model-caused gaps stay in play. Attempts
     2-5 build their prompt from what is left (`nextAttemptOrder`, tested), the count/target in the
     prompt follow the shorter list, and the loop stops under 3 videos
     (`funnel.attemptsSkippedForList`). `funnel.attempts[].listSize` shows the shrinking list.
     **Tell on Sep 17:** `dupName` + `dupVideo` ≈ 0 and later attempts' `listSize` well under
     attempt 1's; if raw counts on later attempts fall to 0-2, the model has nothing it wants in
     the tail and the ceiling is the candidate list, not the asking.
  2. **Compilations out before the model** (`compilationTitle`: number + ≤5 words + recipes/snacks/
     meals/ways/ideas/…, or "my … smoothies"; `funnel.compilationTitles`). Sep 17: read that list —
     every entry must be a multi-recipe video; a single recipe in it is a false positive to fix.
  3. **DEFERRED — only if Sep 17 still stores < 12:** the model tier (`?model=` dry-run override,
     pricing check first) and candidate volume (13 → 26 searches). Logan's call, in that order.
- [x] **THE CEILING, after 808:** ~400-460 raw → 11-19 repeats + 3-6 non-recipes out by title →
  floor → **25-31 candidates with a list**, of which ~5 are compilations. The model picks ~15-18
  distinct; with today's parser fixes ~13 survive on a day like this. 12 is reachable most days;
  18 is not without a bigger list or a model that returns what it is asked for.
- [x] **VARIETY AUDIT 2026-09-16 (Logan: "a lot of cheesecake, brownie, paneer, salad bowls").**
  Live pool 238 rows. Scripts in the session; classification is by name regex, so ±a few.
  - **Desserts are the imbalance, not any one dish:** sweet-treat is 85 of 238 (36%), and 38% of
    everything added since Aug 31. Four forms are 55 of those 85: cheesecake 20, brownie 14, ice
    cream 13, mousse/pudding 8.
  - **Cheesecake 22** (blueberry ×6: plain, mini, lemon, donuts, yogurt, chia pudding; chocolate ×4;
    peanut butter ×3). Mostly OLD: 6/9/6/1 added per week over the last four. 12 left by Sep 30,
    1 by Oct 7. **Brownie 16**, still arriving at ~4/week. **Pasta/noodles 31 (13%)**, the biggest
    form and still growing (8 this week). **Salads 17 + ~12 savory bowls**; the pasta-salad family is
    7, and two near-identical tuna pasta salads came in TODAY.
  - **Why no gate stops it:** the dedup gates block the SAME dish, and correctly do not call
    Raspberry Cheesecake a duplicate of Chocolate Cheesecake. Replaying today's name gates over the
    whole pool blocks only 4 of 238. FORMAT_CAP is 2 per form PER DAY and nothing caps the 30-day
    pool; the client's ARCHETYPE_PER_SHELF spaces forms apart but never shows fewer of them.
  - **Options, unbuilt, Logan's call:** (1) client cap per form across the WHOLE page (e.g. 3
    cheesecakes visible, newest first, rest via search) — immediate, reversible, costs no yield;
    (2) pipeline form quota against the live pool (a form with ≥ 6 live rows goes to overflow) plus
    a dessert share ceiling — the real fix, but it COSTS yield on dessert-heavy days while yield is
    already 9-13, so it wants lever 3 first; (3) do nothing on cheesecake, which ages out by Oct 7,
    but brownies, pasta and salads are still arriving.
- [x] **OPTION 1 SHIPPED (`54c7fbc`; Logan: "lets do 1"): page-wide family cap.** `lib/dishFamily.ts`
  (7 tests): a family is any family word in the name; narrow families (cheesecake, brownie,
  tiramisu, ice cream, bites, paneer…) show 4, broad ones (pasta, salad, rice, wrap, pizza, soup…)
  show 10. Hero + personalised-shelf picks are pinned and counted; NEW TODAY next; the rest rotate
  daily. Search still reaches everything. Simulated on the live pool: 149 of 238 shown, desserts
  36% → 28% of the page, 0 new dishes hidden.
  - [x] **MOVED to ▶ TOMORROW item 6.** Tell: scroll Discover to the end of Everything else and count
    cheesecakes (≤ 4 on the whole page) and pasta (≤ 10); search "cheesecake" still finds all of
    them; tomorrow the four visible cheesecakes are different ones.
- [x] **JUNK INGREDIENT LISTS (`7f109c8`, DEPLOYED).** 3 live rows had benefit bullets or a creator's
  sign-off as ingredients; 2 came from real run 808. New whole-line claim rules; scanned against
  every stored ingredient name: exactly the 20 junk lines, zero false positives. Gelatin dessert
  (Sep 13) repaired in place.
  - [x] **DELETED by Logan 2026-09-16** (verified: 0 remain; today's live rows now 6) — the two Sep 16
    rows with no real ingredient list:
    `delete from trending_meals where id in ('d794e444-ac90-4fae-999e-4238ab387985', '0b2f069e-705e-41cc-8003-808536413708');`
    ("Oats and Paneer Savory Breakfast", "Soya and Corn Protein Breakfast")
- [x] **SHELF RULE (`a321d98`, DEPLOYED, unexercised until Sep 17).** The prompt had two rules that
  disagreed ("a cuisine wins" vs "cuisine first, otherwise…"). Now one order: dessert → snack →
  savoury cuisine → morning → american-comfort, with named examples for every collision seen.
  24 live rows moved under it with a guard on the old tag (list in the commit body, reversible):
  sweet-treat 85 → 70. Indian rows did not increase — 6 moved onto the Indian shelf from snack/asian.
  - [x] **DECIDED + BUILT (`fade012`; Logan: "your call"): a "Salads & bowls" shelf.** ~20 live dishes (tuna/pasta/egg salads,
    cuisine-less protein bowls) have no honest home: 8 sit on mediterranean, the rest on snack and
    comfort, and the rule's catch-all is a shelf titled "Comfort food, minus the guilt". Adding one
    = a 10th SHELF_TAG + title + prompt line + retag of those rows.
- [x] **LEVER 3 — BUILT as replay + `?model=` + shards (`303f098`); the test and its decision rule are ▶ TOMORROW item 7.**
  Pricing checked 2026-09-16 (ai.google.dev/gemini-api/docs/pricing): `gemini-3.1-flash-lite` free
  tier, paid $0.25/$1.50 per 1M in/out (current). `gemini-3.8-flash` free tier, paid $0.75/$3.75
  until Dec 31 then $1.50/$7.50. `gemini-3.1-pro-preview` NO free tier, $2/$12. At ~60k in / 50k out
  a run: Lite ~$0.09, 3.8 Flash ~$0.23 (~$7/mo, ~$14/mo from Jan), Pro ~$0.72 (~$22/mo).
  **Order:** (1) Sep 17 cron on the CURRENT model measures everything shipped today — switching the
  model tonight would make that result unattributable. (2) A `?replay=<runId>&model=` dry-run mode
  that re-runs only the LLM stage on a stored run's `funnel.candidates` (videos.list, ~1 quota unit
  instead of ~1,300) — same candidates, one variable. (3) Replay 808 and Sep 17 on Lite vs 3.8
  Flash; switch only if raw per attempt roughly doubles and the wall budget still fits.
  (4) Search volume 13 → 26 stays post-launch (halves the runs a day).
- [x] **FULL SHELF REVIEW, every dish (Logan 2026-09-16 evening: "why are many salads in protein
  snack?").** DB check first: `high-protein-snack` holds ZERO salads (24 rows: balls, bars, bark,
  bites, dips, crackers, Chicken Spread) — the three that were there moved to salads-bowls at
  `fade012`. The phone was showing an older pool: Discover refetches only on a tab return more
  than 5 min after the last fetch, and a pool that arrives while the tab is on screen is parked
  until the tab is left. Tell: switch tabs and come back (or relaunch), and salads are gone from snacks.
  Review result, 236 dishes: **sweet-treat, indian, high-protein-snack, american-comfort and
  salads-bowls are right** (the sweet shelf's problem is repeats, not misfiling). 15 still misfiled,
  APPLIED 2026-09-16 (Logan: "yes"; guarded on the old tag, 16 of 16 incl. Paneer Pasta) with the 4 rule gaps written into the prompt (`303f098`):
  - sweet-treat → breakfast: Greek Yogurt Berry Parfait · → high-protein-snack: Blueberry Cheesecake
    Yogurt, Strawberry Protein Cloud Bread
  - breakfast → american-comfort: Ham and Cheese Protein Wrap (a lunch wrap) · → mexican: Sweet Potato
    Chorizo Bowl (chorizo, Chihuahua cheese, pico; no eggs)
  - italian → indian: Lauki Pasta (paneer, schezwan, peri-peri masala), Paneer Pizza (moong dal crust)
    · → american-comfort: Pepperoni Pizza Skillet (beef + rice + pizza sauce; its twin Pizza Crunch
    Steak Skillet is already comfort)
  - asian → indian: Green Butter Garlic Chicken (paneer, garam masala — Indo-Chinese), Konjac Noodles
    (paneer + soya chunks) · → salads-bowls: Quinoa Edamame Chicken Bowl (soy sauce is not a cuisine)
  - mediterranean → american-comfort: Creamy Tomato Tofu Soup, Tofu Sandwich · → asian: Brown Lentil
    Cabbage Stir-fry
  - mexican → indian: Mexican Inspired Rajma Salad (rajma, paneer, curd, peri peri)
  Paneer Pasta moved to indian after all (Logan: "your call" — an Indian creator's desi pasta built on paneer);
  Black Bean and Corn Salad on salads-bowls; Chicken Spread on snacks.
  **Rule gaps these expose, for the prompt (same go):** pasta/pizza built on another cuisine's sauce
  or staples (schezwan, masala, paneer + soya) takes THAT cuisine; a stir-fry with no cuisine → asian;
  a soup or sandwich with no cuisine → american-comfort; a parfait → breakfast.
  After the moves: indian 26 → 32. Not more Indian food — the same dishes, off the Italian, Asian and
  Mexican shelves where they read as Indian food everywhere.
- [x] **THE 150 s LIMIT IS THE ARCHITECTURE, NOT A LAW (Logan: "can't we just extend that time?").**
  The whole pipeline runs as ONE HTTP request to an edge function. Supabase docs (checked
  2026-09-16, supabase.com/docs/guides/functions/limits): request idle timeout 150 s for every plan
  (no response by then = 504, what killed Sep 14/15); wall clock 150 s Free / 400 s paid; CPU 2 s
  (network waits do not count). Ways out, smallest first: (a) respond at once and finish in
  `EdgeRuntime.waitUntil` — escapes the 150 s response limit, still capped by wall clock, so it only
  buys time on a PAID plan (**plan not known to the agent — dashboard → Organization → Billing**; docs
  do not state a separate background-task limit, so verify with one run); (b) split into stages that
  each run as their own invocation (candidates → model → images) — no overall limit on any plan;
  (c) parallel model shards — shrinks the model step itself. With (a) or (b) the model choice is
  made on quality and cost alone, and the attempt budget + image deadline become safety nets.
  **DONE (Logan: "your call"):** (c) parallel shards, off until item 7 measures them, and photos as
  their own 08:05 step (`303f098`, cron job 6). (a)/(b) are not needed while the model step is short.
- [x] **INDIAN SHARE since the region change (`2d0a374`, Aug 30: keyword search scoped US/English)
  — the change worked.** Same measures before (Aug 17-30, 113 rows) → after (Aug 31-Sep 16, 125):
  Indian dish or creator 26% → **10%** (8% in the last 10 days); needs an Indian grocer (the
  commit's own measure: besan/poha/suji/atta/chana dal/methi/maida) 12% → **3%**; `indian` shelf
  12% → 6%. **"A lot of paneer" is the old rows:** 15 of the 24 paneer rows predate the change and
  all leave Discover by Sep 29; the live pool reads 18% Indian today only because they are still in
  it, ~10% by Sep 30 at the current rate.
- [ ] **Watch: Indian creators are still ~9-10 of 25 CANDIDATES** (run 808: Hindi titles, "desi",
  ladoo, sattu/ragi, soya compilations). Region is a bias, not a filter; most die as compilations or
  non-dishes. Raising yield (lever 3: bigger model, more searches) could let the share climb back.
  Before lever 3 ships, add the day's Indian share to the funnel/daily report, and decide the line
  (e.g. ≤ 15% of a batch, needs-Indian-grocer ranked last, matching `2d0a374`'s pantry-match reason).
  Measured per batch in ▶ TOMORROW items 5 and 7; the model decision rule includes the ≤ 15% line.
- [x] **"Only 3 meals showing" — no Discover-tab bug.** No today-only shelf; NEW TODAY badges are
  spread through the shelves; the pool (233 + today's 10, all with photos) is inside the client's
  30-day window. The "3" was the daily report line or three badges.
- **Ops notes:** the Supabase MCP role cannot decrypt Vault (`permission denied for function
  _crypto_aead_det_decrypt`); fire runs with `npx supabase db query --linked "select net.http_post(
  … vault.decrypted_secrets where name = 'cron_secret' …)"`. YouTube quota 2026-09-16: **6 of 7**
  used (cron, 803, 804, real 805, 806, 807); one left, deliberately unspent.
- [ ] **D. Parser: a method line was counted as an ingredient.** "Veggie Tofu Stir-fry Noodles"
  source list line 21 = "Sauté mushrooms dry till browned. Set aside." — contract 21 vs got 20.
  On 807 the same video PASSED as "Vegetable Noodles" (21/21), which almost certainly means the
  model echoed mushrooms twice to meet the count — so the stored row likely carries a duplicate
  mushrooms entry. Replay the description in a unit test; the fix is the parser not counting a
  sentence with a verb and a full stop as an ingredient. Never widen tolerance.
- [x] **AUDIT RERUN — Logan 2026-09-13, top of the list:** once the Sep 14 and Sep 15 crons have run,
      *(CLOSED 2026-09-15 as stale — Logan.)*
  do a full pass on Fable 5.1 over both stored batches and their `pipeline_runs` rows (they persist
  now): every fix below verified in production output, every failure kind in `rejected` explained,
  and NO new failure kinds. Methods in `docs/TRENDING-OPEN.md`. Quota is 7 runs/day; the audit
  should need at most 2 dry runs on top of the cron.
**2026-09-13 evening: ROOT CAUSES FOUND, FIXES DEPLOYED, PASS STILL PENDING (two cron days ≥ 12).**
The 16-day series is 4, 18, 4, 18, 11, 2, 15, 14, 12, 2, (outage), 13, 9, 5, 2 — not a decline, a coin
flip: a thin day every 3-4 days since Aug 29. Two mechanisms, both in code, neither the model:
- [x] **The retention count collapsed the very thing the contract asks for.** `countedIngredients`
  deduped by NAME, so a creator's "1/2 cup sugar" + "2 tbsp sugar" (two lines) became one entry
  whether the model split them or `recoverMergedIngredients` restored them — and the recipe was
  rejected for a shortfall it did not have. That is why production's `ingredientsRecovered` was
  always 0 (the model was complying, the count erased it) and why TRENDING-OPEN's "prompting
  failed" result was graded wrong. Now keyed on name + amount; an echo at the same amount still
  collapses.
- [x] **Recovery could not read creator wording.** Exact word-set identity missed "1 onion, cut into
  large dice" vs "onion", "thick fat-free skyr", "½ cup" (unicode fractions), "jalapeño". Rewritten
  as head-noun + subset matching with a prep/grade stop-list; a dropped "chicken stock cube" is
  still never absorbed by "chicken". All 8 recipes dropped on Sep 12/13 clear in unit tests.
- [x] **Attempts were raced, not unioned.** Best single batch of three: [0,3,5] stored 5. Now the
  union across up to 5 attempts, survivors-only dedup registration, cumulative counters, `llmRaw`
  per attempt in the funnel. A whole run is ~85s.
- [x] **The model is near-deterministic per prompt** — dry run 2 yielded [2,0,0,0,0], the same two
  dishes five times. Each attempt now rotates the candidate list (offset = attempt × ⌈n/attempts⌉)
  and `video_index` is mapped back; dry run 3 then yielded [11,6] from raw [20,23].
- [x] **Parser precision:** container dimensions ("External: 19 × 14 × 5 cm", "Shape:", "Capacity:")
  no longer count as ingredients; Turkish/Russian/Portuguese/Spanish headings stop the parse, and
  the stop regex uses `(?!\p{L})` instead of the ASCII-only `\b` (the Turkish cookies read every
  method step as food: 3 real ingredients, a 15-line contract).
- [x] **Found on the way: `parseQty` read "1/2 cup" as 12 cups (2,880 g), "½ cup" as nothing.**
  `leadingNumber` now reads fractions, mixed numbers, unicode fractions and ranges. It feeds
  `estimateMacros` (generate-meals + scale-recipe); a grams field there is normally "120g", so the
  app path is unaffected in practice, but it was wrong.
- [x] **REAL RUN 2026-09-13 20:35 UTC (Logan: "rerun for cron"): stored 12, 12 durable photos, 12
  source-verified, in 75s.** Replaced the morning's 2. The Apple Pie Cottage Cheese Cake is in with
  its three sugar lines at the creator's amounts (100g / 25g / 12g); the Kinder Bueno bowl has 15
  real ingredients and no dimension junk. `ops_report_data()` reads "Discover: 12 new recipes, all
  have photos" — the grey line. **Samples on the new code, same day's pool:** 13 and 2 (union only,
  before rotation), then 17, 12 (real), 10, 14 (with rotation; the last two from a pool the stored
  batch had already depleted to 31-32 candidates). Tests 591, tsc 135/16. YouTube quota: 7 of 7
  used today; tomorrow's cron draws a fresh bucket at 07:00 UTC.
- [x] **FOUND + FIXED the same evening: the funnel row was silently LOST on every rich day.** None of
  today's five runs wrote `pipeline_runs`; the crons of Sep 5, 6, 10, 11 (14, 12, 13, 9 stored) have
  no row either, while the thin days do. `stripBullet` split a two-glyph emoji bullet ("👨‍🍳") and
  left a lone UTF-16 surrogate in a source line; Postgres jsonb refuses it; the insert swallows the
  error by design. Fixed (u flag + `_shared/json-safe.ts` at every jsonb insert, including the
  meals batch, where one such string would have refused a whole day). Verified: row 679. **Read
  `pipeline_runs` before 2026-09-13 20:24 as an incomplete record.**
- [x] **FAILED 2026-09-14 AND 2026-09-15: both scheduled runs stored 0 and wrote no `pipeline_runs`
      *(CLOSED 2026-09-15 as stale — Logan.)*
  row.** Found 2026-09-15 17:40 UTC. `cron.job_run_details` said "succeeded" (= request queued);
  `net._http_response` for Sep 15: `timed_out` at pg_net's default 5 s; the health check read 0
  (Sep 15) and a gateway timeout (Sep 14). A manual dry run on the same code at 17:47 UTC:
  **HTTP 504 IDLE_TIMEOUT at exactly 150 s** — the gateway's request limit — no row. Root cause:
  the attempt loop had no wall budget ("a whole cron run takes ~70s, so five attempts fit
  easily", the code's own comment) and Gemini now answers in ~45-50 s per call (Sep 13: ~17 s),
  so five unioned attempts cannot fit. TWO FIXES, both live: migration `20260915174909` keeps the
  cron's client attached (`timeout_milliseconds` 200 s; health check 30 s) — side effect: the
  cron's real status/body now lands in `net._http_response` for the first time; and
  `generate-trending-meals` (commit 2dcea32, DEPLOYED) starts no attempt after 50 s, clamps a
  call to end by 85 s, and records `attemptsSkippedForTime` in the funnel. **Dry run on the
  deployed code at 17:54 UTC: HTTP 200 in 59 s, wouldStore 10, llmRaw [19], 1 attempt, 5
  skipped for time, funnel row 793 written.** So tomorrow's cron will RETURN; how much it stores
  now depends on Gemini's latency that hour — one attempt gave 10 today. Do not fire manual runs
  before the 08:00 UTC cron (7 YouTube runs/day; today used 3).
  **Read the Sep 16 result with the SQL in handoff §1.** PASS is unchanged at ≥ 12 on a scheduled
  run — but a 200 with ~10 and a funnel row is the plumbing fixed and the yield question back
  where it was; a 504 or a timed-out row is a new failure. If yield stays under 12 because only
  one attempt fits, the next single variable is the per-call latency: the provider list already
  carries OpenAI as the second entry, and a second attempt at 17 s fits where one at 50 s does
  not — measure `t+ms` in the function logs (dashboard; this session had no logs tool) before
  touching the budget constants. **Never widen the retention tolerance.**
- [x] **PASS = a scheduled 08:00 UTC run stores ≥ 12, two days running (now Sep 16 + Sep 17)**, and the
      *(CLOSED 2026-09-15 as stale — Logan.)*
  daily line reads "Discover: N new recipes, all have photos" in grey. Read `pipeline_runs`
  (`dry_run=false`): `llmRaw`/`llmYields` per attempt, `rejected.dropped`, `ingredientsRecovered`.
  If a thin day recurs, compare KINDS: low `llmRaw` on every attempt is the model, high `dropped`
  is the parser — never widen tolerance.
- [x] **BUILT + REPAIRED 2026-09-13 (Logan: "your call") — a whole cake stored as one serving.**
  `inferServings` in `_shared/macro-estimate.ts`: when `servings` is 1 and the batch computes to ≥ 2x
  the stated per-serving kcal, servings = round(ratio), capped at 16, and only if the two then agree
  within the normal 25% band. Changes the COUNT only — never an ingredient, never the stated
  macros. Runs before either macro branch in the pipeline; `servingsInferred` in the funnel. Replay
  of all 88 live one-serving rows: 9 change, every one a batch — cake 1→8 (3,346 vs 420 kcal),
  cheesecake 1→6, ice cream 1→4, pizza 1→3, flatbread 1→3, five bowls/loaves 1→2 — and the four big
  single bowls (Sukiyaki 1.73x, Lauki Pasta 1.67x, Pulao 1.62x, Cucumber 1.58x, Sweet Potato Beef
  1.43x) stay at 1. Those 9 live rows were repaired via REST the same evening (verify: no YouTube
  row with servings 1 computes to ≥ 2x). Was: Apple Pie Cottage Cheese Cake:
  1,637 g of ingredients, `servings` 1, 420 kcal / 12 g protein, `macros_source` 'model'. The model
  reported the creator's per-slice numbers and called the batch one serving; computed macros
  disagreed by ~7x, and on disagreement the code keeps the model's numbers and stores the row. In
  the live pool: 9 of 245 YouTube rows have `servings` 1 with more than 800 g of ingredients, and
  ALL 9 are `macros_source` 'model' (Chicken Rice Cooker Sukiyaki 1,579 g / 750 kcal; Lauki Pasta
  1,106 g / 740; Double Chocolate Protein Cheesecake 1,061 g / 278; Stuffed Chicken Caesar Sourdough
  958 g / 750; …). Pre-existing, not touched today. Deterministic fix, NOT built: when `servings` is 1
  and computed ÷ stated ≥ 2, infer servings = round(computed ÷ stated) — changes the servings count,
  never an ingredient (CLAUDE.md). Or reject. Needs the 9 rows replayed offline before trusting it.
- [ ] Residual drops seen today, deliberately left: "Rajma Dahi Kebab" 21/22 — the model omitted
  "Lemon juice" (a real drop; the reject is correct). "High Protein Corn Wrap" 7/11 and "Corn and
  Tuna Fitness Wrap" 8/11 — not inspected. `nameGap` 3-5 and `fractional` 2-4 per run are the
  next-largest losses after dedup; both are deliberate gates, but the fractional gate's offending
  items are not in the funnel — add them if it keeps costing 3+ a day.
- [ ] **Constraints, do not relearn:** YouTube quota is 10,000 units/day = **7 runs**, dry runs cost
  the same; run tests SEQUENTIALLY. Trigger a dry run with `?refresh=true&dryRun=true` and the
  `sb_secret_` key as bearer (`npx supabase projects api-keys --reveal`, never on disk) — the
  legacy service_role JWT is NOT accepted as internal. 100% ingredient retention is a product
  requirement — never widen tolerance to fill a thin day; the levers are candidate volume and
  parser precision (CLAUDE.md). Methods and standing procedure: `docs/TRENDING-OPEN.md`.

## 0b. RAISED BY LOGAN 2026-09-13 — the Chicken and Rice Soup  *(analysed; then Logan: "go build it, all 4 steps" — BUILT + DEPLOYED the same evening)*
Run 678 (20:04 UTC), Cook Now, target 40 g / 525 kcal, pantry 55 items. Shown: Bulgarian Yogurt and
Protein Shake, Greek Yogurt and Protein Cereal Bowl, Chicken and Rice Soup. The soup: chicken, cooked
rice, leafy greens, garlic, WATER, salt — "Dice chicken. Boil water with garlic and chicken 7 min. Add
rice and greens 2 min." Photo matches it exactly: cubed chicken, rice and wilted greens in clear water.
- **Is it a real dish?** Chicken and rice soup is universal (avgolemono, arroz caldo, the American one).
  THIS one is not one anyone cooks on purpose: water instead of stock, no fat, no acid, no pepper, no
  aromatic beyond garlic. It is the "plain grilled chicken + plain rice" diet plate the prompt bans, in
  a bowl. The pantry could have made a real one — soy sauce, lime, salsa, butter, peanut butter,
  shredded cheese, pad thai sauce are all on the shelf and the model used none of them.
- **Why it was shown — three mechanisms, none of them "the pantry is too small":**
  1. **The ranker is blind to flavour.** `flavourAxes` is computed AFTER `selectDeck` (index.ts 1307
     vs 1318) and only measured. The 7 candidates carried: Pan-Seared Chicken w/ Cauliflower 2 axes
     (tier 1, incomplete); Ground Beef and Potato Hash 2 axes (tier 0, worst calorie fit 0.706);
     Chicken and Pesto Rice Bowl 2 axes (umami + aromatic, tier 0, fit 0.028); Chicken and Rice Soup 0
     axes (tier 0, fit 0.002). The soup took the dinner slot over the pesto bowl on a 0.026 difference
     in calorie fit. All three shown meals: 0 axes. Last 10 days: 12 meals shown, 5 with ZERO axes,
     avg 1.33, against a prompt rule that demands ≥ 2. The daily line goes red only on salt/pepper
     absence, so a salted, flavourless deck reads as healthy.
  2. **The pool is exhausted.** 6 of 7 candidates were repeats (33 names in the recent window); cheese
     and egg were banned as overused. The one fresh dish was the shake. On repeats the ranker has only
     tier and calorie fit left to choose by.
  3. **The model strips real dishes to macro skeletons** when the targets bind — the same failure the
     prompt already names for protein quantity ("diet food wearing a recipe's clothes"), here for
     flavour. Nothing in code catches it.
- **Verdict:** the model is not inventing random dishes; it is picking real dish types and gutting
  them, and the ranker cannot tell. Logan's instinct is right, his hypothesis (pantry-only → made-up
  food) is the wrong cause.
- [x] **BUILT 2026-09-13 evening, all four steps** (`rank-deck.ts`, `flavour-axes.ts`, `dish-key.ts`,
  `generate-meals`, migration `20260913204647`):
  1. **Flavour ranks inside a tier, above freshness:** two-or-more axes, then one, then none, then
     fresh, then calorie fit. Sweet dishes are exempt (the name list, or a fruit/nut name with no
     meat or egg in it). Unit test replays run 678: the pesto bowl ships, the soup does not, the
     shake is not penalised, the incomplete pan-seared chicken still loses on tier.
  2. **The pantry's flavour shelf is in the prompt**, grouped by axis in the ranker's own vocabulary
     (`flavourShelf`, assumed staples included), with "water is not stock" spelled out. Funnel:
     `pantryFlavourOffered`.
  3. **Bans only ever take a protein or a carb base.** Cheese, cream cheese and peanut butter still
     detect as bases (a cheese dish repeats a cheese dish) but are never banned — the old rule
     "banning them costs the deck nothing" cost it its umami.
  4. **Daily report goes red on any savory meal shown with no flavour axis** (`savoryZeroAxesShown`).
  **Logan's real pantry, dry run on the new code:** shelf offered acid (BBQ sauce, lime, pickles,
  salsa, relish) · heat (ground pepper, hot sauce, chili powder, red pepper flakes) · umami (pad thai
  sauce, pesto, soy sauce, tomato sauce) · aromatics (garlic, onions, basil) · fat (butter, oils).
  Deck: Ground Beef Skillet with Garlic and Onions (3 axes), Cheesy Beef and Potato Skillet (2), a
  sweet porridge. Zero savory meals without an axis. Chicken was the one ban (overused — correct).
  **Sweep, 38 decks / 114 meals, before → after (compare KINDS; counts swing ±4):**
  savory meals with 2+ axes **57% → 76%**; with none 9% → 5%; harness "N flavour axis" soft flags
  49 → 28; **uncookable-kept 20 → 2** (before, the carb-heavy decks "met" the floor with dishes
  needing lean beef, chicken breast or protein powder the pantry did not hold — the shelf line keeps
  the model on what it has); under-protein-floor shown 17 → 25, concentrated in the carb-heavy and
  vegan pantries whose ceiling is below the floor (harness "pantry ceiling" soft flag 6 → 12) — the
  honest, cookable version of the same decks.
- [ ] **WATCH, not proven:** 4 hard protein misses after vs 0 before on pantries the harness says
  could have reached the floor (Black Bean and Cheddar Skillet 30g/41g; Egg and Black Bean Salad
  28g/70g; two vegan black-bean bowls 26g/46g). Tier still outranks flavour, so a floor-clearing
  candidate would have won — these are runs where the model returned none. Within the ±4 swing; the
  next sweep (RUNS=3) settles it. The daily line's own red threshold (>20% under floor) guards
  production meanwhile.

## 0c. RAISED BY LOGAN 2026-09-13 (evening) — 147 g of beef, "1 to shop for", a 696 kcal / 39 g plate  *(BUILT + DEPLOYED)*
Runs 758 and 759 (20:57, 20:58 UTC), his two generations after the flavour work. Old fixes confirmed on
both: the shelf line ran, `savoryZeroAxesShown` 0, every photo under a fingerprinted key, `unpreppedForms`
counting (1 per meal on "chopped cilantro / pineapple", "minced garlic" — the rule is only partly obeyed;
measured, not gated). The three things he saw share ONE root:
- [x] **FOUND: FatSecret priced raw meat as cooked.** `lookupMacros` took the top search hit; for "ground
  beef" that is "Ground Beef (Cooked)" at 276 kcal/100 g, for "chicken breast" a roasted entry at 195.
  A recipe lists raw weights, so meat carried 40-80% too many calories AND too much protein (140 g raw
  breast read as 273 kcal / 47 g; it is ~168 / 32). The cascade on run 759: the resize saw 924 kcal,
  cut the beef to its 0.7 floor because the "2 medium" potatoes are count-locked, the protein fell to
  39, and the card read 696 kcal — wrong in both directions. Fixed: `_shared/fatsecret-match.ts`
  fetches a page for a raw protein and takes the raw entry (then the first with no cooked-state
  word, then the top hit; generic over brand); an ingredient that names its cooked state keeps the
  top hit. Tested. Confirmed by the numbers on Logan's pantry (190 g beef → 38 g, chicken 140 g →
  ~30 g); the trace label appears on the next real generation's `macros` (dry runs do not store it).
- [x] **Protein now reaches the target where the food allows.** A SECOND pass after the calorie
  resize (`fundProtein`): when the plain top-up is stopped by the calorie ceiling, it cuts dense
  food first (rice, potatoes, oil — never a condiment, never a counted item, never below half) and
  grows the anchor, iterating because cut rice loses its own protein; tolerance 0.01 so 39 becomes
  40. Tier gains an "at target" point (0 = complete AND ≥ target; a complete 38 g dish now sits one
  tier down, not level). Funnel: `underTargetShown`. **Dry runs on Logan's pantry after: proteinShown
  [48,52,49], [48,52,46], [46,45,49]; 0 under target; calories 525-571.** Beef dishes reach 41 by
  funding ("diced red potatoes 110 g → 72 g; ground beef 177 → 197 g"). Physics, not a bug: 85/15
  ground beef needs ~215 g for 40 g of protein, ~460 kcal on its own, so a beef plate at 525 is
  beef-dominant and the ranker now prefers the chicken, egg-white and cottage-cheese dishes that
  reach the target with room to spare. A hard cut at 100% was rejected — on the vegan/carb-heavy
  sweep pantries it empties the deck; the tier ranks, the floor still shows something.
- [x] **Grams round to what a cook weighs** (`roundIngredientGrams`): ≥ 100 g to the nearest 10,
  20-99 to 5, below to 1; a protein anchor rounds UP and the macros follow it; a bare-gram visual
  ("147g") is rewritten to match, a measure ("¾ cup") is not. 147 g → 150 g.
- [x] **"2 ready now · 1 to shop for" over a dish short only of cilantro.** The client counted ANY
  gap. The server now sends `structural_missing` / `garnish_missing` (the split `findMissing` already
  made); `readySummary` counts structural gaps re-checked against the live pantry; the card reads
  "Need: X" for a structural gap and "Better with: X" for a garnish. **UNVERIFIED on device** — needs
  a Metro reload (JS only) and a generation carrying a garnish gap. Older cached meals lack the
  fields and fall back to any gap, as before.
- [x] Step-checks' "unseasoned" now uses `isSweetDish()`, so "Yogurt and Pineapple Power Bowl" is no
  longer counted unseasoned (it was, on run 759, and it feeds the daily line's percentage).
- **Sweep after (19 decks / 57 meals, one round):** savory 2+ axes 73% (76% before this batch,
  57% before the flavour work); under the floor 9 of 57 (the same rate as 17 of 114), all on the
  carb-heavy and tiny pantries whose ceiling is below the floor; uncookable-kept 0 (was 20 → 2);
  hard issues only the name-promise and duplicate kinds — no "could have reached the floor" miss.
  Every standard pantry shows all three meals at or over target; the 16 under-target meals are the
  ceiling pantries plus a few 44-49 g on vegetarian / messy-names / meal-plan. Raw pricing lowers
  every meat reading, so a 49 that used to read 55 is the honest number, and the tier ranks it.
- [ ] **Metro died twice today with no crash record visible** (Logan's terminal showed only the auth
  login; the first restart was a manual `expo start -c`, the second I started detached via nohup on
  8082, pid in the scratchpad log). Expo prints "Your project may not work correctly until you
  install the expected versions of the packages" on start — a pre-existing version mismatch worth a
  `npx expo install --check` before the next build.

## 0d. RAISED BY LOGAN 2026-09-14 — meat was priced COOKED, so every meat meal overclaimed protein  *(FIXED + VERIFIED)*
Run 784's trace read `Chicken Breast@195/100g`. That is the COOKED density; raw is 120. A recipe's
"150g chicken" is what the cook puts on the scale, and a cook weighs raw, so the card sold 47 g of
protein where the raw weight gives ~34. **Measured on Logan's own week: 26 of 75 meals carried raw
meat, averaging 45.8 g claimed protein.** A two-meat day finished ~22 g under a 160 g goal while the
app showed it met — the precise failure he called out ("going under is not fun"). Two more effects:
the calorie resize inherited the inflation and trimmed ~15% more food off the plate than it needed
to, and the at-target tier built on 2026-09-13 was ranking meat above dairy and egg dishes on a
phantom ~35% protein bonus (dairy and eggs are eaten in the state they are sold, so they were priced
correctly all along).
- [x] **The 2026-09-13 `pickFatSecretMatch` fix was only HALF a fix, and I reported it as done.** It
  ranks results by whether the NAME says raw or names a cooking method. It worked for beef (run 785:
  `Ground Beef (85% Lean / 15% Fat)@215/100g`, was `Ground Beef (Cooked)@276`) and did nothing for
  chicken, because FatSecret's generic "Chicken Breast" entry is cooked-weight by convention and
  says so nowhere. Verified through dry runs, which return a funnel WITHOUT the `macros` key — the
  trace is only in the `pipeline_runs` row, which dry runs DO write. Read the row, not the response.
- [x] **RAW IS NOW THE DEFAULT** (Logan's call, 2026-09-14). Three local-table rows carried cooked
  densities under unqualified names and are now raw: `chicken` 165/31 → **120/22.5**, `steak|sirloin|
  beef` 217/26 → **201/21**, `pork|chop` 242/27 → **231/21**. The cooked figures survive only on rows
  that NAME the state (`rotisserie|shredded|cooked chicken` 165/31, `chicken salad`, `bacon`, deli).
  `ground beef` (215/18.6), `ground turkey`, `salmon`, `shrimp`, `tuna` and the white-fish row were
  already raw and are untouched.
- [x] **Raw meat and fish are now priced from the local table, not FatSecret** (`tableReference()` in
  `_shared/macro-estimate.ts`, used by `lookupMacros`). The table's meat rows are curated raw, so they
  are the better answer here rather than a fallback. An ingredient that names its cooked state still
  goes to FatSecret — it IS the cooked food — and so does a raw protein the table does not know,
  where `pickFatSecretMatch` still biases toward a raw entry.
- **VERIFIED in production 2026-09-14 05:34 UTC:** run 786's trace reads
  `chicken (raw, local table)@120/100g=168` for 140 g. Two dry runs on Logan's pantry after:
  protein [43,48,52] and [40,50,49] against a 40 g target, 0 under target, 0 below floor. Tests
  607 → 610, tsc 135/16 unchanged.
- [x] **MEASURED 2026-09-14, no run needed — the raw table makes Discover BETTER, and by a lot.**
  Replayed the whole 245-row pool offline through the new table: **47 rows (19%) contain an affected
  raw meat**, and of those 8 are `creator` (untouched), 15 keep their label, **23 gain 'computed'**
  and 1 loses it. In other words our arithmetic now AGREES with the creator's published per-serving
  macros on 23 more recipes than it did — independent confirmation that creators list RAW weights
  and that cooked pricing was the thing putting us out of band. No Discover change is needed.
  The one loss is "Protein Jello" (107 stored vs 60 recomputed), which was marginal either way.
  Yesterday's own batch is unaffected: **none of its 12 recipes contain chicken, steak or pork.**
  Replaying it gives creator 3 / model 3 / computed 6 against the stored creator 3 / model 5 /
  computed 4, and both flips (Soya Mutter Paratha, Apple Pie Cottage Cheese Cake) come from the
  SERVINGS repair, not the meat change — with servings finally right, the per-serving division
  agrees. Method: `scripts/` equivalents are in the session scratchpad; the query is a REST pull of
  `trending_meals` fed through `computePerServingMacros` + `COMPUTED_AGREEMENT_BAND`.
- [x] **FIXED 2026-09-14 (Logan: "fix this now") — a meat word inside something that is not that
  meat.** Scanning every ingredient in both pools turned up 8 real rows, not the 1 first noticed:
  `unflavored beef gelatin` / `beef gelatin` / `gelatin` / `unflavored gelatin` priced as BEEF
  (21 g protein per 100 g against gelatin's 86), and `chicken bouillon powder` / `beef bouillon
  cube` / `bouillon powder` priced as raw chicken breast — a whole-food price for a cube of salt.
  Two sausage rows (`hot italian sausage`, `jones chicken sausage links`) were priced as the raw
  animal too. Four rows added ABOVE the meat rows, which is the table's own documented ordering:
  gelatin 335/86, bouillon 240/10, chicken sausage 172/17, generic sausage 301/14. Liquid broth and
  stock were already correct and are untouched.
  **Result: Protein Jello now recomputes to 101 kcal against a stored 107 and KEEPS its 'computed'
  label** (it fell to 60 kcal before, which is what would have demoted it). The file's own note had
  already worked out that 120 g of beef gelatin is ~26 g protein per serving; the code now agrees
  with it exactly. Whole-pool projection after: of the 47 affected recipes, **23 gain 'computed'
  and 0 lose it** (was 23 gain / 1 lose). Tests 610 → 611, tsc 135/16. Both functions redeployed.
  One oddity recorded in the tests rather than fixed: `zero salt chicken stock cube` lands on the
  SALT row and prices at 0 — right answer, wrong reason, harmless for a stock cube.
- [ ] **Logan's already-generated history carries the old inflated numbers.** `generated_meals` rows
  written before 2026-09-14 05:30 UTC overstate protein on meat meals by ~10-13 g. He is the only
  user; nothing is being recomputed. If he logged any of those meals, the day totals are overstated.

## 1. Verify App Store Connect products  *(do first — external lead time)*
- [x] **Products exist and are correctly configured** — checked in App Store Connect 2026-09-04.
      Real product IDs are `com.kobalabs.pantry.monthly` (1 month) and `com.kobalabs.pantry.annual`
      (1 year) — NOT `pantry_monthly` / `pantry_annual` as this checklist previously said. Group is
      "Pantry Premium", Apple ID 6763233845 (monthly). Per-subscription localization is filled
      ("Pantry Premium" / "Unlimited AI meals, scans, and macro tracking"), tax category matches the
      parent app, availability is all countries.
      **"Prepare for Submission" is NOT an error** — it is the normal pre-submission state and does
      not mean anything is wrong. Two genuinely missing fields, below.
- [x] **Review screenshot — DONE on both products 2026-09-16 (Logan).** Was: EMPTY on both products. Review Information -> Screenshot -> "Choose
      File" with nothing uploaded. Apple requires a shot of the purchase UI per auto-renewable
      subscription; this is the usual cause of a product sitting in Missing Metadata. Upload a
      screenshot of the Superwall paywall showing both prices — the same image serves both products.
      **Both DONE 2026-09-16** — the same paywall screenshot on Monthly and Annual, both added to the
      draft.
- [ ] **Draft Submission holds the group + Monthly + Annual (2026-09-16) — waiting only on the 1.0
      app version (§12).** Started 02:06 with ONLY the "Pantry Premium" GROUP in it.
      **VERIFIED 2026-09-16 (Logan): Superwall's "Missing required metadata" is gone on both
      products** — Apple now considers both subscriptions complete.
      Apple's two blockers on it: (1) "New subscription groups must be submitted with an
      auto-renewable subscription from within that group" — **CLEARED 2026-09-16** once Monthly
      joined the draft (Items Ready to Submit (2): group + Monthly); (2) "add an app version for
      the selected platform" — the 1.0 iOS version, i.e. this cannot be submitted until §12.
      Always pick the EXISTING "Draft Submission (1)" in the Add for Review dropdown, never
      "Create New Submission" — the group and its subscriptions must ride together.
      Leave the draft sitting; it waits. Tell for each product being complete: its status leaves
      "Prepare for Submission", and Superwall's "Missing required metadata" clears.
- [x] **Subscription GROUP localization — DONE 2026-09-04** ("Pantry Premium", English (U.S.),
      "Use App Name"). Was empty; this is a separate field from the per-subscription localization.
- [x] ~~Subscription GROUP localization is EMPTY.~~ The "Pantry Premium" group's Localization
      section shows only a Create button. Separate field from the per-subscription localization
      that IS filled. Create English (U.S.) with display name "Pantry Premium" — this is what users
      see in iOS Settings when managing the subscription.
- [x] **Prices CONFIRMED 2026-09-04** — $9.99 monthly / $29.99 annual.
- [ ] **Leave Family Sharing OFF.** Currently off on monthly. Enabling it CANNOT be undone and lets
      one purchase cover up to six people.
- [ ] **Attach to the app version and submit TOGETHER.** App Store Connect states it twice on
      these pages: "Your first subscription group must be submitted with a new app version" and
      "Your first auto-renewable subscription must be submitted with a new app version." They
      cannot go on their own. Submitting the app WITHOUT them attached leaves the IAPs in limbo —
      the most likely explanation for the half-remembered "not approved".
- [x] **Superwall mapping CONFIRMED correct** (2026-09-04). "Pantry Main" paywall: primary =
      `com.kobalabs.pantry.annual` $29.99/year 7d trial, secondary = `com.kobalabs.pantry.monthly`
      $9.99/month 7d trial. Exact ID match with App Store Connect, prices match canonical pricing.
- [x] **RESOLVED 2026-09-16 — cleared by the review screenshots, as predicted.** Was: ⚠️ Superwall
      shows "Missing required metadata" under BOTH products — this is NOT a Superwall problem. Superwall reads product metadata from Apple, and Apple withholds it until the IAP
      has every required field. It is the SAME gap as the missing review screenshot / group
      localization above, surfacing in a second dashboard. Do not go looking for a fix in
      Superwall. **Use it as the verification signal instead:** once App Store Connect is complete,
      reload Superwall's products page and this warning should disappear. If it does not, Apple
      still considers something incomplete.
- Context: Logan recalls App Store Connect or Superwall reporting "not approved" at some point.
  Banking/Mercury is confirmed complete, so that is NOT the cause. Most likely remaining causes:
  products in "Missing Metadata", not attached to a version, or a Superwall mapping pointing at
  product IDs that no longer exist. Do this early — anything needing Apple review has lead time.

## 2. Trending pipeline — continued auditing, review and testing  *(major ongoing workstream)*
Not a single task. This is the largest piece of engineering still in flight and it has produced
significant findings on every pass — 13 fixes on 2026-08-30 alone, including two live rows serving
3x and 8x protein overclaims and a gate that had been silently dead for 19 days. Assume more remain.
- [ ] Keep re-running the cron and re-auditing the pool. Full standing procedure, open items and
      the measurement methods live in **`docs/TRENDING-OPEN.md`** — read it before each pass.
- [ ] **→ ▶ TOMORROW item 7 (replay A and A2 on an identical list, ~1 quota unit each).** Settle whether daily yield is variance or a defect. Identical code, sequential runs gave raw
      24 vs 5 and stored 17 vs 4 — so a once-daily cron takes ONE sample from that spread and the
      swap makes it permanent. Needs ~10 SEQUENTIAL `?dryRun=true` runs. If variance confirms, the
      fix is architectural (run 2-3x, keep the best batch) and no amount of prompt work helps.
- [ ] **→ ▶ TOMORROW item 7 E (replay + `&provider=openai`, ~1 unit).** Finish the OpenAI fallback verification — one call:
      `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`
- [x] **CHECKED 2026-09-16 against the 123 rows written since:** method checklist PASS (steps stating a
      time 25% → 64%, a temperature 13% → 24%, 4.2 → 5.8 steps); junk gates PASS (0 massless or
      scaffold rows); truncation guard fired once with detail and it was a FALSE POSITIVE (▶ TOMORROW 8);
      decimal parser still unmeasured (▶ TOMORROW 9). Original note: **Four fixes shipped 2026-08-30 affect GENERATION only and are still unproven** — the method
      checklist, the truncation guards, the decimal parser fix and the junk gates. One run confirms
      all four; the exact SQL and pass criteria are in the "CONFIRM ON THE NEXT PIPELINE RUN"
      section at the end of `docs/TRENDING-OPEN.md`. Do not claim any of them work until then.
- [ ] Treat "it looks fine" as untested. Hand-verify every count before believing it.

**QUOTA BUDGET — the binding constraint on all of the above.** YouTube allows 10,000 units/day,
resetting at MIDNIGHT PACIFIC. A run costs ~1,314 units (13 search.list @ 100 + 14 videos.list @ 1),
so the day holds exactly **7 runs**. `?dryRun=true` costs the same — it skips DB writes and image
generation, not the YouTube calls. The cron was moved to 08:00 UTC (01:00 Pacific) on 2026-08-30 so
it draws from a fresh bucket instead of the previous day's leftovers; budget **1 run for the cron,
6 for testing**. Run tests SEQUENTIALLY — 3 fired concurrently starved each other and dropped the
candidate gate from 61 videos to 8.

## 2b. RAISED BY LOGAN 2026-09-05 — image did not match the recipe  *(FIXED, but see the last item)*
Kala Chana Protein Balls rendered as one giant ball garnished with whole chickpeas, raw oat flakes,
sliced chilli and diced onion, with no curd dip — for a recipe that blends everything and serves it
with a curd dip.
- [x] **Stage 1 was innocent.** Added a `describeOnly` path to `generate-meal-image` (internal-auth
      only, one near-free LLM call, no FAL spend) so the description is readable without generating
      an image. Drive it from SQL with the Vault pattern; see `docs/TRENDING-OPEN.md`. It returned
      *"...pan-seared protein balls...served alongside a smooth, creamy white curd dip in a small
      ramekin"* — plural, blended, ramekin. Everything reported missing was already there.
- [x] **Root cause: the "Negative prompt: ..." trailer was positive tokens.** `fal-ai/flux-2` has
      no `negative_prompt` field (verified against fal's schema 2026-09-05), so that string was ~60
      words appended to the POSITIVE prompt — and Flux's text encoder has no negation semantics
      regardless. It fed the model "pieces", "solid chunks", "ingredients", "components",
      "containers", "multiple plates", and buried a 27-word description under 90 words of
      dish-independent boilerplate. Removed. **Do not reintroduce it in any form.**
- [x] **Second conflict: `photoVariant` named the vessel.** Its SURFACE axis said "pale ceramic
      plate on a warm oak board", overriding Stage 1's vessel and unable to express two (plate +
      ramekin). Now backdrop-only; variety unchanged.
- [x] **Verified by downloading the regenerated file and looking at it** — not by checking that its
      size changed. All three defects gone in one generation.
- [x] **Second report same day — Bounty Overnight Weetabix.** Dry chocolate flakes instead of a
      melted ganache; whole Weetabix instead of the crushed-and-soaked pressed base. Confirmed the
      vessel bug visually: the old photo is a glass container sitting INSIDE a terracotta bowl,
      because Stage 1 said "glass container" and photoVariant said "rustic terracotta dish"
      (surface index 3 for this name — computed, not guessed). Ganache came back for free once the
      boilerplate was gone. The base needed a new rule: PROCESSED INGREDIENTS had no entry for
      crushed/soaked cereal, and the model knows a cereal's DRY look far better than its soaked
      one. Verified at v3 by downloading the file.
- [ ] **NEGATIVE RESULT — the LAYERED DISHES build-order rule does not work.** Step 3 sprinkles
      coconut on the yoghurt and step 5 spreads chocolate OVER it, so the coconut belongs buried.
      The rule is in the prompt, reaches the model, and the description still lists coconut after
      the ganache on both runs — the model reads "sprinkle over" as a finishing garnish. Same shape
      as the merged-ingredient finding. Left in place, but do not spend more prompt rounds on it.
- [x] **THE JELLO "fixed it but Discover still shows the old one" BUG WAS ONLY HALF FIXED — now
      closed properly 2026-09-05.** `17905c0` wired the cache-HIT path and stopped there: a
      SUCCESSFUL generation wrote `image_cache`, returned, and never touched `trending_meals`, so
      Discover kept the placeholder until someone opened that meal a SECOND time. What hid it was a
      `backfillTrendingImage` call sitting on the upload-FAILED branch, where the only URL is a FAL
      link that guard 2 rejects by design — it could never write under any input. Dead code shaped
      like a safety net, in exactly the place the real call was missing.
      Verified on a row that was NOT nulled first (the scenario that used to fail): the function
      moved it from `...bowl.jpg` to `...bowl.jpg?v=1788630958080` on its own.
- [x] **Repairs now have a supported path.** `.is('image', null)` keeps an unattended backfill safe
      but makes a REPAIR impossible, since a repair targets a row that already holds a wrong image.
      Internal-only `replaceTrending: true` opts out. **Use it for the library pass below** — every
      manual regeneration before this needed a hand-written `update trending_meals set image = null`
      first, and forgetting it once silently produced an A/B that compared an image to itself.
- [ ] **OPEN — the steps rule misses the verb "Add".** `Kala Chana Paneer Protein Bowl` step 2 is
      "Add sliced onion and green chillies" to the mash, and the photo draws them as raw garnish.
      The rule triggers on mashed/blended/mixed/stirred/folded/dissolved/melted/whisked. Extending
      the list is one line, but it is UNMEASURED and the LAYERED DISHES rule added the same day did
      not take, so do it with a before/after on several dishes, not one sample.
- [x] **CLOSED 2026-09-07 — audited, and NOT a launch blocker. It is 194 images, not 1,370, and they are mostly fine.**
      MEASURED 2026-09-07 with `scripts/date-image-library.py`. The storage list endpoint returns
      `created_at` and `meal-images` is a public bucket, so the whole library dates itself against
      the commit dates of every prompt change — anon key only, no cost. There WAS an automated
      check available all along; nobody had looked for one.

      2054 images in the bucket, 206 of them referenced by `trending_meals`:

      | images | live in Discover | newest prompt era they were written under |
      |---|---|---|
      | 50 | 12 | **current** (soaked cereal + real negative prompt, 2026-09-05) |
      | 18 | 14 | flavourings stripped before description |
      | 1029 | 179 | ingredient coverage tightened (2026-05-28) |
      | 27 | 0 | incorporated ingredients made invisible |
      | 22 | 0 | ingredient-faithful prompt |
      | 120 | 1 | two-stage Gemini→Flux pipeline |
      | 788 | 0 | predate the two-stage pipeline entirely |

      **So the decision is much smaller than it looked.** 194 stale images are live in Discover;
      the 788 oldest — the ones that make this item frightening — are serving nobody. At 512x512
      that is **$0.60** to regenerate the entire Discover surface, which is an afternoon, not a
      launch risk. Worklist: run the script, take the rows where `live_in_discover` is true.
      Regeneration is cheap to trigger — delete the `image_cache` row, null `trending_meals.image`,
      re-invoke; the `?v=` token handles clients.

      **AUDITED 2026-09-07 — DO NOT BULK REGENERATE. The premise does not hold.** Eight of the 194
      were sampled at random and looked at: seven are correct and appetizing (chocolate-strawberry
      smoothie, bacon chicken crack bowl, mini blueberry cheesecake, PB fudge balls, choc-PB protein
      bar, soya chunks chilla, paneer dosa). One is flawed — `biscoff-paneer-cheesecake` has garbled
      fake lettering on the biscuit — and that is a diffusion text-rendering artifact, which none of
      the prompt fixes address, so it is not evidence for regenerating either.

      "Generated under the broken prompt" was never evidence that an image IS broken. The three
      known-bad ones were found because Logan looked at them. Nobody had looked at the rest.

      Regenerating also has a cost that is not the $0.60: measured the same day, Flux drops a named
      element roughly 1 render in 11 (one live recipe, 11 renders; six seeds at current settings all
      correct). A bulk regen re-rolls ~194 mostly-good images at that rate with no verification step,
      so it would quietly make some of them worse.

      **Replaced by:** regenerate individually when an image is actually reported wrong. The
      thumbs-down reason `photo_mismatch` (shipped 2026-09-07) is the detector, and
      `scripts/describe-image.sh --render` is the one-command fix. A stochastic tail is cheaper to
      detect than to prevent.

      Also verified while auditing: all 206 Discover rows resolve — 0 broken storage links, 0 still
      on a YouTube thumbnail, 0 with no image.

      **Read "live" as "live in DISCOVER".** Generated-meal images are keyed in `image_cache`,
      which is service-role only, so a file marked not-live is not proof nobody is served it —
      only that Discover is not.
- [x] **CLOSED FOR THE APP 2026-09-05 — 512x512 stays. Logan looked and it is fine.**
      Measured rather than guessed: the meal-detail hero is 500pt full-width = **1179x1500 real px**
      at @3x, so a 512 source is upscaled **2.93x** and loses 21% of its width to `cover`. Discover
      featured and the Home hero are 2.07x; rail cards 1.32x; thumbnails already DOWNSCALE and were
      never affected. Flux 2 bills **$0.012/megapixel**, so the whole library to date has cost about
      **$4.31**, and 1024 would be ~$17 to re-render plus ~$5/month more on the pipeline.
      **Cost was never the reason not to — perceptibility was.** The A/B was real (fixed seed,
      both put through the actual hero crop) but I showed it as a 620px crop magnified in a desktop
      chat window, which is a view nobody ever gets. On a ~460 PPI phone, with a gradient over the
      bottom third, a 2.93x upscale of a PHOTOGRAPH is close to invisible — food is the friendliest
      possible content for upscaling (soft bokeh, organic texture, no hard edges, no text). Do not
      reopen this for the app without new evidence FROM A DEVICE.
- [x] **Square is correct and is not the thing to change.** Consumers span 0.78 (detail hero,
      Discover rail) to 1.24 (Home hero), so no single aspect fits and 1:1 is the least-bad. Only
      the resolution was ever in question. (`aspect_ratio: "16:9"` -> `image_size: "square"` was an
      undiscussed migration default in `22e790a`; square turns out to be right by accident.)
- [ ] **Resolution REOPENS for the trailer and App Store screenshots only — see §7 and §8.**
      Different bar: full-screen, held for seconds, re-encoded by Apple, and a conversion surface
      rather than something browsed past. `imageSize` + `seed` overrides are already shipped and
      internal-only, so a one-off high-res render needs no code change.

## 2c. ANSWERED 2026-09-05 — the "slow Supabase queries" were Metro, not the app
Cold-start traces showed Home's profile/pantry/logs queries taking 8-11s, and every query in the app
completing within the same ~700ms window no matter when it started. That release-together shape
pointed at one shared gate. It was not the one it looked like.
- [x] **Server ruled out.** curl from the dev machine against the same REST endpoint: TTFB 654 /
      293 / 158ms across three attempts.
- [x] **supabase-js ruled out**, by a three-way probe (`lib/netProbe.ts`, dev-only, now gated off
      behind `PROBE_ENABLED`). `auth.getSession()` — the gate every PostgREST call awaits to attach
      the JWT, and the prime suspect — took **0ms**. A supabase query took **92ms** once a
      connection existed. A BARE `fetch` with no supabase-js in the path took **2322ms**, i.e. just
      as slow as everything else. The client was never the problem.
- [x] **It is Metro.** Query time tracks BUNDLE SIZE across four traces the same day:
      3843 modules -> 7.7s | 3842 -> 11.2s | 1 module -> 1.5s | 1 module -> 2.1s.
      The phone pulls the JS bundle from the Mac over the same wifi and Supabase requests contend
      with it. A release build has no Metro and no bundle transfer.
- [x] **HEALTH-CHECK ALERTING PROVEN END TO END 2026-09-05.** `expo_push_token` is written and the
      persisted row now reads `"alert": "sent"` instead of `"FAILED: ops user has no
      expo_push_token"`. Three things had to land: pipeline_runs persistence, the EAS project link,
      and — the one that actually mattered — `EXPO_PUBLIC_EAS_PROJECT_ID`, because in a BARE
      workflow expo-constants reads the config embedded at NATIVE BUILD time, so app.json's
      projectId stays invisible until `npx expo run:ios` runs again. That is why the warning
      survived three JS reloads.
- [ ] **Confirm on a release build before ever touching this again**
      (`npx expo run:ios --configuration Release`). If cold-start queries are ~100ms there, this is
      closed permanently. **Do NOT "optimise" the Supabase client for a number measured under
      Metro** — the same trap as reading absolute perfMark values instead of deltas.
- [ ] **New data point 2026-09-16 23:53 — this time NOT bundle contention.** After a reload, ~18
      authenticated requests on one fresh HTTP/3 connection (handshake 50 ms) all got their first byte
      7.8 s after sending, released together at 23:53:40.7; the same connection then answered in
      ~120 ms. The bundle had already loaded, and the phone log shows no large Metro transfer in the
      window. The phone's internet path was CELLULAR (5G, link quality "moderate"), not wifi.
      `pg_stat_statements` shows no app-table query over 2 s since March, so the time was not
      query execution — either the cellular path or Supabase's API layer. Not settled. The same
      release-build test settles it; run it once on wifi and once on cellular.
- [ ] Note for the release-build pass: it also settles the OTHER dev-only number still open —
      whether Discover's remaining ~230ms tap-to-paint survives outside a dev bundle (see §6f).

## 2d. RAISED BY LOGAN 2026-09-05 (evening) — WORK THESE IN ORDER, DO NOT REORDER
Logan asked for these to be worked strictly top to bottom. Each is unstarted.

- [x] **DONE 2026-09-05. 1. Seed `meal_slots` from onboarding's `meals_per_day`.** The structure column shipped with a
      flat default of 4; onboarding already asks how many meals a day, so asking again in Profile is
      a redundant CTA. Map number -> ordered names, and **when a name would repeat, number it
      ("Lunch #1", "Lunch #2")** — the first draft of this table had "Lunch" twice at n=5, which is
      the exact collision the case-insensitive add-guard rejects. Rough shape:
      3 = Breakfast/Lunch/Dinner · 4 = +Snack · 5 = +Morning snack · 6 = +Evening snack.
      **Seed ONCE.** After that `meal_slots` is the source of truth: a later change to
      `meals_per_day` must OFFER to re-seed, never silently overwrite custom names. Existing rows
      took the flat default of 4 and can be backfilled from `meals_per_day`.
- [x] **DONE + VERIFIED 2026-09-05 (see 2f). 2. Fix the DOUBLE generation on cold start.** Trace shows
      `generation start +2377ms` and again `+2400ms`, with two SESSION_CHECKs and two getSessions:
      `useMealSuggestions`'s effect deps are `[userId, isPremium, mode, enabled]`, `enabled` flips
      when the pantry lands and a second dep (almost certainly `isPremium` resolving from Superwall)
      flips ~23ms later and re-runs it. The `cancelled` guard only suppresses STATE UPDATES — it does
      not abort the in-flight call, so both batches complete and are paid for, and only one reaches
      `recent_meal_names`. That is also why five distinct meal names appeared for a three-meal batch.
      Fix = a ref keyed on what has already been generated for, so a late dep change cannot re-fire.
      Touches the generation path; do it with Logan watching.
      **VERIFY AFTER FIXING — server-side, no device needed.** Trigger one generation, then:
      ```sql
      -- A) exactly ONE batch per timestamp. Today shows 6 meals sharing 20:57 and 6 sharing 11:51,
      --    where a batch is three. After the fix each generation must produce ONE group of ~3.
      select date_trunc('minute', created_at) as gen, count(*), array_agg(name)
      from generated_meals where user_id = '<uid>'
      group by 1 order by 1 desc limit 5;

      -- B) EVERY name from that batch must appear in the anti-repeat window. Today only 3 of the 6
      --    from 20:57 are there — "Egg White and Spinach Frittata" is missing, which is why it came
      --    back a day after 09-04. That gap IS the bug, so closing it is the pass criterion.
      select recent_meal_names from profiles where id = '<uid>';
      ```
      PASS = one group of ~3 per generation AND every one of those names present in
      `recent_meal_names`. FAIL = any batch whose names are only partly in the window: the lost
      update is still happening.
      DO NOT tune RECENT_MEMORY as part of this. The window is 30 and is not too short; it is being
      truncated by the race. Tuning it would mask the fix and make the result unreadable.
- [x] **3. ANSWERED — NOT A BUG. Changing meal frequency in Profile clears the meal cache.**
      Logan changed Meals Per Day once during testing. `meals_per_day` is one of four `GoalField`
      values (`profile.tsx:585`), and saving any of them runs
      `multiRemove(['pantry_daily_meals_cookNow','pantry_daily_meals_mealPlan'])` on purpose:
      "Calorie/protein/meals/prep all size meal generation — drop the cached daily meals so they
      regenerate to the new target instead of serving stale, wrong-sized suggestions." Correct
      behaviour. Dietary restrictions, diet type and a macro recalculation do the same.
      HOW IT WAS FOUND, since three wrong theories died first: the four-session trace showed 3 HITS
      and 1 MISS, and session 1 hit the cache WITHOUT generating — so a valid cache went invalid
      with nothing generating in between, which killed the leading "app killed mid-generation"
      theory outright. Also ruled out by reading: the date key (todayStr is local, not UTC),
      maxPrepMinutes undefined (profile has 30, writer defaults `|| 30`), prepTime stored as a
      string (the generator returns a number and the edge function already filters it), and
      mealPrefetch as a rogue writer (it writes the full correct shape).
      The four Profile clears are now perfMark'd — a deliberate wipe and a cache lost to an app kill
      both surface as `cache MISS: no entry stored` on the next open, and only the mark tells them
      apart. Every cache-miss branch in `useMealSuggestions` is named too, so a genuine one can be
      diagnosed from a single log instead of another session of guessing.
      **NOTE FOR ITEM 1:** seeding `meal_slots` from `meals_per_day` means one edit will re-seed the
      slots AND wipe the meal cache. Coherent, but say so in the UI — the user is changing more than
      they may realise.
      **STILL OPEN under this:** the onboarding writers (`onboarding/index.tsx:2653`,
      `createaccount.tsx:164`) stamp this cache WITHOUT `maxPrepMinutes` or `userId`, which the
      reader treats as old-format and discards. Harmless today because a regeneration follows
      onboarding anyway, but it is a guaranteed miss and worth aligning.
- [x] **4. ANSWERED WITH CERTAINTY — it is a REAL bug, and it is the SAME bug as item 2.**
      `generated_meals` is a permanent, timestamped record (written server-side by generate-meals
      precisely because "a generation not recorded at the moment it happens is gone for good"), so
      this needed no guessing. Facts:
        09-05 20:57  Protein-Boosted Chocolate Smoothie / Greek Yogurt and Pineapple Power Parfait /
                     Cottage Cheese and Savory Green Bowl / Greek Yogurt and Salsa Protein Dip /
                     Egg and Potato Breakfast Hash / **Egg White and Spinach Frittata**
        09-05 11:51  Greek Yogurt and Cinnamon Granola Power Bowl / **Chocolate Protein Smoothie** /
                     Egg White and Spinach Scramble with Cheese / Cottage Cheese and Pesto Pasta
                     Salad / **Chocolate Protein Smoothie** / Cheesy Egg and Spinach Breakfast Wrap
        09-04 11:21  Savory Yogurt and Egg Scramble / Garlic Butter Chicken and Rice /
                     **Egg White and Spinach Frittata**
      - **Egg White and Spinach Frittata repeated 09-04 -> 09-05.** Logan was right.
      - **"Chocolate Protein Smoothie" appears TWICE INSIDE the 11:51 batch** — a duplicate within a
        single generation, which no anti-repeat window can catch.
      - **SIX meals share the 20:57 timestamp and six share 11:51** — three-meal batches. That is
        the double-fire from item 2, recorded in the data.
      - **Only THREE of the 20:57 six are in `profiles.recent_meal_names`.** The Frittata is not.
      **MECHANISM — a lost update.** Both concurrent generations read `recent_meal_names`, each
      computes `clusterDishes([...its own names, ...theOldList]).slice(0, 30)`, and both write. The
      second write has never seen the first batch's names, so it overwrites them. Half of every
      double generation is therefore INVISIBLE to the anti-repeat window and free to come back the
      next day — which is exactly what the Frittata did.
      **CONSEQUENCE FOR THE QUEUE: fixing item 2 fixes item 4.** The repeats are not a variety-tuning
      problem and RECENT_MEMORY (30) is not too short; the window is being silently truncated by a
      race. Do NOT tune the window. Fix the double-fire, then re-measure.
      **STILL OPEN AFTER THAT:** the within-batch duplicate at 11:51 (same name twice in one
      response) is a separate defect — the generator returned it and nothing de-duplicated the
      batch against itself before storing.

## 2f. VERIFIED 2026-09-05, and what it uncovered
- [x] **2d#2 double generation — FIXED AND VERIFIED SERVER-SIDE.** Newest batch is `count: 3`
      (previous three of five were 6), and all three names are present in `recent_meal_names`. Both
      pass criteria met, no device judgement involved.
- [x] **FIXED — the ingredient rescue was overruling an EXACT name match.** `isSameDishDetailed`
      returned "not the same dish" whenever ingredient overlap fell below INGREDIENT_RESCUE_MAX,
      even for a byte-identical name, so a repeat was rescued and kept. Its own comment scopes it to
      "two SIMILARLY-NAMED dishes" — identical is not similar, and a reader seeing the same dish
      name twice does not care that the ingredient list drifted. Identical `dishKey` now short-
      circuits to true; because dishKey sorts its tokens, "Chicken Rice Bowl" vs "Rice Chicken Bowl"
      is caught too. Three regression tests, including one asserting genuinely different food under
      similar names is STILL rescued so the batch does not thin. Deployed.
      VERIFY on the next few generations: no exact name repeat against `recent_meal_names`.
- [x] **ORIGINAL NOTE, kept for the record —** "Protein-Boosted Chocolate
      Smoothie" was generated 09-05 20:57, DID reach the anti-repeat window, and was generated again
      verbatim at 09-06 03:00. Same exact string, ~1h after entering the list the model is told to
      avoid. So 2d#4 was two bugs: the lost update (fixed) and the model repeating a name that is in
      the window (open). INVESTIGATE the prompt side — is `recentMealNames` actually reaching the
      model, is it truncated, and does `clusterDishes`/`matchesRecentDish` collapse it before it
      gets there? Do NOT lengthen RECENT_MEMORY; a window that is being ignored gets no better by
      being longer.
- [ ] **Also open, same batch:** "Chocolate Protein Smoothie" appeared TWICE inside the single 11:51
      response. Nothing de-duplicates a batch against itself before storing.
- [x] **FIXED — Profile now STALES the meal cache instead of deleting it.** Logan reloaded after a meal-
      frequency change and got the bare "Let's cook" empty state for 4-5s instead of his previous
      meals. The carryover branch in useMealSuggestions paints a PREVIOUS day's cached meals while
      the new ones generate — precisely so this never looks empty — but it needs an entry to exist.
      `multiRemove` in all four Profile handlers destroys the carryover source. Marking the entry
      stale (e.g. dating it to yesterday) would trigger carryover instead and keep the intent
      ("regenerate rather than serve wrong-sized suggestions") intact.
- [ ] **Related: the cache clear does not touch in-memory `meals` state.** Nothing re-runs the load
      on focus — the effect deps are `[userId, isPremium, mode, enabled]` and clearing AsyncStorage
      changes none of them — so after a Profile change Home keeps rendering the OLD meals until a
      remount, with no indication they are stale. That is also why a Profile change only appears to
      regenerate on the NEXT app launch, which is what made this look intermittent for hours.

## 2g. BUILT 2026-09-05 — multi-serving generated meals  *(Logan's idea)*
**Shipped in `cf18cae`, deployed, NOT yet seen on device against a 6-meal profile.**
The design below is preserved because the reasoning still holds; three of its four checkboxes were
answered differently once the pipeline was actually read, and those corrections are the value:

**The problem.** `displayCount = Math.min(mealsPerDay, 3)` but `calorieTarget = calorieGoal /
mealsPerDay` is NOT capped. So a 6-meal user gets three ~350 kcal "cooked" recipes covering half
their day — snack-sized recipes for a cook-from-your-pantry surface. Three test profiles sit at 5
and three at 6, so this is not hypothetical.

**Rejected fix (mine):** size the three recipes against MEAL slots only, making them ~700 kcal. It
is worse: that user does not eat 700 kcal at once, so they would split it silently while the card
states macros for the whole thing.

**Chosen approach (Logan's):** keep per-serving calories at `calorieGoal / mealsPerDay` — correct
for how they actually eat — and give the recipe MULTIPLE SERVINGS, exactly as trending recipes
already do. Batch-cook and portion is how 5-6 meal/day people really eat.
      servings = clamp(round(~700 / perServingCalories), 1, 3)
      3 meals -> ~700/serving, 1 serving   4 -> ~525, 1
      5 meals -> ~420/serving, 2 servings  6 -> ~350, 2
**This moves generated meals INTO the shape CLAUDE.md documents as correct**, not away from it:
`calories` per serving, `ingredients` full batch, `servings` a count. `app/meal/[id].tsx` already
renders "Makes N servings · macros are per serving" and logging already writes per-serving
calories, so the log path needs no change — verified, not assumed.

- [x] **WRONG — the prompt is NOT where the double-count lives.** This said the fix was "prompt +
      JSON schema". Two server gates read the ingredient array and cannot see the prompt:
      `correctMealMacros` OVERWRITES `calories` with the FatSecret sum over the ingredients (both
      keys are set in prod), so a per-serving claim gets the batch total stamped back on top with
      the model fully compliant; and `verifyMacros` drops a meal at claimed/estimated < 0.65, which
      a per-serving claim against a 2-serving list hits at exactly 0.50 — every batch recipe
      dropped. **The pipeline now stays in BATCH space and divides ONCE in `toPerServing`, after
      both gates.** `servings` is computed server-side, so the prompt is a hint, not the guarantee.
      Two thresholds had to scale or they would eat real food: FatSecret's 200–1200 window (per
      serving) and its >900 kcal per-ingredient "wrong match" guard, which at 2× grams starts
      discarding legitimate ingredients and *understating* the total.
- [x] **`servings` is a real field** on `GeneratedMeal` and `MealDetail`; the `(meal as any)` reads
      are gone.
- [x] **The pantry question was a non-question.** `useMealSuggestions` sends
      `pantryItems.map(i => i.name)`, `pantry_items` has no quantity column, and nothing is deducted
      on cook. A 2-serving batch draws the same pantry as a 1-serving one because quantity is not
      modelled anywhere. Do not build a quantity model to answer it.
- [x] **Ingredients are not scaled** — batch list + `servings` count, per CLAUDE.md.
- [x] **The problem was smaller than this section claimed.** Measured on all 18 live profiles
      BEFORE building: 16 return `servings === 1` (a literal no-op — every scaled band ×1). Only two
      trip it, both on 6 meals/day, and one of those is a 1000 kcal junk profile. The effective
      trigger is a portion under **~467 kcal**; the 5-meal users this section singled out sit at 541
      and 615 and were never broken. Those profiles are pinned in `_shared/servings.test.ts` so the
      inertness is a test rather than a claim. Build it anyway — 6 meals/day at 2500–3000 kcal is a
      real post-launch cohort — but not believing 30% of users are affected today.
- [ ] **UNVERIFIED ON DEVICE.** No live generation has run against a 6-meal profile. What to check:
      the card shows ONE portion's kcal/protein with a "makes 2" marker beside prep time, the detail
      screen prints "Makes 2 servings · macros are per serving", and the ingredient list is visibly
      a 2-portion batch. Function logs print `Servings: 2 per recipe` when it fires.

## 2i. POST-LAUNCH — pantry variety unlock  *(designed 2026-09-06, deliberately NOT built)*
The repeat complaints bottom out in a fact no prompt rule can move. Measured on the live account:

    51 generated meals  ->  26 distinct dishes   (46% repeats)
    pantry: 56 items, but only 9 produce and NO pasta / bread / tortillas / oats
    carbs available: rice, potatoes, granola, protein cereal, plantain chips

Every savory dish is therefore protein + rice or potatoes, which is why chicken-and-potatoes and
yogurt bowls keep returning. Three fresh dishes a day against a 30-dish memory exhausts this
pantry in about ten days.

**The obvious cheap version does not work.** `missing_ingredients` looked like the data to
aggregate — it is not: only **6 of 51** meals have any, and they are garnishes (parsley x2,
chives, lemon juice, banana, parmesan, pasta). That is by design, since the cookNow prompt tells
the model to use ONLY pantry items and set `missing_ingredients: []`. The system is built never to
want anything, so it never records what it could not make.

Doing it properly is a new generation pass ("given this pantry, which 5 additions unlock the most
distinct dishes?") plus a Grocery-tab surface. That is a feature, roughly a day.

**Deferred on purpose.** Pre-launch, and the evidence is one pantry belonging to the developer,
who regenerates five times an hour while testing — not a user. Design it against the
`generate-meals-funnel` rows once real users have produced some. The payoff if it works: it turns
the top churn complaint into the reason to use the grocery loop, which is a core differentiator.

## 2j. Discover freshness signal — Logan's idea 2026-09-06, not yet specced
Users cannot tell Discover is updated daily. Options he is weighing: a gold/green "NEW" bracket or
pill on recently added cards, or ordering each shelf newest-first. Not investigated yet — needs a
look at whether `trending_meals` carries a usable added-at date per row and how it interacts with
the day-keyed shelf rotation (which deliberately varies order per day, and would fight a strict
newest-first sort).
**BUILT 2026-09-10:** NEW TODAY border on a rolling 24h from `created_at`, new recipes lead their
shelves. No "Today's picks" shelf — first-shelf-wins pulled new recipes OUT of their home shelves.

## 2k. VERIFY — shipped 2026-09-10, not yet confirmed  *(grouped by what unblocks each)*
**A. The Sep 11 3am run (08:00 UTC)** — first SCHEDULED run on the fixed cron auth, and the first to
split time three ways at extraction. Deployed source was diffed byte-for-byte against the repo.
- [x] **PASS, checked 2026-09-16: split = phased = meals on every day Sep 4-16 (Sep 11: 9/9/9).** `select count(*) meals, count(rest_time) split, count(time_phases) phased, count(*) filter (where rest_time >= 240) overnight
  from trending_meals where generated_at = '2026-09-11';` — PASS = `meals > 0` AND `split = meals`
  AND `phased = meals` (ordered phases shipped 2026-09-10; a NULL means the extractor's order
  disagreed with its totals — look at which recipe before assuming a bug).
  Then the 08:20 health-check row in `net._http_response` reads `"healthy":true`. The pipeline's own
  row saying `timed_out: true` is EXPECTED (pg_net gives up at 5s, the run takes ~50s).
- [x] **PASS: every real run writes one (Sep 16: 800, 805, 808), and since `05179ea` it is written before images.** Does `pipeline_runs` get a row? Sep 6 (12 meals) and Sep 10 (13) wrote none; Sep 7 (2) did.
  Hypothesis: big batches exhaust wall-clock after images, before the final log write.

**B. Device reload** — on Discover, SWITCH TABS ONCE after opening (it paints from an old cache).
- [x] Dislike sheet at the bottom, clear of the Dynamic Island, text legible — PASS on device
  2026-09-10 (`0bc3751` position, `3521935` text was black-on-#1A1A1A).
- [x] Dislike sheet step 2 legible, no grabber — PASS on device 2026-09-10 (Beef Pasta Skillet).
- [x] **PASS on device 2026-09-10.** **Dislike sheet flavour row** (built 2026-09-10): "Not to my taste" → ingredient chips WITHOUT
  pasta water / spray oil / water / salt / plain oils, then "Or was it the flavour?" Too bland · Too
  spicy · Too sweet · Texture was off. Button reads Done once anything is picked; Skip and Done both
  close it. Pick a flavour, then the daily report should read "... not to my taste (too bland)".
- [x] **PASS on device 2026-09-10.** **One time rule on every card** (`aa037b8`). A waiting Discover dish shows its time pill on its
  OWN row — Lentil Quinoa Flatbread `40 MIN + OVERNIGHT`, Blueberry Lemon Cheesecake `60 MIN +
  CHILL` — with calories and protein beneath; the grid must stay aligned. Non-waiting cards: one
  row, unchanged. (Font-shrinking to fit one row was ruled out: it needs ~6pt; pills are 10pt.)
- [x] ~~SUPERSEDED for Discover by ordered phases (waits now say soak/freeze/chill).~~ Cook Tonight meals, which have no phases, keep the breakdown. Detail screen still says "rest" (`20 min prep · 20 min cook · 8 hr rest`) — "chill" was
  reverted because 3 of 23 waits are soaks. Naming the kind needs the extractor to return it.
- [x] **PASS on device 2026-09-10** (Lentil, McFlurry, 4-phase wrap). **BUILT 2026-09-10 (Logan chose: build now, force-run to verify):** Lentil
  Quinoa Flatbread's detail reads `Soak 8 hr → 20 min prep → 20 min cook`; McFlurry `5 min prep →
  Freeze 16 hr → 5 min spin`; a long timeline wraps inside its pill without pushing the thumbs off.
  Verified server-side: forced dry run of the cron command with the Vault cron_secret → HTTP 200,
  13/13 recipes split AND phased; backfill 219/219 valid, 0 left. A step-number sort was tried and
  REVERTED (3-4 of 24 misordered vs 1); model order + an explicit Creami rule got 24/24.
  Tomorrow's 3am check now also expects `count(time_phases) = meals`.
- [x] ~~NEXT BUILD after the Sep 11 3am run is verified~~ — detail screen time as ordered phases with
  arrows (Logan's call: chronological, "so the user knows the order of operations").** Measured on the
  23 waiting dishes: wait at the END 13 (type order is right), wait FIRST 3 (Lentil Quinoa Flatbread,
  Lahori Chickpea Curry, Moong Dal Dosa — type order reads the overnight soak as after cooking), wait
  in the MIDDLE with work after it 6 (Creami: combine → freeze → spin; bites: mix → freeze → dip →
  chill) — three stored totals CANNOT express those, so arrows must not be faked from prep/cook/rest.
  Build: extractor returns ordered phases `[{kind: prep|cook|wait, label: soak|freeze|chill|…, minutes}]`
  (stored as e.g. `time_phases jsonb`), backfill via the resumable backfill function, detail screen
  renders `Soak overnight → 20 min prep → 20 min cook`; rows without phases keep today's format.
  Also names the wait (soak/freeze/chill) — the "rest" problem above. Waits because tonight's
  extraction change would confound the first scheduled run of the current split.
- [x] **Emoji stripped from Discover steps** (2026-09-10): the pipeline removes them before storing
  (_shared/sanitize.ts stripEmojiFromSteps) and the 8 stored recipes were cleaned — 0 of 219 left.
- [ ] **Creator chatter stored as steps**: "Save this recipe for later and let me know if you try it!"
  (Chocolate Peanut Butter Smoothie Bowl) and a cookbook plug (Slow Cooker Chinese Chicken Curry).
  Not instructions — the extractor should drop them.
- [x] **VERIFIED by run 47 (17:47)** except image counts: pantryCarbsOffered = red/yellow potatoes, cooked rice,
  protein cereal; notCookable 0 (was 4); incomplete 0 of 8 candidates (was 5 of 8); incompleteShown 0;
  belowProteinFloorShown 0 (shown 44/41/38g). Image counts not exercised — no counted eggs in that deck.
  **BUILT 2026-09-10 with Logan's OK** (pipeline_runs, provider generate-meals-funnel):
  - Pantry "Oat Milk" no longer counts as "oats" (nor rice vinegar as rice, tomato sauce as tomatoes,
    almond butter as almonds, chicken broth as chicken). Tell: no porridge without oats.
  - The prompt names the user's own carbs (`pantryCarbsOffered` in the funnel — for Logan: potatoes,
    cooked rice, protein cereal). Tell: `notCookableMissing` stops listing bread/pasta/noodles, and
    `incompleteShown` drops toward 0.
  - Protein floor: under 75% of target ranks below meals that meet it (tier = complete + floor).
    Tell: `belowProteinFloorShown` is 0 unless nothing else qualifies.
  - Image counts: the describer gets "3 eggs" and draws exactly that many. Existing images are cached
    by NAME, so only newly-named dishes show it.
- [x] **Run 48 (18:03): savoryClash [] and savoryClashShown 0** — the prompt line held, so the ranking
  gate itself was not exercised (nothing to catch). Good enough to close; the gate is cheap insurance.
  **Savory clash ranks last** (built `5ef7d3b`): run 47 LED with "Protein-Fortified Creamy Rice Soup" —
  milk, rice, 70g chicken, protein powder "whisked in to thicken"; not a real dish, and 140g chicken hits
  the same protein. Protein powder or a sweet-flavoured product in a savory dish now sorts below
  everything; prompt says powder only in shakes/oats/pancakes/desserts. Measured: 1 flag in 113 meals.
  Verify next generation: `savoryClashShown` 0. (First claimed the soup used VANILLA whey — wrong, that
  was FatSecret's match label; the recipe used plain powder.)
- [x] **DECIDED by Logan 2026-09-10 (after the run 48 audit): tier outranks freshness, plus slot coverage.**
  Order is now clash -> tier -> fresh -> fit, then at least one lunch/dinner and one lighter meal
  (`_shared/rank-deck.ts`). The price, more repeats, is recorded per run as `repeatsShown`.
  Was: **DECISION FOR LOGAN — does "complete + protein floor" outrank freshness?** Then: clash -> fresh -> tier
  -> fit. Replaying run 47 without the soup, the 3rd slot goes to a FRESH 25g Egg and Rice Breakfast Bowl
  ahead of complete 40g+ REPEATS. Tier-first = every shown dish complete and protein-adequate, more repeats.
  The morning handoff said not to reopen the freshness rule without evidence — this is that evidence.
  **Run 48 is stronger evidence (see §2n):** 7 of 10 candidates were repeats, including all 5 dinners, so
  fresh-first had no choice at all — the 3 fresh ones shipped, one of them 24g (tier 1) over seven
  tier-0 dishes, and the deck at 6pm held zero dinners. On a finite pantry, fresh-first selects for the
  model's oddest recombinations (a cottage cheese + rice + pecan bowl) because the real dinners are
  the ones already shown.
- [ ] **Generated "Beef and Shredded Cheese Tacos" had no tortillas or shells** in its ingredients (also a
  "Beef Bolognese Pasta" with flour and no pasta). The name-gap check (25f2f83) should reject a dish
  named after a food it lacks — find out why "taco" slipped past it.
- [ ] **Cucumber Salad Bowl has rest_time 120 but no waiting step** (Chop → Dressing → Combine →
  Avocado → Serve). Likely an extraction error; check its creator's source before trusting its time.
- [x] **A reason actually saves** — PASS 2026-09-10: Avocado Blueberry Yogurt Clusters row reads
  `reason = photo_mismatch` after Logan tapped it on device, and the recipe correctly stayed in
  Discover (photo reports do not suppress).
- [x] **PASS on device 2026-09-10** (may gain recipes after the plural fix below). "Almost in your kitchen": 7 recipes, none "Missing 3" (order may now differ — NEW TODAY recipes sit at random spots), Cottage Cheese Crepes in it; Frozen
  Yogurt Fruit Melts gone.
- [x] **PASS on device 2026-09-10 after the plural fix.** Was FAILED: Peanut Butter Protein Cheesecake listed "1 egg" under YOU'LL NEED
  with "Eggs" in the pantry — the matcher had no singular/plural rule ("large eggs" only matched via
  adjective stripping). Re-verify: "egg" now under IN YOUR PANTRY; greek yogurt still is.
- [x] **PASS on device 2026-09-10.** **Discover opens on the FULL pool** (6 shelves, Lentil Quinoa Flatbread findable) on the first
  open, without switching tabs — the cache held only the newest 60, which gave 2 shelves and parked
  the real pool until blur. Old 60-slice caches are now ignored (one skeleton, then full).
- [x] **PASS on device 2026-09-10.** NEW TODAY recipes sit at RANDOM spots in each shelf's first page (Logan: "just make it random"),
  seeded by the day so the page holds still all day; none behind "Show more". Rejected on device:
  new-first (stacked at top), plain alternation (all in the right column), checkerboard. Random will
  occasionally line up by chance — that is the trade Logan chose over any visible pattern.
- [x] **PASS on device 2026-09-10 (previewed via DEV_DAY_OFFSET = 5, reverted to 0).** "Ready in 15" has no
  frozen desserts. Not on every day's shelves by design — 6 of 11 shelves rotate daily.
- [x] **Run 48: incomplete 0 of 10, incompleteShown 0, notCookableMissing [] — PASS.** But it was
  achieved by putting rice in all three dishes, a "wrap" and a scramble included (§2n).
  **Cook Tonight only serves complete dishes first** (built 2026-09-10; FIRST RUN, 46, still showed 2
  incomplete of 3 — the only complete candidates were repeats, freshness wins, and 4 candidates died
  not-cookable because the model reached for bread/pasta/noodles the user does not own): a meal needs a carb base
  (drinks and keto/low-carb exempt); the ranker orders fresh → complete → fit, so a protein-and-veg
  plate shows only when there are not 3 complete fresh ones. Verify on the NEXT generation: funnel
  `incomplete` / `incompleteShown` in pipeline_runs (generate-meals-funnel), and no "chicken +
  cauliflower + soy sauce" plate. The carb rule sat in the prompt unenforced since 2026-04-30.
- [ ] **Ice/water are 0 kcal in macro correction** (built 2026-09-10) — FatSecret matched "Ice Cubes" at
  217 kcal/100g, so the Chocolate Protein Power Shake read 782 kcal instead of ~565. Verify: a new
  shake's funnel trace shows `zero-calorie@0/100g=0` for ice.
- [ ] Hero, if a waiting dish, reads e.g. `10 MIN + OVERNIGHT`.
- [ ] **Hero no longer changes when switching chips** (Logan: Breakfast → Lunch → All turned the Skillet
  into the Chilli Oil pasta). Chips recorded their own hero as the day's pick and marked it seen.
  Now only All records. Today's stored pick was already rewritten by the bug, so verify TOMORROW:
  note All's hero, flip through chips, come back — same dish. Separately, by design, All's hero can
  still change when the time-of-day tier changes (a breakfast hero is replaced at dinner).
- [ ] Cook Tonight nudge "Still not feeling it? Browse Discover →" from the 3rd generation of the day.
- [x] **PASS on device 2026-09-10.** Ice is assumed stock everywhere: not under YOU'LL NEED, and the Pantry tab's Cook tonight card no
  longer says "Better with: ice cubes" (the app's staples list was never synced with generate-meals'
  Sep 7 change).
- [x] **PASS on device 2026-09-10.** A 3-minute dish reads `5 min` (never "3 min").

**C. The passage of time**
- [ ] After 7pm tonight: NEW TODAY borders still show (rolling 24h from `created_at`, not UTC date).
- [ ] Sep 11 ~1pm: the Sep 10 batch (created 12:51 CDT) loses the border; the new batch gains it.

## 2l. FOUND 2026-09-10 — open, deliberately NOT fixed  *(were only in handoff.md until now)*
- [x] **Daily report BUILT 2026-09-10** (`daily_ops_report()`, cron `ops-daily-report` 14:00 UTC =
  9am CDT / 8am CST). Every day, even at zero: Discover health on line 1, then each meal with a
  count per reason ("Cheesecake: 2 photo didn't match, 1 no reason"), top 8 + a pointer to the
  `ops_dislike_report` view. SQL-only — no edge function or CRON_SECRET can silence it. anon and
  authenticated verified unable to call it or read the view. Recipient = Vault `ops_user_id`.
  Preview without sending: `select public.daily_ops_report(false);`
- [ ] **APNs key FIXED 2026-09-10** via `eas credentials` (push key 9FADV539ZW, Koba Labs team,
  assigned to com.kobalabs.pantry; `eas.json` added so the command would run). Re-send: Expo ticket
  `"status":"ok"` AND receipt `"status":"ok"` (Apple accepted it). **Still to confirm: the banner
  actually appeared on Logan's phone**, then tomorrow's 9am send arrives unprompted.
- [x] ~~BLOCKER: NO remote push has ever reached Logan's phone.~~ Was: Expo returns HTTP 200
  with `"status":"error"` — *"Could not find APNs credentials for com.kobalabs.pantry"*. The health
  check's three "sent" results (09-05, 09-07, 09-10) were HTTP 200 only; it never read the ticket.
  Now fixed to read it (deployed). **Logan must run `npx eas-cli credentials -p ios` → Push
  Notifications → set up a new key** (needs his Apple login). Then re-send and check:
  `select status_code, content from net._http_response order by id desc limit 1` → `"status":"ok"`.
  If it still fails, the next suspect is the dev build's APNs sandbox environment. User-facing
  reminders are LOCAL notifications and do not depend on this.
- [x] Push arrived on Logan's phone 2026-09-10 (first remote push ever to land). Then made the push
  the WHOLE report: fixable (photo/recipe) meals first, up to 10, the rest collapsed into counts
  per reason — no more "select * from ..." printed on a phone.
- [ ] **Notification TAPS go nowhere — for every notification, not just the report.** The response
  listener in `hooks/useNotifications.ts` is an empty stub, so the 7 daily reminders and the day-5
  trial-end notification all just open the app wherever it was. User-facing: decide per type where
  a tap lands (meal reminder → Home, grocery reminder → receipt scan, trial-end → paywall?).
- [ ] Undecided: a report screen only Logan can open, as the daily push's tap target — each meal
  tappable through to its recipe, so a "photo didn't match" lands on the photo being judged. Needs a
  server-side check that the caller is Logan (Vault `ops_user_id`), a screen, and the tap wiring
  above. Worth it once dislikes regularly exceed ~10/day; until then the push is complete on its own.
- [ ] **Report is now an EMAIL from Claude, not a push (Logan's call 2026-09-10; Loops rejected).**
  A Claude desktop scheduled task `pantry-daily-report-email` runs 9:05am local, reads the read-only
  `public.ops_report_data()` through the Supabase connector (role `supabase_read_only_user`, granted
  that one function), and sends `email_body` verbatim from Gmail to loganmasonshaver@gmail.com. Every
  meal listed, no cap. The DB cron `ops-daily-report` is now LOG ONLY (`daily_ops_report(false)`), so
  exactly one message a day. Test email sent 2026-09-10. **Trade-off:** runs only while the Claude app
  is open — a closed laptop at 9am means it sends on next launch. To verify: tomorrow's email arrives
  without prompting; Logan should hit "Run now" once so the Gmail/Supabase approvals are stored.
- [x] **Sectioned HTML email APPROVED by Logan and LIVE** — the scheduled task now sends `email_html`
  (+ `email_text` fallback): Discover line (red if broken), totals + by-reason line, TO FIX
  (photo/recipe), MOST DISLIKED (2+), singles on one line. A meal whose dislikes are all photo/recipe
  shows ONLY under TO FIX (it was listed twice). Re-test any format change with
  `scripts/simulate-daily-report.sql` (rolls itself back).
- [ ] **Verify: Sep 11 ~9:05am the email arrives by itself, in the new format.** Logan should hit
  "Run now" on the task once first, so its Gmail/Supabase approvals are stored and the unattended
  run cannot stall on a permission prompt.
- [ ] Cleanup (low): delete the old `email_body` / `lines` / `tail` path from `ops_report_data()` —
  only `daily_ops_report()`'s manual push still reads it.
- [x] trending-health-check's own push REMOVED 2026-09-10 (Logan: one notification a day). It
  still runs at 08:20 UTC and writes its `pipeline_runs` row, which §2k.A reads; the 9am report's
  first line is the alert now. A test tap confirmed the tap target is still nowhere (see above).
- [x] **Untranslated recipes — FIXED 2026-09-10.** Counted first: 6 of 219, all German, all the same
  shape — English name, ingredients and step titles over German step DETAIL. Why: the extraction
  prompt's fidelity rules ("PRESERVE THE PREPARATION METHOD exactly") beat its translate rule for
  method text, and the existing guard (recipe-integrity looksUntranslated) only judges INGREDIENTS.
  Now: a prompt line, a pipeline safety net that detects foreign step text before storing and
  translates it in a separate verified call (or drops the recipe), and the 6 repaired via the
  backfill's 'translate' mode. Re-scan: 0 of 219. Beef Pasta Skillet verified English on device.
- [ ] **"Beef Pasta Meal Prep" dropped two seasonings** (~8g butter seasoning, ~8g garlic & herb) —
  in the step text only, so they never reach a grocery list. Violates 100% ingredient retention.
  WHY the retention check let it through is uninvestigated. (Its step 4 "onions" is the creator's
  own error, copied faithfully — not ours.)
- [ ] **"Marinate chicken with ingredients listed above" (Sukiyaki).** The grouping IS stored
  (`ingredients[].section = "chicken marinade"`) but the detail screen regroups by pantry status
  and discards it. Proposed, not accepted: expand back-references from the stored section.
- [ ] **Pre-push AI review fails open on EVERY commit** ("Allowing push (fail-open by design)"). It is
  reviewing nothing — including both cron migrations. Every push since is unreviewed.
  Clue (2026-09-10): the hook prints "Fix: claude auth login", yet `claude auth status` in a normal
  shell says loggedIn true — so it is the hook's ENVIRONMENT (env/keychain access from git), not
  the login. Start there.
  New clue (2026-09-10 evening push): the hook's error is now explicit — `401 ... OAuth access token has
  expired`. So the hook's `claude` reads a token that is not refreshed, while the interactive one refreshes
  fine. Likely a separate credential path (config dir / keychain entry) for non-interactive runs.
- [ ] **Health check shares the pipeline's credential**, so one auth failure silences both — how three
  days of cron outage went unnoticed. Fix: a SQL-only cron that checks `trending_meals` and pushes
  via Expo directly.
- [ ] **Cup-measured produce drawn whole** (Sukiyaki "1 cup shiitake", "2 cups cabbage"). The extractor
  should name the prepared form ("sliced shiitake").
- [ ] **"fruit" never matches a specific fruit** — needs a category taxonomy.
- [x] **Image cache key is the meal name only — confirmed a THIRD time 2026-09-13. BUILT + DEPLOYED the same
  day (plan A below, Logan's go), VERIFIED server-side, device tell still open.** "Egg White and Vegetable Scramble" on his phone (greens, onion, butter, no
  paprika) shows the photo generated 2026-09-02 for a different recipe of the same name (cauliflower,
  cheese, potatoes, paprika). Earlier: "Greek Yogurt and Granola Power Bowl" lists pineapple and shows a
  July photo with banana.
  **Numbers (generated_meals, 2026-09-02 → 09-13, 141 rows / 125 names):** 13 names recur, and ALL 13
  recur with a different ingredient list; ~5 of the 13 differ in a way a photo shows (scramble:
  potatoes+cauliflower+cheese vs greens; Thai bowl: chicken salad vs chicken+cauliflower; frittata: rice
  vs cheese; power bowl: orange vs pineapple). 19 of 141 meals (13%) were served an image_cache row
  created BEFORE the meal, 14 of them from before September. Zero generated names collide with
  Discover, so today this is Cook Tonight vs Cook Tonight — and it gets WORSE with users, because every
  pantry with egg whites produces the same generic names. Cost side: flux-2 at 512px is ~$0.003/image
  (fal note in memory), so even a 0% hit rate is 3 images/day ≈ $0.28/user/month, under 3% of $9.99.
  The cost model the name-only key protects is not the binding constraint anymore.
  **RECOMMENDED (A) — key = normalised name + fingerprint of the first 3 non-staple ingredients.**
  Server (`generate-meal-image`): every caller already sends `ingredients`; strip leading quantities
  (the trending pipeline sends "1 slice American cheese"), prep words and colour adjectives, singularise,
  drop `ASSUMED_STAPLES` + water/ice, take the first 3 in recipe order (the model lists the mains first
  — row 601 gives egg whites+greens+onion), sort, join → `name#fp`. Look up `name#fp` ONLY when
  ingredients were sent — falling back to the bare name IS the bug. Requests with no ingredients keep
  the bare-name path (legacy + sorted aliases untouched). On generation write `name#fp`, and the bare
  name only if absent, so `backfillTrendingImage` and no-ingredient callers keep working. **The storage
  filename must carry the fp too** — today it is `${cacheKey}.jpg`, so a second variant would overwrite
  the first variant's file under everyone already holding that URL. Log hit/miss by key type so the real
  miss rate is measured after a week, not guessed. Client (`lib/mealImages.ts`): the AsyncStorage cache
  is ALSO keyed by bare name — key it by name + first-3 ingredients or the phone keeps serving the old
  photo after the server is fixed. `app/meal/[id].tsx` tags by name per screen, fine. Check that
  `saved.tsx` and onboarding's two call sites pass ingredients. Discover is unaffected: names are
  deduped by `nearDup`, the client reads `trending_meals.image` directly, and the self-heal path recomputes
  the same fp from the same stored ingredients. One-time cost: the ~112 Cook Tonight names already in
  cache regenerate once as they recur, ≈ $0.35 total. Tests: the fingerprint normaliser (quantities,
  staples, order, fewer than 3 left). PASS: the scramble on the phone shows greens and no paprika; a
  same-name same-mains meal logs a `name#fp` hit; a week of logs gives the miss rate.
  **Rejected:** (B) make names more specific in the prompt — unenforceable, and the NAMING rule forbids
  ingredient-list names. (C) vision-check the photo against the ingredients on every hit — a paid call on
  the common path to save $0.003 on the rare one. (D) fingerprint ALL ingredients — every garnish change
  is a miss; the top 3 is what a photo shows.
  **VERIFIED 2026-09-13 19:20 UTC:** row 601's exact payload through the deployed function → MISS, new
  file `egg-white-vegetable-scramble-egg-white-leafy-green-onion.jpg`, photo shows egg whites, wilted
  greens, diced onion, pepper, no paprika (the Sep 2 file: potatoes, cheese, paprika). Same payload
  again → instant HIT on `…scramble#egg white+leafy green+onion`, same `?v=`. The Sep 2 bare rows are
  untouched (created_at unchanged). A non-internal, non-user caller with the same payload got the bare
  photo — the pre-auth fallback, as designed. `_shared/image-fingerprint.ts` (+8 tests),
  `lib/imageCacheKey.ts` (+2); tsc 135/16.
  - [ ] **Device tell:** today's scramble on Logan's phone KEEPS the old photo — the URL was written into
    the cached meal object at generation, and nothing re-requests it. The tell is the NEXT generation
    that repeats a name with different mains (or the next same-name meal shows its own mains). The
    client half is JS-only: a Metro reload picks it up, no rebuild.
  - [ ] **Measure after a week:** `select count(*) from image_cache where meal_key like '%#%' and
    created_at > now() - interval '7 days'` against the week's `generated_meals` count = the real
    Cook Tonight regeneration rate. Function logs carry `[image-cache] HIT|MISS|HIT-bare-fallback fp|name`.
  - [ ] Follow-ups, deliberately left: onboarding's Home pre-fill (`app/onboarding/index.tsx` ~4054) reads
    `image_cache` by BARE name, which fingerprinted reads now ignore — harmless (Home fetches anyway),
    but it is dead weight serving the old bug's photos; the Saved backfill (`saved.tsx` ~298) sends no
    ingredients, so legacy saved rows without `image_url` still get a name-level photo.
  - **Mechanism note:** the legacy `service_role` JWT is NOT internal to generate-meal-image (its
    `SUPABASE_SERVICE_ROLE_KEY` env holds the `sb_secret_` key) — a call with the JWT is treated as an
    anonymous caller. Use the `sb_secret_` key, same as the generate-meals dry run.
- [ ] Undecided, carried from 2026-09-07: Home layout (own-row vs one row); feedback board Phase 2
  (Profile has NO support/contact row at all).
- [ ] **Pantry tab's Cook tonight uses its OWN two-way substring matcher** (`missingFor` in
  app/(tabs)/pantry.tsx), the one isAlreadyInList was written to replace — it can call a meal ready
  that the detail screen says needs shopping (pantry "rice" covers "rice vinegar"). Switching it
  to countMissingIngredients changes Ready-to-cook counts, so measure before switching.
- [ ] Cleanup: Pantry's 19 hardcoded `'#4ADE80'` → `COLORS.accentGreen`; unify the two singularisation
  rules (`pantry-check` vs `recipe-integrity` — the latter is better); grep for `COLORS.text` on
  dark surfaces (it is #000000 for WHITE cards — made the dislike sheet unreadable).

## 2n. AUDIT — Cook Tonight run 48 (2026-09-10 18:03)  *(Logan: "audit everything about those meals")*
Shown: Egg and Vegetable Scramble (36g/520), Cottage Cheese and Rice Bowl (33g/549), Egg and Cheese
Breakfast Wrap (24g/559). Target 40g/525 (160g ÷ 4 meals). Rows in `generated_meals`, funnel in
`pipeline_runs` id 48. Photos viewed. Ordered by how much a paying user would notice.
- [ ] **BUILT 2026-09-10, UNVERIFIED — verify on the next generation:** funnel `slotPromoted` names any dish
  coverage pulled in, `rankCandidates[].slot` is recorded, and the deck holds a lunch/dinner. Replaying run 48
  gives Scramble + Cottage Cheese Bowl + Chicken and Pesto Rice Plate (44g) instead of the 24g wrap.
  Pantry tab: lunch and dinner now stand in for each other (score 0.5), so a "lunch" plate leads at 6pm.
  **Zero dinners at 6pm.** The prompt asks for a spread across eating occasions, and the client
  (`app/(tabs)/pantry.tsx` ~607) floats the one that fits the current hour, assuming the deck HAS one.
  The ranker (`generate-meals/index.ts` ~1186) has no slot term: all 5 dinner candidates (Thai basil
  chicken, beef taco bowl, chicken cauliflower skillet, beef stir-fry, pesto chicken rice) were
  repeats, so 2 breakfasts + 1 "any" shipped, and chicken and beef never appeared. Fix idea: guarantee
  at least one lunch/dinner in the 3, even a repeat, ahead of a third breakfast. Tied to the §2k
  freshness decision.
- [ ] **BUILT 2026-09-10 (`nameFormGaps`), Cook Tonight only — UNVERIFIED live.** Measured first: flags
  exactly the 3 real cases in 129 generated meals (this wrap, the taco dish, a flour "wrap"), and 0 of
  219 Discover recipes once rice cakes and roti counted as carriers. NOT wired into generate-trending-meals
  yet: that would confound the Sep 11 3am check. Wire it after that passes. Tell: `nameGapDetail` reads
  "... -> wrap (no tortilla or wrap)".
  **"Egg and Cheese Breakfast Wrap" has no wrap** — step 3: "Serve in a bowl with rice as a base".
  The photo is honestly a rice bowl, so the title contradicts its own photo. `nameIngredientGaps`
  checks FOODS in the title (`DEFINING_FOODS` has tortilla), and wrap/taco/burrito/sandwich/toast are
  FORMS, so nothing checks them. This also answers the open "why did taco slip past" item above.
  Fix: form → required-ingredient map (wrap/taco/burrito/quesadilla → tortilla|wrap|lettuce
  cups; sandwich/toast → bread|bun|roll|bagel).
- [ ] **BUILT 2026-09-10 — UNVERIFIED live.** Shrinking now cuts calorie-dense food (protein under 30% of
  its own calories: rice, nuts, butter, oil, cheese) to as low as 0.5x before touching protein, and trims
  lean food only to the band's edge. Replay: cottage bowl 546 kcal / 43g (was 549 / 33g). Also fixed: with
  counted eggs the old formula undershot (wrap 559 -> now 525), and per-macro factors replace the calorie
  factor on protein. Visuals under ¼ cup switch to tbsp. Tell: `[scale]` log lines read "protein ×0.9x".
  **The calorie scaler throws away protein.** `scaleToTarget` shrinks every measured ingredient by
  one factor. Cottage Cheese and Rice Bowl was ~46g protein at 784 kcal (above target) and shipped at 33g
  / 549; dropping only the 30g of pecans gives ~577 kcal at ~43g. 8 of 10 candidates were scaled this
  run. Needed: cut fat/carb items (nuts, butter, oil, cheese, rice) before protein anchors. Also:
  displayed protein is multiplied by the CALORIE factor while counted eggs stay unscaled, so card
  macros drift a gram or two from the ingredient list.
- [ ] **COUNTER BUILT 2026-09-10 (`flavourAxes`, `flavourAxesShown` in the funnel) — not ranked on.**
  Baseline over stored meals: savory generated dishes fall under 2 axes 20% of the time; savory CREATOR
  recipes in Discover, 45%. The prompt's 2-of-4 rule is stricter than the creators' own recipes, so a gate
  on it would be wrong. The real signal is ZERO axes on a non-sweet dish (generated 9%, creators 12%), and
  all 7 generated cases are egg or cottage cheese dishes. Next step, not built: a narrow prompt or rank
  rule for egg dishes, after a few runs of the counter.
  **The prompt's FLAVOR PRINCIPLE is unenforced — 0 of 3 meet it.** Line ~594 requires 2 of 4 axes
  (acid / heat / umami / aromatic fat). Wrap: 0. Scramble: 0. Cottage bowl: 1 (black pepper). No salt
  in any of them. The pantry held lime, pickles, salsa, hot sauce, soy sauce, garlic and pesto.
  Measure first (funnel counter of axes per candidate), per the file's own gate-after-evidence rule.
- [ ] **Rice in all three.** Potato was base-banned, which left Cooked Rice, Protein Cereal and Granola
  as the offered carbs, and only one of those is savory. Today's carb-completeness rule then forced rice
  "alongside" a scramble and as the "wrap". A pantry with 2 savory carbs has 1 after a ban, so every
  savory dish shares it. Risk: if rice and potato are banned together, the only carbs left are
  breakfast cereals.
- [ ] **Leftover "Cooked Rice" is never reheated.** Cottage bowl says "warm cooked rice" with cookTime 0;
  no step anywhere says to microwave it.
- [ ] **Cottage Cheese and Rice Bowl is four pantry items in a bowl** (cottage cheese, rice, pecans,
  pepper). The photo reads as rice pudding. It is "fresh" only because it is an odd recombination.
- [ ] **Scramble photo shows pooled runny yellow liquid** and mostly cauliflower. Cooking 5 min is
  also short for sautéing cauliflower tender AND scrambling. The photo is now cached under that NAME
  for every user (§2l image-cache item), and the rice-bowl photo now owns "egg cheese breakfast wrap" too.
- [ ] Minor: `visual` mixes "1/2 cup" (model) and "½ cup" (scaler) on the same screen.
- Environment caveat, not a bug: the repeat window is saturated by test bursts (4 generations in 50
  min today, 8 in 45 min on 09-07), so 7/10 repeats is partly testing. But this pantry supports ~6
  real dinners, so a once-a-day user would exhaust them within a week anyway.

## 2o. AUDIT — Cook Tonight run 51 (2026-09-11 23:05), first run on last night's four fixes
Shown: BBQ Chicken and Rice Plate (52g/553), Savory Greek Yogurt and Egg Omelet (46g/525), Egg White
and Vegetable Frittata (51g/527). Target 40g/525. Photos viewed; every quantity and step read.

**Confirmed working (was the point of the fixes):**
- [x] **Protein 52/46/51 — all above the floor**, against 36/33/24 in run 48. `belowProteinFloorShown` 0,
  `incompleteShown` 0, `repeatsShown` 1 (the frittata), `slotPromoted` empty because the top three
  already held two dinners and one breakfast. `rankCandidates` now carries `slot`.
- [x] **The protein-first scaler behaved exactly as designed.** BBQ plate 777 -> 553 by halving sauce,
  rice and oil while the 160g chicken and the cauliflower were untouched. Omelet 613 -> 525 by cutting
  cheese, butter and granola ~0.73 with eggs, egg whites and yogurt untouched; butter's visual went
  "1 tbsp" -> "¾ tbsp" correctly.
- [ ] Form check NOT exercised — nothing was named wrap/taco/sandwich. `nameGaps` 0.

**New, found in this run:**
- [x] **FIXED tonight: a candidate was dropped for "missing" water.** `notCookableMissing: ["water"]`.
  The prompt promises water is always available; the ASSUMED array never had it, so any recipe listing
  water (soups, oatmeal, anything simmered) was disqualified as uncookable. Fixed in `pantry-check.ts`
  rather than by adding "water" to ASSUMED, because isInPantry matches substrings and a bare "water"
  would make "watermelon" and "coconut water" assumed in stock. Tell: `notCookableMissing` stops
  naming water.
- [x] **FIXED tonight: granola on a savory omelet.** The carb rule demanded a carb, potato is
  base-banned, and the only carbs offered were rice, protein cereal and granola — so a dish named
  "Savory ... Omelet" was served "with a side of yogurt topped with granola". Sweet FOOD (granola,
  cereal, cookies, ice cream, chocolate chips...) now counts as a savory clash and sorts last.
  Honey, maple and brown sugar deliberately excluded — honey-garlic chicken is real. Measured: flags
  this dish and adds zero new flags across the 129 generated and 219 Discover meals. Tell:
  `savoryClashShown` stays 0 and no sweet cereal appears in a savory dish.
- [x] **PROMPT RULE ADDED 2026-09-11, UNVERIFIED — needs the next generation.** "SEASON IT, AND WRITE THE
  SEASONING DOWN": the rule now says salt and the assumed spices are free, can never make a meal
  uncookable, and must appear in BOTH the steps and the ingredients. Baseline to beat, measured tonight
  over 129 stored meals: 50% unseasoned. Tell: funnel `stepIssuesShown[].unseasoned` all false.
  Was: **No salt or pepper in ANY of the three, and 51% of all 129 generated meals mention neither.**
  Numbers, not taste: `flavourAxesShown` was [1, 0, 1]. Hypothesis worth testing before any prompt
  edit: INGREDIENT COMPLETENESS ("EVERY item referenced in any step MUST appear in the ingredients
  array") makes mentioning salt cost an ingredient line, so the model stays silent instead. A prompt
  line telling it that assumed basics may be named in steps AND listed would test that directly.
- [x] **PROMPT RULES ADDED 2026-09-11 for all three step defects, UNVERIFIED.** Every cooking step must
  carry a time and a protein step a doneness cue; the FIRST step preheats the oven when one is used;
  pre-cooked pantry food is cold and must be reheated in a step. Counters added (`_shared/step-checks.ts`,
  funnel `stepIssuesShown`). Baselines measured tonight over the 129 stored meals: 8 of the 14 oven dishes
  had no preheat step, 42% had a cooking step with no time, 5 served cold pre-cooked rice unheated.
  Tell: those three counters at 0 on the next run.
  Was: **The frittata never says to preheat the oven** — step 4 says "transfer to a preheated oven at
  375°F". A cold oven adds ~10 min to a dish whose cookTime claims 20.
- [ ] (covered by the rules above) **The BBQ chicken step has no time and no doneness cue** ("sear until cooked through") on a whole
  breast. The prompt's own example step says "cook 6-7 minutes per side until golden". Food safety plus
  beginner usability. Its 15 min cook is also short: chicken 12-14 + glaze 1 + cauliflower 5-7, all
  sequential in one pan, is ~22. No rest for the chicken either.
- [ ] (covered by the rules above) **Cold "Cooked Rice" is still served without a reheat step** — "over a bed of warm cooked rice"
  and "stir in the cooked rice". Second run in a row (§2n).
- [ ] **360g of liquid egg whites (1.5 cups, ~12 whites) in a one-serving frittata** — about 80% of a
  16oz carton, and 1.5 cups of liquid plus veg and rice needs a small skillet the recipe never names.
- [ ] **The omelet splits 115g of yogurt** between the egg mixture ("half the Greek yogurt") and the
  side, without the ingredient list saying so.
- [ ] **Funnel gap:** `notCookableMissing` names the missing FOOD but not the dish that died, so which
  candidate the water bug cost cannot be recovered. Same argument that put names into `nameGapDetail`.
- [ ] **Mixed quantity formats in one list** — the model writes "1.5 cups" and "1/4 cup", the scaler
  writes "½ cup" and "¾ tbsp", and both appear on the same screen. Normalise at display.
- [x] **EGG DISHES NO LONGER NEED A CARB (2026-09-11), UNVERIFIED.** `isEggDish` exempts omelets,
  frittatas, scrambles, shakshuka, quiche and egg bakes from the carb rule, and the prompt says so
  explicitly ("do NOT bolt cereal, granola or a side of rice onto one"). This is the root cause behind
  rice beside a scramble (run 48), rice in a "wrap" (run 48) and granola on an omelet (run 51): the rule
  was written against protein-and-veg PLATES and an egg dish is not one. Measured: flips 9 of 129 stored
  meals from incomplete to complete, every one a scramble, frittata or omelet; a wrap and a stir-fry
  still owe a carb. Tell: an egg dish shows with no starch bolted on, `incompleteShown` stays 0.
- [x] **CARB BAN PROTECTED 2026-09-11, UNVERIFIED.** A carb is now banned only while `minCarbsLeft` (2)
  savory carbs would remain, mirroring `maxProteinBans`. Savory excludes granola, cereal and oats, so a
  sweet carb can never be counted as the alternative that keeps a ban legal. Replayed on the real last-15
  history: the ban was about to take RICE, leaving potato alone; it now takes cheese and chicken instead,
  which is the point — variety comes from the axis this pantry has plenty of. Funnel records
  `savoryCarbsHeld`. Tell: `bannedBases` holds no carb while the pantry has only rice and potato.
- [ ] Still true from §2n: rice in 2 of 3 shown, and 2 of 3 were egg dishes. Whether the carb protection
  plus the egg exemption actually breaks the rice monotony is the thing to read on the next run.

## 2p. COOK TONIGHT — stress test across pantries, and the ship bar  *(2026-09-12)*
Every rule in generate-meals had been calibrated on ONE pantry: Logan's 55 items, protein-heavy, two
savory carbs. Several were written as direct reactions to its shape. This is the sweep across the
pantries real users will have, the bar it is measured against, and what is left.

**Harness** — `scripts/cook-tonight-sweep/`, results gitignored.
```bash
node scripts/cook-tonight-sweep/run.mjs                      # 17 cases x 2 runs, scored
RUNS=3 CASES=vegan,keto-declared node scripts/cook-tonight-sweep/run.mjs
node scripts/cook-tonight-sweep/depth.mjs vegetarian standard 7 vegetarian   # a WEEK with real history
node scripts/cook-tonight-sweep/rescore.mjs results/<dir>    # re-grade offline, no API calls
```
It drives the function's service-role `?dryRun=true` (no cap, no history, no images, nothing a user
sees) and scores each deck with the production gates themselves plus what production has no opinion
on: dietary violations, dislikes served, over the time budget, duplicate dish, repeat shown while a
fresh candidate sat unshown. ~14s and ~$0.03 a generation; a full sweep is ~8 min and ~$1.

**The bar.** HARD (blocks the ship gate): not cookable from that pantry · title promises a food or
form it lacks · steps use an unlisted ingredient · sweet food in a savory dish · no carb base when
the pantry HAS one · a declared restriction or dislike violated · protein under 70% of target *when
the pantry could reach it* · calories outside the band · over the user's time budget · two of the
same dish in one deck · a repeat shown over an unshown fresh candidate. SOFT (tracked, not blocking):
unseasoned · untimed cooking step · oven never preheated · cold pre-cooked carb never reheated ·
under 2 flavour axes · invented marketing name · absurd single portion · every dish on one base.

**Results (34 decks, 102 meals per sweep, all re-scored with the final scorer):**
| sweep | decks clean | hard fails |
|---|---|---|
| 1 — before any of this | 27/34 | 6 dietary violations, 6 not cookable, 1 duplicate, 1 name gap |
| 4 — after the diet gate + matcher fixes | 31/34 | 3 not cookable, 1 protein |
| C — final | **32/34** | 4 not cookable |
| D — final, consecutive | **31/34** | 3 not cookable, 1 ghost ingredient |

**Depth — a WEEK on one pantry with real history accumulating, which a breadth sweep cannot test.**
Day 1 was never the risk; the question is whether day 7 still works once the repeat window is full and
the base ban has fired. 21 meals each, all 21 distinct dishes in every run:
| pantry | clean days | protein range | repeats in last 3 days |
|---|---|---|---|
| Logan's (55 items) | **7/7** | 41-75g vs 50g target | 3 of 9 |
| vegetarian | **5/7** (was 3/7) | 29-76g vs 50g | 3 of 9 |
| thin (12 items), beginner 15-min | **5/7** | 24-50g vs 43g | **9 of 9** |
| carb-heavy vs 50g target | 1/7 | 20-57g vs 50g | 4 of 9 |

The thin pantry's last three days were ENTIRELY repeats — 12 items cannot produce 21 distinct good
dishes, and the ranker correctly prefers a familiar dish that hits the macros over a novel one that
does not. That is the same product answer as the protein ceiling below: tell the user their shelf is
the limit, rather than generating around it.

**Found and fixed** (each has its own commit and tests):
- [x] **Dietary restrictions were never enforced, only requested** — sweep 1 served soy sauce and
  sourdough to gluten-free, feta and butter to dairy-free, pecans twice to nut-free. `_shared/diet-check.ts`
  now enforces in code and its drop is the ONE gate that is never floored. Zero violations since.
- [x] **The app never sent the diet style at all.** `profiles.diet_type` (Pescatarian/Vegetarian/Vegan)
  was split out for Discover and `useMealSuggestions` was never updated — it did not even SELECT the
  column. Every generation ever made was blind to it.
- [x] **"Protein powder" counted as in-stock in every pantry** — the head-noun matcher compares last
  words and "garlic powder" is an assumed staple. Class words (powder/sauce/oil/milk/broth…) no
  longer match on the last word alone.
- [x] **Water counted as a missing ingredient** (§2o), **granola on a savory omelet** (§2o).
- [x] **The model under-portions plant protein.** A failing vegetarian day had ONE of nine candidates
  over the floor. The prompt now carries the protein density table and must add up what it wrote.
  After: vegetarian 3/3 clean, vegan 3/3, thin 3/3, asian 3/3.
- [x] **Macro fit punished a 73g meal as hard as a 27g one**; only the shortfall scores now, doubled.
- [x] **Counted quantities blocked resizing** — "1 pack" udon and "15 large" shrimp left a 690 kcal
  dish against a 467 kcal cutting target. Counts of 4+ now scale to whole items; 3 or fewer stay
  frozen, so the "0.5 large eggs" landmine is untouched.
- [x] **A vegan in a shared fridge saw ONE meal.** Told "vegan" with salmon, turkey, chicken and Greek
  yogurt in the scanned list, the model used them anyway; the diet gate (never floored) dropped 8-9 of
  10 and one card was left. The pantry is now filtered by the restriction BEFORE the prompt — the
  model cannot cook what it never sees. After: 3/3 full decks, zero drops. Funnel: `pantryHiddenByDiet`.
- [x] **An empty pantry was silently replaced by a made-up one** (chicken breast, rice, eggs,
  broccoli) so the model had something to work with — reachable through the post-scan reveal when a
  scan finds nothing, and a vegan would have been offered chicken. Now an `empty_pantry` error with
  no retry button: "Add a few items to your pantry first."
- [x] Ranking: a not-cookable meal can no longer LEAD a deck; slot coverage can no longer promote a
  dish under the protein floor (it was costing ~15g on the third meal every day of a vegetarian week);
  one dish cannot appear twice under two names.

**OPEN — decisions for Logan, not bugs:**
- [x] **DECIDED 2026-09-12 (Logan): the floored cookability gate stays as it is.** ~3% of meals on a
  thin pantry need one item the user lacks, and the card already says "Better with: <item>". A short
  deck was judged worse than a deck with one shopping line, which is the same answer every other
  floored gate in the file already gives. Not to be reopened without a new measurement.
- [x] **BUILT 2026-09-12, UNVERIFIED ON DEVICE — the pantry-limit line.** When EVERY meal in the deck
  misses the protein floor, Home's "Cook from your pantry" header carries one muted line: "Light on
  protein for your {N}g-a-meal goal — add one when you shop." Same 75% floor the ranker uses, so it
  appears only when the server had nothing better; it waits for the profile network read, because
  proteinGoal falls back to 180 and telling someone they are short against numbers that are not
  theirs is worse than silence. No button — "See all →" in that header already goes to the pantry.
  Measured against 68 real sweep decks: fires on 3, ALL of them the carb-heavy pantry, and silent on
  the other 15 pantry types. **Needs a look on device** — it sits inside the measured header wrapper
  that feeds the hero fit, so it should push the hero down rather than over it, and the copy wraps to
  two lines on a narrow screen.
- [x] **Line seen on device 2026-09-13 — and Logan caught the trigger being wrong.** It fired when the
  GOAL was raised to 300g, blaming the pantry for a shortfall the goal caused. Rebuilt: it now needs
  the symptom (every meal under 75% of the per-meal target) AND the cause — the pantry's own protein
  sources cannot reach the target at normal portions (`lib/proteinCeiling.ts`, two densest sources at
  200g inside the calorie budget) — AND a target a single meal could carry at all (≤ 70g). Copy:
  "Your pantry can't reach 40g of protein a meal — add a protein source." Note the spec: few sources
  is not the test; eggs and steak alone can carry 40g, so a short deck there is the generator's fault
  and stays silent. UNVERIFIED on device in the new form — needs a pantry that is actually thin.
- [ ] Optional follow-up: the Pantry tab's own "Cook tonight" card does not carry the same line.
**SHIP CHECKLIST — what is actually left (2026-09-12, after ~750 generations):**
- [x] **One real generation from the phone — PASSED 2026-09-12 00:56** (pipeline_runs 503, `dry_run =
  false`, 3 generated_meals rows, recent_meal_names updated, 6 image rows within 5 s). **BUT the phone
  was on a stale bundle:** Metro had been up since Sep 7 and its served bundle held none of the client
  changes (diet-style merge, empty-pantry error, pantry warning line, Pantry-tab evening sort). Server
  path verified; the client still needs `npx expo start -c` from `/Users/loganshaver/pantry` + a reload,
  then the two device checks.
- [x] **BUILT 2026-09-13 (Logan: "fix the protein issue"): protein is sized to the target.**
  `topUpProtein` grows the lean protein anchor toward the target from the corrected numbers before the
  calorie resize, capped at 250g meat/fish, 350g yogurt/tofu/cottage cheese, 60g powder, and the
  calorie drop line; condiments can never be the anchor (the first draft grew soy sauce to 7¾ tbsp —
  caught by replaying row 503, not by a user). `PROTEIN_FLOOR` = 0.85 in one place, matching the
  prompt. Sweep after: meals under 85% of target **27 → 15** of 114, median 100% of target (was 98%),
  91 of 114 topped up; a week on Logan's pantry 7/7 clean with every meal 45-68g against 50; the
  vegetarian week 6/7 (was 5/7), third meals 38-53g (were 26-33g). Home's warning line stays at 75%.
- [x] **FOUND 2026-09-13 on Logan's phone (row 601): 2 cups / 504g of egg whites in one scramble.** The
  math was right (57g); the portion was a carton and a half. The model wrote 360g, the corrected meal
  came in at 298 kcal, and the calorie UP-resize grew every measured item 1.4x to fill the gap — the
  top-up had a portion cap, the resize never did. Fixed: `clampPortions` runs first (egg whites 350g,
  whole eggs 250g, meat 250g, powder 60g — one shared `anchorCap`); the up-resize now takes calories
  from dense food first and never grows a protein past its portion; a scaled count keeps its grams
  honest ("6 large" eggs = 300g). Two sweeps after: 29/38 then 32/38 clean with only the accepted
  failure kinds; portions at or over the cap 14 → 6 (the six sit exactly AT the cap).
- [x] **Row 601 too: step 1 says "add diced onions" under an onion line that reads "1/4 medium" —
  nothing in the recipe dices anything.** The prompt's prepared-form rule now covers knife work: the
  cut goes in the ingredient NAME ("diced yellow onion"), which is where the display code, the pantry
  matcher and the image describer already expect it (`recipeTemplates` has used "diced potato" all
  along). Measured, not gated: `unpreppedForms` in the funnel's `stepIssuesShown` counts cuts whose
  first mention is inside a cooking step. Deployed 2026-09-13. **UNVERIFIED on a real generation** —
  tell: the next `pipeline_runs` funnel row shows `unpreppedForms` 0 on the shown meals, or names
  which form slipped; if it keeps slipping, the lever is a prep step, not the visual field.
- [x] **FOUND 2026-09-13 in Logan's 300g generation (row 548): a smoothie shipped as ONE ingredient** —
  45g protein powder claiming 78g protein and 500 kcal. The phantom-ingredient prune drops anything
  the steps never name, and "Combine all ingredients in a blender" names nothing, so yogurt, fruit and
  milk were stripped before macro correction; the correction then refused a 159 kcal list and left
  the model's numbers on the wreck. Fixed: a collective reference vouches for the whole list, and
  steps naming half the food or less are a wording problem, never phantom food.
- [x] ~~OPEN — Logan's question: why two 32g meals against a 40g target?~~ (row 503). Was: In order: only 2
  of 7 survivors were fresh and both were 32g (cheese and chicken were banned for overuse); 32g clears
  the code's 75% floor (30g) so both rank tier 0, and fresh beats a 59g repeat inside a tier; the
  model's own arithmetic said 140g beef ≈ 40g but FatSecret priced it at 32g. "Supposed to happen"
  under the current floor — which is looser than the prompt's own minimum (85% = 34g). Proposed, NOT
  built: (1) a deterministic protein top-up after macro correction — scale the lean protein anchor up
  toward the target, bounded by a per-food cap and the calorie band, then let the dense trim rebalance;
  (2) raise the code floor to 0.85 to match the prompt. Sweep + depth before shipping either.
- [x] ~~One real generation from the phone.~~ Was: Every run above was the service-role dry run, which
  skips auth, the daily cap, the history writes, recent_meal_names and images. The production path
  shares the code but has NOT been exercised since any of these changes. Tap Generate once; the tell
  is a `pipeline_runs` row with `dry_run = false` (the column was hardcoded true until today), three
  new `generated_meals` rows, and photos. If the deck is empty or errors, this is where to look first.
- [ ] **Two device checks:** the pantry-limit line (raise your protein goal in Profile to force it;
  it must push the hero down, not overlap it) and the Pantry tab at dinner time floating a "lunch"
  dish ahead of a parfait.
- [x] **Eye test DONE by Claude over 54 meals: 44 would-cook (81%; 88% excluding the impossible
  pantry), 9 wouldn't, 1 embarrassing** — 334g of DRY lentils in one serving, priced as cooked. The
  nine were mostly titles promising a technique the steps never do (a "Bake" with no oven, "Roasted"
  in a skillet, "Grilled" toast, "Lettuce Wraps" in tortillas, a "Herb Bowl" with no herb, a "Scramble"
  of hard-boiled eggs). **BUILT 2026-09-12, unverified live:** `nameTechniqueGaps` (in the name gate,
  floored) and `dryStapleOverload` (floored) plus a DRY-OR-COOKED prompt line; measured on 1,170 meals
  first — no-bake / microwave / pre-roasted-ingredient / dried-herb-blend false positives are exempted
  and tested. "1¼ pinchs" fixed. Logan's own read for appetite is still worth doing.
- [x] ~~The eye test — yours, not the harness's.~~ Was: 17 decks / 51 meals from the final sweeps are in
  a digest (sent to you). Rate each *would cook / wouldn't / embarrassing*. Bar: >=80% would-cook,
  zero embarrassing. The harness cannot judge appetite, and photos only exist for real runs.
- [x] **Quality counters in the daily email — LIVE 2026-09-12** (migration `20260912061834`). One line
  under the Discover health line, red when: any generation failed, any savory clash shown, unseasoned
  > 30%, uncookable-shown > 10%, protein-floor misses > 20%. A failed generation now writes a funnel
  row (`failed: true`) so "N generations" is honest. The first line read 67% unseasoned from row 503's
  OLD counter (soy sauce and sweet bowls were not credited); the counter is fixed and every later
  generation reads correctly. Keys `cook_tonight` / `cook_tonight_bad` in ops_report_data().
- [x] ~~Quality counters in the daily email~~ Was: (`unseasoned`, `flavourAxesShown`, `belowProteinFloorShown`,
  `notCookableKept`, `droppedByDiet` from `pipeline_runs`), so a prompt regression after launch is
  visible the next morning instead of when a user complains. SQL in `ops_report_data()`; a migration.
- Not needed to ship, tracked: soft metrics still above where they should be — ~45% of meals reach fewer than
  2 flavour axes, ~20% unseasoned (was 50% before the seasoning rule), ~15% have an untimed cooking
  step. None blocks the gate; all are visible in `stepIssuesShown` / `flavourAxesShown`.

## 2m. POST-LAUNCH — popularity signals  *(Logan asked 2026-09-10: "most liked in 7 days" as the hero?)*
- [ ] **Decided: NOT the hero.** Pre-launch every recipe has 0 likes, and early on 1-2 taps would pick
  it; a popularity hero also self-reinforces (most shown → most liked → stays shown) and repeats for
  days, fighting the hero's job — the newest dish the reader has not seen, the reason to open daily.
- [ ] Instead, once there is data: a **"Most cooked this week"** shelf below the hero using `log_count`
  (cooking beats a like), count on the card ("12 cooked" — the pill already exists at >= 10), hidden
  until a floor like 5 distinct cooks. Optionally popularity as a TIEBREAKER inside the hero's pool
  of new, unseen, time-appropriate dishes.

## 2n. POST-LAUNCH — the pantry scan INSIDE onboarding, as a Superwall A/B  *(Logan 2026-09-16: "an important one to test — don't let this slip after I've launched")*
- [ ] **The test.** Arm B moves the pantry scan (and possibly the cook reveal) into onboarding,
  BEFORE the paywall, so the ask lands on a user who has just watched "N items found" from their
  own fridge. Arm A is today's flow (step 7 → createaccount → paywall → scan after). Logan's
  hypothesis, written 2026-09-16: **B converts better and costs more** — a vision call (plus a meal
  generation and images if the reveal is included) per onboarding START, paid before anyone has
  subscribed. Which wins is a number, not a vibe: (paid × LTV − cost per start) per arm.
- [ ] **Mechanics to confirm before building (use the `superwall` skill / docs — do not assume):**
  Superwall campaign split assigns the arm; the app has to read the assigned variant before step 7
  and branch. The scan runs under the user's JWT and the cap is per user, so it must sit AFTER
  createaccount — or get an anonymous path with its own abuse ceiling (the anon key ships in the
  bundle; see §6e). Scan cap, scan-cap refund, and the first-run consent prompt all have to hold
  inside onboarding.
- [ ] **Measure per arm:** onboarding start → trial start, trial → paid, and OpenAI + fal spend ÷
  onboarding starts. Needs real traffic — a few hundred starts a week so an arm reads inside a
  month. Prediction and kill line go in `~/founder-research/MY-EXPERIMENTS.md` **before** it runs
  (queued there as Q2 with the prediction blank — Logan fills it).
- [ ] **Do not run it confounded:** §4 (skip-onboarding paywall variant) and §5 (rating prompt)
  settled first, and not in the same window as a price test.

## 2h. Also designed, not built — scale instead of regenerating
Logan asked why a goal change needs a whole new generation when the dish is still fine.
- [ ] **Scale the existing meals for calorie/protein/macro changes instead of regenerating.**
      Applies ONLY to those. Diet type and dietary restrictions must still regenerate (a vegan
      cannot eat a scaled chicken dish); max_prep_minutes must too (scaling will not make a 45-min
      dish take 15); meals_per_day needs MORE dishes, not bigger ones.
      Machinery already exists: onboarding scales templates today, `scaleVisual` handles fractions
      and ranges, and `WHOLE_UNIT_FOODS` knows eggs are 50g, bananas 120g.
      **Round countable items to whole units** — this is the "0.5 large eggs" trap, and
      WHOLE_UNIT_FOODS is the fix that did not exist when that rule was written.
      **Cap the scale factor (~0.7-1.4x)**; past that the dish stops being the dish and a
      regeneration is the better answer.
      Bonus worth stating: a scale creates NO new dish names, so nothing enters the anti-repeat
      window and it sidesteps the whole repeat problem. Images are already cached too.

## 2e. Trial reminder notifications — RESEARCHED 2026-09-05, not yet applied
Logan: mimic what the highest-converting apps do, do not guess. Queue this AFTER 2d's four items.

**What is actually measured, from `~/founder-research/growth-teardowns/` (his own corroborated data,
★★★★ — the highest-rated row in the whole ledger):**
- Sunflower: adding trial reminders gave **+48% revenue, +46% trial conversions, +30% trial starts,
  +70% annual revenue**. Founder verbatim: *"We had a +48% revenue bump by adding in trial
  reminders. It was insane."* Their priming copy: *"We want you to try Sunflower for free / we'll
  remind you before your trial ends."*
- Pingo: the trial-TIMELINE page was the single biggest paywall lift, beating value-prop and
  testimonial variants. Structure: *"Today you unlock Pingo -> in 5 days we remind you -> you'll be
  charged; try it free."*
- Halo: *"Try Halo free / we'll notify when trial ends."*
- SYNTHESIS action #1: *"free 7 days · we'll remind you 2 days before · cancel anytime"*.

**THE CRITICAL DISTINCTION, and the reason not to just rewrite the notification:** every measured
lift above comes from the PROMISE OF A REMINDER MADE BEFORE PURCHASE, on the paywall/priming screen
— not from the notification's wording. Pantry already makes that promise (onboarding step at
`app/onboarding/index.tsx:3098`, "We'll remind you before your trial ends") and already delivers a
day-5 local notification from SuperwallContext. So the high-leverage half is BUILT. Do not "improve"
the notification and log it as a conversion win; it is the delivery of a promise, and its job is to
not undo the reassurance that was sold.

**No verbatim notification copy is publicly documented.** Superwall's own free-trial-reminders page
provides Title/Subtitle/Body/Delay fields and NO defaults or examples — checked directly. Anyone
claiming exact wording from the top apps is guessing.

- [ ] **Rewrite the day-5 BODY, which currently sells instead of reassuring.** It reads "Lock in
      unlimited scans, saved meals, and AI suggestions before you get charged." That is an upsell
      plus a charge warning with no cancel path — the opposite of the low-risk framing every source
      above says produced the lift. Mirror the promise instead: what happens, when, and that they
      are in control. Timing (day 5 of 7 = 2 days before) already matches the synthesis exactly —
      DO NOT change it.
- [ ] **Consider a second notification on the final day** ("Your trial ends today"). General
      practice is a 3-touch pattern and "more than one reminder builds trust", but this is NOT in
      the corroborated founder data — treat as a test, not a known win. Check first whether it
      duplicates Apple's own 24-hour trial-ending notification for auto-renewable subscriptions.
- [ ] **Log the prediction in `MY-EXPERIMENTS.md` BEFORE shipping any change here** — pricing/paywall
      bets are exactly what that file exists for, and the result is worth more than the teardowns.

## 3. Pantry scan flow — end to end + UI  *(blocks the trailer)*
- [x] **VERIFIED on device 2026-09-16 (Logan) — ONE pantry matcher on all three surfaces.**
      `lib/mealReadiness.ts` now imports `isInPantry` from `_shared/pantry-check.ts` (plain TS, no
      Deno; Metro bundles it — confirmed by building the real entry and finding it in the bundle) and
      the meal screen reads `pantryHas` from there, so Home, the detail and the server's cookability
      gate cannot disagree by construction. The matcher itself got the SAME-FOOD rule: a name inside
      another name matches only when both have the same head noun after cuts are stripped, so
      "banana peppers" ≠ banana, "eggplant" ≠ egg, "licorice" ≠ rice, "salted butter" ≠ salt,
      "chicken salad" ≠ chicken, "egg whites" ≠ egg, "crushed tomatoes" ≠ Tomato Sauce (its old
      test asserted the opposite; the clause behind it was the banana one) — while "chicken breast",
      "boneless skinless chicken thighs", "garlic cloves", "pineapple chunks", "Ribeye Steak" for
      steak, "Cheddar Cheese" for cheddar all still match (+4 tests, 25 in the file). One known cheap
      false positive kept: bare "cloves" against Garlic Cloves (same shape as steak; a garnish).
      Tells: (1) the smoothie on Home reads **Need: banana** (or the deck no longer contains it after
      the next generation); (2) meal screen agrees with Home on every card; (3) `generate-meals`
      deployed 2026-09-16 ~02:10 CDT — the only function that imports pantry-check, so nothing else
      is stale. **Original finding:** three matchers, proven by running all three on the same inputs:
      | ingredient | pantry | server `isInPantry` | Home `missingIngredients` | detail `isAlreadyInList` |
      |---|---|---|---|---|
      | banana | banana peppers, banana cream pudding mix | present | present | **missing** |
      | chicken | chicken breast | present | present | missing |
      | milk | coconut milk | present | present | missing |
      | onion | yellow onions | present | present | missing |
      | oats | oat milk | missing | missing | missing |
      Server and Home use two-way substring ("banana peppers" ⊃ "banana" → present); the detail uses
      exact-after-adjective-strip ("chicken breast" ≠ "chicken" → missing). So the cookability gate
      passed the smoothie at generation, Home showed ✓, and the detail showed YOU'LL NEED banana — all
      from ONE pantry. **Plan (needs go):** (1) `lib/mealReadiness.ts` imports `isInPantry`/`findMissing`
      from `supabase/functions/_shared/pantry-check.ts` (pure TS, no Deno, node already runs it) and the
      meal screen reads mealReadiness — one matcher on all three surfaces by construction; (2) fix the
      shared matcher's false positive: a pantry item whose last word is itself a FOOD (peppers) does
      not cover a different food (banana), while a CUT/FORM last word (breast, thigh, fillet, florets…)
      still lets "chicken breast" cover "chicken" — small word list + tests beside the 19 existing;
      (3) keep the strict matcher for grocery dedupe, where it was written. `pantry_items` has NO
      banana, pineapple or avocado row although the counter photo showed all three; "Banana Peppers"
      was created alongside Bell Peppers and Greek Pepperoncini (a fridge-door jar reading, not the
      bunch). The bananas were MISSED, not mislabelled; scan-pantry keeps no raw output (logs only),
      so the dashboard function log at ~01:49 CDT is the only place to confirm per-photo counts.
- [x] **VERIFIED on device 2026-09-16 (Logan) — the meal screen no longer opens with every ingredient
      under + Add.** `pantryKnown` gate: rows render as one muted list with no chips or labels until
      the pantry has answered; the Pantry tab's disk mirror (`lib/pantryMirror.ts`, key shared with
      the tab) seeds it in a few ms, the network read confirms. Tell: open any meal — no flash of
      "+ Add" on things you own. **Original finding:** `pantryNames` starts as an empty Set and is fetched on mount;
      until it lands every row is a NEED row. Home had the identical bug and gates on `known`
      (`pantryFetched`); the meal screen never got the gate. Fix: hold the buckets (render rows
      without chips/labels) until the pantry query resolves, and seed from the Pantry tab's disk
      mirror `pantry_items:<uid>` for an instant first paint. Clean bounded fix — ship on next pass.
- [x] **VERIFIED on device 2026-09-16 (Logan) — thin pantry.** (a) the server no longer pads
      the deck with uncookable meals: a deck of one or two is returned as is, and an EMPTY one is
      refused with the slot refunded; (b) floor: under **6** in-stock items Cook Now is refused before
      the model is called (server `MIN_PANTRY_FOR_COOK_NOW`, mirrored client-side so no round trip),
      slot refunded; (c) one message everywhere (`thinPantryMessage`): "Not enough in your pantry yet
      for full meals — N ingredients so far. Scan another shelf or add a few basics."; (d) Home's
      resting card becomes "Not enough to cook from yet" + that line + a **Scan pantry** action that
      opens the scanner and retries after the save; (e) the reveal shows the line with no Retry, and
      the headline says "1 meal you can make" for a deck of one; (f) the scan modal's Add-all ends on
      the success step with the line and Done when the pantry is still under the floor. Tells (needs
      a test account or toggling most of the pantry Out): (1) with 5 in-stock items Home shows the
      card, tapping it opens the scanner, no generation is spent (`scan_usage` meal_gen unchanged);
      (2) with 6+ items but nothing cookable (e.g. only condiments) the same card appears after a
      refunded generation; (3) a normal pantry is unchanged. Not a "Need:" removal: Home's Need line
      stays and now means only "the pantry changed since this deck was made". **Original finding:** Today: 0 items → Home's
      scan hero, no generation (`empty_pantry` when the ingredient list is empty); ≥ 1 item →
      generation runs against the item(s) + assumed staples. Server drops macro-band failures and
      meals needing a structural item the pantry lacks — BUT when fewer than 3 cookable candidates
      survive it KEEPS the uncookable ones "rather than showing a short deck"
      (generate-meals ~L987). So a thin pantry produces normal-looking recipes the user cannot make,
      the reveal still says "3 meals you can make right now" (it never reads `structural_missing`),
      and Home's "Need: …" is the only true line on screen. The one thin-pantry message that exists is
      the protein-ceiling note ("Your pantry can't reach Xg of protein a meal — add a protein
      source"). **Plan (product calls for Logan, then go):** (a) server returns a SHORT deck instead of
      padding (or pads but the response says how many are cookable); (b) reveal headline counts
      cookable meals only — at 0: "Your pantry's a little thin — N ingredients found. Scan another
      area or add a few basics." with Scan as the one action; (c) Home shows that same line once above
      the deck instead of three Need cards; (d) a minimum before auto-generating (proposal: 6
      non-staple in-stock items) so a 3-item pantry is told, not charged a generation. **Decision on
      "Need:" on Home (Logan questioned it):** keep it — after (a)–(d) it only appears when the pantry
      changed AFTER generation (an item toggled Out), which is true and useful; today it also fires
      from the padding and the matcher drift, both of which go away.
- [x] **VERIFIED on device 2026-09-16 (Logan: "all is verified") — Home "Cook from your pantry": two ✓ Ready to cook over
      three meals read as partial failure** (Logan 2026-09-16). Shipped as agreed below: Home rows
      are Need or ✓ Ready only; the meal screen has an OPTIONAL group after IN YOUR PANTRY with
      "Not needed for this dish — nice if you have it." and per-row + Add. One definition for both
      screens: `isOptionalGap` / `neededMissing` in `lib/mealReadiness.ts` (+3 tests) — optional
      only when the server listed it in `garnish_missing`, exact name; anything else is needed.
      Tells: (1) today's three Home cards all show ✓ Ready to cook; (2) open the turkey salad →
      fresh lime juice under OPTIONAL at the bottom, not under YOU'LL NEED; (3) a saved or Discover
      meal's detail is unchanged (no garnish list → everything missing is needed). All three were cookable; the third showed "Better with: fresh lime
      juice" instead of the check (`PantryMealRow` in `app/(tabs)/index.tsx`: Need → Better with →
      Ready, first match wins). **Direction agreed 2026-09-16 (Logan's idea):** the Home row shows
      only ✓ Ready to cook or Need: — no garnish line — and the garnish is mentioned ONLY on the meal
      screen, as a suggestion. **The catch found in code:** the meal screen does not split gaps today;
      it lists every missing non-staple under "YOU'LL NEED" with "Tap an item to add it to your
      grocery list", so the lime juice already reads there as a requirement — deleting the Home line
      alone would make Home say Ready and the detail say You'll need. Build: an "OPTIONAL" group
      AFTER "IN YOUR PANTRY" (garnish = missing but not in `structural_missing`, via
      `lib/mealReadiness.ts` so both screens share one definition), muted rows, keep the per-row
      "+ Add", hint "Not needed for this dish — nice if you have it." "YOU'LL NEED" keeps only
      structural gaps. Meals cached before the server split have no list and fall back to all
      gaps as needed, as Home already does. Not built — waiting on "go".
- [ ] Walk the whole flow start to finish on a real device and confirm the UI holds at each step.
- [x] ~~Delete or wire the dead review screen first~~ — DELETED 2026-08-30. It was not a
      delete-vs-wire fork: step 55 is a strictly better version of the same review-and-confirm
      screen (photo grid, dedup'd list, search-doubles-as-add, keyboard handling), so step 6 was a
      superseded draft, not a missing feature. Removed the JSX block plus `toggleItem`,
      `checkedCount`, `grouped` and 8 orphaned style keys — 125 lines, no behaviour change.
      Live path is unchanged: 1 → 4 → 5 → 55.
- [ ] Re-test the camera on device: it has not been checked since the 16-photo cap and the
      full-width scan pill landed, and the bottom bar now carries filmstrip + shutter + full-width
      button. If the viewfinder feels cramped, hide the tips pill after the first photo.
- [x] **VERIFIED on device 2026-09-16 (Logan) — landscape captures come out upright.** The app is portrait-locked,
      so every in-app capture was tagged portrait however the phone was held; a wide shelf shot
      showed sideways in the theatre, the review, the zoom, and went to the model that way.
      Fix: `responsiveOrientationWhenOrientationLocked` on `CameraView` (reads the accelerometer
      at shutter time; the viewfinder does not rotate). Tell: hold the phone sideways, shoot a
      shelf, the tile in the review is WIDER than tall and the shelf is level. Gallery imports were
      already fine (Photos' EXIF gets baked in by `manipulateAsync`). Needs a DEV BUILD, not a reload.
- [x] **VERIFIED on device 2026-09-16 (Logan) — review page scrolls with 14+ photos.** The wrapping photo grid
      grew five rows tall at 14 shots, pushed the header under the search bar, and left the list's
      flex:1 ScrollView no height — nothing scrolled. Photos are now ONE horizontal strip (≤120pt,
      80pt tiles scrolling sideways past four) and the headline reads "Check these N items · Tap a
      name to fix it · ✕ to remove · type below to add". Tell: a 14-photo scan shows the headline
      directly under the strip and the list scrolls to the last item.
- [ ] **FIXED 2026-09-16, UNVERIFIED — adding an item on the scan review buzzed 5-10 times.** The
      count-up effect (16 light taps + a Success) re-ran on every change to the list's length, so a
      hand-added or removed item replayed it. Now once per result set (`countedForRef`). Tell: add an
      item on the review → one tap at most, no burst.
- [ ] **BUILT 2026-09-16, UNVERIFIED — the scan review is grouped by aisle like the Pantry tab, each aisle a card** (Logan; cards added in cc3a3da).
      Same order (`PANTRY_ORDER`, now in `lib/categoryMatch.ts`, shared) and the same mapping the
      pantry insert applies (`normalizeCategory`), headers styled like the tab's. Search results stay
      grouped. Tell: MEAT & FISH first, each item under the heading it will have in the pantry.
- [x] **VERIFIED on device 2026-09-16 (Logan) — ‹ lands on the camera; no double spend.** Spamming ‹ /
      the camera button left `scan_usage` pantry at 7 (the limit), unchanged. **Found in that test and
      FIXED same day, VERIFIED (Scan A):** the camera button flipped words on its own ("Scan 4 photos" ↔
      "View results") because its label read the in-flight ref during render; now state-driven, with
      three labels — "View results" (results exist), "Back to scan" (still running), "Scan N photos".
- [ ] **BUILT + DEPLOYED 2026-09-16, UNVERIFIED on device — the weekly scan limit is told up front, with
      one action.** `scan-pantry` accepts `{ checkOnly: true }` and answers `{ allowed, used, cap }`
      without spending (`readScanWindow` in `_shared/scan-cap.ts`, same window as the RPC); the modal
      asks on open and, at the limit, shows "You've used this week's scans" + **Add items by hand**
      over the camera, ✕ as the only exit. A scan refused with `scan_cap_reached` lands on the same
      screen instead of "Scan failed / Retry scan". Add by hand closes the scanner and focuses the
      Pantry tab's "Search or add…" field (from Home: navigates with `?add=1`, consumed on focus).
      Unknown fails open — the real call still decides. Deployed: scan-pantry only; the other
      scan-cap importers (generate-meals, generate-recipe, extract-recipe-from-url,
      estimate-meal-macros, parse-receipt, generate-meal-image) were NOT redeployed — the change is
      an additive helper they do not call, and another session has work in progress in that tree,
      so preflight will list them as newer-than-deploy until their next real deploy. Tells:
      (1) at 7/7 open the scanner from the Pantry tab → the capped screen, no camera; Add items by
      hand → Pantry tab with the keyboard up; (2) same from Home → lands on the Pantry tab, keyboard
      up; (3) under the limit the camera opens as before. **Plan as proposed:** the weekly-scan-limit
      screen offers "Retry scan", which cannot work for days (Logan 2026-09-16). His proposal: primary "add items manually" (keyboard up), second
      option "go Home". Claude's counter: (1) agree on manual add as the ONE action — close the scanner
      and focus the Pantry tab's "Search or add…" field (via a route param when opened from Home);
      (2) no Home button: the top-left ‹ becomes ✕ close on this error (the camera is a dead end when
      you cannot scan), and closing already returns where the scan started — two exits is the
      redundant-CTA rule; (3) the bigger fix: say it BEFORE the camera. Logan took photos and only then
      learned the week was spent. Read the rolling-7-day `scan_usage` pantry count when the scanner
      opens and, at the limit, open on "You've used this week's scans" + the same manual-add action.
      Server code is `scan_cap_reached` (`_shared/scan-cap.ts`); the client currently drops the code
      and keeps only the message. **Original finding:** the SCANNING screen's ‹ goes to the camera; the
      "More ingredients" areas hub is DELETED (2026-09-16, second pass). Logan's original ask was about the THEATRE's ‹, which went
      to the hub (a second screen of the same photos); the build below changed the REVIEW's ‹ instead,
      so on device he still landed on the hub. Now: theatre ‹ → camera with the filmstrip, the hub
      block + its state/styles/icons are gone (it had no other way in), and a scan still in flight is
      re-shown, never re-paid: going back mid-scan and pressing the button (it reads **View results**)
      returns to the running scan. A changed photo set or ✕ supersedes the run and drops its results
      (✕ mid-scan also stopped late results landing in the closed modal, where the meal prefetch could
      fire a paid generation). Tells: (1) scan → ‹ during the theatre → camera, strip intact, button
      "View results" → theatre continues, `scan_usage` pantry count +1 not +2; (2) same after the
      scan finishes → straight to the review; (3) no route ever shows "More ingredients, tastier meals".
- [x] **VERIFIED on device 2026-09-16 (Logan, Scan A) — review ‹ goes to the CAMERA, and the scan is not spent twice** (2026-09-16,
      Logan: "get rid of that screen"). ‹ on the review used to reopen the loading theatre, which had
      nothing left to show. Now it lands on the camera with the photos still in the strip AND the
      results kept: the big button reads **"View results"** and reopens the review with no call.
      Add or remove a photo and it reads "Scan N photos" again — a real new scan, and the old list
      is cleared first (before this, results were never cleared short of closing the modal, so a
      photo added after backing out was silently never scanned). ✕ on the camera with a kept result
      asks "Discard this scan? N items were found but not added yet" instead of the unscanned-photos
      copy. Tells: (1) review → ‹ → camera shows the strip and "View results" → tap → review, same
      list, no theatre, scan count unchanged (`scan_usage`); (2) then take one more photo → button
      says "Scan 15 photos" → theatre runs → new list; (3) camera ✕ with results → the new copy.
      **Open edge, not fixed:** ‹ on the THEATRE mid-scan goes to the hub while the call is still in
      flight; Scan again there fires a second call. Pre-existing; the ✕ there closes cleanly.
- [ ] **Cook reveal — Logan picked 1 + 2, tossed 3** (2026-09-16; `app/cook-reveal.tsx`):
      - [x] ~~"Uses 17 of your 108 items"~~ — seen on device 2026-09-16 (Logan) and REJECTED: "19 of
        your 119" read as 100 items unused. Superseded by the line below.
      - [x] ~~SUPERSEDED 2026-09-16 by the two-line rewrite below.~~ Was: validation line "Picked from your 119 items · nothing to buy"
        (falls back to "Picked from your pantry" until the count lands). The total proves the scan
        counted everything; no used-count over it, so nothing invites the subtraction. Tell: the
        line under the headline, no fraction.
      - [x] **VERIFIED on device 2026-09-16 (Logan) — "Tap a meal to start cooking" removed.**
      - [ ] **UNVERIFIED — the previous scan's meals no longer flash before this scan's** (Logan,
        second scan of the day: the 12:29 set showed for a beat, then shimmer, then the 01:01 set).
        Root cause: the reveal passes `enabled=false` believing that skips the hook's cache paint;
        the paint was later un-gated so Home could paint from disk before its pantry arrives, so the
        reveal read today's cache BEFORE the scan's prefetch had written it, then load() swapped in
        the new set. Fix in `lib/useMealSuggestions.ts`: the cache paint awaits the in-flight
        prefetch first (settled → a tick). Tell: do two scans in one day, the reveal's first frame is
        the new set. `generated_meals` timestamps show which set was which.
      - [x] **VERIFIED 2026-09-16 (Logan: "there isn't any image loading problems now")** — no meal shows until every card's photo has settled (Logan: "all of the
        images need to be generated or pulled from cache before any meals pop up"). The gate held
        for the hero only (2.6 s cap); now all three, capped at 20 s, `imageUnavailable` counts as
        settled. Tell: swipe straight to card 3 on open — it has its photo. Watch the worst case: a
        fast reviewer on a cold image cache sits on "3 meals you can make right now" + shimmer cards
        for up to ~20 s. If that reads as a hang, the fix is copy on the build-up, not a shorter cap.
      - [ ] **UNVERIFIED — one image fetch per photo at a time** (`lib/mealImages.ts`): the prefetch's
        warm and the reveal's backfill both missed the URL cache and both invoked
        generate-meal-image for the same meal. Callers now share the in-flight promise. Tell: the
        function logs show one generate-meal-image per meal per reveal, not two.
      - **Open edge, not fixed:** if the scan's prefetch FAILS (null), the reveal serves today's
        earlier set with no sign the scan changed nothing — the same silent-stale the flash was.
        Rare (cap or timeout); the right fix is load() forcing a generation when the prefetch it
        awaited resolved null.
      - [x] **VERIFIED on device 2026-09-16 (Logan, Scan A) — scanning past the meal cap.** Scan stays live.
        Add all → if this open's prefetch FAILED and `meal_gen` is at the cap, the success step says
        "You've used today's meal picks. Your next ones will use everything you just added." with one
        Done button, no reveal (COOK_REVEAL_SEEN_KEY not set). The reveal now uses `autoLoad=false`
        (no mount paint), and `load()` generates instead of serving the cache when the prefetch it
        awaited resolved null. Tells: (1) at 6/6 meal_gen, scan → Add all → that success step;
        (2) under the cap, the reveal is unchanged. Original plan below.
      - **(plan, as written) Home says generations are done for today, Pantry still offers
        Scan.** Both are true: two separate server caps. Logan's row that day: `meal_gen` 6/6 (daily),
        `pantry` 6 in the rolling week (cap = `SCAN_CAP_WEEK`, overridden for testing — §9),
        `image_gen` 22/24. The HARM is what a scan does next: it spends a scan slot, saves the items,
        the meal prefetch is refused by the meal cap and resolves null, and the reveal serves the
        earlier deck under "3 meals you can make right now" — nothing on screen reflects the scan.
        Plan, not built:
        1. **Do NOT disable Scan when meals are capped.** The scan's first value is the pantry
           itself (list, grocery, tomorrow's picks); blocking inventory on meal quota punishes the
           most engaged user and the button would look broken for no visible reason.
        2. **Skip the reveal when generation is capped.** In the Add-all handler, before the
           `seen` fork: if the server's meal count is at the cap (read the same quota the hook's
           `refreshQuota` reads), go to the existing "N items added" success step with ONE line —
           "New meal picks unlock tomorrow and will use everything you just added." — and no See
           meals button (no promise it cannot keep, no redundant CTA).
        3. **Close the general edge:** in `fetchAndGenerate`, a prefetch that resolved null makes
           the cache read below it untrustworthy for THIS scan — force one generation; if that
           fails too, show the reveal's error state, never the earlier deck.
        4. **Verify, nothing to build:** tomorrow's first open misses the date-keyed cache and
           generates from a fresh `pantry_items` read, so the scanned items are used.
        Testing note: resetting only `meal_gen` leaves `image_gen` at 22/24, so the next reveal's
        third card shows no photo — that is the image cap, not the download gate regressing. Reset
        both (`reference_scan_cap_reset_sql` in memory).
      - [x] **SUPERSEDED 2026-09-16 — the reveal moved inside the scan modal; the flash is gone (Logan, on device).** Was: UNVERIFIED — no Pantry-tab flash between "Add all" and the reveal (Logan 2026-09-16,
        second pass). The modal used to close FIRST and push the reveal 400 ms later because UIKit
        drops a push that starts mid-dismissal — so the Pantry tab showed for the gap. Now the push
        happens while the modal is still fully presented and the modal dismisses 500 ms later onto
        the mounted reveal (`goToReveal` in PantryScanModal; `onSeeMeals` in pantry.tsx pushes at
        once). The Add-all spinner stays up through the hand-off. Tell: tap Add all → spinner →
        modal slides down straight onto the reveal, no Pantry tab in between. **If the reveal ever
        fails to appear at all, the push is being dropped under the presented modal — revert to
        close-then-push and cover the gap another way.** Known trade-off: the headline's chunk
        ticks now fire while the modal is still sliding away (the reveal mounts underneath).
      - [x] **SUPERSEDED 2026-09-16 — the build-up no longer draws placeholder cards; it is the headline read-off only.** Was: UNVERIFIED — build-up and revealed states share one layout. The build-up was
        vertically centred (`centerRegion`) and the revealed state top-aligned, so the headline
        jumped a third of the screen upward when the cards arrived (Logan's screenshots 2 → 1).
        Same header / deckArea / bottom-bar skeleton in both now; the gate only changes card content.
        Tell: nothing on screen moves when the cards spring in.
      - [x] **VERIFIED 2026-09-16 (same report)** — the gate waits for the photos to be DOWNLOADED, not just known. A URL in
        hand still painted a flat #1A1A1A card until expo-image fetched it — Logan's screenshot 1 is
        that. `prefetchMealImages` now returns expo-image's prefetch promise and the reveal opens on
        it (still capped at 20 s). Tell: card 1 has its photo on the first frame after the spring.
      - [x] **VERIFIED on device 2026-09-16 (Logan): no image loading problems** after the download gate.
      - [x] **DIAGNOSED 2026-09-16 with timings — the flash cannot be fixed by ordering.** (Fixed by A below.) One Add-all
        on device, `animation: 'none'`: push t=0 → reveal React mount +0.70 s → modal close +0.80 s →
        native transitionStart/End **+2.02 s** (same ms: no animation). The stack does not attach
        the pushed screen until the RN <Modal> is fully dismissed, so the Pantry tab is uncovered for
        ~0.9 s between the modal leaving and the push landing. Next step is plan A below (reveal
        inside the modal).
      - [x] **VERIFIED on device 2026-09-16 17:41 (Logan: "the reveals look a lot better"; the Plating path seen) — THIRD PASS: photos on the device BEFORE the reveal opens; the waiting
        glow was wrong (Logan).** The prefetch only ever warmed each photo's URL, never its bytes, so the
        reveal still had three downloads to do — hidden behind the closing modal before, visible once
        the reveal moved inside it. Now `lib/mealPrefetch.ts` downloads each photo during the review
        (`prefetchMealImages`) and exposes `takeRevealReady`; Add all / See what you can cook wait on it
        (button: spinner + "Plating your meals…", capped 25 s, abandoned if the modal closes) before
        showing the reveal. The build-up glow is removed; the reveal opens on the headline read-off and
        the cards follow it. Tell: reveal opens → headline words → cards with photos, nothing empty.
      - [ ] **MEASURED 2026-09-16 17:41 (Logan's 6-photo scan) — and PLAN for the ~10 s "Plating your
        meals…" wait, awaiting go.** Vision: **39.5 s via gpt-5.4, no fallback**, 42,356 tokens in /
        5,479 out / 0 reasoning (so the timeout+fallback suspicion is ruled out for this scan). Save:
        31 new + 49 restocked in 1.7 s. Timeline from the database: pantry save committed **17:41:00.9**
        → meals (prefetch text) inserted **17:41:02.6**, i.e. generation was still running when Logan
        tapped → the three photos generated **17:41:09.7 / 10.0 / 10.3** → downloads → reveal. The
        plating wait was ~2 s of meal generation + ~7.5 s of photo generation + <1 s download. Not
        measurable yet: when the meal generation STARTED (so its real duration), and the scan's
        end-to-end time on the phone (upload + edge overhead on top of the 39.5 s vision call).
        PLAN: (A) perf marks for the whole chain — scan request start/end, prefetch start, meals back,
        each photo URL, photos downloaded, plating start/end — so one scan gives every number;
        (B) parallel per-photo vision calls: the 39.5 s is mostly the model writing 5.5k output tokens
        in one stream — per-photo calls write ~0.9k each, so wall time becomes about the slowest photo
        (estimate 10-15 s, to be measured); input tokens rise ~+33% (the ~2.8k-token prompt repeated
        per photo; image tokens unchanged), output about the same; quality check needed because each
        call loses cross-photo context (the review's dedupe already merges repeats); (C) while plating,
        keep the big-type story running instead of a spinner on a button — does not shorten, changes
        how it feels; (D) generate-meals starts the three photo generations itself the moment the
        meals exist, saving the client round trip — small (~1-2 s), honest about it.
        - [x] **(A) VERIFIED 2026-09-17 00:00 — Logan's 7-photo scan, cellular, dev build.** Timeline
          (phone wall clock; server rows agree to ~0.1 s):
          scan sent 00:00:53.4 (JPEGs 10.5 MB = ~14 MB of base64 on the wire) → response **44.6 s**
          = vision **37.8 s** (gpt-5.4, 43,124 in / 4,567 out) + **6.8 s** upload + edge → review 77
          items → prefetch fired at once → profile + pantry + ratings read **1.5 s** (three sequential
          round trips) → generate-meals sent 00:01:39.5 → Add all tapped 4.9 s into review, saved in
          1.6 s → plating start 00:01:45.9 → **generate-meals back 12.8 s** after sending (00:01:52.3;
          `generated_meals` row 05:01:52.21 UTC) → all three photos requested in the same 0.1 s → URLs
          back in 3.8 / 4.1 / 5.0 s (`image_cache` rows 56.05 / 56.33 / 57.25) → downloads 1.5 / 0.8 /
          0.8 s → plating ready **12.6 s** (6.4 s of meals still generating + 6.1 s of photos) → deck
          open 1.5 s later. The reveal's own photo requests all hit the device cache: no double pay.
          **What it changes:** the old "~2 s of meals" was wrong — generation is 12.8 s and is the
          biggest part of plating. Levers by size: B (37.8 s vision); the 12.8 s inside generate-meals
          (unknown split — needs a server log, and a redeploy ships the other session's `7f109c8`);
          **B COST (priced 2026-09-17, OpenAI pricing page: gpt-5.4 $2.50 / 1M in, $0.25 cached, $15
          out):** this scan cost ~$0.176 ($0.108 in + $0.069 out). Per-photo calls repeat the ~1.8k-token
          prompt (7,292 chars) six more times, +~11k input = +$0.027, and output likely rises 10-25%
          (a JSON envelope per call, no cross-photo "list it once") = +$0.007-0.017 — so ~$0.21-0.22,
          **+20-25% per scan**; ~+$1.20/month for a user at the 7/week cap. No cache discount as built:
          images come BEFORE the prompt, so the shared prefix differs every call. Bigger risk than cost:
          the prompt's COUNT CHECK ("a full fridge holds 20-40 distinct items") is written for a whole
          kitchen and would push each single-photo call to pad its list — rewrite it before any B test;
          (CORRECTION 2026-09-17: `scripts/pantry-eval` already runs ONE photo per call with this prompt,
          so single-photo is how gpt-5.4 was chosen — the padding risk is unmeasured, not new. But the
          eval can barely score it: `images/` holds 17 photos and only 3 have ground truth, drafted by
          reading the photos and never verified by Logan. B's eval needs Logan to check those 3 and
          label more, plus an OPENAI_API_KEY on the Mac — Supabase secrets cannot be read back.)
          upload (14 MB — check what resolution gpt-5.4 actually reads before shrinking photos); the
          1.5 s of sequential context reads — **now parallel (2026-09-17, UNVERIFIED; tell: the next
          scan's "meals: profile + pantry + ratings read (in parallel)" mark reads ~0.5 s, not 1.5 s;
          no cost change — same queries, and Supabase does not bill per request)**. **D is DROPPED:** the meals reached
          the phone 0.1 s after their DB insert and the photo request left 0.1 s after that, so
          starting photos server-side saves well under 0.5 s. Hero-first download ordering cost ~0.3 s.
        - **(A) as built, 2026-09-16:** `lib/scanPerf.ts`: dev-only
          `[perf]` marks, wall-clock, printed live and again as one `── scan timeline ──` block when the
          deck opens (or the modal closes / the scan fails). Marks: scan start → request sent (MB) →
          response (phone s vs vision s = upload + edge) → review shown → prefetch fired → profile +
          pantry + ratings read → generate-meals sent / back → each photo requested / URL back (or
          device cache, or a failed attempt's 3 s gap) / downloaded → add all tapped / pantry saved →
          plating start / end (ready, or the 25 s cap) → reveal step → meals in hand → photos painted →
          deck open. App-only, no deploy. Not covered: the split
          INSIDE generate-meals (LLM vs its DB reads) — that needs a server log and a redeploy.
        - **(D) cost of building it, found while answering Logan 2026-09-16:** the client would still
          call generate-meal-image for the URL, and nothing server-side dedupes an in-flight
          generation (the dedupe map is per device) — so a server-started photo still generating when
          the client asks is paid for twice, unless generate-meals waits for the photos (holds the
          meals back ~8 s for every caller) or a pending marker + polling is added. The image cap must
          still be charged to the user (a service-role call skips it). Redeploying generate-meals also
          ships the other session's `7f109c8`. What D can save = the meals' trip back to the phone (the
          `generated_meals.created_at` row vs A's "generate-meals back") + the phone's gap to "photo
          requested" + the photo request's own trip and auth/cache/cap checks. Build it only if that
          sum is over ~2 s; the phone already asks for the photos the moment meals land.
      - [ ] **PHOTOS TOOK 40 s, NOT 4 s — scan of 2026-09-17 00:26 (5 photos). OPEN, cause unproven.**
        Timeline: scan 37.6 s (vision 33.3 s) → review → reads 0.6 s (parallel fix works) →
        generate-meals 13.8 s → photos requested 00:27:00.8 → plating started 00:27:03.5 → **plating hit
        the 25 s cap** 00:27:28.5 → reveal opened on the headline alone → photo URLs back **40.2 s**
        after asking → downloads (one took 6.9 s) → deck open 00:27:48.9 — **45 s** after the tap. Server
        rows: meals inserted 05:27:00.59 UTC; all three `storage.objects` rows at 05:27:37.10-37.11
        (within 9 ms of each other); all `image_cache` rows at 05:27:40.26-40.31. So the 40 s was
        inside generate-meal-image, not the phone or the network, and three independent generations
        finishing within 9 ms points at one shared thing they all waited on — a FAL cold start or
        queue is the leading suspect (the 00:01 run, 25 min earlier, took 3.8-5.0 s with the same
        code). **EDGE LOGS READ 2026-09-17 (Management API):** each of the three calls ran 39.8 s —
        boot 0.04 s → cache MISS 01.13-01.18 → Gemini visual description done 01.76-01.87 (~0.7 s) →
        **FAL flux-2 answered 35.89 / 35.93 / 36.04 — ~34 s at FAL, all three within 0.15 s** → image
        fetch + Storage upload → "Cached OK" 40.73 (**~4.7 s** after FAL; the Storage rows were inserted
        at 37.1, so ~3.6 s of it sits between the upload and the cache write — unexplained, and far
        above normal: the whole call took 3.8-5.0 s at 00:01). So the stall is FAL, not our code or the
        edge runtime. Still unknown: queue wait vs slow inference — FAL's body carries `timings`, but
        the log cuts the body at 300 chars. **Next:** log FAL's `timings.inference` and our own ms per
        phase (describe / FAL / fetch / upload / cache) in generate-meal-image and redeploy (preflight's
        "newer than deploy" on it is the additive scan-cap helper — no behaviour change rides along).
        Then decide: a timeout with one retry, FAL's queue API, or a fallback provider.
        **DONE 2026-09-17 00:5x CDT — deployed, boots (cache-hit smoke test 200 in 1.5 s).** Every
        generation now logs one line: `[timing] OK <key> total=… lookup=… describe=… fal1=…
        falTimings1={"inference":…} download=… upload=… cacheWrite=… trending=…` (FAILED /
        FAL-URL-ONLY on the other exits). Before deploying, the live source was downloaded and diffed:
        index.ts identical; the only other changes shipped were scan-cap's unused `readScanWindow`
        and dish-key's `overusedBases` (generate-meal-image imports only `dishArchetype`, unchanged).
        **Tell:** the next scan's photos → read the [timing] lines (fetch-logs script pattern: CLI
        token from keychain → Management API `function_logs`). A slow one with a small
        `falTimings.inference` = FAL queue; a large one = slow generation.
      - [ ] **FIXED 2026-09-17, UNVERIFIED: after the plating cap the reveal waited ANOTHER 20 s on a
        blank screen** (Logan's screenshot: FROM YOUR PANTRY + headline, nothing under it). The
        reveal's own photo gate (IMAGES_WAIT_MS 20 s) stacked on plating's 25 s. The scan modal now
        passes `imagesWaitMs={0}`: plating owns the photo wait, and a deck past the cap opens with
        photos still arriving rather than an empty screen. **Tell:** only visible when photos are
        slower than the cap — the deck appears ~1.4 s after the reveal starts, cards fill in.
      - [ ] **FIXED 2026-09-17, UNVERIFIED: Home showed the PREVIOUS meals after a scan** (Logan: open
        a recipe from the reveal, back out → "the old generation is taking up the home screen"). The
        scan's prefetch wrote the cache but never used `mealGenerationBus`, so Home and Pantry kept the
        deck they held in React state. Now `commitCookNowPrefetch` runs when Add all saves, and from
        then the scan's meals and each photo are published to every mounted meal screen (also on
        "Maybe later"). An abandoned review still only writes the cache, as before. **Tells:** (1)
        scan → reveal → open a recipe → back → Home shows the new meals with photos; (2) scan → Add
        all → Maybe later → Home shows the new meals.
      - [ ] **(C) BUILT 2026-09-17, UNVERIFIED — the plating wait is the scan story, not a button
        spinner.** `PlatingStory` (components/ScanTheater.tsx) covers the review or saved step while
        `goToReveal` waits: green PLATING YOUR MEALS eyebrow (the reveal's own eyebrow style) over the
        scan story's big type, words spoken in, 4.5 s a line, resting on the last line instead of
        looping. Lines from `buildPlatingStory` (lib/scanStory, tested): "Putting all 80 items to
        work" → "Aiming for 40g of protein a plate" → "Built from what's already in your kitchen" →
        "Ready in 30 minutes or less" → "Plating your picks now". Intentions only; nothing that counts
        the meals or says "cook right now" (a Cook Now meal can still show Need:). The spoken-line
        renderer was lifted out of ScanTheater unchanged so both use one. Shown ONLY when the meals are
        not ready yet (`isRevealReady`, read synchronously) — a ready deck opens with no flash.
        "Maybe later" stays on the saved-step path at the same spot (it was tappable during the old
        spinner); a close there clears plating so the next open cannot start on it. **Tells:** (1) tap
        See what you can cook within ~10 s of the review opening → the saved step fades to the story,
        then the reveal opens with photos; (2) wait 30 s in review first → no plating screen at all;
        (3) Maybe later during plating closes, and the next scan does not open on the plating screen;
        (4) first-ever scan (Add all) shows the same story, no Maybe later.
      - [ ] **Tapping Scan right after a launch waited ~3 s for the AI-consent check — FIXED 2026-09-16,
        UNVERIFIED.** Logan: after a reload, the consent prompt took "a solid 3 seconds" to come up.
        Measured (phone log + DB stamp): reload 23:53:32 → Scan tapped ~23:53:37 → `requestConsent`
        waits for the `profiles.ai_consent_accepted_at` read → that read sat in the app's first request
        burst, which answered at 23:53:40.7 → prompt → Continue stamped 23:53:46.5. Every AI entry point
        (Pantry + Home scan, receipt, AI log) had this wait, including users who consented long ago:
        for them the scan screen itself was what took 3 s. Fix: `AIConsentContext` keeps the answer
        on the device per user; a cached "yes" answers at once and the server read still corrects it
        (a revoke elsewhere applies on next launch). A FAILED read no longer counts as "never
        accepted" — it used to re-prompt someone who had. The server never enforces consent, so
        acting on the device copy is safe. **Tell:** reload, go straight to Pantry, tap Scan → the
        camera opens with no pause. (The first launch after this change still waits once, to fill
        the cache.)
      - [ ] **Scan tapped ~4 s after launch: ~1.1 s to the first camera frame, felt "delayed" (Logan
        2026-09-17 00:00, DEV build).** Phone log, wall clock: Pantry tab 23:59:39.86 → **Discover's
        background preload mounts 41.05** (`app/(tabs)/_layout.tsx`: feed prefetch + 2.5 s + idle
        callback) → Scan tapped 41.23 → Discover renders until its first paint at 41.86, and the
        tap's state change renders only after it (Pantry RENDER logged at 41.86) → `AVCaptureSession
        init` 42.08 → first camera frame 42.31. So ~0.63 s was the tap queued behind a background
        render the user never asked for, ~0.2 s the scan screen itself, ~0.23 s the camera starting.
        It only collides in the first seconds after a launch, and it was measured on a dev bundle,
        where renders are several times slower — per §2c, do not tune for a Metro number. **Next:** (1) tap
        Scan with the app open 15+ s — expect ~0.45 s if the preload is the cause; (2) repeat both
        on a release build. If release still collides, start the preload only after ~2 s without a
        touch instead of on a fixed delay, so it never lands under a tap. The consent-cache fix above
        was NOT exercised by this run: the profile read answered in 0.7 s this launch.
      - [ ] **FROZE ONCE, NOT REPRODUCED: Pantry tab unresponsive right after tapping Continue on the
        consent prompt (2026-09-16 23:49, other tabs worked).** The repeat at 23:53 (phone log
        recording, consent cleared first) worked. Suspect, unproven: the scan modal asks iOS to
        present while the consent modal is still fading out; RN's `RCTModalHostViewComponentView`
        sets `_isPresented = YES` BEFORE `presentViewController`, so a refused presentation is never
        retried and React believes the modal is open. It does not obviously explain a frozen screen,
        which is why nothing was changed. The run that froze had the prompt appear instantly at the
        tap; the run that worked had it appear ~3 s later — timing is the only known difference.
        **Tell if it recurs:** run `idevicesyslog -p Pantry` and grep for "Attempt to present" /
        "already presenting". Fix if confirmed: resolve `requestConsent` from the consent Modal's
        `onDismiss`, not on tap, on all four entry points.
      - [x] **MEASURED 2026-09-16 17:41 — see the item above (vision 39.5 s via gpt-5.4, no fallback).** Was: MEASURING — where a scan's ~2 minutes go, before any parallel-scan decision. scan-pantry
        (deployed) returns `_meta { ms, provider, primaryError, usage }` and the app logs
        `[perf] scan-pantry: vision Xms via …, tokens in/out (reasoning)` to Metro. Suspect, not proven:
        gpt-5.4 has a 60 s timeout and then falls back to Gemini Flash-Lite with another 60 s — a scan
        that times out once takes ~2 min AND is read by the weaker model. If the log shows
        `gpt-5.4 failed: timed out at 60s`, the first fix is the timeout/fallback, not parallelism.
        If gpt-5.4 answers slowly, decide parallel per-photo calls from the logged tokens: image
        tokens are the same either way, the extra cost is the ~2.8k-token prompt repeated per call,
        and wall time becomes roughly the slowest single-photo call instead of one call writing every item.
      - [x] **VERIFIED 2026-09-16 17:41 (Logan: "the loading story looks a lot better"; restocks measured 49 in 1.7 s) EXCEPT (5) the review cards, still unverified — tracked on the review-grouping item.** SECOND PASS — Logan on device after the first build: (1) Pantry tab
        flash GONE (verified); (2) photo-to-photo and line-to-line felt choppy — the photo was a keyed
        image that unmounted instantly and faded the next up from black, the line was removed then
        faded up from nothing. Now: one expo-image cross-dissolving natively (700 ms), and the outgoing
        line fades out while the next is laid over it (both absolute in one box); (3) lines are spoken
        in word by word (110 ms apart), numbers in green, 27 pt; (4) grey placeholder cards were back
        on the reveal — not new image logic: the same wait used to happen behind the closing modal,
        now it is on screen. Placeholders removed: the headline reads off word by word ("3 meals you
        can make right now", one tick on the number, not seven), the deck space breathes with the
        green glow, cards appear whole at the peak; (5) review sections now look like the Pantry tab —
        rows inside a #141414 card, radius 14, inset hairline, 16 pt rows — the headings alone did not
        read as sections; (6) the Add-all spinner: that save restocked 42 existing items one round trip
        at a time — now eight in parallel, with a `[perf] pantry save` log (NOT measured before: the
        rows share one client timestamp, so the database cannot show the loop's duration). Tells: smooth
        photo and line changes; words build; review cards; reveal with no grey cards; Metro log line
        for the next save's restock time. Honest limit recorded: a 7-photo scan taking ~2 min is the
        vision call itself — the story softens the wait, it does not shorten it. (Corrected same day:
        parallel VISION calls are not in any existing plan — the scan-import plan's "bounded
        concurrency" is the client's photo preparation, not the AI call. See the item below.)
      - [x] **VERIFIED 2026-09-16 (flash gone; story and reveal approved) EXCEPT tell (4) View recipe from the in-scan reveal, still unverified.** BUILT 2026-09-16 (Logan: go, lines every 4.5 s, goal reassurance mixed in), UNVERIFIED on
        device.** A: `components/CookRevealView.tsx` is the reveal; the scan modal renders it as step 7
        after Add all (no navigation), `app/cook-reveal.tsx` is a thin route wrapper, `[handoff]` logs
        removed, route animation back to fade. View recipe closes the modal then pushes the meal
        (`onOpenMeal` from pantry.tsx). B: `lib/scanStory.ts` (+6 tests) builds the story — profile
        facts interleaved with goal lines (lose / gain / maintain get three each, everyone gets
        consistency lines; no goal → consistency only), every line ≤ 46 chars, empty fields skipped;
        `ScanTheater` shows it in 26 pt, two lines reserved, fade-up, photo and line advance together
        every 4.5 s. C: the reveal header is FROM YOUR PANTRY + headline only; `lib/revealLine.ts`
        deleted (unused). Tells: (1) Add all → the reveal appears with NO Pantry tab in between;
        (2) scan wait: "Reading every shelf in your N photos" → "Consistency beats perfect. This makes
        it easy" → "Built around your 2,200-calorie day" → … one every 4.5 s, big; (3) reveal shows
        only the eyebrow and headline over the cards; (4) View recipe → modal closes, meal opens
        (expect a short Pantry-tab beat here — accepted in the plan). **Plan as approved:** reveal
        inside the scan, the wait tells a story, the reveal top says one thing.
        **A. Reveal inside the scan modal.** Extract the reveal body into `components/CookRevealView.tsx`;
        the modal renders it as its last step after Add all, so there is no navigation at the peak and
        no tab can show. `app/cook-reveal.tsx` stays as a thin wrapper. ✕ closes the modal. View recipe
        closes the modal, then pushes the meal screen — that push has the same ~0.9 s hold, but reads as
        "sheet closes, page opens" rather than a glitch at the payoff; if it still bothers, the meal
        screen can become a second layer inside the modal (larger). Then remove the `[handoff]` logs
        and restore the route animation.
        **B. The scan wait tells the story, in big type.** Where: the scan theatre (step 5), the ~40-60 s
        wait — not the reveal build-up, which is short. One sentence at the bottom, ~26-28 pt, two lines
        max, fading up every ~3.5 s, replacing the small rotating status title ("Decoding labels"); the
        photo and "Fridge · 7/14" stay. Beats, each SKIPPED when its field is empty: photo count ("Reading
        every shelf in your 14 photos") · calorie_goal ("Built around your 2,200-calorie day") ·
        protein_goal ÷ meals_per_day ("About 40 g of protein in every meal") · calorie_goal ÷
        meals_per_day ("Around 550 calories a plate") · max_prep_minutes ("Nothing over 30 minutes") ·
        diet_type/restrictions · food_dislikes ("And no mushrooms. Ever.") · fitness_goal ("Every pick
        moves your cut forward") · cooking_skill · finale when results land: the real item count, big.
        Rules: these are INTENTIONS from the profile, never claims about meals — the meals do not exist
        yet during the photo scan (they are generated after results land), so "aiming for / around /
        built around", never "every meal is under 630". Loop if the scan runs long, no beat twice in a
        row, never adds wait. Logan's row (2,200 kcal, 160 g, 4 meals, 30 min, Classic, no dislikes,
        goal and skill NULL) gets photos, calories, protein, per-plate calories, time, finale.
        **C. Reveal top says one thing.** Keep FROM YOUR PANTRY + "3 meals you can make right now";
        remove "Picked from your N ingredients" and the goal sentence (the story said it during the
        wait, and each card's pills show that meal's calories and protein). The deck moves up; the
        photos get the room. `lib/revealLine.ts` stays for reuse in B. Open question: eyebrow or
        headline only.
      - [ ] **OPEN — the Pantry tab STILL flashes on the way to the reveal** after push-first (Logan
        2026-09-16, second pass). react-native-screens' `setPushViewControllers` only defers when the
        stack view has no window or a nav transition is in flight (RNSScreenStack.mm:669-700), so a
        push under a fully presented RN <Modal> should land at once — yet the tab shows. PLAN, in
        order, Logan's go needed:
        1. **Diagnose first (2 min) — IN PLACE 2026-09-16:** `[handoff] push / reveal mount /
           reveal transitionStart / transitionEnd / close` log lines (scan modal + reveal) and the
           cook-reveal route on `animation: 'none'`. Next Add-all: read the Metro log. Flash gone → the push was landing late and
           FADING over the tab; keep 'none' (the way back snaps). Flash stays → the push is being
           held until the modal is gone, and a cover cannot help either (the tab's tree may be
           frozen); go to 2.
        2. **Reveal inside the modal (medium):** extract `CookReveal` into a component and render
           it as the scan modal's last step; `app/cook-reveal.tsx` stays as a thin route for other
           entry points. No navigation at the peak, so no tab can show. Tapping a meal from there
           closes the modal and pushes the meal screen after the dismissal — the same gap moves to a
           lower-stakes moment; push the meal screen with `animation: 'none'` to shrink it.
        3. **Scanner as a route (large, post-launch unless 1-2 fail):** the scanner becomes a
           native-stack `presentation: 'fullScreenModal'` route instead of an RN <Modal>; the reveal
           is then a `router.replace` inside one navigator, and the whole SafeAreaProvider-inside-
           Modal class of bugs retires with it.
      - [x] **SUPERSEDED 2026-09-16 — both lines removed; the reveal header is the headline only.** Was: BUILT, UNVERIFIED on device — validation line rewrite (Logan: drop
        "nothing to buy", say "ingredients", a sentence tied to THIS user's goal). `lib/revealLine.ts`
        (+9 tests) builds line 2 from the three cards' own numbers. Tells: line 1 "Picked from your
        100 ingredients"; line 2 e.g. "Each one is under 630 calories with at least 48 g of protein."
        — Logan's own row has `fitness_goal` NULL, so he sees the no-goal form until he sets a goal in
        Profile → calculator; then "…— built for your cut." Nothing moves when the cards spring in.
        As planned:
        - Line 1 (green, 13 semibold): **"Picked from your 100 ingredients"** ("…from your
          ingredients" until the count lands).
        - Line 2 (white/muted, 14 regular, prose): goal word from `profiles.fitness_goal` + numbers
          computed from the THREE MEALS ON SCREEN (max calories, min protein), so it is true of
          every card: lose → "Each one is under 620 calories with at least 48 g of protein — built
          for your cut." · gain → "Each one brings at least 48 g of protein — built for your
          bulk." · maintain (Body Recomp) → "Each one keeps protein high at under 620 calories —
          built for your recomp." · null → the numbers sentence without the goal clause.
          **Prod values are `lose` / `maintain` / `gain` (not `build`, which is only the onboarding
          option id), and 13 of 20 profiles are NULL** — the fallback is the common case for older
          accounts, so it has to read as complete on its own, not as a missing clause.
        - Data: one `profiles.select('fitness_goal')` alongside the existing pantry count (parallel,
          same effect). Layout: header grows ~20pt; deckArea is flex:1 so the deck re-centres; the
          build-up placeholder reserves two lines so nothing moves at the gate. Not built.
      - ~~Ingredient names on the card~~ — TOSSED by Logan 2026-09-16. Do not re-propose.
      - **Meal quality** — Logan: "I need to fix some of these generated meals", separate pass on go.

## 4. "Skip onboarding" paywall variant
- [ ] Let skeptical users skip onboarding to explore first, then show a paywall tailored to
      browsers. Must be in the build that goes to TestFlight, and likely appears in screenshots.

## 5. Rating prompt — sentiment-gated, never the native popup first
Review count is the durable moat against a copycat: a competitor can clone the UI in a weekend but
cannot clone 400 reviews. Must be in the TestFlight build.
- [ ] Ask at a **success moment**, not on launch or on a timer. Candidates: 3rd meal cooked, first
      pantry scan that returns a full shelf, a meal saved. Must not collide with the paywall or the
      onboarding trailer.
      **2026-09-16 recommendation (Logan asked whether the post-scan reveal is the moment): not
      the FIRST reveal.** It is the emotional peak but a promise, not delivered value — nothing has
      been cooked, and `requestReview` is rationed (Apple shows it at most 3×/365 days per device,
      and decides whether to show it at all). Spend it on the first completed cook (the meal screen's
      done/logged moment), with the 2nd reveal as the fallback — a returning scanner is itself the
      signal. Never inside the trial's first session, where it competes with the paywall.
- [ ] **Own modal first.** "How's Pantry working out?" → two paths, no App Store branding on it:
      - Loves it → THEN fire the native prompt (`StoreReview.requestReview()`).
      - Doesn't → route to an in-app feedback form, never to the App Store. Bad reviews land in a
        private pool that feeds the roadmap instead of the public rating.
- [ ] Needs `expo-store-review` — **not currently a dependency.** Add it before building the flow.
- [ ] Needs an in-app feedback form — **does not exist yet.** Nothing in `app/` collects written
      user feedback today (the "feedback" hits in the codebase are all haptics). Simplest version:
      a text field writing to a `feedback` table with RLS insert-only for `auth.uid()`.
- [ ] Ask once, then never again for that user unless they engage. Persist a `review_prompted_at`
      on the profile — an unsaved flag re-asks on every reinstall.

**Two constraints that decide the design — read before building:**
- **iOS caps the native prompt at 3 per user per 365 days,** and it silently no-ops past that with
  no callback and no error. So the gate is not just a rating filter — it is how you avoid burning a
  scarce prompt on someone who was going to leave 2 stars. That is the real argument for it.
- **App Store Review Guideline 5.6.1 says Apple "will disallow custom review prompts."** The
  sentiment-gate is a gray area: it is shipped by large apps and rarely rejected, but it is against
  the letter of the rule. Keep the pre-screen worded as a satisfaction question, not a review ask —
  no stars, no "rate us", no App Store logo. If it says "rate us" it is a custom review prompt and
  it is rejectable.
- **On a premium-only app the review pool is small.** Nearly everyone who could review is a trialist
  or subscriber, so gating too aggressively can leave you with 12 reviews instead of 40. Volume at
  the ask matters more than purity of the filter — do not set the bar so high that almost nobody
  reaches the native prompt.

## 6. End-to-end test AI meal generation
- [ ] Full path on device, not simulator.

## 6b. Home screen — verify the next-day behaviour  *(CANNOT be tested same-day)*

Four changes shipped 2026-09-02 that only reveal themselves on the FIRST OPEN OF A NEW DAY. They
are invisible today because today's cache already exists, so none of this can be signed off in the
session that wrote it.

- [x] **"Yesterday's picks · fresh ones cooking"** appears above the Cook-from-pantry carousel on
      the first open of a new day, with yesterday's three meals shown while today's generate
      underneath — instead of a 6-8s skeleton. Label disappears when today's land. (`43d7055`)
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **No blank gap.** The section holds its place and shimmers from first paint; it must never be
      absent for 2-3s and then push the page down when it appears. (`9237e47` — this part IS
      testable same-day.)
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **Discover hero is a dish not served before**, and does not change again once the page has
      settled. (`a14c9b4`)
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **SUPERSEDED — `37b9ba1` never worked, and the reason is worth keeping.** It rotated which of
      the THREE personalised shelves leads, but the other two are structurally empty for most users:
      `fits` needs something logged TODAY, `because` needs a last-cooked meal whose name hits
      `DISCOVER_PROTEIN_KEYWORDS`. Checked against Logan's live profile — 0 logs today, last cooked
      "Whole Milk" (not a protein keyword) — so the empty-section filter left exactly one shelf and
      it led every day. Rotating three items where two cannot populate is a no-op.
- [x] **VERIFY: a DIFFERENT section sits under the hero each day.** Display order is now decoupled
      from claim order and rotates across all shelves; "Everything else" stays pinned last. Claim
      order is unchanged, so `nearly` still gets first pick and keeps its contents. Simulated over 8
      days: the leader cycles all 4 sections and `nearly` leads 2 of 8 instead of 8 of 8.
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **VERIFY: "Almost in your kitchen" shows DIFFERENT MEALS day to day, not just reordered ones.**
      This is the half `37b9ba1` never addressed and the actual source of the stale feel — a pantry
      that does not change produced the same 8 dishes daily, reordered. It now takes a 24-meal window
      of the ranked list and advances it a full shelf per day: 3 distinct sets before repeating,
      confirmed by simulation. Every member is still verified + low-missing, and the shelf is
      re-sorted best-first for display.
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **HOW TO VERIFY WITHOUT WAITING DAYS:** `DEV_DAY_OFFSET` at the top of
      `app/(tabs)/discover.tsx` — bump it by 1, let Fast Refresh reload, and the page renders as
      tomorrow. `__DEV__`-guarded, so a release build ignores it. **It must be 0 in committed code.**
      Step 0 -> 1 -> 2 -> 3 and confirm both bullets above, then set it back.
      *(CLOSED 2026-09-15 as stale — Logan.)*

- [x] **Photo-gated meal swap.** When a generation lands while meals are on screen, the old meals
      hold until the NEW hero's photo is ready, then cross-fade in (300ms). The tell is the ABSENCE
      of a shimmer beat between old and new. Testable same-day with the refresh button — it does not
      need a day rollover. (`08771ab`)
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [x] **Category icons and colours.** Every pantry category should now have a real icon, not a grey
      box, and the three overlapping condiment rows should be one. Testable on any reload; the
      backfill is already applied and verified at zero off-list rows. (`750f4d6`)
      *(SUPERSEDED 2026-09-15: the Pantry rebuild removed category icons and colour dots from the tab.)*
- [x] **Pantry "Add an item".** Header pill is now a `+` icon; a dashed "Add an item" row sits at the
      end of the category list. Testable on any reload. (`129fe3c`)
      *(SUPERSEDED 2026-09-15: no ✚ and no "Add an item" row — search doubles as add, `dbc6512`, seen on device.)*
- [x] **⚠️ COLD-START DEFECTS — Logan could not verify these, they need a NEW DAY's first open.**
      Both were found from the 11:21 screenshots on 2026-09-04 and both are fixed blind.
      - [x] **Calorie/protein goals must NOT flash the wrong numbers.** VERIFIED ON DEVICE 2026-09-04. The ring used to animate to
            a hardcoded 2,400 kcal / 180g before the profile landed, then re-animate to the real
            2,100 / 160g. Goals now hydrate from AsyncStorage on mount. **This part is testable
            TODAY** — force-quit and reopen: the ring should animate exactly once, to your numbers.
      - [x] **No shimmer between yesterday's meals and today's.** `HERO_IMAGE_WAIT_MS` was 8000,
            calibrated against the cached-image path (~50ms); a dish nobody has generated before
            needs a ~10s Flux render, so the gate always timed out and swapped in the shimmer
            anyway. Raised to 22000. **Needs a day rollover.** Tell: yesterday's photo holds until
            today's photo replaces it, with no shimmer beat between them.
            *(CLOSED 2026-09-15 as stale — Logan.)*
      - [x] **The sweep bar reads as activity — VERIFIED ON DEVICE 2026-09-05.** Logan: "it
            behaved as it should, looked like something was cooking in the background."
      - [x] **NEW 2026-09-05, UNVERIFIED: no dark gap between the shimmer and the photo.**
            Ending the skeleton at `meals.length > 0` ended it when the TEXT arrived, so the card
            sat over MealImage's flat #1A1A1A for 1-2s while the photo downloaded — visible
            precisely because the sweep bar had just made the screen look busy. Home now holds the
            skeleton until the hero photo PAINTS (`onLoad`), capped at 2500ms, and only when there
            is a URL to wait for. Sequence should be sweep bar -> shimmer -> photo, with no dark
            beat. (`bf41c61`)
            *(CLOSED 2026-09-15 as stale — Logan.)*
      - [x] **NEW 2026-09-05, UNVERIFIED: regenerated photos actually reach the device.**
            Storage uploads with upsert, so a regenerated image overwrites the same path and every
            client keeps serving its cached copy forever — three corrections to the Protein Jello
            photo were invisible on device for this reason. URLs now carry `?v=<timestamp>`.
            (`34707fe`)
            *(CLOSED 2026-09-15 as stale — Logan.)*
      *(CLOSED 2026-09-15 as stale — Logan.)*

- [x] **Repeat/variety fixes need DAYS, not a reload.** The base-food ban, the deduped 30-dish
      window and the protein-family guard only prove themselves across several generations. Watch
      for: no cottage-cheese/potato run, and no two meals that are the same dish reworded.
      (`8de4e00`, `ef1c4b4`, `a38a9b9`)
      *(CLOSED 2026-09-15 as stale — Logan.)*

**How to test without waiting:** these all read the DEVICE clock (`dayOfYearNow`, `todayStr`), not
the database — no SQL can simulate a new day. Either wait for tomorrow, or set the iPhone forward a
day (Settings > General > Date & Time > off "Set Automatically"). Expect a Supabase token refresh
when the clock jumps; there is a `refreshSession` path for it, worst case sign in again.

---

## 6f. RAISED BY LOGAN 2026-09-05 — Home skeleton flash  *(fix shipped, UNVERIFIED on device)*
Symptoms: every app open shows "Checking what's in your pantry…" for ~1s before meals appear; and
on launch Home paints, gives way to a loading card, then returns.
- [x] Two defects, both from `bf41c61` the same day, opposite halves of the `mealsPending` line.
      (a) the hero-paint clause could go TRUE again after cards were visible, because `heroPainted`
      resets on any `meals[0].image` change — so a refresh, the daily swap, or one of today's new
      `?v=` versioned URLs redrew the shimmer over content. Now a one-way latch.
      (b) the hold was armed for cached opens too, though `useMealSuggestions` serves disk cache
      with NO loading state (~40ms), so every launch paid a second of shimmer for a photo already
      on disk — undoing `43d7055`. Now armed only once `loading` has been true.
- [x] **VERIFIED ON DEVICE: images are present the moment Home shows.** (b) was the real cause of
      the 1s wait.
- [x] **THE FLASH WAS NOT THE SKELETON AT ALL — I diagnosed the wrong component twice.** Logan had
      to correct me: "there is never a skeleton". The "loading screen" is the branded
      `SplashOverlay`, and the ordering he reported (Home FIRST, then the loading screen) was the
      whole clue — nothing that is loading appears AFTER the thing it loads.
      `SplashOverlay` started at `opacity: 0` and faded in over 200ms, with a comment claiming it
      was cross-fading from the NATIVE splash. False in this app: **`expo-splash-screen` is not a
      dependency and nothing calls `preventAutoHideAsync`**, so the native splash is gone before
      React paints and the fade was revealing the running app. Now opaque from frame 1.
      It became visible only because fix (b) made Home paint in ~40ms — the bug is older than today.
- [x] **Splash -> Home hand-off now dissolves (320ms fade + 1.06 content lift).** It was
      `{showSplash && <SplashOverlay />}` — a one-frame hard cut, which is what read as janky beside
      Cal AI and MyFitnessPal. Load TIME was never the difference; MyFitnessPal takes ~2s too.
      Parent holds the mount until the animation reports finished. **320ms is the tunable** — 240 if
      it drags, 400 if it still blinks.
- [x] **VERIFY: a real generation still holds the skeleton until the hero photo paints** — that is
      `bf41c61`'s fix and the one thing here not yet re-confirmed. Needs a day with no cache.
      *(CLOSED 2026-09-15 as stale — Logan.)*
- [ ] **Splash has `pointerEvents="none"`** — taps during the 2s hold pass through to Home controls
      that are invisible at the time. Known, unfixed, deliberately not bundled.

**METHOD NOTE, worth more than the fixes.** I twice fixed a real defect in the wrong component and
called the symptom addressed. What finally located it was Logan's ORDERING detail (content before
loader), not more code reading. When a UI report says "X then Y", check that X-then-Y is even
possible in the component you are looking at before fixing anything in it.

## 6c. Home + Pantry layout — OPEN DESIGN QUESTION, needs a decision before the trailer

Not a bug list. The layout of these two tabs is unresolved and item 7 films them.

- [x] **DECIDED + BUILT 2026-09-14 (Logan: "like it, do everything") — Home shows the three meals
      as a stacked list, all visible, no rotation.** Each row: 88pt SQUARE photo (generation
      renders 512×512, so this is the first slot on Home that shows the whole image — the 3:2
      hero cropped a third off every one), name, the TIME / CAL / P / MAKES pills, and the
      readiness line ("Ready to cook" / "Need: …" / "Better with: …") that came over from the
      Pantry tab, computed against the live pantry via the new `lib/mealReadiness.ts` (6 tests).
      Ready-to-cook first, stable, so the server's protein/flavour order still decides within a
      tier. The ↻ regenerate, the daily-cap Discover nudge and the `trackCookTonightUsed` counter
      came over too. Deleted: the 5× page loop, recentring, Ken Burns, the hero-paint gate, and
      the fit-to-fold maths (`heroFit`, `LOG_PEEK`, two `onLayout` measurements) — ~400 lines.
      The page now stacks naturally; on a Pro-size phone the "Daily meal log" header and the top
      of Breakfast peek at the fold, which IS the scroll affordance (a cut element; a header alone
      reads as a footer). Not ported, on purpose: the "Fresh today" pill (the "Yesterday's picks"
      row already covers the honest case), the ready-count subtitle (the rows say it), the
      time-of-day sort (the generator already spreads occasions) and the thin-pantry hint (Home's
      own protein-ceiling note covers the case that matters).
- [x] **Identity constraint answered:** Home = three medium rows, Discover = one big hero.
- [x] **The Pantry tab no longer shows meals.** Cook Tonight, its hook call (the cold-day
      double-generation race with Home), `missingFor`, the fresh-date key and ~120 lines of
      styles are gone; the tab is ingredients + scan. Home's "See all →" went with it (it led to
      the same three meals).
- [x] **VERIFIED ON DEVICE 2026-09-14 01:25 (Logan: "really happy with the changes overall").**
      Measured from his screenshot: three rows above the fold, "Daily meal log" header at 711pt,
      Breakfast card top at 739pt against a fold at ~782pt — so ~43pt of Breakfast is the cut
      element. Readiness line confirmed ("verify 2 did work from before"), empty-slot tap confirmed
      (3), spacing confirmed (1), tiles and "Nothing logged yet" visible in the shot (4, 5).
- [ ] Residual tell, needs a logged entry to see: on a slot WITH an entry, the entry row's own tap
      (edit / open meal) still works inside the now-disabled outer touchable, and the `+` pill
      appears. Also the 6.1" size if one is ever around: the third row should be the cut element
      there, not Breakfast.
- [x] **UNVERIFIED ON DEVICE — "Log to which meal?" now lists YOUR meal slots, nothing
      pre-selected, no "+ Custom meal"** (Logan, 2026-09-14). Was a hardcoded Breakfast / Lunch /
      Dinner / Snack with a green time-of-day default and a free-text "+ Custom meal". Production
      had 12 logs; **2 landed in a slot not in that user's own list** ("Midnight snacky" typed via
      Custom, "Snack" from the hardcoded list against a profile without one) — each an orphan
      section on Home. The picker now reads `profiles.meal_slots`, the list Home's log renders,
      in the same order. Tell: open any meal → Log Meal → the rows match Home's "Daily meal log"
      names and count exactly, none is green. Then in Profile change Meals Per Day, accept
      "Update", and the picker follows. The 2 existing orphan rows are left alone — Home still
      renders them after the user's own slots.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [ ] **FOUND 2026-09-14, not fixed — meal COUNT has two sources that can drift.** Generation
      sizes each meal by `meals_per_day` (`useMealSuggestions.ts:189`), while Home's slot list,
      the log picker and Home's "can't reach Ng of protein a meal" note use `meal_slots.length`.
      They agree after onboarding and after Profile's "Update" prompt, but diverge when the user
      taps Home's "+ Add Meal" or answers "Keep mine": a 4-meal user who adds "Pre-workout" has 5
      slots, 4-meal-sized recipes, and a protein note dividing by 5. Needs a decision, not a patch:
      does an added slot change the per-meal target, or are slots display-only and the note should
      divide by `meals_per_day`? Logan's own profile is consistent (4 / 4) today.
- [ ] **OPEN — Logan's eye keeps going to the centred-ring card (the "Hello Aman" Dribbble
      shot).** Read the note in the 2026-09-14 session before reopening: the number-left /
      ring-right layout was chosen on 09-04 for the fold, and a centred ring that carries the
      number needs ≥104pt (84 cannot hold "2,200" legibly) = +46pt, which is more than the 43pt
      of Breakfast currently showing. Break-even version if it is still wanted after seeing a
      FILLED ring: ring 104 centred with the number inside, "0 consumed" / "2,200 goal" flanks
      replacing the consumed line (−18), day nav folded into the card's top edge (−20) → net +8pt.
      Decision deferred until a meal is logged and the ring is seen with data in it.
- [ ] **Scan-card placement.** Probably state-gated rather than fixed — an empty pantry has nothing
      else to show and scan IS the content; a stocked one should not be pitched a feature it has
      already adopted. Logan pushed back on demoting scan and that pushback is recorded.
- [x] **Scan Pantry card illustration — GONE 2026-09-15 with the rebuild.** The scan row is two
      pills with an icon each, no art. (Was: the line drawing did not read as a shelf with food on
      it — line art asked to carry meaning at a size where it reads as abstract shapes.)

---
- [x] **BUILT 2026-09-14 (Logan: "do your rec for the redo button") — ↻ moved out of the header,
      UNVERIFIED ON DEVICE.** The header is just the title now. Under the third card: "Not feeling
      these? New picks · 4 left today" (the link regenerates; the count is cap − used, omitted
      while the count is unknown); after the third generation of the day "· Browse Discover" is
      appended; at the cap the row is the existing "That's today's new picks." + Discover pill.
      Hidden while a generation runs — `working` now includes `loading`, so the status line and
      sweep bar show during a redo over a set already on screen (they did not before). Tells: tap
      New picks → status row + sweep bar appear, three new rows land, the count drops by one.
      **2026-09-15, Logan: "get rid of specifically the number of how many generations left for
      users to see" → the "· N left today" count is REMOVED.** The row reads "Not feeling these?
      New picks", plus "· Browse Discover" after the third generation; the cap row is unchanged.
      Home was the only surface showing it (Discover's "left today" is calories; the creator
      modal's is behind a disabled flag). Tell: no number anywhere in that row.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [x] **BUILT 2026-09-14 (Logan: "go") — the Daily meal log card, UNVERIFIED ON DEVICE.** Rows
      read "675 · 46P" (protein was missing from a protein-first log); the header carries the
      slot total "1,429 kcal · 63P"; delete is swipe-left (red Delete, the Pantry rows' pattern)
      and the per-row ✕ is gone; the icon aligns with the header instead of floating mid-card;
      empty slots are header + `+` only (no "Nothing logged yet"); one plain `+` per card, green
      once the slot has entries; "+ + Add Meal" → "+ Add meal"; Snack's icon is a cookie, not
      water drops. Tells: swipe a Breakfast row left → Delete slides in, tap → row gone; the
      Breakfast header shows the total; the Lunch card is a single line.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [x] **BUILT 2026-09-15 (Logan: "go") — the Pantry tab rebuilt to the sketch. UNVERIFIED ON
      DEVICE.** Scan row = white "Scan pantry" primary + dark "Scan receipt" secondary, no line
      art, no AI badges. The photo banner is gone; a one-line STATUS STRIP shows only for a gap
      ("Add a protein source · Add to grocery"). A second strip, "N items untouched for 3+ weeks ·
      Still have them?", opens a review sheet: Keep (restarts the clock) / Used up (in_stock
      false) / Keep all. Backed by `pantry_items.last_confirmed_at` (migration `…173237`; a
      corrective `…173554` backfills from created_at because `default now()` had stamped all 158
      rows with the migration's moment — CLAUDE.md gotcha added). `lib/pantryAge.ts` (4 tests):
      age label "2d / 1w / 5w / 3mo", stale = in stock AND 21+ days. Every write that touches an
      item (toggle, keep, used up) sets last_confirmed_at. The category accordions are a grouped
      SectionList: coloured-dot section headers (sticky) with counts, every item visible as a row
      (tap = in/out of stock, swipe = delete, grey age on the right, "Out" tag + strikethrough
      when out). Retired: DraggableFlatList, the drag-reorder and its device-local order key, the
      count badges, the scan-card beam animation and SVG, the hero image + gradient, ~55 dead
      style keys. Section order = the store order the grocery list uses.
      Tells: (1) the top of the tab is header → strips (if any) → two pills → search → PRODUCE
      section, with rows visible without a tap; (2) tap a row → dims with "Out", tap again →
      back; (3) swipe → Delete; (4) with items older than 3 weeks the grey strip appears; tap →
      the sheet; "Used up" removes it from the sheet and marks the row Out; (5) ages on the right
      read like "3w", not "today" for everything (the backfill worked: verified in SQL).
      **Superseded in part by the second pass below** (the strips, the ✚, the dots, the
      strikethrough, the every-row age and the tab icon all changed the same day) — verify the
      second pass's tells, which cover this item's mechanics too.
      *(VERIFIED ON DEVICE 2026-09-15 via Logan's 13:10 and 13:43 screenshots: grouped list, scan pills, notice line, review. The toggle's sink-on-tap later became fade-in-place, `462f6b0`.)*
- [x] **BUILT 2026-09-15 (Logan sent a screenshot of the rebuild, asked for "more premium, less
      cluttery, easy to understand and operate", then "ok do all") — Pantry tab, second pass.
      UNVERIFIED ON DEVICE.** The diagnosis from the screenshot: the list was fine; the top third
      was four full-width cards of equal weight (segmented control + ✚, stale strip, scan row,
      bordered search card) before the first ingredient at ~36% of the screen, three add paths,
      and "7w" on every one of 54 rows. Changes, all in `app/(tabs)/pantry.tsx` plus one line in
      `app/(tabs)/_layout.tsx`: (a) the ✚ is gone — search doubles as manual add (placeholder
      "Search or add…"; a typed name with no exact match puts an `Add "kimchi"` row under the
      results, which opens the existing add sheet with the name prefilled; a partial match like
      "Kimchi Paste" still offers it); (b) search is a 38pt filled field, no border, not a card;
      (c) the strips are one-line grey text notices with no background, directly above the list
      they describe ("54 items untouched for 3+ weeks · Review", "Add a protein source · Add to
      grocery"), the whole line the tap target; (d) scan pills 2pt shorter, otherwise untouched —
      the one bright shape above the list, deliberately; (e) the age shows ONLY on stale rows
      (3+ weeks) — one scan stamps one date on every row, so a fresh pantry said "7w" fifty
      times; (f) Out rows are dimmed + "Out" tag, no strikethrough (that is "done" on iOS), and
      sink to the bottom of their section on LOAD, never on the tap; (g) dividers inset to the
      text edge; (h) row name 15 → 16; (i) section-header colour dots gone, count a step dimmer
      than the title (Grocery never had dots, so nothing drifts); (j) tab icon UtensilsCrossed →
      Refrigerator (lucide 0.577 has it). Green now appears once above the tab bar, on "Review".
      Rejected on the way: Reminders-style circles on every row (54 green ticks), demoting scan
      (Logan's recorded pushback), sorting Out rows on the tap (jumps under the finger). Gates:
      tests 654, tsc 135/16 unchanged, the 8081 bundle serves the markers.
      Tells: (1) the header is the segmented control alone, then scan, search, a grey notice line,
      then PRODUCE — the first row sits noticeably higher than in the screenshot; (2) fresh rows
      show NOTHING on the right, stale ones "7w"; Review → Keep on one → its "7w" disappears from
      the list; (3) type "kimchi" → an `Add "kimchi"` row under any partial matches → tap → the
      sheet opens with the name filled → Add → the row lands in its section and the Add row is
      gone; (4) Chicken Salad (Out) sits at the BOTTOM of Meat & Fish on open; tapping a row Out
      leaves it in place; (5) the Pantry tab shows a fridge; (6) the "Out" name is grey, not
      struck through. Judge on device: a right column that is empty on every fresh row — if it
      feels too blank, the fallback is the age at 11pt in a dimmer grey, not removal.
      **Seen on device 2026-09-15 13:10 (Logan's screenshot): the layout landed as designed** —
      header, scan, search, notice line, PRODUCE; fresh "Chicken" shows no age; "Chicken Salad"
      (Out) at the bottom of its section, grey, no strikethrough; fridge icon. Every other row
      still reads "7w" because all 54 of his items ARE stale — that clears when he taps Review →
      Keep all. Then Logan: "put meat and fish first" → **Meat & Fish leads the Pantry tab
      (`PANTRY_ORDER`), Grocery keeps store order.** Tell: MEAT & FISH is the first section.
      Not asked, worth a look: Dairy & Eggs second — eggs, Greek yogurt and cottage cheese are the
      app's other protein aisle and sit fourth today.
      **Then Logan: "not a fan of the week count" and "very little visual difference between out
      and in stock" → BUILT, UNVERIFIED ON DEVICE.** No age on any row now: the notice line
      carries the count and the review sheet shows "7 weeks ago" under each item
      (`ageLabelLong`), the one place the number decides something. Out rows are crossed off
      again AND faded to 35% white, tag faded to match — Grocery crosses off a checked item the
      same way, so "gone" reads the same on both tabs. The morning's strikethrough removal was a
      semantic argument ("done" on iOS) losing to the contrast it had been providing. Tells: no
      "7w" anywhere in the list; Chicken Salad is struck through and plainly dimmer than Chicken
      above it; Review → each item reads "7 weeks ago", not "7w".
      **Then Logan: "still very little visual difference" + "how would the system know items have
      been untouched and not just regularly restocked, and the user doesn't uncheck much — did you
      account for this?" → NO, it had not. BUILT, UNVERIFIED ON DEVICE:**
      (1) **Out rows leave their aisle for one OUT OF STOCK section at the bottom** (crossed off,
      faded, no tag — the header says it), and the move happens ON the tap, animated, the way a
      ticked item drops to the bottom in Bring!. Reverses this morning's "never move on tap": that
      was for a silent reorder inside a section; a labelled destination plus animation makes the
      movement the feedback. Aisle counts are now in-stock counts. Grey-in-place was tried twice.
      (2) **The stale check was built on a signal the app was throwing away.** All three restock
      paths — pantry scan, receipt scan, grocery check-off (`lib/pantryInsert.ts`, `grocery.tsx`)
      — set `in_stock` back to true on an existing item but never touched `last_confirmed_at`, so
      a user who rescans every fortnight was still asked about everything already on the shelf.
      Fixed: every restock resets the clock. (3) **Perishables only** — Produce, Meat & Fish,
      Dairy & Eggs, Bakery (`isPerishable`, +1 test). Staples are never asked: "untouched" says
      nothing about cumin that is used and rebought without the app hearing of it. Frozen is out
      too. Notice reads "N perishables from 3+ weeks ago · Review"; sheet hint "Last seen 3+
      weeks ago — by a scan, a receipt or a tap." What the check now means: a perishable with no
      scan, receipt, check-off or tap for 3 weeks — which for a pineapple or ground beef is a fair
      question, and for a user who never scans again it is one Keep-all every 3 weeks on the
      perishable aisles only. Tells: (a) tap Chicken → it animates out of MEAT & FISH into an
      OUT OF STOCK section at the very bottom, struck through; tap it there → it animates back;
      (b) the notice count drops from 54 to the perishable aisles only (roughly Produce 9 + Meat 3
      + Dairy 14 + Bakery); (c) after a pantry scan that sees Garlic again, Garlic leaves the
      Review sheet — verify in SQL: `last_confirmed_at` on that row moves to the scan's moment.
      Still not modelled, deliberately: cooking a meal as evidence its ingredients were there
      (a logged meal is not necessarily a pantry meal); a per-aisle shelf life (3 weeks is generous
      for produce and short for hard cheese — one number, a question not a rule).
      **Then Logan on the OUT OF STOCK section, before seeing it: wrong call — a row vanishing on
      tap, beside swipe-to-delete on the same row, "feels like it's deleting it", and the section
      is hidden below 50+ rows. REVERTED the same hour, DECISION NOT TO REOPEN:** an Out row stays
      in its aisle — crossed off, 35% white, tagged "Out" (the tag legible, on purpose) — and sinks
      to the bottom of its own card with an animated slide, so the tap reads as a state change in
      view. Aisle counts are total rows again. Tells: tap Chicken → it slides to the bottom of MEAT
      & FISH, struck through, with an "Out" tag; tap it there → it slides back up. If strike + 35%
      + tag + position is STILL not enough on device, the next lever is a leading glyph on every
      row, not a relocation.
      **VERIFIED ON DEVICE 2026-09-15 13:43 (Logan: "I can verify last changes made are working",
      with a screenshot):** MEAT & FISH first, no ages on rows, "23 perishables from 3+ weeks ago
      · Review" (down from 54), fridge tab icon, notice line and search field as designed. Then:
      "I'm not super excited about the state it visually looks currently" → **research pass
      DONE 2026-09-15: https://claude.ai/artifact/Q1ST18qHJAm47zS6DTVtcp** ("Pantry Tab Field
      Study" — 8 apps, 65 store screenshots read, 13 shown: Bring!, AnyList, SuperCook, Cooklist,
      NoWaste, Paprika, KitchenPal, Pantry Check). Finding: every app that feels like an inventory
      gives each item a shape and a picture; a text list (Paprika's pantry = ours today) never
      does. **Proposed, awaiting Logan's pick — NOT built:** three-across TILES inside the same
      aisle sections (one emoji + one name each; 54 items = 18 rows), state in the tile (filled =
      in stock; hollow dashed + greyed glyph + struck name + OUT tag = out; amber dot = perishable
      to review), a count line under search ("54 items · 3 out · 23 to review") in place of the
      notice card, long-press menu (Used up · Delete · Add to grocery) since a grid has no swipe.
      Emoji, NOT the 298 Flux photos still in the `ingredient-images` bucket: the meal screen
      dropped them on 2026-05-28 (0a01b97) for a 5–10% wrong-food rate, and on a tile the picture
      IS the item. Keeps: scan row, search-as-add, Meat & Fish first, no move on tap, the
      perishable/restock logic. Risk is taste (emoji on black); fallback is one lucide icon per
      AISLE. Est. half a day, $0, no network.
      **EMOJI RETRACTED the same hour (Logan: "would this make the app feel cheap or off-brand?
      honest thoughts only" → yes).** The app's identity is moody photography + a monochrome UI;
      emoji bring Apple's saturated cartoon palette (the aisle-dot problem ×54) and are a
      utility-app / vibe-coded tell in the sparkles-icon family. Looked at 17 of the 298 bucket
      photos: whole foods (garlic, lime, pineapple, cauliflower, spinach, rice, salmon, chicken,
      potato, onion) are excellent and match the meal photography exactly; the failures are the
      packaged class (olive oil with a gibberish label, cheddar as a cartoon holed block, black
      beans that read as peppercorns, a cluttered milk still life) — 3–4 of 17. **Revised
      proposal, awaiting Logan's pick:** ROWS with a 44pt photo thumbnail in Home's square style
      (swipe/tap/search-as-add all stay; Out = photo grey + struck + tag); whole foods get photos,
      packaged goods a quiet #1f1f1f placeholder with a low-opacity aisle icon (not emoji);
      Logan reviews the 298 once from a grid page; on-demand generation re-added WITH auth and a
      no-packaging/no-label/no-text prompt (~$0.003/image, global cache). Serve thumbnails at a
      small size — the bucket files are 1024² webp, 50–136 KB each. Tiles-with-photos remains an
      option but would make Pantry the most image-dense screen in the app.
      **ALL PANTRY TAB REDESIGN PROPOSALS DROPPED 2026-09-15 (Logan: "let's scrap any plans for
      changes to this screen. It looks fine how it is now.").** Tiles, emoji, photo thumbnails,
      the count line and the long-press menu are off the table. Research and mock kept for the
      record (field study + https://claude.ai/artifact/WLBKjCY9eXpcTuYKP1LT8L). Do not reopen
      without Logan raising it.
      *(VERIFIED ON DEVICE 2026-09-15 13:43 — see the note inside this item.)*
- [ ] **PLANNED, GATED ON LOGAN'S "GO" (2026-09-15) — screen transitions + a small animation and
      haptic on every user action. Plan: `docs/PLAN-motion.md`.** Logan: "I did try this in the
      past and ultimately the app became too slow." Git says the earlier slowness was never the
      NUMBER of animations: the July tab transition caused the black screen, the Aug 29 macros
      animation caused 8 renders per tap and stepped by animating height, the tilt ran on the
      sensor clock, the splash animated on the JS thread during boot. Budget: transform/opacity
      only, UI thread only, zero renders from motion, navigators untouched, nothing at cold start,
      haptics on commits only, no new library. Measured in a RELEASE build with Instruments'
      Animation Hitches (< 5 ms/s), one commit per screen, revert any that fails.
  - [x] Phase 0 — baseline. **MEASURED 2026-09-15:** pre-Phase-1 Release build, 0.99 ms/s hitch time, 12 hitches, worst 25 ms. Tooling `f2de9e8`; numbers in PLAN-motion §7.
  - [x] Phase 1 — **BUILT + MEASURED, TELLS UNCHECKED (`e0a0e41` `462f6b0` `15310d6` `2e3e063`).** Release walkthrough 1.24 ms/s vs baseline 0.99 — both good, the gap is walkthrough noise (one 37.5 ms hitch); frames neither worse nor better, as expected, since the saving is JS renders.** All 10 dead `LayoutAnimation` calls gone (2 were in dead code, deleted); Reanimated gap-close on Home's log, Grocery and Saved; CSS opacity fade on Pantry and Grocery toggles; calorie ring on the UI thread (it was re-rendering ~100×/load for a value shown nowhere). Loop-pausing dropped: native-driver loops on detached tabs cost nothing. **Behaviour change:** a Pantry toggle now stays in place and fades; the Out row sinks on the next load, not on the tap (the tap-time "slide" was a one-frame jump). Tells: (1) swipe-delete a logged food on Home → the row fades and the rows/cards below glide up, the card's background shrinks with them, no snap; (2) swipe the day → the log is simply replaced, nothing slides from the old day; (3) the calorie ring still sweeps from empty on open; (4) Pantry: tap an item → it dims, strikes and shows "Out" over ~0.2 s without moving; leave the tab and come back → it is at the bottom of its aisle; (5) Grocery: check two items → names dim smoothly; Clear checked → they fade and the rest close up; swipe-delete two rows quickly → the second swipe works; (6) Saved: unsave a card → the rest slide into place; Undo → it returns and they slide back; typing in search → cards do NOT slide.
        *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
  - [x] Phase 2 — **BUILT + MEASURED 2026-09-15 (`b02670f`…`5932d3f`): 1.52 ms/s, good; the gap to Phase 1 is one 66.7 ms launch hitch (1.08 without it). Device tells below still unchecked.** Haptics added to ~20 commits that had none, moved to after the result on Save and Extract Recipe, removed from openers and no-touch events; New picks answers the tap; inline-added Grocery rows and new meal slots fade in. Tab-bar tick kept. Measure: the Phase 2 Release build is being installed; `bash scripts/motion-trace.sh phase2` and compare with phase1-redo (1.24 ms/s). Tells: (1) log a food → one success tap as the modal closes; (2) Pantry: tap an item → a light tick as it fades; Review → Keep all → success; (3) Grocery: check → tick; type a new item + return → tick and the row fades in; (4) meal screen: Log Meal → NO tick until you pick a slot, then one success as it says Logged ✓; Save as a subscriber → success only when it says Saved; (5) Scan pantry / Scan receipt buttons → no tick on open; (6) Home: tap Today while already on today → no tick; New picks dims when tapped; add a meal slot → the card fades in; (7) leave the cook reveal alone → cards change with a glow but no buzz; swipe it → a tick; (8) cross your calorie goal by logging → success; open the app later already past goal → nothing.
        *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
  - [ ] Phase 3 — legacy `Swipeable` → `ReanimatedSwipeable` on Home log rows and Pantry rows
  - [ ] Phase 4 — screen transitions: consistency audit only; tabs stay instant
  - [ ] Phase 5 — onboarding animations, only if Phase 0 shows hitches there
- [x] **RAISED BY LOGAN 2026-09-15 — Discover does not start loading until its tab is tapped, and the
      skeleton "looks glitchy/bad" until it does. BUILT 2026-09-15 (`abcaba8`) and VERIFIED ON DEVICE the same evening (Logan: "ok that's fixed").** Also fixed on the way: a pool fetched while Discover was not on screen was parked until a blur that had already happened, so a next-morning resume opened on yesterday's feed. Cause: the
      DATA is already warm — the tab layout's `prefetchDiscover` writes today's feed to disk at launch
      — but the SCREEN is a lazy tab, so nothing mounts until the tap. Then, on the tap: two
      sequential disk reads (personalisation, then the ~400 KB feed), JSON parse, shelving the whole
      pool, and the photos, all behind the skeleton. Proposed: `router.prefetch` the Discover tab in
      the background once `prefetchDiscover` has resolved and Home has gone idle (a few seconds after
      launch). Verified in node_modules, not assumed: expo-router 55's `prefetch` sends React
      Navigation's PRELOAD, and bottom-tabs 7.15 renders a preloaded route (`preloadedRouteKeys`);
      with `animation: 'none'` it sits detached like any visited tab. Side effects checked: meal
      impressions fire only on scroll (safe); the daily hero pick is recorded on PAINT, so a
      background mount would mark a hero "served" on days Discover is never opened — record it only
      while focused. Costs to measure: Discover's mount work and its first photos move to every
      launch, a few seconds in, on a phone that logs memory pressure. Tell after the fix: open the app,
      wait ~5 s on Home, tap Discover → the finished page, no skeleton.
- [x] **RAISED BY LOGAN 2026-09-15 — the Pantry tab takes a moment to load when tapped, for
      ingredients already on his list. CAUSE FOUND, FIXED, UNVERIFIED ON DEVICE (`lib/pantryGroup.ts`
      + `app/(tabs)/pantry.tsx` + `app/(tabs)/_layout.tsx`).** The tab is a lazy route with NO local
      copy of the list: the tap mounted the screen, which then queried Supabase for every row and
      rendered an empty list until the answer came back (plus two small profile/meal_logs reads for
      the notice line). Home caches its day and Discover its feed; the pantry never was. The launch
      warm read (`prefetchPantryNames`) fetches only in-stock NAMES for Home's readiness line and is
      consumed once by Home. Fixed both ways: a disk mirror at `pantry_items:<uid>` written on every
      change (not only after a fetch — toggles, adds, deletes and Clear pantry edit state directly),
      painted on mount and corrected by the focus fetch; and the tabs layout now preloads the Pantry
      route in its own idle window after Discover's. Grouping moved to a tested pure function so the
      cache paint and the network paint build the identical list. Trade accepted, same as Home's log:
      a row changed on another device can show for the second before the fetch answers. Tells: cold
      launch, wait ~5 s on Home, tap Pantry → the list is there immediately, no empty gap; toggle an
      item Out, force-quit, relaunch, tap Pantry → it is still Out and at the bottom of its aisle.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan: the tab paints instantly and an Out row survives a relaunch.)*
- [x] **RAISED BY LOGAN 2026-09-15 — pick MULTIPLE gallery photos in one go for a pantry scan.
      BUILT, UNVERIFIED ON DEVICE (`components/PantryScanModal.tsx`).** The gallery button opened a
      single-pick picker, so five shelf photos meant five trips. Now `allowsMultipleSelection` with
      `selectionLimit` set to what is LEFT of the 16-photo cap, so the system picker stops the user at
      the limit instead of this code rejecting photos after they were chosen (and the count is
      trimmed again in code, because selectionLimit is iOS 14+). The chosen photos become filmstrip
      rows immediately and are downscaled SEQUENTIALLY — sixteen full-size decodes at once is a
      memory spike on a phone that already logs pressure — so tiles fill in one by one. A failed
      photo drops its row and the batch reports once ("2 photos skipped"), never one alert per photo.
      Receipt, AI log and creator-recipe pickers are deliberately untouched: those take one photo.
      Tells: tap the gallery icon in the scan camera → select 4 photos → all 4 appear in the
      filmstrip and fill in; with 14 already taken, the picker only lets you pick 2 more.
      **FOLLOW-UP 2026-09-15 (Logan: "takes a good 5 seconds for all of them to pop up… I didn't even
      know it had registered"). Step 1 of the plan BUILT, UNVERIFIED ON DEVICE.** Cause, read from
      expo-image-picker's iOS source: `handleMultipleMedia` walks the selection with `asyncMap`,
      which is SEQUENTIAL, and the JS promise resolves only after the last photo is copied out of the
      library — so nothing can be shown until all of them are ready, and an iCloud-only photo adds a
      download. Not our downscale: that runs after the rows are already on screen. Built now: an
      `importing` flag set BEFORE the picker opens, so the instant the sheet dismisses the strip
      shows a spinner and "Preparing photos…" at tile height; the gallery button dims and the Scan
      button is disabled and says the same, since the count is about to change; a light haptic fires
      when the tiles land. Also recorded in code: `quality: 1` is a SPEED setting here — the picker
      only takes its copy-the-original fast path at quality >= 1, so lowering it makes this slower.
      Steps 2 and 3 of the plan (dev-only timers splitting picker time from downscale time, then
      bounded concurrency if our step dominates) are NOT built — they wait on Logan seeing step 1.
      Tell: tap the gallery icon, pick 4 photos, hit Add → the spinner and "Preparing photos…" appear
      immediately, then the tiles replace them without the row jumping.
      *(VERIFIED ON DEVICE 2026-09-16 — Logan: multi-select and the "Preparing photos…" spinner both work. The ~5 s wait itself is Apple's picker; plan steps 2-3 remain unbuilt.)*
- [x] **RAISED BY LOGAN 2026-09-16 — ✕ during a scan discarded photos silently. BUILT, UNVERIFIED
      ON DEVICE.** "If I have photos taken showing up on the mini sliding bar below and I click x,
      have a popup saying are you sure… but don't have it say are you sure if I hadn't taken a photo
      yet." ✕ and the system dismiss now go through `requestClose`: with unscanned photos it asks
      "Discard N photos?" (Keep taking photos / Discard, destructive + warning haptic); with none,
      or once the scan has produced results, it closes straight through as before. The app's rule is
      no confirmation for reversible actions — this one cannot be undone, and the ✕'s own comment had
      carried that live edge as a known risk since `721217b`. Tells: take one photo → ✕ → the
      question; Keep taking → still on the camera with the photo; Discard → closed; reopen with no
      photos → ✕ closes with no question.
      *(VERIFIED ON DEVICE 2026-09-16 — Logan.)*
- [x] **FOUND 2026-09-15 — a launch can stick on the splash. UNEXPLAINED, not yet attributable to
      Phase 1.** Logan's second motion walkthrough: the Phase 1 Release build launched (initial
      frame at 1.16 s, foreground and active for 18 s, main thread never hung) but pushed only 4 UI
      commits, the last at 1.92 s, then nothing until he left the app — the splash never dissolved.
      That was the FIRST launch after installing the build. 12 later launches of the same build under
      xctrace all dissolved the splash at 2.3–2.4 s; a 13th recorded no data and its trace was
      deleted before it was read. The pre-Phase-1 build launched cleanly 2 of 2 — too few to compare.
      The splash hides on `checking` (auth + onboarding-flag resolution in `app/_layout.tsx`) AND
      `MIN_SPLASH_MS`, so the two candidates are the auth chain never resolving (network, token
      refresh) and the JS thread stalling while Home mounts. Tell: the wordmark stays up past ~5 s.
      Next: a Release-visible marker (os_signpost or a timestamp written to AsyncStorage) at auth
      resolved / Home mounted / splash hidden, then 10 first-launches-after-install per build.
      Evidence kept: `~/pantry-traces/phase1-20260915-151815.trace`.
      **REPRODUCED 2026-09-15 16:1x on the Phase 2 Release build: its FIRST launch after install,
      launched by xctrace with nobody touching the phone, stuck the same way — 2 UI commits, none
      after 2 s, foreground and active.** Two new builds, two stuck first launches; ~13 later launches
      all fine. So the pattern is "first launch after installing a build", which is exactly what every
      App Store install and update is. Likely NOT Phase 1/2 code (it gates on auth/onboarding
      resolution, untouched), but unproven. Promoted from curiosity to launch-risk. Cheap repro
      without a rebuild: `xcrun devicectl device install app --device <udid> <DerivedData>/Release-iphoneos/Pantry.app`,
      then a traced launch — reinstalling resets the "first launch" state. Do the instrumented
      investigation AFTER Logan's Phase 2 walkthrough, because a reinstall would put his walkthrough
      back on a first launch.
      **INVESTIGATED 2026-09-15 16:2x–16:4x with os_log captured (Instruments `--instrument os_log`).**
      Reproduced a third time on the Discover-preload build's first launch. What the logs show: JS
      starts on time (`Running "main"`), creates the same 21 native module objects as a healthy
      launch, reads `profiles`, loads Home's meal photos, talks to Superwall, PostHog and Expo push —
      i.e. the app renders Home in JS and the network works. But the SCREEN takes no UI commits after
      ~1.9 s, and iOS's launch animation never runs (UIKit deactivation reason 5 / "animating
      application lifecycle event: 1" is present in the healthy launch and absent in every stuck one).
      Ruled out: expo-updates (not installed, disabled in Expo.plist); expo-splash-screen holding the
      native splash (not a dependency); SuperwallProvider withholding children (renders them always);
      the app's own providers gating render; network failure; phone auto-lock (Logan: auto-lock is
      off); `expo run:ios` launching the app (it only installs); reinstalling the SAME binary (a
      devicectl reinstall launched healthy). Every stuck launch so far was a launch STARTED REMOTELY
      by xctrace on a newly built binary — none was a human tapping the icon. **Open question, and the
      next tell: after the next new build installs, Logan opens Pantry by tapping the icon, before any
      trace runs.** Loads normally → an artifact of remote launching, drop to post-launch. Sticks → a
      real first-launch bug; then the same check on a TestFlight install before submission. Evidence in
      the session scratchpad (hang1 healthy / hang2 stuck os_log exports), not in the repo.
      *(CLOSED 2026-09-15 — Logan verified the app launches normally when he opens it himself; every stuck launch was started remotely by xctrace. Not proven on a first launch after a new install, so it is re-checked on the TestFlight install, §11.)*
      *(CONFIRMED 2026-09-15: Logan opened a FRESH build by tapping the icon and it launched normally — the case the remote launches kept failing. TestFlight check in §11 still stands.)*
- [x] **FOUND 2026-09-15 — every `LayoutAnimation` in the app is a no-op, including one reported
      today as an animation.** Reanimated disables React Native's LayoutAnimation on the New
      Architecture (software-mansion/react-native-reanimated#6751, open); first seen on device
      2026-08-29 (`1eab76b`) and then forgotten. The 10 calls in Home, Pantry, Grocery and Saved
      snap. That includes `ccb57f7`'s "sinks to the bottom of its card with an animated slide":
      the row moves, but in one frame. Tell: tap a Pantry item → it JUMPS to the bottom of its
      card rather than sliding. Fix is Phase 1a above. CLAUDE.md landmine added.
      **Fixed in code 2026-09-15 by Phase 1** — zero `LayoutAnimation` calls remain in app/ and
      components/. Verification is Phase 1's tells.
      *(FIXED IN CODE 2026-09-15 by motion Phase 1; zero LayoutAnimation calls remain. Device check is Phase 1's tells.)*
- [x] **FIXED 2026-09-15 (Logan: "do the other 21 percent") — "Other" was the app believing the
      scan model.** `normalizeCategory` accepted ANY category that exists in the list before
      looking at the name, and "Other" is in the list — so the model's punt on "Brown Sugar" was
      written as-is while the keyword table said Baking, and a model that filed "Eggs" under Meat
      & Fish and "salt" under Sauces was believed everywhere. Measured across all users: 158
      rows, 30 in Other, ~74 in an aisle the name contradicts. Rule now: THE NAME DECIDES whenever
      the table can read it; the model's category is kept only when it is one of the aisles the
      name allows (a tiebreaker — "Frozen Chicken Nuggets" stays Frozen), and is the answer only
      for a name the table cannot read. The LLM path (`categorizeItem`) goes through the same
      rule. Keywords the rows were missing: creamer, egg white, granola/cookie/seed butter, coffee
      bean, ground pepper, relish, chutney, sauce, snack; a bare "pepper" is now the spice
      (Produce lists only the qualified vegetable). 5 new tests. Backfill: the rule replayed over
      every row via SQL — 74 of 158 moved, Other 30 → 1 (a "Cat Food" row, which should never
      have been scanned in). Judgement calls the table makes that Logan may want to revisit:
      Salsa, Pickles, Peanut/Almond Butter → Canned & Jarred (not Sauces); Maple Syrup → Baking;
      Protein Powder → Beverages (no Supplements aisle exists). Tell: Pantry tab → no "Other"
      section; Brown Sugar under BAKING, Pecans under NUTS & SEEDS, Eggs under DAIRY & EGGS.

## 6g. RAISED BY LOGAN 2026-09-14 — the food log screen (`components/FoodSearchModal.tsx`, detail step)

One screen, five jobs: log a searched food, log a Recent, log a scanned barcode, EDIT a logged
entry (Home → tap an entry with a `food_id`), and correct a food's macros for yourself ("Something
off? Fix it" → `macro_overrides`). Logan: "feels very incomplete and half baked".

- [x] **SUPERSEDED by the rebuild below — QTY editing.** (1) Keyboard only opened on the second tap: the
      input was a ~48×19pt field centred in 16pt of padding, so most taps on the box hit padding;
      the input now fills the box, the detail ScrollView has `keyboardShouldPersistTaps="handled"`,
      and the search field's keyboard is dismissed before the detail step mounts. (2) Keypad covered
      the box: `automaticallyAdjustKeyboardInsets` + scroll-to-end on `keyboardDidShow`, so QTY, the
      meal chips and the Log button sit above the keypad. (3) No return key on `decimal-pad`: an
      `InputAccessoryView` "Done" bar. Also: ✕ closes the keyboard first when it is up; qty commits
      on blur (empty / "0" / "." was logged as 1 while the box still showed what was typed); a
      comma-decimal keypad's "1,5" is read as 1.5, not 1. Tells: first tap on QTY opens the keypad;
      the box, chips and Log button are visible above it; Done dismisses; clearing the box and
      tapping Done shows 1. Unsure until seen: InputAccessoryView and the keyboard inset both
      inside an RN `<Modal>` — neither is used inside a Modal anywhere else in the app.

**Found by reading the code paths + prod data. ALL FIXED 2026-09-14 (Logan: "make all changes you recommended") — UNVERIFIED ON DEVICE, tells in the BUILT item at the end of this section.**
- [x] **Edit mode can overwrite an entry with a DIFFERENT food.** Home → tap a logged food → ‹ back
      (goes to search, `editLogId` still set) → open any other food → "Update Log". The update
      writes the new food's calories/macros/serving_id/quantity onto the old row but NOT
      `meal_name` or `food_id`, so "Cheddar Cheese" carries chicken's numbers, and its next edit
      cannot find its serving. Fix direction: edit mode has no back-to-search at all.
- [x] **Edit mode ignores a meal change.** The chips are shown and tappable, but the update never
      writes `slot` — move an entry to Lunch, tap Update, it stays in Breakfast. Silent.
- [x] **A macro fix is per FOOD, applied to every serving — and on the gram path it multiplies.**
      The override stores absolute numbers taken from whichever serving was selected when saved,
      and both the display and `saveLog` use them as the PER-SERVING base for any serving. Switch
      "1 cup (113g)" to "1 slice (21g)" and the slice shows the cup's calories. Worse, pick the
      synthetic "1 g" serving and type 240: 150 kcal × 240 = **36,000 kcal logged**. The one prod
      override is exactly that shape: `fatsecret:794` Whole Milk, 150 kcal / 8P / 11C / 8F — 1 cup
      values. Fix direction: migration adds the serving's gram basis (`per_grams`) to
      `macro_overrides`, backfill 794 from its cup serving, scale on apply; a serving with no gram
      data applies the fix only when it is the serving the fix was made on.
- [x] **Barcode scanner dies after one successful scan.** `scanningRef` is only reset on failure, and
      ‹ back from the detail step resets neither it nor `scanned` — the camera shows but never
      scans again until the modal is closed. Re-tapping the Scan tab does not help (it resets
      `scanned`, not the ref).
- [x] **Per-food state leaks into the next food.** `openDetail` resets qty and barcode; the Recents
      tap and the scan path do not, and ‹ back resets nothing but the food. Set qty 3 on one food,
      back, tap a Recent → it opens at 3. Scan product X, back, open a Recent Y, tap "Fix it" →
      the correction is saved under X's BARCODE key. The previous food's override also stays
      applied until the next lookup resolves (and forever if it fails). Fix direction: one
      `openFood()` that resets every per-food field, used by search, Recents, scan and edit.
- [x] **Recents are per DEVICE, not per account, and survive sign-out.** `pantry_recent_foods` is not
      user-stamped and is not in AuthContext's sign-out `multiRemove` list (Profile's reset does
      clear it). The App Review demo account signed in on Logan's phone would open on his Recents.
- [x] **The synthetic "100 g" / "1 g" options are built from an ml serving and labelled grams.**
      `getFoodById` accepts `metric_serving_unit === 'ml'` for the reference — for milk, near enough;
      for honey or oil, "100 g" is 100 ml, ~40% off. Label it ml when the source is ml.
- [x] **"No results for 'chedd'" flashes while typing** (browse step): the empty state checks
      `!searching`, and `searching` only turns on when the 500 ms debounce fires.
- [x] **~58pt of dead space above the title.** Measured from Logan's screenshot against MFP's on the
      same phone: our header sits ~50pt lower. The detail header adds `insets.top - 4` inside a
      `SafeAreaView edges={['top']}` that evidently already applies the inset here (the browse step
      does the same with `+ 8`). Contradicts the CLAUDE.md note that SafeAreaView reads 0 inside a
      Modal — so verify on device, not by reasoning, when fixing.
- [x] **Same product, two override keys.** Scanned → `barcode:<ean>`; opened from Recents or search →
      `fatsecret:<id>`. A fix made after scanning is missing the next time it is opened from Recents.
- [x] **Log button does not name the day.** It logs to whatever day Home is showing; the meal detail
      screen names a non-today day on its button for exactly this reason, this one does not.
- [x] **Double-tap on Log may insert twice** — guarded by `saving` STATE, which is async; the meal
      detail screen uses a ref for the same guard. Plausible, not reproduced (rule out environment
      first if a duplicate shows up — see CLAUDE.md).
- [x] **Meal chips come from Home's RENDERED slots,** which include orphan sections (a slot label only
      present because an old entry used it). Should be `meal_slots`, like the log picker since
      `2bc3b88`. Edit mode also passes the entry NAME as `defaultSlot` — masked today by
      `initialSlot`, a trap for the next edit.
- [x] **Recents show the logged TOTAL** (2 cups = 910 cal) but open at qty 1 (455) — list and detail
      disagree.
- [x] **Camera permission denied once → "Allow Camera" is dead forever.** `requestCameraPermission`
      cannot re-prompt; there is no Settings deep link.
- [x] **Serving picker is an `Alert` with one button per serving,** matched by description text —
      a food with 10+ servings is a long system alert, and two servings with the same description
      always pick the first.
- [x] **Fiber shows "0g" when FatSecret has no fiber value** — unknown presented as zero, on a
      number the app tracks nowhere else.

- [x] **DESIGN — mock v2 shown 2026-09-14, awaiting Logan's "go".** Logan AGREED: meal chip
      pre-selected (he chose the slot by tapping its card), Log pinned to the bottom naming the day
      when not today. He likes MFP's "% of calories per macro" row most — it is how he judges a
      food's protein-to-calorie ratio. Mock v2, top-down: ✕ (and ‹ only when not editing) → name →
      ONE card: small segmented kcal ring + Protein / Carbs / Fat columns, each % of calories over
      grams (protein first), and under a divider "TODAY AFTER THIS" as two bars, Calories and
      Protein, with this food as a lighter segment on top of what is already logged (edit mode
      excludes the entry's own current values) → AMOUNT: typed number + a unit pill that opens a
      sheet of servings (each with grams + kcal) and "By weight: grams / ounces" → MEAL chips from
      `meal_slots` → "Nutrition details ›" (only values FatSecret actually has) + "Edit nutrition"
      → pinned "Log to Breakfast" / "Save changes". Cut: the 150pt ring, the % legend, the four
      tiles, the Fiber-as-0 tile. Edit mode: "EDIT ENTRY" eyebrow, no ‹, meal change saved.
      REVISED from v1: the − n + stepper is DROPPED — research found no tracker using one, and it
      cannot express "40 g". Research (sources in the 2026-09-14 session; much of it unverifiable):
      MacroFactor shows the day-after-this impact on this screen and Carbon has an eye-icon preview,
      while Cronometer charges for it; MacroFactor and Foodvisor switch between household units and
      grams by tapping the unit; Carbon and MacroFactor can solve the amount from a target protein
      or calorie number — POST-LAUNCH idea, not in v2. No app verified shows a protein-per-100-kcal
      number; the % of calories already carries that fact (25% protein = 6 g per 100 kcal), so it
      is not added as a second number.
- [ ] **BUILT 2026-09-14 — mock v2 + all 17 findings. UNVERIFIED ON DEVICE.** Pure portion math in
      `lib/foodPortion.ts` (19 tests) is now the only source of every number the screen shows and
      logs; migration `20260914072207_macro_override_basis` adds `basis_amount` / `basis_unit` /
      `serving_id` to `macro_overrides`, and the prod Whole Milk row gets its default-serving basis
      on first read. Synthetic "100 g" / "1 g" servings are gone — grams / ounces / millilitres are
      units derived from the food's own metric data. Recents are per account
      (`pantry_recent_foods:<userId>`) and reopen at the logged portion. Tells, in order of what
      would hurt most:
      1. Whole Milk → unit grams → 240 → the ring reads ~148 kcal (with the correction), NOT 36,000.
      2. Log a food, tap it on Home → no ‹ button, "EDIT ENTRY", change meal to Lunch → Save → it
         moves to Lunch.
      3. Scan a barcode → ‹ back → scan a second product → it opens (the camera re-arms).
      4. Open a food, set 3, ‹ back, open a Recent → it opens at its OWN logged portion, not 3.
      5. Cheddar → 1 cup → tap the unit → grams → the amount becomes 113 and kcal is unchanged.
      6. The first tap on the amount box opens the keypad; Done closes it; the pinned Log button
         rides above the keypad.
      7. On a past day, the button reads "Log to Breakfast · Sat, Sep 12".
      8. The title sits just under the status bar — no ~50pt gap. (This removed a manual top inset
         on the belief SafeAreaView applies it inside this Modal; if the title now hides under the
         Dynamic Island, that belief was wrong — put the inset back on the header, not both.)
      9. "Nutrition details" lists only values FatSecret has; Cheddar shows no "Fiber 0g" line
         unless FatSecret reports fiber.
      10. Camera denied → the scan tab says "Open Settings" and opens iOS Settings.

- [ ] **RAISED BY LOGAN 2026-09-14 02:32 after seeing the rebuild on device ("very good start") —
      three follow-ups, all built, UNVERIFIED ON DEVICE.**
      1. **~1s from tapping a Home entry to the screen.** Two sequential network calls: food.get
         through the edge function to FatSecret, then the correction row. Now: `lib/foodCache.ts`
         keeps every fetched food in memory + disk (`pantry_food:<id>`), the correction is fetched
         in PARALLEL with the food, and a tapped search result paints from the servings the v3
         search already returned (food.get runs behind it and swaps in any serving the search
         left out). A logged entry is always a food already fetched to log it, so its edit opens
         from disk. Second pass (Logan: still a half-second spinner every time, after a
         restart): that was the CORRECTION lookup, a network query on every open. The user's whole
         correction set is now one map in memory + disk (`pantry_overrides:<uid>`), every write
         goes through it, and when food and map are both in memory the screen is built in the same
         tick as the step change — no await, no spinner frame. Home warms both while the day's
         entries render. Tell: tap a logged entry → no spinner at all, including the first tap
         after a cold restart of a day whose entries were logged since this build.
      2. **"240 g shows 144 kcal" — RESOLVED: 144 is correct for Logan's account.** The prod
         correction row `fatsecret:794` (150/8/11/8) belongs to a March TEST account
         (`aaaaaa@gmail.com`), not to Logan's current user — RLS hides it from him, correctly.
         His account has ZERO corrections, so 144 is FatSecret's own whole milk (60 kcal/100 g ×
         2.4), which is what he logged (meal_logs: food 794, `__1g` × 240 → 144). The "~148" tell
         assumed the row was his; it was not. Neither guessed cause applied. The ml/g ratio tier
         added on the way stays — it is right for milk-shaped foods. The orphan row is left alone.
         **Verification of the correction machinery end to end (the 36,000-kcal fix), still
         open:** Whole Milk → Edit nutrition → 150 / 8 / 11 / 8 per cup → Save → link reads "Your
         numbers · Edit"; unit → grams → 240 → ~148; then `select * from macro_overrides` shows a
         row under Logan's user_id WITH basis_amount / basis_unit / serving_id filled.
      3. **Home painted 0 / "Nothing logged yet" / empty circles for ~1s on launch, then jumped.**
         The goals were disk-cached (GOALS_CACHE_KEY); today's rows and the week's were not. Both
         are mirrored now (`pantry_day_logs:<uid>:<date>`, `pantry_week_logs:<uid>:<week>`),
         hydrated before the network answers and never over a network result that already landed.
         The goal-crossed haptic is suppressed on hydration. Tell: kill the app with meals logged,
         relaunch → the card and the check mark are right on the first frame.
      Also seen in both screenshots: "Open debugger to view warnings" — the warning text was not
      captured (Metro is not in the desktop terminal pane). Tap the toast and paste the warning.
- [x] **BUILT 2026-09-14 (Logan: "go") — Edit nutrition has a "Per" row. UNVERIFIED ON DEVICE.**
      Logan: the sheet said "per 100 g" when logging grams, and a label is per serving size — a
      calculator job. The sheet now opens on the LABEL serving (the household default; the
      correction's own serving if one exists), never the logging unit, with an amount box + unit
      pill listing the food's servings and grams/ounces. "2 Tbsp (32 g) · 190 kcal" → Per 2 tbsp,
      type 190/7/7/16. ½ cup → cup, 0.5. `correctionToStore` normalizes serving portions to ONE
      serving (basis = one serving's weight) and stores weight portions as typed; 4 tests. A
      decimal-pad Done bar was added to the sheet's five inputs (it never had one). Tells:
      (1) open Edit nutrition while logging in grams → it reads "Per 1 cup · 244 g", fields
      146/7.9/11/7.9; (2) Per → tbsp → the amount resets to 1 (no conversion); (3) on Whole Milk:
      Per 1 cup, type 150 / 8 / 11 / 8, Save → the link reads "Your numbers · Edit", 240 g reads
      ~148, and the DB row under Logan's user has basis_amount 244, basis_unit g, serving_id =
      the cup's id; (4) Done dismisses the keypad inside the sheet.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [x] **BUILT 2026-09-14 (Logan: "do all changes you recommended") — the finish pass on the food
      screen + Edit nutrition, UNVERIFIED ON DEVICE.** (1) A metric-only FatSecret serving
      ("100 g") no longer sits in a unit list beside the grams unit it duplicates — both pickers,
      `pickerUnits`, kept only while selected; a "100 ml" serving on a gram-basis food stays (the
      only volume option). (2) The sheet's Cancel is gone; tapping the dark backdrop closes it,
      keyboard first. (3) "Save" / "Reset to original", sentence case. (4) The Per hint is one
      line ("244 g · What the label says for this portion."); the account/scaling sentence lives
      once, in the picker. (5) Nutrition details are inline under the amount card, no toggle —
      only values FatSecret has. (6) Save is disabled until a field differs from its prefill.
      (7) Edit mode has a red "Delete entry" at the bottom — Home's delete, no confirmation, same
      as its row ✕. Logan can veto (7). (8) Decimals: the sheet prefills WHOLE grams like a
      label, one decimal only below 1 g; typed decimals are kept. Tells: open Whole Milk → Edit
      nutrition → Per picker shows one "grams", no "100 g" serving; fields read 122 / 8 / 11 / 5;
      Save is dim until a field changes; tap outside closes; the main screen shows a NUTRITION
      DETAILS card with no chevron; "Delete entry" removes the entry from Home.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [x] **BUILT 2026-09-14 (Logan: "make sure I can't type macros that don't add up") — a 4/4/9
      WARNING, not a block, UNVERIFIED ON DEVICE.** Labels do not add up themselves (milk 150 vs
      148 computed; peanut butter 190 vs 200) and a hard rule rejects real foods — beer computes
      to 56 of 150 (alcohol), sugar-free candy, high-fiber bars. Margin 15% or 20 kcal, whichever
      is larger; past it an amber line under the fields names the computed number and the
      legitimate reasons; Save stays on. 6 tests incl. "15" and "1500" typed for 150. Tell: in
      Edit nutrition set calories to 15 → the amber line appears; back to 150 → gone.
      **VERIFIED in the DB 2026-09-14 19:30 UTC:** Logan's correction on `fatsecret:800` (2% Fat
      Milk) stored 150/8/11/8 with basis 244 g / serving 18 under HIS user — the end-to-end proof
      of the 36,000-kcal fix. He entered whole-milk numbers on 2% as a test; Reset to original
      when done.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*
- [x] **RAISED BY LOGAN 2026-09-14 ("prevent this from happening again") — the food search screen
      shifted up under the status bar, intermittently. FIXED for the CLASS, UNVERIFIED ON DEVICE.**
      The CLAUDE.md landmine: a bare SafeAreaView inside a <Modal> pads by 0 — and it RACES the
      modal's window, so it passed on some opens and failed on others, which is why Logan saw it
      "multiple times". Six modals had it (FoodSearch, EditPortion, RecipeForm, ReceiptScan,
      CreatorRecipe, AILog); each now has its own <SafeAreaProvider>, PantryScanModal's remedy.
      Prevention: `lib/modalSafeArea.test.ts` scans every Modal subtree in app/ and components/
      and fails the suite for safe-area use without a provider; CLAUDE.md points at it. Tell: open
      Log from any slot ten times — "Search Food" and the ✕ sit below the status bar every time;
      the edit screen's ✕ likewise.
      *(VERIFIED ON DEVICE 2026-09-15 — Logan.)*

## 6d. RAISED BY LOGAN 2026-09-04 — decided, not built  *(work these before anything below)*

These came out of a working session and existed ONLY in that conversation until now. Each has a
decision attached; do not re-open the decision, build it. Ordered by how directly Logan asked.

**The original complaint — Pantry categories sit below the fold.**
Measured from the stylesheet: ~926pt of chrome above the first category row against a ~710pt
viewport, so categories start ~215pt below the fold. Agreed fix, then parked when Logan pivoted to
Home ("drop all of those design changes for now") — parked, NOT rejected:
- [x] ~~Render NOTHING when `buildInsight` returns `tone === 'affirm'`.~~ DONE 2026-09-14. That state is terminal: the
      pantry can only grow (see the depletion item below), so once you have no gaps you see the
      same sentence and four checkmarks forever. The eight `gap` messages are good and stay —
      including the log-driven protein nudge at `lib/pantryProfile.ts:258`, which IS dynamic.
      Banner then survives exactly where the trailer films it (a fresh pantry has gaps).
- [x] ~~Cut "Cook tonight" from the Pantry tab.~~ DONE 2026-09-14 with the Home rebuild (§6c).
      Its readiness line moved to Home rather than being lost. Frees ~426pt on Pantry and removes
      the cold-day double-generation race.
- [x] Scan cards stay exactly as they are, full size, second on the screen. Logan pushed back on
      demoting scan TWICE and he is right — scan is the acquisition hook. It is also not needed:
      banner + Cook tonight alone are 614 of the 926pt.
      *(SUPERSEDED 2026-09-15: scan is a two-pill row in the Pantry rebuild; Logan approved the layout.)*
- [x] Result: header 78 + scan 130 + search 68 + categories header 36 = 312pt, rows land at 720.
      *(SUPERSEDED 2026-09-15 by the Pantry rebuild's layout.)*

**Pantry category rows carry two data points for 68pt each.**
- [x] ~~Colour the icon circles at rest.~~ DONE 2026-09-14. `app/(tabs)/pantry.tsx:184` already has `category.iconColor`
      and only applies it when the row is EXPANDED, so all six read as identical grey. One line.
      This is also where the tab's visual identity comes from once the banner is gone.
- [x] Add 2-3 item names as a muted subtitle ("chicken, ground beef, salmon…"). Same height, triple
      the information, answers "what's in there" without a tap.
      *(SUPERSEDED 2026-09-15: the accordions are gone; every item is visible as a row.)*

**⚠️ The pantry cannot deplete — and meal generation is built on top of that.**
- [x] Every `in_stock` write in the app sets TRUE (`lib/pantryInsert.ts:41`, `grocery.tsx:374`,
      `pantry.tsx:558`). The only path to FALSE is the manual toggle at `pantry.tsx:486`, buried
      inside a collapsed category below the fold. So `useMealSuggestions.ts:106` generates from a
      pantry that only accumulates — an ever-growing fiction — and "Ready to cook" is a claim the
      app cannot back. Likely a contributor to the repeat problem: a 55-item pantry keeps every
      stale ingredient in the prompt forever. Needs a decision (log a meal → offer to mark its
      ingredients used? a "still have this?" nudge on items untouched for N weeks?), not a patch.
      Blocked on confirming `pantry_items.created_at` exists — the table is not in any migration.
      *(ADDRESSED 2026-09-15: Out is a one-tap toggle on every visible row, and the perishable review marks items Used up.)*

**Home layout — knobs left unspent after the 2026-09-04 compression.**
Shipped: ring 170→124, header crunch, slot rows slimmed. The LOG_PEEK reserve is GONE as of
2026-09-14 — nothing on Home is fit to the fold any more (§6c), so every point trimmed above the
rows now lifts the meal log into view directly. Still available:
- [ ] Move the day nav inside the calorie card (~20pt). Worth ~20pt more of Breakfast at the fold.
- [x] ~~Drop "Let's start tracking today"~~ — the line is now "Nothing logged yet" at 0 and the
      consumed-of-goal figure otherwise; "Keep logging!" implied you had started.
- [x] Calorie card → number-left / ring-right, macros as a 3-tile row — shipped earlier; on
      2026-09-14 the tiles were reordered to label / number / bar top-down (the bar used to sit two
      rows away from the figure it measured, which is what read as "stacked weirdly").

**Smaller, all confirmed by reading the code or the screenshots:**
- [x] Pantry tab icon is `UtensilsCrossed` (`app/(tabs)/_layout.tsx:96`) — a MEAL icon on the
      ingredients tab. Should be a shelf/basket/box.
      *(DONE 2026-09-15: `Refrigerator`, seen on device.)*
- [x] "Other" holds 12 of 56 pantry items — 21% still uncategorised after the 2026-09-03 backfill.
      Either the scan model punts to Other freely or the canonical list has a gap.
      *(DONE 2026-09-15: the name decides the category, `964a183` + `3fbbb93`; Other 30 → 1 across all users, 0 for Logan.)*
- [ ] Saved Meals runs 4 filters over 5 meals. Show filters past a threshold (~8) or they read as
      scaffolding.
- [ ] Grocery: "Just 2 items left to complete your list" at 0/2 — "left" implies progress made.

**DECIDED — "Made from your pantry" is post-launch, and it is an ARCHIVE, not an expansion.**
- [ ] Not "Cook tonight but longer". `RECENT_MEMORY = 30` is the no-repeat window, so expanding
      Cook tonight means "3 fresh picks + 27 you already passed on", and stale rows carry unbackable
      readiness badges. Reframed: a separate section BELOW the categories, "Made from your pantry —
      18 dishes", different promise from both Home (tonight) and Discover (the internet's food).
      Cheaper than the design in `docs/todos.md` because moving the entry point off Home's carousel
      removes the terminal-card-in-an-infinite-loop problem that doc calls the real build risk.
      Hard-gate below ~12 dishes or it looks broken in the trailer. Sharpest objection on record:
      Saved Meals already holds the ones worth keeping, so the honest pitch is "the one you forgot
      to save".

---

## 6e. Security follow-ups from the 2026-09-04 sweep

The critical finding (a published, permanent premium bypass) is FIXED and verified in prod — see
`git log` for `20260904151500` / `152600` / `153900`. Never exploited: 0 redemptions all time.
What that sweep left open:

- [x] **Replacement comp code minted 2026-09-04** via `scripts/creator-code.sh` — shared, 25 per
      rolling 30 days, expiring. Value lives in the DATABASE and in Claude's local memory only.
- [x] **Anon-callable `insert_saved_meal` overload DROPPED** — SECURITY DEFINER, no `auth.uid()`
      check, took the target account as a parameter, executable by `anon`. Third instance of the
      leftover-overload trap. (`cc9d43b`)
- [x] **Creator comp codes rebuilt** — `scripts/creator-code.sh`, rolling 25-per-30-days budget,
      denied attempts no longer eat it, attribution can no longer be silently overwritten. The live
      code is in Claude's memory, never in this repo.
- [ ] **🚫 STANDING RULE — a code value never enters this repo.** It has leaked TWICE now:
      `PANTRY_CREATOR` in the 2026-05 seed, and `CREATORS-D9929`, hand-written into
      `20260904171500` about an hour after the first was removed. Both were rotated rather than
      edited out, because the repo is public and git history keeps the value. To touch the live
      code from SQL, match on a property (`grants_premium`, `cap_window_days`, `creator_name`),
      never on the literal. `scripts/creator-code.sh` is the only sanctioned way to create one.
- [ ] **`validate_referral_code_v2` is still an anon oracle** returning `grants_premium` for any
      guess, and PostgREST calls bypass the edge functions' rate limiter entirely. It cannot simply
      be revoked: onboarding calls it at step 16, BEFORE createaccount, and step 3325 skips the
      paywall on the result. Entropy + a redemption cap is what makes the oracle worthless; real
      rate-limiting needs an identity anon does not have.
- [x] **⚠️ The migration tree does not match production — DIFFED 2026-09-04, and it found a live
      hole.** `insert_saved_meal` had TWO overloads in prod; the superseded 9-arg one was SECURITY
      DEFINER, had NO `auth.uid()` guard, took the target account as a parameter, and was executable
      by **anon**. Dropped in `20260904161200` and verified: one overload left, guarded.
      Also confirmed benign: `handle_new_user()` and `rls_auto_enable()` are in no migration but
      both return `trigger`/`event_trigger`, so neither can be invoked directly. `rls_auto_enable`
      is wired to `ensure_rls on ddl_command_end` and never disables RLS — it is why every table
      had RLS on. Every remaining anon-executable DEFINER function is either uncallable (trigger)
      or guarded internally by `auth.uid()`.
      **Standing rule this produced: audit against `pg_proc`, never against the migration tree.**
- [ ] **Item 10 downgraded, see below.**

---

## 7. Onboarding trailer  *(after 3 — the app must be final before filming)*
- [ ] BLOCKED ON A DECISION: is any cached meal image hero-grade enough to hold 2.4 seconds? That
      frame is a third of the film.
- [ ] **The resolution half of that question now has a number.** Full-screen is 1179x2556, so a 512
      source is a **5x upscale** — and unlike in-app browsing (closed as imperceptible, §2b) this is
      held still, re-encoded, and watched as an ad. **1024 does NOT solve it either (still ~2.5x).**
      If a photo has to carry a full-screen frame, render those few dishes at 1536 or 2048 as a
      one-off: `generate-meal-image` takes internal-only `imageSize` and `seed` overrides, so it is
      a request-body change, not a code change, and it costs cents for a handful of dishes.
- [ ] Note the fidelity fixes landed AFTER most of the library was generated. Whichever dishes the
      trailer uses must be regenerated anyway (see §2b) — do the high-res render in the same pass.
- [ ] Shot list: https://claude.ai/code/artifact/766f88c0-a922-463a-ad84-09059a351b14
- [ ] **Phone shell + tooling — Logan asked 2026-09-16 for a Rotato-like skill/repo path, then for the
      installable-skill search to be exhaustive. PLAN ONLY, nothing installed in this repo.** Both
      slots already draw a flat 2D shell (`OnboardingTrailer.tsx` PHONE_W 250; paywall
      `w1.phoneContainer` 280pt × 9:19.5 with drawn side buttons, `contentFit="cover"`, 0.9× rate).
      A phone baked into the video REPLACES those shells — it cannot sit inside them — so this is the
      shell decision rev 3 left open.
      **Search result (every fact in memory `reference_trailer_tooling`):** the claude.ai skill
      directory and the org plugin catalog have nothing for device mockups. skills.sh and GitHub do:
      1. **HyperFrames** (`npx skills add heygen-com/hyperframes`, HeyGen, Apache-2.0, 50k★, 500K+
         installs) — the only ecosystem with device-mockup primitives as installable items.
         `device-frame-stage` (CSS phone, Dynamic Island cutout, rise → settle → idle float, screen
         slot that takes HTML incl. a `<video>` clip) VERIFIED to `init` + `add` here on CLI 0.8.42
         via a scratchpad probe. Its own spec bans "spinning hardware reveal, glare sweep,
         camera-lens tour" — the restrained motion the trailer wants anyway. The real-GLTF iPhone
         15 Pro Max block `vfx-iphone-device` FAILS today ("Invalid registry manifest": its files
         say `type: "asset"`, working blocks say `hyperframes:asset`), is landscape 1920×1080,
         experimental, and needs Chrome's experimental drawElementImage. Render needs Node ≥22 ✓,
         FFmpeg ✓, a bundled Chrome download; telemetry on by default
         (`npx hyperframes telemetry disable`). Install core + registry + cli skills only; skip the
         `product-launch-video` orchestrator (URL capture, HeyGen sign-in for voice/BGM).
      2. **Remotion + `remotion-dev/skills`** (527K installs) — unchanged fallback; 2.5D CSS tilt
         first, `create-video --three` slab only if the phone must turn. `av/remotion-bits`
         (Scene3D, cursor-flyover) and `Remocn` (launch templates) add motion but NO phone frame.
      3. **`michaelboeding/skills@device-framer`** (27★, 23 installs) — flat 2D one-liner: MP4 in →
         framed MP4 out, ffmpeg + Pillow, 12 iPhones incl. 17 Pro Max using Apple's official bezel
         PNGs, shadow + bg. Script reviewed: subprocess only for ffmpeg, no network. No motion.
      4. **Slant** (`slant.html` in `tdimino/claude-code-minoan`'s recordly skill, 41★) — one HTML
         file, three.js + HDRI + DOF, 12 Rotato-style camera presets, but a flat plane with no
         bezel and MediaRecorder export. Use the file, not the skill's Recordly install script.
      Not for video: nexu-io `mockup-device-3d` (static CSS poster) and `open-design/mobile-app`
      (iPhone 15 Pro SVG bezel — a usable frame source for path 2), `aso-appstore-screenshots`
      (§8). Paid SaaS via MCP: Clueso (free 10 min/mo, $40/mo Solo) — device frames not stated.
      Reference, not renderer: `eronred/aso-skills@app-preview-video` (§8 App Store previews).
      **Recommended:** dry-run HyperFrames with the existing 886×1920 `.mov` in the
      `device-frame-stage` slot, portrait root on `#000000`, before shoot night; fall back to
      Remotion if the portrait host or video-in-slot breaks. Wire-in sets playbackRate back to 1.0
      and deletes the drawn shell. Still gated on §3 and the hero-image decision above.

## 8. App Store screenshots + description  *(after 3)*
- [x] **NAME DECIDED 2026-09-04 — `Pantry: AI Meal Planner` (23/30), already live in ASC.**
      A 2026-04-07 decision renamed it to "Pantry: Food Tracker" to drop "AI"; that rename was
      never applied and has now been dropped rather than completed. Reasoning: dropping "AI"
      optimised for brand taste at a stage where the name's only job is discovery — zero users
      means no brand equity to protect, and the name field is the heaviest-weighted keyword
      surface in App Store search. Cal AI, the direct benchmark, carries "AI" in the same
      category. "Food Tracker" was also the wrong fight: that term belongs to MyFitnessPal /
      Lose It / Cal AI, and Logan's own positioning is "instead of getting the macros we make
      the food" — the differentiator is generation, so "Meal Planner" is where it lives.
      No conflict with the no-sparkles rule: that governs UI craft, this is a discovery surface.
- [ ] **Subtitle proposed: `Scan your pantry, track macros` (30/30)** — picks up the *pantry
      scan* and *macro tracking* keywords the name gives up. Not yet set in ASC.
- [ ] **⚠️ The name/subtitle call was reasoned from structure and the Cal AI precedent, NOT from
      live search-volume data.** A real ASO check belongs here before the copy is written.
- [ ] **Screenshots must be AI-generated, not Figma re-skins.** Method Logan wants used —
      surface this when the task comes up, do not make him re-explain it:
      1. **Find references first.** Browse Screens Design (screensdesign.com) or Dribbble for App
         Store screenshot layouts he actually likes. Reference-driven, not designed from scratch.
      2. **Then capture the real app.** Logan takes photos/screen-grabs of the best FEATURES in
         Pantry — the actual screens, not mockups.
      3. **Hand both to an AI to write the prompt.** Feed the reference shots + the app captures
         into ChatGPT or Claude and have it produce the image-generation prompt.
      4. **Let the AI generate the final screenshots** from that prompt.
      This is a rough guideline as of 2026-09-08, not a locked spec — expect it to tighten once
      the first set is made.

## 9. Unset SCAN_CAP_WEEK  *(after the trailer and screenshots are shot)*
- [x] **DONE — already unset as of 2026-09-16** (preflight: "SCAN_CAP_WEEK unset"; Logan's scans were refused at 7/7 that day). Raise it again only if filming needs more than 7 scans a week. Was: `npx supabase secrets unset SCAN_CAP_WEEK` — unset is correct; scan-pantry falls back to 7.
      Held raised deliberately until app fixes and filming are done. Preflight fails until reverted.

## 10. Clean git history of leaked secrets  *(DOWNGRADED 2026-09-04 — not a blocker)*
The `.env` committed at `eb9a624` contained ONLY `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Both ship inside the IPA by design and are public keys. No
service-role, OpenAI, FAL or FatSecret secret is in history. Real hygiene, not a launch gate.
- [ ] BFG Repo-Cleaner — anon key still in old commits.

## 11. TestFlight beta
- [ ] Everything above must be in the build.
- [ ] **First launch after installing the TestFlight build: open Pantry by tapping the icon and confirm it gets past the splash.** The remote-launch splash hang (§6c, closed) never reproduced by hand, but was never tried on a fresh install either.
- [ ] **Prove the email system end to end here, not at launch.** It had NEVER worked before
      2026-08-30 (`4c016c2`) — loops-sync selected `email`/`full_name` from `profiles`, which have
      never been columns there, so every call failed on the unknown column and no contact or event
      ever reached Loops. Now reads identity from `auth.users`. Needs a real signup + purchase to
      confirm.
- [ ] **Verify the engagement counters move.** `touchLastActive`, `trackCookTonightUsed`,
      `trackMealSavedEngagement` and `trackGoalsCustomized` had never been called by anything
      (`8977f41`). Use the app — save a meal, open a Cook Tonight pick, change a goal — then re-read
      the profiles row. Until this is checked the Loops sequences are unproven.

## 12. App Store submission
- [ ] App Review demo account: `appreview@heypantry.app`, `promo_active=true`, entered in App Store
      Connect. REQUIRED AT EVERY SUBMISSION — a missing one is an automatic rejection.
- [ ] Paste the prepared App Review Notes into the Notes field.
- [ ] Submit.

---

## Unresolved — surfaced 2026-08-30

Four of the five originals are fixed (orphan Discover row deleted, grocery evening date bug, mock
data removed from the bundle, `last_active` schema drift). The email and engagement items moved into
step 10, since TestFlight is where they can actually be proven. What is left unowned:

- **`CODE_REVIEW.md` — TRIAGED 2026-08-30, and it is CLEAN where it matters.** All 3 criticals and
  all 15 highs were re-verified against live code and the live database: **18 of 18 are closed**.
  The results table is at the top of that file. Two are worth knowing: C1 (promo_active bypass) is
  fixed by a TRIGGER and not by RLS — the policy is still blanket `auth.uid() = id`, so anyone
  auditing this must check `trg_enforce_server_premium`, not the policy. And H13 is by design:
  onboarding proceeds without a purchase because every feature is gated downstream, which is the
  behaviour item 4 formalises.
  The 42 medium and 27 low findings were NOT checked. Given an 18-of-18 stale rate on the severe
  ones, a fresh `/security-review` would carry more signal than triaging the rest.

## Deliberately NOT on this list

Decided with Logan on 2026-08-30 — do not re-add without asking:

- **Stripe web checkout** (3 items) — Apple IAP alone is sufficient to launch.
- **Paywall A/B tests** (pricing, hard-vs-soft, placement) — cannot be run without traffic.
- **Creator recipes** — a v2 feature. The single orphan row was deleted so it does not render.
- **2FA**, Instagram import, Whisper transcripts, share extension, custom vision/macro models,
  dessert and trending feature scoping, content-lead hiring and UGC scaling.
- The 13 content-idea screen recordings are launch marketing, not submission blockers.
