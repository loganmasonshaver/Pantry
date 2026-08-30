# Handoff — 2026-08-30 (evening)

Replaces the morning handoff (in git history at `3f609ac`). **26 commits this session.**
`git log --since="2026-08-30 14:00"` carries the reasoning for every one — what was measured, what
was rejected and why. This file holds only what git does not.

State: everything committed, pushed and deployed. **192 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). Preflight green except
`SCAN_CAP_WEEK`, which Logan is holding raised **on purpose** until app fixes and filming are done.

**TS baseline moved twice today: 150/45 → 132/27 → 134/27.** Deleting a dead `MOCK_DETECTED` array
removed 18 errors in one go; two new `Deno.env.get` lines added one Deno-global each. Watch the
app-code number (27), not the total.

---

## 0. READ THESE FIRST — they replace parts of this file

- **`docs/PRELAUNCH.md`** — the OFFICIAL pre-launch checklist. Logan declared it canonical on
  2026-08-30 after triaging a 60-item list down to 11. **When he asks "what's next for pre-launch",
  answer from that file.**
- **`docs/TRENDING-OPEN.md`** — standing re-audit procedure and open items for the trending
  pipeline. Read before any pipeline pass.
- **`~/my-briefing/todos/active.md` is CONTESTED.** A concurrent session overwrote it wholesale
  **five times** today, losing appended content each time. That is why the two files above live in
  the repo. It is also ~20 commits ahead of its origin and unpushed.

---

## 1. NEXT TASK — both blocked on YouTube quota, which resets midnight Pacific

**Quota was exhausted today by ~16 measurement runs.** The 05:00 UTC cron fires at 22:00 PDT the
*previous* day, i.e. inside the same quota window — so **tomorrow's cron will likely add nothing**.
Not damaging (18 rows for 08-30, 30-day retention), but expect one empty day and do not diagnose it
as a new bug.

1. **Is trending yield variance or a defect?** Identical code, sequential runs produced raw 24 vs 5
   and stored 17 vs 4. A once-daily cron takes ONE sample from that spread and the swap makes it
   permanent — a better explanation of "thin days" than any single defect. Method: ~10 **sequential**
   `?dryRun=true` runs. If it confirms, the fix is architectural: run the cron 2-3x and keep the best
   batch, or merge instead of replace.
2. **Finish the OpenAI fallback check.** One call:
   `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`, then read
   `funnel.llm_OpenAI` and `providerErrors`.

### New tooling built today — use it
- **`?dryRun=true`** runs the whole pipeline and returns the funnel WITHOUT inserting, deleting or
  generating images. Every yield measurement before this swapped the day's rows; six runs churned
  the feed six times. Dry runs still spend YouTube quota.
- **`?provider=openai|google`** forces one provider. The fallback is otherwise unobservable, which
  is exactly how it shipped with two breaks.
- **The `funnel` object now rides in the RESPONSE**, not just logs (which need the dashboard). It
  carries rawCandidates → dedup → viewFloor → ingredientGate → sentToLLM → llm raw/sanitized →
  stored, every rejection counter, `droppedDetail` and `providerUsed`. The cron's response lands in
  `net._http_response`.

---

## 2. NEEDS LOGAN

- **`SCAN_CAP_WEEK`** — deliberate hold. `npx supabase secrets unset SCAN_CAP_WEEK` after filming.
- **The trailer** is blocked on ONE decision: is any cached meal image hero-grade enough to hold
  2.4 seconds? That frame is a third of the film.
- **Pantry scan flow QA** — Logan added this as a gate: the flow must be walked end to end on device
  and the UI must look right **before the trailer is filmed**. Delete or wire the dead review screen
  first (below).
- **App Store Connect products (#1 on the checklist)** — he recalls a "not approved" state.
  Banking/Mercury is confirmed complete, so that is NOT the cause. Check: products in "Missing
  Metadata", not attached to a version (a first-time IAP is reviewed WITH a version, never alone),
  or a Superwall mapping pointing at product IDs that no longer exist. I cannot check this — the
  Superwall CLI needs an interactive login to his account.

---

## 3. WATCH — shipped today, never observed working

Everything here is unverified in the direction that matters. Do not report any of it as working.

- **The Loops email integration had NEVER worked.** loops-sync selected `email` and `full_name` from
  `profiles`; neither has ever been a column there, and PostgREST fails the whole query on an
  unknown column. Every call, every user, since the file was written, returned
  `column profiles.email does not exist`. No contact was ever created, no event ever fired. Identity
  lives in `auth.users` (email on the user, full_name in metadata) and is now read from there.
  **Needs one real end-to-end test — do it in TestFlight, not at launch.**
- **Four engagement trackers were never called by anything.** `touchLastActive`,
  `trackCookTonightUsed`, `trackMealSavedEngagement`, `trackGoalsCustomized`. The data was stark:
  32 saved meals and 12 meal logs existed while 0 users had any counter above zero. Now wired.
  Verify by using the app and re-reading the profiles row.
- **Subscription lifecycle moved server-side.** `subscribed_at`/`churned_at` are now written by
  `superwall-webhook` on `initial_purchase` / `expiration`. The client versions were DELETED — do
  not re-add them; Superwall's SDK only reports ACTIVE/INACTIVE and cannot tell a conversion from a
  trial start. Needs a real purchase or expiration to prove.
- **loops-sync now accepts a trusted server caller** (CRON_SECRET / service-role) so the webhook can
  reach it. `delete` stays user-only deliberately — its email comes from the verified session
  precisely so a caller cannot name someone else's contact.

---

## 4. DEAD ENDS — measured and rejected today, do not rebuild

- **Reordering the view floor to run after the ingredient gate.** This was my plan and the
  measurement killed it: 634 raw → 171 past the 100k floor → 61 gated, against a 60-video cap. The
  candidate pool is NOT the bottleneck at any stage; the model returning ~17 of 60 is.
- **A digit-plus-time-unit rule for instruction detection** ("30 минут", "for 5-7 minutes"). Caught
  nothing the temperature and word-count rules miss, AND deletes real food — "10 minute rice" and
  "5 minute oats" are products.
- **Letting the fractional gate accept `1/2` and `½`.** Un-broken as written it would reject three
  live recipes, all legitimate ("1/2 can corn", "1/2 packet jello", "1/4 sliced onion"), and catch
  nothing real. Decimals only — the failure mode is arithmetic, humans write fractions.
- **Raising the LLM output target from 15-20 to 30-40 as a yield fix.** Unproven. Raw output went
  17 → 5 → 17 → 24 → 5 on identical code. I briefly concluded "it did nothing" from a 17→17 pair;
  that conclusion was worthless at this noise level. Do not claim a yield win without ~10 runs.

---

## 5. METHOD — three ways I got burned today

1. **Shell loops lie.** `git show <ref>:<path> | grep -c` inside a `for` loop returned 0 where the
   file plainly had 2 matches, and I nearly concluded a gate had been removed. Redo any such
   trace in Python before believing it.
2. **Concurrent dry runs are not repeats.** Three fired at once starved each other's YouTube quota
   and dropped the gate from 61 videos to 8. Run them sequentially.
3. **Retyping code to "reproduce" a bug can invent a clean version.** The fractional gate contained
   a literal backspace byte (0x08) inside a `String.raw` template, making it inert for 19 days. My
   hand-typed reproduction matched; the real source could never match. A test now asserts no source
   file carries a stray control character.

---

## 6. NOT DONE, deliberately

- **`CODE_REVIEW.md` holds 87 confirmed findings; ~80 are unchecked.** Its paywall findings were
  verified stale today (`handleStartTrial` no longer exists; Restore/Privacy/Terms all have live
  handlers). The rest deserve one triage pass and will likely surface real work.
- **`setStep(6)` is still never called.** The whole "Found N ingredients / review and confirm"
  screen in `PantryScanModal` (~80 lines) is unreachable; the live path is 1 → 4 → 5 → 55. Delete or
  wire it BEFORE the scan-flow QA, or you will be testing around a ghost.
- **The scan camera has not been re-tested on device** since the 16-photo cap and full-width scan
  pill landed. The bottom bar now carries filmstrip + shutter + full-width button. If the viewfinder
  feels cramped, hiding the tips pill after the first photo is the next lever.
- **Two stored rows still carry `1/2 can` / `1/2 packet` ingredients.** Harmless — the gate now
  correctly ignores common kitchen fractions. Noted so they are not re-flagged as findings.
- **`SYNONYMS` narrowing left `maple`, `honey` and `ranch` with no synonyms.** Watch for false
  "missing maple" gaps on recipes listing only "syrup".

---

## 7. Corrections to earlier claims — believe these, not the transcript

- "21% of multi-serving rows have incoherent servings" was **wrong**. The macro table's gaps let
  calorie-dense misses through a gram-weighted coverage filter. Strict basis: **~6%**, median 0.93.
- "Six engagement trackers, three wired" was **wrong**. Eight exports; two were still unwired after
  the first pass (`markSubscribed` imported-never-called, `markChurned` never imported).
- Two stored rows violating the fractional gate were **not** a deploy lag. Deployed source is
  byte-identical to HEAD (verified with `supabase functions download`, 102,011 bytes, zero diff).
  The gate was inert.
