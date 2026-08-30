# Handoff — 2026-08-30

Yesterday's file is in git history (`aeaf61f`) if you need it. 9 commits today, plus 2 late on
2026-08-29. **`git log --since="2026-08-29 20:00"` carries the reasoning for every one** — what was
measured, what was rejected and why. This file holds only what git does not.

State: preflight green except `SCAN_CAP_WEEK`, which is failing **on purpose** (see §2). Everything
committed, pushed and deployed. 170 tests (`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).
TS baseline **150** total / **45** app-code — the app number is the one that matters.

---

## 1. NEXT TASK — read the funnel logs before touching anything

Logan asked why trending runs look thin (5–14 meals/day against `STORE_CAP` 18). **Do not answer
that from the code.** Three separate attempts to reason about it from source today produced wrong
answers that only measurement caught. The cron runs 05:00 UTC; after it, read
Dashboard → Edge Functions → `generate-trending-meals` → Logs for:

```
[funnel] raw YouTube candidates: N
[funnel] ingredient-list gate: N/M videos have a readable list     <- the dominant filter, ~28%
[funnel] view floor … → N videos
[funnel] Google LLM: N raw → M sanitized (rejected: noName, noMacros, dupName, nearDup,
         fractional, dupIngredients, dropped, nameGap, untranslated)
[funnel] rejected "X" — named for blueberry, absent from ingredients
[funnel] rejected "X" — source is de and the ingredients were not translated
```

The last two lines are new gates shipped today; **they have never been observed in production.**
`nameGap` and `untranslated` got their own counters precisely so this read is unambiguous — they
used to share `dropped`.

The two candidate conclusions point at completely different work, which is why guessing is
expensive: if volume dies at the ingredient-list gate the lever is candidate volume or parser
precision; if it dies at dedup it is something else entirely. Measured rejection rate for the new
name-gap gate over the stored pool was 4% with zero false positives, so it should be a rounding
error — if it is large, suspect the gate, not the model.

### The method that worked all day, in order of yield

1. **Query the real data and count.** Every finding today came from running a function over the
   live pool and reading output. Nothing came from reading code alone.
2. **Then hand-verify every hit before believing the number.** The first pass at name/ingredient
   mismatches said 28/168; the real answer was 7. The difference was three bugs in the *analysis
   script* (a stemmer turning "potatoes" into "potatoe", `\b` being ASCII-only so it never matched
   before "Ł", and subtracting stems from unstemmed words). An unverified count is a guess wearing
   a number's clothes.
3. **Check the direction of the error.** Two of today's near-misses were fixes that would have made
   things *less* safe. See §4.

---

## 2. NEEDS LOGAN

- **`SCAN_CAP_WEEK` is set to 50** for the trailer shoot. Preflight FAILS until it goes back:
  `npx supabase secrets unset SCAN_CAP_WEEK` (unset is correct — scan-pantry falls back to 7).
  This is now a blocking preflight check rather than a note, because the file's own comment calls
  leaving it raised "the forgot-to-revert-before-launch footgun".
- **The trailer.** Corrected shot list: `https://claude.ai/code/artifact/766f88c0-a922-463a-ad84-09059a351b14`
  It supersedes rev 2 ("Eight Seconds") beats 1–2 and its footage list — those described a live
  detection overlay that **does not exist** (verified in `PantryScanModal`: during a scan you get
  process-only status lines, the count is 0 until results land, chips-on-photo is the review step).
  Blocked on one question Logan has not answered: **is any cached meal image hero-grade enough to
  hold 2.4 seconds?** That frame is a third of the film.
- **App Store screenshots** after the trailer.
- **Two chats are writing `~/my-briefing/todos/active.md`.** Its content from this session was lost
  twice — once to an uncommitted reset, once to commit `eabc399` overwriting the whole file.
  Recovered both times from git. If the other chat keeps writing the file wholesale rather than
  editing it, this will keep happening.

---

## 3. WATCH — shipped today, never seen in production

- **`nameGap` / `untranslated` rejections** (above). Measured 4% and 0% respectively against stored
  data; unknown live.
- **The Discover prefetch** now runs from `app/(tabs)/_layout.tsx`, not from the Discover screen —
  that screen isn't mounted until you open it, so nothing inside it can run ahead of the user.
  Symptom if it regresses: opening Discover on a new day shows yesterday's shelves for 2–3s and
  then visibly re-lays-out.
- **The scan camera keeps you on the shutter now.** Not re-tested on device since the 16-photo cap
  and the full-width scan pill landed. The bottom bar carries more than it used to (tips pill moved
  up top, filmstrip, shutter, full-width button); if the viewfinder feels cramped, the tips pill is
  the next thing to hide after the first photo.

---

## 4. DEAD ENDS — measured and rejected, do not rebuild

Each of these looked obviously right and was killed by data.

- **Macro-based drop detection.** `verifyMacros` already exists, is tested, and gates
  `generate-meals` but not trending — it looks like free coverage. It is not. A dropped ingredient
  makes the claim EXCEED the estimate, and that check only fires on protein overstated or calories
  understated. Applied naively it also fails 42% of the pool, because trending stores **batch**
  ingredients with **per-serving** macros and the check knows nothing about `servings`. Normalised
  for servings, known-bad meals land at 0.98–2.03x — inside the clean distribution (p50 1.07,
  p75 1.53). Catching half of them costs a third of the feed.
- **Food-table coverage as a language detector.** Does not separate: the lowest scorers are
  English-language INDIAN recipes ("Lauki Galouti Kebab" scores 0.00, identical to a Polish list)
  because the macro table is Western-biased. It would have deleted a cuisine.
- **English marker words alone.** Every foreign fixture scores 0.00 — and so does one real English
  meal whose ingredients are all brand nouns ("Quest Salted Caramel Milkshake, Xanthan Gum, Monk
  Fruit Sweetener"). That is why the shipped check requires YouTube's `defaultAudioLanguage` to
  agree before it drops anything.
- **Widening the trending dedup window.** The 60-day name window and 90-day video window read from
  `trending_meals`, which retention prunes at 30 days — so they can never exceed 30 (measured: 21).
  The stated guarantee ("won't reappear when its twin ages out") is unimplemented and a bigger
  number cannot implement it; it needs a ledger outliving the rows.
- **Re-running `classifyDietTags` over stored rows and writing the result back.** Nearly shipped.
  The stored tag is `classifyDietTags` AND the model's own `contains_*` answer, and that answer is
  **not a column** — so a stored `false` may be the model catching dairy the keywords cannot see
  (Oreo Fluff: Cool Whip and pudding mix). A wholesale rewrite would have made 20 rows MORE
  permissive. Tag corrections must only ever AND toward `false` and remove diets, never add.

---

## 5. NOT DONE, deliberately

- **`setStep(6)` is never called.** The entire "Found N ingredients / review and confirm" screen in
  `PantryScanModal` (~80 lines) is unreachable; the live path is 1 → 4 → 5 → 55. Same shape as the
  dead second-pass code deleted today. Left for its own commit.
- **`app/(tabs)/grocery.tsx:265`** compares `created_at` (a timestamp) against a bare UTC date
  string, so "today's order" goes unfound in the evening. Needs a local-midnight instant.
- **Schema drift: onboarding upserts `last_active`, and no migration creates it** (only
  `last_active_at` exists). Prod must have it from a manual dashboard add — meaning **migrations
  alone cannot rebuild this database**, and a fresh environment would hard-fail onboarding on the
  one upsert CLAUDE.md calls the #1 bug source. Verify against the live schema and add a migration.
- **The pipeline ingests non-English videos.** Now instructed to translate and gated on it, but
  nothing verifies the *name*. A fully-foreign recipe with a foreign name would still pass. Left
  until it recurs rather than guessed at.
- **One HIGH audit finding remains:** "Fidget avacaodo brownie" (2026-05-12) has a null image and a
  mangled name. It is the only `trend_source = 'creator'` row and retention does not delete those,
  so it will not age out on its own.
- **~50 MED audit findings**, mostly `shelf_tag` null on older rows (they fall to the catch-all
  shelf) plus a few protein overstatements. Not user-blocking.

---

## Useful tools built today

- `supabase db query --linked "<sql>"` — runs SQL against prod. `--linked` is required; it defaults
  to local and fails with a Docker error. `compatible_diets` is `text[]`, **not** jsonb; a jsonb
  literal aborts the whole statement.
- The pool audit script pattern: fetch `trending_meals` with the anon key (it has public SELECT),
  then run `_shared/recipe-integrity.ts` + `_shared/diet-tags.ts` + `_shared/macro-estimate.ts` over
  it under `node --experimental-strip-types`. That is how every number in this file was produced.
- **Secrets are confirmable without reading them.** Supabase stores an unsalted SHA-256 per secret,
  so `supabase secrets list` plus `printf '%s' 'on' | shasum -a 256` proves a short known value.
  That is how `PREMIUM_ENFORCEMENT=on` was verified rather than assumed. Useless against real API
  keys, which is the point.
- **CLI 2.116 changed both output formats preflight parsed.** `functions list` is JSON now;
  `migration list` is JSON by DEFAULT while `-o json` returns the OLD table. Both parsers were
  fixed; preflight also no longer hides drift inside its 3-minute grace.
