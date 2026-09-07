# Handoff — 2026-09-07 (afternoon)

Replaces the 2026-09-07 early-hours handoff. **11 commits** since `bb3c12f`.
`git log bb3c12f..HEAD` carries the full reasoning for every one; this file holds only what git does
not — what is UNRESOLVED, what is UNVERIFIED, and the decisions already made so the next session
does not re-derive them.

**State:** everything committed, pushed, deployed. Tree clean.
**TS baseline 130 total / 16 app-code. 374 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).

---

## 0. NEW THIS SESSION — you have a Supabase MCP server

Set up at the very end of the session, so this is the first session that can use it. Read-only,
scoped to the Pantry project, expires ~Sep 2027. Token is in Apple Passwords as
**"Pantry — Supabase MCP token"**, with the re-add command in its notes.

**This changes how to work.** Three times this session a measurement had to be relayed through
Logan by hand. Now `execute_sql` reads `pipeline_runs`, `image_cache` and anything else directly.
API Keys and Auth Signing Keys were deliberately REMOVED from the token — a token that can read
the legacy service_role key is not read-only in any meaningful sense.

Writes are NOT available (`--read-only`). Cap resets stay a dashboard job; migrations stay
`supabase db push`.

**Do NOT rotate `CRON_SECRET`.** Logan's, saved in Apple Passwords, and nothing automated sends it —
both cron jobs authenticate with the Vault's `cron_service_role_key`. Ask him to export it when an
internal-auth call is needed.

---

## 1. ⚠️ START HERE — the device pass, and it has doubled

**Nothing shipped on 2026-09-06 or 2026-09-07 has run on hardware.** That is now ~11 changes across
five screens, and Phase 2 of the feedback board sits directly on top of Phase 1.

From yesterday, still unseen: servings stepper, pantry refresh lighting Home's sweep bar, the
no-photo fallback, Home's generation-error card, the Pantry ↻ button reading the server quota.

From today:
* **Time display.** Card shows one number (prep + cook) then a WORD: `5 min + overnight`,
  `15 min` (a 20-min chill vanishes below the 30-min threshold). Detail screen keeps the real
  breakdown: `10 min prep · 20 min cook · 8 hr rest`. Hero's separate rest pill is gone.
* **Produce as counts.** "150g orange" now reads "1 orange". 24 foods added.
* **The dislike reason sheet** — five chips on thumbs-down, on BOTH Home and meal detail.
* **The taste follow-up** — tap ingredients, then `/food-preferences` opens with them staged
  UNSAVED plus explanatory copy.

---

## 2. THE FLAVOUR PLAN — waiting on a number, do not build step 3 yet

Steps 1 and 2 shipped (`80b6b75`): a prompt rule saying a flavoured pantry item is a flavour
decision, and `_shared/flavour-match.ts` counting when the model took the flavoured option with a
plain one on the shelf. **It counts. It does not gate.**

```sql
select created_at, funnel->>'flavourMismatches' misses, funnel->'flavourMismatchDetail' detail
from pipeline_runs where provider='generate-meals-funnel' order by id desc limit 20;
```

The counter runs BEFORE the fat and prep drops and before the slice to 3, so each generation samples
6-10 dishes, not 3. Six generations ≈ 40-60 dishes — enough to decide.

* **Zero** → the prompt rule took. Steps 3 and 4 die; do not build them.
* **Three or more** → step 3 is justified, with the caveat from the re-audit: a self-declared
  flavour field only works if it is emitted BEFORE the ingredients in the JSON, so it CONDITIONS
  them rather than describing what was already written.

**Precondition:** his pantry must still hold a flavoured AND plain version of the same staple, or
the check can never fire and zero means nothing.

---

## 3. STILL UNRESOLVED — raised by Logan, no commit

* **Home layout redesign.** Wants the single-meal hero gone and three meals shown like the Pantry
  list. Undecided: all three on one row, or each its own row. He leans own-row; the cost is the
  daily log getting pushed down, which is the thing he explicitly wants to avoid. The two goals
  fight and he has not picked.
* **Discover freshness signal.** Users cannot tell Discover updates daily. Check first: shelf
  rotation is DAY-KEYED to vary order, so a strict newest-first sort would fight it.
* **Feedback board Phase 2** — he asked to be prompted. One private `feedback` table plus three
  entry points. The real argument for doing it pre-launch: **Profile has no support or contact row
  at all**, so a user with a problem has exactly one outlet and it is the App Store.
* **Image cache key is the meal NAME only.** One name = one image for every ingredient variant,
  which is why a parfait with orange inherited a photo without one. Undecided: put defining
  ingredients in the key (more images, more cost) or name dishes after their contents.
* **`SCAN_CAP_WEEK` is still raised** — preflight calls it blocking. `npx supabase secrets unset
  SCAN_CAP_WEEK` before launch.

---

## 4. NEGATIVE RESULTS FROM TODAY — do not redo this work

* **Do NOT rewrite the image description prompt.** `describeOnly` proved Stage 1 named "bright
  orange segments" and Flux drew none. Same description re-rendered correctly. The sentence was
  never the problem.
* **Do NOT bulk-regenerate the "stale" Discover images.** PRELAUNCH 2b is CLOSED. Eight of the 194
  were sampled and looked at: seven correct, one with garbled text on a Biscoff biscuit — a
  diffusion text artifact no prompt fix addresses. "Generated under the broken prompt" was never
  evidence an image IS broken.
* **Do NOT raise `guidance_scale` without a reason.** Measured 1 miss in 11 renders; six seeds at
  current settings came back 6/6. It is a tail, and no parameter removes a tail.
* **A guidance A/B on a pinned seed cannot measure element dropping.** Dropping is stochastic, so
  pinning a seed that already renders correctly guarantees every arm renders correctly. Vary the
  SEED for a rate; pin the seed only to compare aesthetics. The sweep did prove guidance 7 does not
  burn the image.
* **The vessel was not the mechanism.** `seed-128` renders the same shallow bowl as the original bad
  image and still shows the orange.

---

## 5. TOOLING BUILT TODAY

* `scripts/describe-image.sh` — `describeOnly` (free), `--render [SEED/GUIDANCE]`, `--ab` (guidance
  sweep, pinned seed), `--seeds` (miss rate). Needs `CRON_SECRET` exported.
* `scripts/date-image-library.py` — dates every image in the bucket against the prompt era it was
  written under, using the anon key alone. This is what cut PRELAUNCH 2b from "~1,400 unknown" to
  "194, mostly fine".
* `bypassCache`, `guidanceScale`, `promptExpansion` — internal-only overrides on
  `generate-meal-image`. The cache check is unconditional by design (a client must never force paid
  regeneration), which is why re-rendering a wrong image was impossible before today.

---

## 6. THE METHOD THAT KEPT WORKING

Four times today a "systematic problem" turned out to be smaller than assumed once measured:
1,370 broken images → 194 → mostly fine. A prompt that "drops ingredients" → 1 in 11. A guidance
knob that would fix it → no measurable effect. A flavour-pairing engine → one mechanical check.
**Measure before building. It has been right every time.**
