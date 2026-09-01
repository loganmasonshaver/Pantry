# Handoff — 2026-08-30 (late evening)

Replaces the previous handoff (in git history, `296203a`). **51 commits this session.**
`git log --since="2026-08-30 17:30"` carries the reasoning for every one — what was measured, what
was rejected, and why. This file holds only what git does not.

**State:** everything committed, pushed and deployed. Working tree clean. **226 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). TS baseline **134 total / 27
app-code** — unchanged all session. Pool: **128 meals, 100% source_verified**, oldest 2026-08-16.
Preflight green except `SCAN_CAP_WEEK`, still held **on purpose**.

---

## 0. READ FIRST — the one thing that gates everything

**Eleven generation-side changes shipped today and NOT ONE is verified.** The existing 128 rows
were written by the old code, so they prove nothing about any of it. Do not report any of them as
working.

**`docs/TRENDING-OPEN.md` ends with a `⚠️ CONFIRM ON THE NEXT PIPELINE RUN` block.** It has five
checks with exact SQL, the baseline numbers to beat, and — the part that matters — **what a FALSE
pass looks like**. One run confirms all of them. Read it before running anything.

The three false-pass traps, because they are easy to shrug off:
- `has_time` not moving **at all** means the model is ignoring the method checklist. That is a
  prompt problem, not a parser one.
- Expect a rise but **not to 100%** — only ~43% of descriptions publish a method. Partial is the
  correct outcome, not a failure.
- A `truncated` counter above ~1 per run means the detector is **eating real food**. Read the log
  line naming the ingredient before celebrating.

Quota: ~1,314 units per run, 10,000/day, resets **midnight Pacific / 2am Logan's time**. `dryRun`
costs the same. Run tests SEQUENTIALLY.

Other canonical files, unchanged in authority: **`docs/PRELAUNCH.md`** (the official checklist —
answer "what's next" from it) and **`docs/TRENDING-OPEN.md`** (standing procedure + open items).
`~/my-briefing/todos/active.md` remains contested and stale; its remote is archived on purpose, so
**do not flag its unpushed commits.**

---

## 1. What changed today, in one line each

All of it came out of one screenshot review. Eighteen reported items, all closed.

**Pipeline (deployed, unverified):** junk/massless-ingredient gates · method checklist from the
creator's own steps · cook settings captured from "Air Fryer Settings" blocks · truncation guards
(finish_reason + output check) · decimal-quantity parser fix · section-heading gate · unquantified
ingredient recovery · recipe SECTIONS · non-English parsing · brand-descriptor rule ·
`regionCode=US&relevanceLanguage=en`.

**App code (needs a rebuild, NOT seen on device):** whole-unit counts prefer the creator's count ·
containers show count + size · unambiguous creator units win over grams · fractions instead of
decimals · pepper-is-not-a-spice · Discover dish-form diversity · per-dish photo variation ·
Ingredients header layout.

**Data:** 36 unverified pre-gate rows deleted · 36 junk ingredients stripped · two rows repaired
from source.

**Scan modal (needs a rebuild, NOT seen on device):** a `SafeAreaProvider` inside the modal — see
§5 · the camera's top chrome moved out of the status bar · the prep screen's CTA given real bottom
clearance · the prep screen rebuilt with Lucide icons instead of emoji and its copy audited against
scan-pantry's own documented misses.

**Audit:** `CODE_REVIEW.md` triaged — 3/3 criticals and 15/15 highs closed.

---

## 2. NEEDS LOGAN

- **`SCAN_CAP_WEEK`** — deliberate hold. `npx supabase secrets unset SCAN_CAP_WEEK` after filming.
- **App Store Connect products** (#1 on the checklist). Still unchecked; the Superwall CLI needs an
  interactive login to his account.
- **Scan-flow QA on device** — a gate he set. The dead `setStep(6)` screen was deleted this
  morning, so the ghost is gone and the flow can now be walked honestly.
- **Nothing from today has been seen rendered.** Two visual passes on the Ingredients header were
  reasoned from a measured 36pt row height, not observed. If it still looks wrong, the next suspect
  is the pill height itself (36pt around 12pt text) — shrinking it was the option he did not take.
- **The scan modal now has real insets for the first time.** Adding the provider made every
  `insets.top` in that file live, where they had all been resolving to 0 — so steps 4/5/55
  (`stepWithSafeTop`) and both overlays gain top padding they never had. That is the behaviour
  their own comments intend, but it is a visible change nobody has seen. Check it during the
  scan-flow QA rather than assuming it.
- **The rebuilt prep screen is unseen.** Icons, three new tips, new CTA spacing.

---

## 3. DECISIONS HE MADE — do not relitigate

- **No video link in the app.** Built it, he vetoed it, reverted (`8afcb04` + revert). Do not
  re-propose sending users to YouTube.
- **Cups are a measurement.** He overruled my "grams are more precise for volume-of-a-solid" call.
  If the creator wrote "1 cup", the list says one cup. 222 rows changed.
- **Delete, don't preserve, unverified rows.** He chose deletion twice over softer options.
- **US bias by shoppability.** 29% of the pool needed an Indian grocer; the keyword search was
  globally scoped while the trending call was already US-only. Two query parameters, at the source.

---

## 4. DEAD ENDS — measured and rejected, do not rebuild

- **A "creamy"/"cheesy" name-gap rule.** Looks obviously right for "Creamy Fajita Chicken". Of 4
  pool meals with "creamy" and no literal cream, only ONE is a real gap — the others are satisfied
  by cashew cream, paneer and **vodka sauce**. Rejects 3 good recipes to catch 1.
- **A blanket ingredient dedupe.** Duplicate paprika and Greek yogurt are FAITHFUL — creators
  section recipes (pasta/salmon/dressing, cake/frosting). A dedupe silently halves them.
- **Forcing times into the prompt.** With no method in the source the model INVENTS them, and an
  invented "chicken at 200°C for 25 minutes" is a food-safety claim this app cannot make.
- **YouTube captions.** The free route is closed: `captionTracks[].baseUrl` returns **HTTP 200 with
  a zero-byte body**. Tested across 3 videos and 5 endpoint variants. `captions.download` needs
  OAuth as the video OWNER. Do not spend a session rediscovering this.
- **Dry-basis macro table.** Physically correct — the pool lists starches dry 11 times out of 12 —
  and measurably WORSE: 49 → 50 failures. The table holds offsetting errors and correcting one
  exposes the others. Fix the over-counting first, then flip, then re-measure.

---

## 5. METHOD — five ways I got caught today

1. **A "measured and rejected" verdict is only as good as the measurement.** I killed the
   unquantified-ingredient idea on a test that applied none of the existing gates: 160 junk lines
   vs ~7 real. With the real gates it was ~27 real vs 1 junk. Logan pushed back and was right.
2. **Watch the TS DELTA, not the total.** 134 → 136 was a TDZ crash I had already deployed — it
   would have thrown while building the prompt and taken out the whole run.
3. **The pre-push AI review caught a real bug I could not see.** A `Map` keyed by ingredient line
   collapsed repeated ingredients to their last section — breaking the exact case the feature
   existed for.
4. **Survivorship bias is everywhere here.** Any sample drawn from `trending_meals` consists of
   rows extraction already succeeded on. My 15 sampled descriptions all parsed ≥3 by construction.
5. **English-shaped assumptions keep surviving in new places.** Third time this repo has been bitten
   (Składniki/Zutaten, ASCII `\b`, now three more). A German description inflated the retention
   contract from 7 items to 11 and parsed its method to zero.
6. **A landmine note can be half true and cost you the fix.** CLAUDE.md said "SafeAreaView still
   works because it's a self-measuring native view". True in a normal tree, FALSE inside a
   `<Modal>` — which is its own window. I acted on it, shipped a fix that changed nothing, and only
   the device screenshot showed it. CLAUDE.md is now corrected.

---

## 6. NOT DONE, deliberately

- **`CODE_REVIEW.md` is triaged and clean where it matters** — 3/3 criticals and 15/15 highs
  closed, verified against live code and the live DB. Results table at the top of that file. The 42
  medium and 27 low were NOT checked, and the recommendation is a fresh `/security-review` rather
  than triaging a report three months and two security passes old.
  **Carry this forward:** C1 (promo_active payment bypass) is fixed by a TRIGGER
  (`trg_enforce_server_premium`), not by RLS. The policy is still blanket `auth.uid() = id`, so an
  auditor who checks the policy will wrongly conclude the bypass is live.
- **Mark invented amounts.** The creator wrote `• Cashew Nuts`; the app shows "30g · ¼ cup" and
  "top with cashew nuts", neither of which they said. The pipeline already knows which ingredients
  were unquantified and discards that fact. Design and honest sizing are logged in
  `docs/TRENDING-OPEN.md` — harm is LOW, sequenced after the verification run.
- **PRELAUNCH #4 (skip-onboarding paywall) is smaller than it looks.** Onboarding already proceeds
  without a purchase and every feature is gated downstream, so the plumbing exists; what is missing
  is the UX and a Superwall placement for the browser variant.
- **Two stored rows still carry `1/2 can` / `1/2 packet`.** Harmless, correctly ignored. Noted so
  they are not re-flagged.

---

## 7. Corrections — believe these, not the transcript

- **"The estimator runs high" was WRONG.** Over the pool the estimate/claim calorie ratio is p25
  0.80, **median 1.00**, p75 1.31, and meat vs meatless is 1.02 vs 0.99. The 38% failure rate is
  SPREAD, not bias. Only the failing tail runs high, which is true by definition.
- **"Most descriptions carry no method" was HALF wrong**, and the wrong half was the actionable
  one: 6 of 14 publish a full numbered method, all inside the prompt window. The model could see it
  and was summarising it away.
- **"Baking powder and soda" is NOT a merge defect.** The creator merged it. Splitting invents two
  amounts from one "pinch", and the obvious rule breaks "macaroni and cheese".
- **"Protein chips" and "tuna in water" are NOT defects.** The video is titled "Protein chip steak
  bowls"; "tuna in water" is a faithful translation of "Thunfisch (eigener Saft)" and the "in
  water" is load-bearing for macros. What was wrong was our rendering — we dropped "Quest Chili
  Lime", which is what made it read as random.

---

## 8. WHAT IS LEFT — in order

Answer "what's next" from `docs/PRELAUNCH.md`; this is the same list with today's state folded in.

### Blocked on the clock (quota resets midnight Pacific / 2am)
1. **Run the pipeline once and work the `⚠️ CONFIRM ON THE NEXT PIPELINE RUN` block** at the end of
   `docs/TRENDING-OPEN.md`. Eleven shipped changes are unproven and this is the only thing that
   proves them. Five checks, exact SQL, and what a FALSE pass looks like. **Do this first** — six
   later items assume the pipeline is sound.

### Blocked on Logan's device
2. **Scan-flow QA end to end** (PRELAUNCH #3) — his stated gate before filming. The dead review
   screen is gone, so the flow can be walked honestly now. Watch the three unseen changes in §2.
3. **Rebuild and eyeball today's app-code changes** — ingredient display across every meal, Discover
   diversity, the Ingredients header, the whole scan modal. All measured against data, none seen.
4. **End-to-end AI meal generation on device** (PRELAUNCH #5).

### Blocked on Logan personally
5. **App Store Connect products** (PRELAUNCH #1) — the Superwall CLI needs his interactive login.
   Longest external lead time on the list; worth doing before anything else on a slow evening.

### Buildable right now, no device and no quota
6. **PRELAUNCH #4 — "skip onboarding" paywall variant.** Smaller than it reads: onboarding already
   proceeds without a purchase and every feature is gated downstream (`if (!isPremium)
   triggerUpgrade(...)`), so the plumbing exists. What is missing is the UX and a Superwall
   placement for the browser variant. Must be in the TestFlight build.
7. **Mark invented amounts** — design and honest sizing in `docs/TRENDING-OPEN.md`. Harm is LOW;
   sequenced after the verification run on purpose.
8. **PRELAUNCH #9 — BFG the leaked anon key out of git history.** Do NOT run this while another
   session has the repo open; it rewrites history.

### After filming
9. `npx supabase secrets unset SCAN_CAP_WEEK` (PRELAUNCH #8), then trailer (#6), screenshots (#7),
   TestFlight (#10) — where the Loops email path and the engagement counters finally get proven —
   and submission (#11).

### Explicitly NOT worth doing
- Triaging `CODE_REVIEW.md`'s 42 medium / 27 low findings. 18 of 18 severity-ranked ones were
  stale; a fresh `/security-review` carries more signal than the remainder.
- Re-proposing a video link, an ingredient dedupe, a "creamy" name-gap rule, forced cook times, a
  YouTube caption fetch, or a dry-basis macro flip. All measured and rejected — see §4.
