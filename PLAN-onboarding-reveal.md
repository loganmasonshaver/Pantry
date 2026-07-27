# PLAN — Onboarding Plan Reveal (Cal AI-modeled) + launch sequencing

**Written:** 2026-07-27 · **Status:** approved shape, not yet built
**Target:** in before the App Store screenshot/trailer recording pass (see §5)

---

## 1. What we're actually copying — and what we're not

Cal AI's reveal is a **long scrolling argument with one sticky CTA**. Its blocks, in order:

| # | Cal AI block | Function |
|---|---|---|
| 0 | ✓ "Goal: lose 10 lbs by October 5" | Commitment device — a date, not a number |
| 1 | Estimated progress (curve, Now → date) | The payoff visual |
| 2 | Your daily recommendation — big kcal + P/C/F tiles, **"You can edit this anytime"** | Kills the "these numbers are wrong for me" objection |
| 3 | Your info — "Based on your inputs" | Proof it was built from their answers |
| 4 | How to reach your goals — 4 behavior rows | Sells the BEHAVIORS, not the feature |
| 5 | Why Cal AI? — Without ✗ / With ✓ | The pain block |
| 6 | Trusted by millions — 10M+, 4.8★ | Social proof, last thing before the CTA |
| 7 | ⓘ How we make recommendations | Transparency / skepticism reducer |
| — | Sticky "Let's get started!" | One CTA, entire screen |

**The trap:** cloning the blocks but keeping the content generic-macro. Cal AI's argument is *"we make
tracking easy."* Pantry's is *"we tell you what to cook from the food you already own."* Copy the
skeleton; re-point every block at food-in-your-kitchen. Otherwise this is just a **longer** version of
the commodity TDEE screen we already have.

**⛔ Block 6 cannot ship.** We have zero users. No fabricated user counts, no invented star ratings —
it's dishonest and it's App Review risk. Replacement in §2.

**Revision to the earlier "end on the trajectory card" call:** that was right about the *failure mode*
(one weak orphan card below the payoff) and wrong as a rule. Length works when every block adds a new
*kind* of evidence — numbers → your inputs → behaviors → pain → credibility. The trajectory card is
still the **first** payoff; the rest builds to the CTA.

---

## 2. The Pantry reveal, block by block

Sticky CTA throughout: **"Let's get started"** (existing `PillButton` in `s.bottomActions`).

### Block 0 — Headline with a date
```
        ✓
Goal: lose 10 lbs by October 12
```
- We already compute `weightDelta`, `isGainDirection`, `targetDateStr` — today they're buried as an
  axis label inside the trajectory card. **Promote to the headline.** The date is the commitment.
- Maintain users have no date: `Goal: same weight, better composition`.

### Block 1 — Estimated progress
- Existing `TrajectoryGraph` / `MaintainGraph`. **Now full-width** — the rings move to Block 2, which
  frees the ~96px currently stolen by `width - 36 - 8 - 88`. Half the "cramped" feeling is this.

### Block 2 — Your daily targets · *"You can adjust these anytime"*
```
🔥  1,840          Calories
[ 168g Protein ] [ 186g Carbs ] [ 55g Fat ]
```
- **Requires a change:** `calculateGoals()` (line 1004) returns `{ calories, protein }` only. Carbs/fat
  are derived separately inside `finish()` (line 3820: 27% fat, remainder → carbs).
- **Extract one shared helper** returning all four. Today the reveal and `finish()` compute macros in
  two places and agree by luck; adding a third copy is how "the reveal promised X, the app enforces Y"
  ships. One helper = the promise and the profile write are the same math by construction.
- The "adjust anytime" line is only honest if it's true — `MacroEditModal` exists, so confirm the
  Profile edit path works before writing that copy. If it doesn't, say nothing rather than lie.

### Block 3 — Your plan · "Based on what you told us"
```
Goal            Lose Weight
Diet            Pescatarian
Meals a day     3
Time to cook    30 min
Cooking         Comfortable
Avoiding        Shellfish, mushrooms
```
- **This is `SGeneratingIntro` (step 17), moved.** Same recap card, same rows — it just works harder
  as evidence *inside* the reveal than as a screen before the loading bar. See §4 for the routing change.

### Block 4 — How this works · the behavior block *(where we diverge from Cal AI hardest)*
```
📷  Scan your kitchen           One photo. We'll know what you have.
🍽️  Get tonight's dinner        Built from what's already in there — 30 min or less.
🛒  Only buy what's missing     Your grocery list writes itself.
📉  Hit 1,840 kcal without thinking about it
                                Every meal already fits your targets.
```
- Numbers interpolated from their own answers (`prepMin`, `cals`).
- This is teardown ledger **#12 — sell the behaviors, make them feel they need it.**
- Honest by construction: describes what the app *does*, makes no claim about meals they haven't seen
  yet. This is the block that finally fills the slot three scan-teaser attempts died on.

### Block 5 — Without Pantry / With Pantry *(the pain block — highest-value steal)*
```
Without Pantry
✗  Ordering out because deciding is harder than cooking
✗  Groceries you forgot you bought, thrown away
✗  The same three meals on repeat

With Pantry
✓  Dinner decided from one photo
✓  Food gets used before it goes bad
✓  New meals that still hit your numbers
```
- This is the missing diagnosis. Fifteen onboarding questions currently never make the user confront a
  problem — twelve of them are calculator inputs. This block states the pain for them.
- Zero risk to build: static copy, no data, no permissions.

### Block 6 — SOCIAL PROOF SLOT — **empty at launch, by design**
Replace with a credibility card, built so real ratings drop into the same slot at 1.1:
```
🛡️  How we calculate this
    Your targets use the Mifflin-St Jeor equation — the formula registered
    dietitians use, referenced in peer-reviewed nutrition research.
```
- This is today's footnote disclaimer, promoted to a real card. It does Cal AI's ⓘ job **and** partly
  covers the trust job, in one block.
- Optional to test later: a one-line founder note ("Built by one person who got tired of throwing out
  groceries"). Pre-launch, true beats impressive.

### Block 7 — sticky CTA
Unchanged: `PillButton "Let's get started"`. One CTA, no secondary action.

---

## 3. The conversation changes

**Phase 1 (ship with the reveal):** none required. Block 5 states the pain without asking anything.

**Phase 2 (optional personalization upgrade):** two questions near step 12 —
- *"How often does food go bad before you use it?"* → Every week / Sometimes / Rarely
- *"What usually happens at 6pm?"* → Order out / Same 3 meals / Stare into the fridge / I've got a plan

Then Block 5 **promotes their own selected answer to the top row, highlighted.** Their stated pain,
answered on the same screen. Cut this if the week gets tight — the block works without it.

---

## 4. Technical notes / landmines

- **⚠️ `app/onboarding/index.tsx` is the #1 bug source in this repo.** After ANY change here: run a
  test profile through the full flow, read the row back, assert **every** field survived — including
  ones we didn't touch. Blocks 0–7 are display-only *except* the shared macro helper, which is on the
  data path.
- **Do NOT renumber steps.** To retire `SGeneratingIntro`, leave the numbers alone and change routing
  only: step 16's `next` → 18, `SPlanReveal onBack` 17 → 16, and the prefetch mount condition
  `step === 17` → `step === 18`. `PROGRESS[17]` just goes unused. No renumbering = no cascade.
- **Verify what the off-screen prefetch is actually warming** before moving it. Its comment says
  "image fetches," but the meal card it fed was removed in `71f71ae` — it may now only be warming the
  `saved_meals` seed for the home screen. Check before assuming it's dead or that it's load-bearing.
- **TS baseline = 197.** Capture before editing; don't claim credit or blame for those.
- Longer screen = more scroll. Keep the section stagger animation but **cap total reveal time** — the
  current 500ms × 4 stagger over 8 blocks would be 4s of waiting before the CTA is reachable.

---

## 5. Launch sequencing — the whole board

Ordering matters here because **three of these tasks consume the reveal screen.** Recording the flow
or shooting App Store screenshots before the rebuild means doing them twice.

| # | Task | Blocks what | Do when |
|---|---|---|---|
| 1 | **Paywall screenshot → ASC, both products** (`Pantry Monthly` + `Pantry Annual` → Review Information → Screenshot → Save → Add for Review) | Products stuck "Incomplete" in Superwall | **First — unblocked right now, ~30 min, independent of everything below** |
| 2 | **Reveal rebuild** (this plan) | Tasks 3 + 4 | Next |
| 3 | **Screen-record the full flow, once** | Trailer + App Store screenshots | After #2 |
| 4 | **Cut the trailer** (already started) + **upload new App Store screenshots** | Submission | After #3 |

Notes:
- #1 is genuinely independent — the ASC screenshot is of the **paywall**, which this plan doesn't touch.
- Expect Superwall to keep reporting "Incomplete" until Apple approves the app; a first auto-renewable
  subscription can't be approved standalone. Sandbox purchases still work — test on device regardless.
- Still unverified: whether the **Pantry Premium subscription GROUP** has its own localization.
- App Store screenshots are a hard submission requirement. The trailer is not — cut it first if time runs out.

---

## 6. Deferred to 1.1 — pre-paywall kitchen scan

Shelved, not rejected. The cost objection turned out not to be the blocker:

- Vision call is **~$11–21 per 1,000 onboarding starts** ($0.01–0.03 each, ~70% reach the step). One
  extra $30 annual sub covers ~1,000–3,000 scans. It has to lift paid conversion ~0.05pp to break even.
- **The unbounded cost is not the scan — it's what you show after it.** GPT-generating meals from real
  fridge contents mints novel dish names → new unique image keys → new Flux generations, per user,
  forever, including for people who never pay. The cheap version intersects the vision output with the
  **fixed recipe bank** (bounded name set, images already cached): marginal image cost $0.
- **The real blocker is auth.** `_shared/scan-cap.ts` binds the cap RPC to the caller's JWT so
  `auth.uid()` resolves server-side. No auth → no cap → a public GPT-4o vision endpoint. And
  `createaccount` currently sits *after* the reveal. Shipping this means moving signup **before** the
  screen that currently earns the signup. That trade — not the $14 — is what decides it.
- Blocks 0–7 above are built so the scan result drops in as a new top block without disturbing the rest.
  Decide it in 1.1 with real funnel data.
