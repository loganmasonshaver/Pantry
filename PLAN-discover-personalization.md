# PLAN — Discover: from one shelf to a Spotify-shaped home

**Written:** 2026-08-12 · **Status:** plan, nothing built
**Reference:** Spotify home — the target shape, not the target aesthetic

---

## 1. The actual gap

Not visual polish. **Shelf variety.**

Every shelf on Spotify's home answers a *different question*: what's new · what's made for me · what
fits right now · what I was just doing · what's like the thing I love · what mood am I in. Six
questions, six reasons to tap.

Discover today answers **one** — "what's trending" — as a featured card plus one rail. Adding better
photos or bigger cards doesn't close that gap; adding *reasons* does.

---

## 2. ⚠️ PHASE 0 — instrument BEFORE launch (the only irreversible part)

Everything in Phase 2 is learnable from data. **Data not captured is gone forever.** This phase is
the only one that can't be done later, so it's the only one that's genuinely time-sensitive.

### What's missing today

| Gap | Consequence if not fixed before launch |
|---|---|
| `meal_logs` has **no `source`** (columns: user_id, meal_name, calories, protein, carbs, fat, slot, created_at, food_id, serving_id, quantity, meal_data) | A cook can't be attributed to Discover vs pantry hero vs search vs manual. **Every shelf-quality question becomes unanswerable.** |
| `meal_logs` / `meal_ratings` key on **`meal_name`**, not an id | Joining a cook back to its `trending_meals` row is a fuzzy string match. Renames and near-duplicates silently break it. |
| **No impression events** — `trackMealViewed(mealName)` fires on open, nothing fires on *seen* | No CTR. Can't tell "shelf nobody taps" from "shelf nobody scrolled to". |
| **No shelf identity or position** in any event | Can't separate shelf quality from position bias. Position 1 always wins; without rank you'll conclude the *shelf* is good. |

### The four changes

1. **`meal_logs.source text`** — `'discover_featured' | 'discover_rail' | 'pantry_hero' | 'search' | 'saved' | 'manual' | 'scan'`
2. **`meal_logs.trending_meal_id uuid null`** + same on `meal_ratings` — real join key, name kept for display
3. **`discover_meal_impression`** event — `{ shelf_key, meal_id, position, seen_ms }`, fired on viewport entry, batched per shelf
4. **Extend the existing PostHog calls** — `trackMealViewed` / `trackMealSaved` / `trackMealLogged` all take `{ shelf_key, position, source }`

**Cost:** two nullable columns and a handful of event props. Effectively free now; unrecoverable later.

> **The one-line test for this phase:** in three months, can you answer *"of the meals shown in the
> Post-Gym shelf, what fraction got cooked?"* If no, Phase 2 can't be built.

---

## 3. PHASE 1 — launch shelves (zero user data required)

All of these run on columns that already exist: `prep_time`, `protein`, `calories`, `category`,
`compatible_diets`, plus the profile (`calorie_goal`, `protein_goal`, `diet_type`,
`max_prep_minutes`, `cooking_skill`, `food_dislikes`).

### 1a. Context-titled hero — *highest ratio of perceived intelligence to effort*
Today's `timeOfDayRank` already sorts by meal time silently. **Promote it to visible copy.**

> **"Tuesday evening · under 30 min · 48g protein to go"**

Nothing new computed. The intelligence was already there; it just wasn't *saying* anything. Perceived
personalization comes from the label as much as the pick.

### 1b. Occasion shelves — rule-based, no data
| Shelf | Rule over existing columns |
|---|---|
| **Nothing in the fridge** | fewest ingredients not already in `pantry_items` — the most Pantry-native shelf on this list |
| **Post-gym** | protein ≥ 35g AND protein ≥ 30% of calories |
| **15 minutes flat** | `prep_time <= 15` |
| **Meal-prep Sunday** | scales to 4+ servings, `prep_time >= 30` (surface on weekends only) |
| **Hits your remaining macros** | `calories <= remaining` AND `protein >= remaining_protein * 0.4` |

That last one is the sharpest: it's the only shelf here that *no competitor can copy* without also
knowing what you ate today.

### 1c. Reason lines under every shelf title
"Because it fits your 2,536 kcal." "Under your 30-minute limit." A mediocre pick with a stated reason
outperforms a great pick with none.

### 1d. Hide empty shelves
"No creator recipes yet — tap + to post one" is currently visible. Spotify never renders an empty
shelf; it renders a different one. An empty shelf reads as a broken app, not an invitation.

### 1e. Card density
Rails are 175px carrying three data pills. Spotify shows **desire** (image + two lines); we show
**data**. Consider a larger card, one pill, macros on the detail screen.

---

## 4. PHASE 2 — ~3 months post-launch (needs the Phase 0 data)

### ⚠️ Cohort-level works at ~100 users. Per-user needs thousands.
This is the thing to get right about the timeline. At a few hundred users:

- **Works:** "meals like this get cooked 3× more often than average" (pooled across all users)
- **Doesn't work:** "users similar to you cooked this" (collaborative filtering needs density we won't
  have for a year)

So Phase 2 is **cohort ranking + per-user filtering**, not per-user recommendation. Anything framed
as "people like you" is a Phase 3 fantasy at this scale — don't design for it.

### 2a. "Because you cooked X"
The shelf that makes a feed feel alive. Needs `meal_logs.trending_meal_id`. Similarity on the cheap:
shared primary protein + category + prep band. No embeddings needed at this scale.

### 2b. The weekly drop — "Made for Logan"
Spotify's strongest retention mechanic is **scarcity plus a date**: it arrives Monday, it's yours, it
expires. One drop a week beats infinite scroll. Pantry version: 10 meals, Monday, built from macros +
diet + prep time + what you cooked last week, gone next Monday. Pairs naturally with a push
notification — the one notification users won't mute.

### 2c. Cook-rate replaces the like-rate proxy
Today's `likeQualityScore` uses YouTube like-rate as a stand-in for "is this good." Once real cooks
exist, **cook-through rate (impression → logged) is the real thing** and the proxy retires. Also
enables a **per-channel trust score**: a creator whose recipes get shown often and cooked rarely gets
deprioritized at the source. That's the durable fix for the chia-pita problem.

### 2d. Per-user shelf ordering
Spotify puts Discover Weekly first for explorers and Recents first for repeaters. Needs per-shelf CTR
from Phase 0. Simple version: order shelves by that user's historical tap rate, with an exploration
slot so a shelf can't die from never being surfaced.

### 2e. Retire dead shelves automatically
Any shelf under ~2% CTR after N impressions gets pulled. Prevents the page bloating into shelves
nobody uses — the failure mode of every feed that only ever adds.

---

## 5. Metrics that decide whether this worked

| Metric | Why it's the one |
|---|---|
| **Cook-through rate** (impression → `meal_logs`) | The only metric that means the food was wanted. Everything else is a proxy. |
| Shelf CTR (by shelf, by position) | Which shelves earn their space |
| Discover → cook within 24h | Whether Discover drives behaviour or just browsing |
| Repeat cook rate | Did they make it twice — the real taste signal |

---

## 6. What NOT to build

- **Collaborative filtering** — needs orders of magnitude more users
- **Infinite scroll** — Spotify's home is finite and curated; endless feeds kill the weekly-drop scarcity
- **A separate recommendation service** — all of the above is SQL over existing tables
- **Per-user image generation** — breaks the global image cache cost model (CLAUDE.md landmine)

---

## 7. Sequencing

| When | What | Blocked by |
|---|---|---|
| **Before launch** | Phase 0 instrumentation (§2) | Nothing — do it now, it's unrecoverable later |
| Launch | 1a context hero, 1d hide empties | Nothing |
| Launch +2wk | 1b occasion shelves, 1c reason lines | Nothing |
| +1mo | 1e card density | Design call |
| **+3mo** | 2a because-you-cooked, 2c cook-rate | Phase 0 data + real usage |
| +4mo | 2b weekly drop, 2d shelf ordering | 2a shipped, CTR accumulated |
| +6mo | 2e auto-retirement | Enough shelves to prune |

**The only urgent row is the first one.** Everything else can slip; Phase 0 can't.
