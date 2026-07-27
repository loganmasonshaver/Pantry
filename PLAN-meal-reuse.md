# PLAN — Reuse existing meals instead of generating new ones

Status: **PLANNING — post-launch.** Not to be built before App Store submission; it touches the
core meal-generation path.

---

## 1. Why

Every day, for every user, Pantry generates brand-new meals. Each new meal name is a cache miss on
`image_cache`, so it also pays for a brand-new FAL image. That produces the two problems we keep
working around:

- **Latency.** Text ~6s, then images ~10s. The user watches a narrated skeleton, then a "Plating your
  dish…" placeholder. We've dressed this wait well; we haven't removed it.
- **Cost.** Image spend scales with *unique meal names*, and today we manufacture new ones daily.
  (See the cache-key tightening in `generate-meal-image` — same lever, this one is bigger.)

**The insight (Logan's):** don't generate a new dish when one that already exists would fit. A meal
that's already been generated has **an image already cached** — serving it is instant and free.

This beats overnight pre-generation, which was the other candidate: pre-generation pays for meals
that users who don't open the app never see. Reuse pays for nothing.

## 2. The pool already exists

`trending_meals` holds complete meals: name, ingredients, steps, macros, prep time, diet tags
(`compatible_diets`, `is_dairy_free`, `is_gluten_free`, `is_nut_free`) **and a generated image**.
It's read today by `app/(tabs)/discover.tsx`. That is exactly the "something that already exists"
this plan reuses. (Related: the existing `project_v2_meal_rotation` note — rotate from a cached pool
once enough is cached. This is that idea, made concrete.)

## 3. Approach

Do the matching **server-side, inside `supabase/functions/generate-meals/index.ts`**, before the LLM
call. That keeps the cap/cost logic in one place and means every surface (home hero, pantry
Cook Tonight, cook-reveal) benefits with no client changes.

**Flow:**
1. Load the user's in-stock pantry (already done for the prompt).
2. Query `trending_meals` for candidates — cheap pre-filter on diet tags + `prep_time <= maxPrepMinutes`.
3. **Cookability check** per candidate: every ingredient is either in the pantry or an assumed staple.
   Reuse the exact rule the client already uses so a reused meal can never contradict the UI —
   see `missingFor(...)` in `app/(tabs)/pantry.tsx` and `isAssumedStaple` (`constants/staples`).
   **Extract that matcher into a shared module first** (e.g. `lib/pantryMatch.ts`) rather than
   writing a second implementation; a divergent copy is precisely how "Cook Now showed a meal you
   can't cook" happened before.
4. Apply the same exclusions the prompt enforces: `food_dislikes`, disliked meals, and the
   recent-names suppression list (a reused meal must still not be one they just saw).
5. Fill from the pool first; **call the LLM only for the shortfall.** Zero matches → today's behavior,
   unchanged.
6. Tag reused meals (e.g. `source: 'pool'`) so we can measure hit rate.

**Ordering:** interleave rather than "pool meals first" — otherwise the reused ones always lead and
the feed feels static. Keep the existing protein-variety rule across the combined set.

## 4. Guardrails

- **Correctness beats reuse.** A pool meal that isn't fully cookable must be *dropped*, never
  softened into a "you're only missing X". Cook Now's promise is the product.
- **Image must already exist.** Only reuse a meal whose `image` is a real URL — reusing a meal with
  no photo buys nothing and reintroduces the wait.
- **Freshness.** Exclude anything in the recent-names list; consider a per-user "already served"
  ledger so the pool doesn't cycle a user through the same 5 dishes.
- **Personalization floor.** Pool meals aren't macro-tuned to this user. Cap the share of a day's
  suggestions that may come from the pool (start ~1 of 3) so the set still feels personal.

## 5. Sequencing

- **Phase 1 — measure.** Log how many pool meals *would* have matched, without serving them. Answers
  "is the pool big enough yet?" for free. Do this first; it may show the payoff is still months out.
- **Phase 2 — extract the shared matcher** (`lib/pantryMatch.ts`), used by pantry.tsx and the edge
  function. Pure refactor, independently verifiable.
- **Phase 3 — serve** the capped share from the pool, LLM for the rest.
- **Phase 4 — measure again:** hit rate, image-cache miss rate, time-to-first-photo.

## 6. Verification

- TS baseline (**197** at time of writing) unchanged.
- Unit-test the matcher against the pantry fixtures: an ingredient list with one missing item must
  fail cookability; assumed staples must not count as missing.
- Device: with a well-stocked pantry, at least one suggestion appears **with its photo instantly**
  (no shimmer) — that's the whole point, and it's visible.
- Confirm a reused meal never renders "Better with: …" for a defining ingredient.
- Watch `generate-meals` logs for the pool-hit tag; confirm LLM calls drop by roughly the hit rate.

## 7. Honest risks

- **Pool is thin today.** Early users still mostly generate; benefit grows with the library, same
  curve as `image_cache`. Phase 1 exists to find out where on that curve we are.
- **Matching is the exact logic that caused a shipped bug** (Cook Now including an uncookable meal).
  One shared implementation, tested, or don't ship it.
- **Sameness.** Aggressive reuse makes the app feel static — the per-user cap and freshness ledger
  are what prevent that, not an afterthought.
