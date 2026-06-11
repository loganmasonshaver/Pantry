# Pantry-scan model A/B harness

Decide whether to move the pantry scan off GPT-4o onto Gemini **based on YOUR photos**,
not benchmarks. Runs each image through GPT-4o, Gemini 3.1 Pro, and Gemini 3.1 Flash-Lite
with the exact production scan prompt and prints a side-by-side recall matrix.

## Use

1. Drop 15–20 varied pantry/fridge photos into `images/` (jpg/jpeg/png/webp).
   Mix them up: full fridge, sparse shelf, glare, partial labels, back-row clutter.
2. Run with your API keys (the same ones in Supabase secrets):

   ```bash
   OPENAI_API_KEY=sk-...  GOOGLE_AI_KEY=AIza...  node scripts/pantry-eval/run.mjs
   ```

   Missing a key → that model is skipped. No new dependencies; needs Node 18+.

## Reading the output

- Per photo: each model's item count + latency, then a matrix of every detected item
  with ✓/· per model.
- **More items ≠ better.** Look for items a model **invented** (✓ for one model, not
  actually in the photo) vs. items it **missed** (· where you can clearly see the item).
- **Decision rule:** ship the cheapest model whose ✓ column matches GPT-4o on *real*
  items. Gemini is ~4–5× cheaper per image; if Pro matches GPT-4o recall, switch the
  pantry-scan primary to Gemini (keep GPT as the fallback) — same quality, lower cost.

## Notes

- Model ids in `run.mjs` (`gemini-3.1-pro`, `gemini-3.1-flash-lite`, `gpt-4o`) are
  current as of June 2026 — if a call 404s, update the id to match the provider docs.
- The prompt is copied from `supabase/functions/scan-pantry/index.ts`. If you change the
  production prompt, update `buildPrompt()` here to keep the test honest.
- `images/` is git-ignored (your photos shouldn't be committed).
