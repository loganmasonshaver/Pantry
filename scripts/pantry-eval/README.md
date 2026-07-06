# Pantry-scan model A/B + confidence-floor harness

Two questions, one harness, answered on **YOUR photos** not benchmarks:

1. **Which model?** (`node run.mjs`) — runs each image through the current lineup (gpt-4.1
   incumbent, gpt-5.4-mini, gpt-5.4, gpt-5.5; Gemini Flash-Lite fallback) with the exact
   production prompt, and prints per-model **recall vs. ground truth + REAL measured $/photo**
   (usage tokens × current price). Pick the cheapest model whose recall matches/beats gpt-4.1.
   Note: gpt-4.1 uses tile tokenization (downscales to 768px shortest side); the gpt-5.x rows
   use `detail: 'original'` (full-res patches) — the resolution edge for small-label reading.
2. **What confidence floor?** (`SWEEP=1 node run.mjs`) — see the section below.

gpt-4o was removed (API 404s since 2026-02-16). gpt-5.x may need param tweaks (temp /
max_completion_tokens) — an error row prints the reason so it's quick to fix.

## Use

1. Drop 15–20 varied pantry/fridge photos into `images/` (jpg/jpeg/png/webp).
   Mix them up: full fridge, sparse shelf, glare, partial labels, back-row clutter.
2. Run with your API keys (the same ones in Supabase secrets):

   ```bash
   OPENAI_API_KEY=sk-...  GOOGLE_AI_KEY=AIza...  node scripts/pantry-eval/run.mjs
   ```

   Missing a key → that model is skipped. No new dependencies; needs Node 18+.

## Confidence-floor sweep (find the `SCAN_CONFIDENCE_FLOOR` sweet spot)

The production scanner now scores every item `confidence` 0–100 and can drop anything below
`SCAN_CONFIDENCE_FLOOR` (env, default 0 = drop nothing). To find the right cutoff on YOUR
photos instead of guessing:

```bash
SWEEP=1 OPENAI_API_KEY=sk-... node scripts/pantry-eval/run.mjs
```

Runs the production model (`gpt-4.1`) **3× per photo at temperature 0** and prints:

- **CONSISTENCY** — item-count spread + mean Jaccard across the 3 runs (proves temp 0 fixed the
  "same photo, different results" problem) and the exact items that still *flicker* run-to-run.
- **ITEMS by confidence** — every distinct item, lowest score first (the drop candidates).
- **THRESHOLD SWEEP** — for each candidate floor, how many items survive and **exactly which get
  dropped**, so you can see where junk dies and (if ever) real food starts dying.
- **Ground-truth recall** — on labeled photos, real-item recall vs. unverified items cut at each
  floor, and a **suggested `SCAN_CONFIDENCE_FLOOR`** (highest floor keeping ≥95% real recall).

Knobs: `REPEAT=5` (runs/photo), `SWEEP_MODEL=gpt-4o`, `LIMIT=1` (first photo only, cheap).
Add more `GROUNDTRUTH` entries in `run.mjs` (hand-list a photo's real items) to firm up the
recommendation — right now only one photo is labeled.

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
