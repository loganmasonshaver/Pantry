# Handoff — 2026-08-30 (evening)

Replaces the morning handoff (git history, `3f609ac`). **30 commits this session.**
`git log --since="2026-08-30 14:00"` carries the reasoning for every one — what was measured, what
was rejected, and why. This file holds only what git does not.

**State:** everything committed, pushed and deployed. Working tree clean. **192 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). Preflight green except
`SCAN_CAP_WEEK`, held raised **on purpose** until app fixes and filming are done — do not "fix" it.

**TS baseline moved twice today: 150/45 → 132/27 → 134/27.** Deleting one dead array removed 18
errors; two new `Deno.env.get` lines added one Deno-global each. **Watch the app-code number (27),
not the total.**

---

## 0. READ FIRST — these two files outrank this one

- **`docs/PRELAUNCH.md`** — the OFFICIAL pre-launch checklist. Logan declared it canonical after
  triaging a 60-item list down to 11. **When he asks "what's next for pre-launch", answer from that
  file.** It also carries a "Deliberately NOT on this list" section — do not re-add those.
- **`docs/TRENDING-OPEN.md`** — standing re-audit procedure and open items for the trending
  pipeline. Read before any pipeline pass.
- **`~/my-briefing/todos/active.md` is CONTESTED and mostly stale.** A concurrent session overwrote
  it wholesale **five times** today. Its GitHub remote is **archived and read-only on purpose** —
  commits pile up locally and Logan confirmed he wants it left alone. **Do NOT flag the unpushed
  count**; I did, and it was a deliberate state, not neglect.

---

## 1. NEXT TASK — both blocked on YouTube quota

**Quota budget, the binding constraint.** 10,000 units/day, resets **midnight Pacific**. A run costs
~1,314 units (13 `search.list` @100 + 14 `videos.list` @1), so the day holds exactly **7 runs**.
`?dryRun=true` costs the same — it skips DB writes and image generation, not the YouTube calls.
The cron now runs 08:00 UTC (01:00 Pacific), an hour past the reset, so budget **1 run for the cron,
6 for testing**. **Run tests SEQUENTIALLY** — 3 fired concurrently starved each other and dropped the
candidate gate from 61 videos to 8.

1. **Is trending yield variance or a defect?** Identical code, sequential runs produced raw 24 vs 5
   and stored 17 vs 4. A once-daily cron takes ONE sample from that spread and the swap makes it
   permanent — a better explanation of "thin days" than any single defect. Method: ~10 sequential
   `?dryRun=true` runs. If variance confirms, the fix is architectural (run 2-3x, keep the best
   batch) and **no amount of prompt work helps**.
2. **Finish the OpenAI fallback check.** One call:
   `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`, then read
   `funnel.llm_OpenAI` and `providerErrors`.

### Tooling built today — use it, don't rebuild it
- **`?dryRun=true`** runs the whole pipeline and returns the funnel WITHOUT inserting, deleting or
  generating images. Before this, every yield measurement swapped the day's rows.
- **`?provider=openai|google`** forces one provider. The fallback is otherwise unobservable, which
  is exactly how it shipped with two breaks.
- **The `funnel` object rides in the RESPONSE**, not just logs (which need the dashboard):
  rawCandidates → afterDedup → viewFloor → ingredientGate → sentToLLM → llm raw/sanitized → stored,
  plus every rejection counter, `droppedDetail` and `providerUsed`. The cron's response lands in
  `net._http_response`.
- **`supabase db query --linked "<sql>"`** runs SQL against prod. `--linked` is required.

---

## 2. NEEDS LOGAN

- **`SCAN_CAP_WEEK`** — deliberate hold. `npx supabase secrets unset SCAN_CAP_WEEK` after filming.
- **The trailer** is blocked on ONE decision: is any cached meal image hero-grade enough to hold
  2.4 seconds? That frame is a third of the film.
- **Scan-flow QA is a GATE he set**: the flow must be walked end to end on device and the UI must
  look right **before the trailer is filmed**. Delete or wire the dead review screen first (§6).
- **App Store Connect products** (#1 on the checklist). He recalls a "not approved" state.
  Banking/Mercury is confirmed complete, so that is NOT the cause. Check: "Missing Metadata", not
  attached to a version (a first-time IAP is reviewed WITH a version, never alone), or a Superwall
  mapping pointing at dead product IDs. I cannot check — the Superwall CLI needs an interactive
  login to his account.

---

## 3. WATCH — shipped today, never observed working

Do not report any of this as working.

- **The Loops email integration had NEVER worked.** `loops-sync` selected `email` and `full_name`
  from `profiles`; neither has ever been a column there, and PostgREST fails the whole query on an
  unknown column. Every call, every user, since the file was written, returned
  `column profiles.email does not exist`. No contact created, no event fired, ever. Identity lives
  in `auth.users` and is now read from there. **Prove it in TestFlight.**
- **Four engagement trackers were never called by anything.** 32 saved meals and 12 meal logs
  existed while 0 users had any counter above zero. Now wired at the real interaction points.
- **Subscription lifecycle moved server-side.** `subscribed_at`/`churned_at` are written by
  `superwall-webhook` on `initial_purchase` / `expiration`. The client versions were **deleted** —
  do not re-add them; Superwall's SDK only reports ACTIVE/INACTIVE and cannot tell a conversion from
  a trial start. `expiration` is the churn signal, not `cancellation` (access continues to period
  end).
- **`loops-sync` now accepts a trusted server caller** (CRON_SECRET / service-role) so the webhook
  can reach it. `delete` stays user-only deliberately — its email comes from the verified session
  precisely so a caller cannot name someone else's contact.
- **Trending: 13 fixes today.** The pool is 165 rows, zero null images, zero name/ingredient gaps,
  zero duplicate pairs, zero allergen-unsafe rows.

---

## 4. DEAD ENDS — measured and rejected today, do not rebuild

- **Reordering the view floor to run after the ingredient gate.** My plan; the measurement killed
  it. 634 raw → 171 past the 100k floor → 61 gated, against a 60-video cap. The candidate pool is
  **not** the bottleneck at any stage.
- **A digit-plus-time-unit rule for instruction detection.** Caught nothing the temperature and
  word-count rules miss, and deletes real food — "10 minute rice" and "5 minute oats" are products.
- **Letting the fractional gate accept `1/2` and `½`.** Would reject three live recipes, all
  legitimate, and catch nothing real. Decimals only — the failure mode is arithmetic; humans write
  fractions.
- **Raising the LLM output target as a yield fix.** Unproven. Raw output went 17 → 5 → 17 → 24 → 5
  on identical code. Do not claim a yield win without ~10 runs.
- **Re-running `classifyDietTags` over stored rows** (from the earlier session, still true). The
  stored tag is ANDed with the model's own answer, which is not a column — a wholesale rewrite makes
  rows MORE permissive. Tag corrections may only AND toward `false`.

---

## 5. METHOD — four ways I got burned today

1. **Shell loops lie.** `git show <ref>:<path> | grep -c` inside a `for` loop returned 0 where the
   file plainly had 2 matches, and I nearly concluded a gate had been removed. Redo any such trace
   in Python before believing it.
2. **Retyping code to "reproduce" a bug can invent a clean version.** The fractional gate contained
   a literal backspace byte (0x08) inside a `String.raw` template, inert for 19 days. My hand-typed
   reproduction matched; the real source never could. A test now asserts no source file carries a
   stray control character.
3. **Concurrent runs are not repeats.** See the quota note in §1.
4. **Unverified counts are guesses wearing numbers.** "28 mismatches" was really 7. "21% incoherent"
   was ~6%. Hand-verify every hit.

---

## 6. NOT DONE, deliberately

- **`CODE_REVIEW.md` holds 87 findings; ~80 unchecked.** Its paywall findings were verified stale
  today, and its "canonical pricing" note was itself the stale thing — it flagged the live $9.99 as
  a defect. Worth one triage pass.
- **`setStep(6)` is still never called.** The whole "Found N ingredients / review and confirm"
  screen in `PantryScanModal` (~80 lines) is unreachable; live path is 1 → 4 → 5 → 55. **Delete or
  wire it BEFORE the scan-flow QA** or you will be testing around a ghost.
- **The scan camera has not been re-tested on device** since the 16-photo cap and full-width scan
  pill landed. If the viewfinder feels cramped, hiding the tips pill after the first photo is the
  next lever.
- **Two stored rows still carry `1/2 can` / `1/2 packet` ingredients.** Harmless — the gate now
  correctly ignores common kitchen fractions. Noted so they are not re-flagged.
- **`SYNONYMS` narrowing left `maple`, `honey` and `ranch` with no synonyms.** Watch for false
  "missing maple" gaps on recipes listing only "syrup".

---

## 7. Corrections — believe these, not the transcript

- "21% of multi-serving rows have incoherent servings" was **wrong**. The macro table's gaps let
  calorie-dense misses through a gram-weighted coverage filter. Strict basis: **~6%**, median 0.93.
- "Six engagement trackers, three wired" was **wrong**. Eight exports; two were still unwired after
  the first pass (`markSubscribed` imported-never-called, `markChurned` never imported).
- Two rows violating the fractional gate were **not** a deploy lag. Deployed source is byte-identical
  to HEAD (`supabase functions download`, 102,011 bytes, zero diff). The gate was inert.
- **Pricing is $9.99/mo and $29.99/yr.** The app was always right; the DOCS were stale, including
  customer-facing email templates quoting $7.99. Fixed.
- **`~/my-briefing` unpushed commits are not a problem.** Archived remote, deliberate.
