# Trending pipeline — open items

Durable copy. `~/my-briefing/todos/active.md` kept getting overwritten wholesale by a
concurrent session (five times on 2026-08-30), so this lives in the repo instead.
Reasoning for every fix is in `git log`; this file holds only what is still open.

## Standing: re-run and re-audit EVERY session

Every time this pipeline has been examined it has produced significant findings — 13 fixes on
2026-08-30 alone, two of them live rows serving 3x and 8x protein overclaims, and one a gate that
had been silently dead for 19 days. Treat "it looks fine" as untested.

1. **Run the cron and read the funnel.** `?dryRun=true` runs everything and writes nothing.
   The response carries `funnel`: rawCandidates → afterDedup → viewFloor → ingredientGate →
   sentToLLM → llm raw/sanitized → stored, every rejection counter, `droppedDetail`, and
   `providerUsed`.
   Run them **sequentially** — 3 concurrent runs starved each other's YouTube quota and dropped the
   gate from 61 videos to 8. Dry runs still spend quota.
2. **Re-audit the stored pool — needs no YouTube quota.** Most findings come from here. Fetch
   `trending_meals` and run `_shared/recipe-integrity.ts`, `diet-tags.ts` and `macro-estimate.ts`
   over it under `node --experimental-strip-types`. Check: name/ingredient gaps, allergen tags more
   permissive than the keyword scan, junk/equipment lines, duplicate ingredients, name- and
   ingredient-Jaccard duplicates, repeated `video_id`, null `shelf_tag`, macro plausibility,
   servings-vs-batch coherence, images still on a YouTube thumbnail.
3. **Hand-verify every hit before believing the count.** An unverified count is a guess wearing a
   number's clothes: "28 mismatches" was really 7, "21% incoherent" was ~6%, and a regex retyped by
   hand "reproduced" a match the real source could never produce.

## Open

- [ ] **Yield: variance or defect?** BLOCKED on YouTube quota (resets midnight Pacific; burned
      2026-08-30 by ~16 runs). Identical code, sequential runs gave raw 24 vs 5 and stored 17 vs 4.
      A once-daily cron takes ONE sample from that spread and the swap makes it permanent — a better
      explanation of "thin days" than any single defect. Method: ~10 sequential `?dryRun=true` runs.
      If variance confirms, the fix is architectural: run the cron 2-3x and keep the best batch, or
      merge instead of replace.
- [ ] **OpenAI fallback — one call finishes it.** Mechanism proven (split-emoji surrogate +
      max_tokens above gpt-4o-mini's 16,384 ceiling, fixed `f8d43b9`); forcing hook added
      (`14a0ce5`). An actual 200 from OpenAI is still unobserved — quota died before the forced run
      reached the LLM. Run:
      `...generate-trending-meals?refresh=true&dryRun=true&provider=openai`
      then read `funnel.llm_OpenAI` and `providerErrors`.
- [ ] `SYNONYMS` narrowing left `maple`, `honey` and `ranch` with no synonyms. Watch for false
      "missing maple" gaps on recipes listing only "syrup".
- [ ] Two stored rows carry `1/2 can` / `1/2 packet` ingredients. Harmless — the gate now correctly
      ignores common kitchen fractions. Noted so they are not re-flagged as findings.
