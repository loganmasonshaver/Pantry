#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// Pantry-scan model A/B harness
//
// Sends each photo in ./images through GPT-4o, Gemini 3.1 Pro, and Gemini 3.1
// Flash-Lite using the EXACT production first-pass scan prompt, then prints a
// side-by-side recall matrix so you can judge: which model misses the fewest
// real items (and which over-invents) on YOUR photos — not on a benchmark.
//
// Why this exists: MMMU/benchmark scores don't measure "read a cluttered fridge."
// The only dataset that matters is yours. Ship the cheapest model that matches
// GPT-4o's item recall.
//
// Run:
//   OPENAI_API_KEY=sk-...  GOOGLE_AI_KEY=AIza...  node scripts/pantry-eval/run.mjs
//
// Drop 15–20 varied pantry/fridge photos (jpg/jpeg/png/webp) into
// scripts/pantry-eval/images/ first. Missing a key → that model is skipped.
// ───────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IMAGES_DIR = path.join(__dirname, 'images')

// Models under test. Adjust ids here if Google/OpenAI rename them — these are the
// current (June 2026) ids; verify against the provider docs if a call 404s.
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'

const MODELS = [
  {
    label: 'GPT-4o (current)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
  },
  // Pro dropped — slower than Flash-Lite (10-15s), pricier, and over-splits worse. Worst of both.
  {
    label: 'Gemini 3.1 Flash-Lite',
    endpoint: GEMINI,
    model: 'gemini-3.1-flash-lite',
    apiKey: process.env.GOOGLE_AI_KEY,
  },
  // Via OpenRouter (one key, OpenAI-compatible) — auto-skipped if OPENROUTER_API_KEY is unset.
  // Qwen3-VL tops open-weight vision/OCR benchmarks and is NOT a thinking model (so it should be
  // fast). Pixtral = Mistral's small cheap VLM. Fix ids if they 404 (openrouter.ai/models).
  {
    // Best-guess current ids — if these 404, run LISTOR=1 (below) to get the exact strings.
    label: 'Qwen3.6 Flash (OpenRouter)',
    endpoint: OPENROUTER,
    model: 'qwen/qwen3.6-flash',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    label: 'Qwen3.7 Plus (OpenRouter)',
    endpoint: OPENROUTER,
    model: 'qwen/qwen3.7-plus-20260602',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
]

// The production first-pass prompt, verbatim, parameterized on photo count.
// (Copied from supabase/functions/scan-pantry/index.ts — keep in sync if that changes.)
function buildPrompt(n) {
  return `These are ${n} photo(s) of a kitchen (fridge, pantry shelves, counter), numbered 0 to ${n - 1} in the order shown. Identify every visible food ingredient or grocery item.

You are a kitchen inventory scanner. Be EXHAUSTIVE — your job is to spot every single edible item in these photos, even ones that are small, partially hidden, in clear containers, on shelf edges, or at the very top/bottom/back of the frame. Better to over-include with a best-guess name than to silently miss something.

Use these 3 detection strategies on every item:
1. VISUAL RECOGNITION — identify foods by their appearance, shape, color, container type
2. BRAND/LOGO READING — if you can see a brand name, logo, or product label, use it to determine the exact product variant
3. NUTRITION LABEL / INGREDIENT LIST — if a product is turned showing its back label, read any visible nutrition facts or ingredient lists to help identify the specific product

EXHAUSTIVENESS RULES:
- Scan EVERY zone in the image — don't focus on the obvious centerpiece items and skip the rest
- Common misses: spices in small jars, condiment bottles on fridge doors, sauces, oils, items in CLEAR or SEMI-TRANSPARENT containers, back-row items partially hidden behind front items, frozen drawer contents, top-shelf items, bottom items that look like packaging
- For items in clear containers, identify the CONTENTS not the container
- If you see something edible but can't ID it precisely, use a best-guess generic name — DO NOT skip it
- Partial labels still count — include with your best inference

FRESH FOOD COUNTS TOO (don't only scan labeled/packaged goods):
- Actively sweep produce/crisper drawers, the main fridge compartment, and shelves for FRESH items: vegetables, fruit, eggs, herbs, cheese, leftovers, raw meat. In a fridge these hide behind door condiments and in dim drawers — look for them on purpose. Missing the carrots, eggs, lettuce, and lemons is a failure.

ONE PHYSICAL ITEM = ONE ENTRY (do not over-split):
- If you can see only ONE container, list it exactly ONCE with your single best name. NEVER output multiple near-synonyms or alternate guesses for the same object — e.g. do not list both "Protein Powder" and "Protein Supplement" for one tub, or "Chicken Soup" and "Chicken Broth" for one can. When unsure of the exact identity, commit to ONE best name, not several.
- If a single product is duplicated (3 identical cans of beans), still list it ONCE.

COUNT CHECK before you finish: a full fridge/pantry typically holds 20-40 distinct items. If your list looks short, go back to back rows, door shelves, drawers, and shelf edges. (Only include items that are actually visible — never invent.)

EXCLUDE — never list these (they are NOT food):
- Pet food/treats, and non-edible household goods (cleaning supplies, paper towels, foil, dish soap, sponges, trash bags, batteries, toiletries)
- Dishware, cookware, and kitchen tools: plates, bowls, cups, mugs, glasses, utensils, cutting boards, pots, pans, kettles, trays
- Small appliances (coffee makers, toasters, blenders), cookbooks, and any container that is clearly EMPTY
Only actual food and drink items go in the list.

Return a JSON object:
{
  "zones": [
    { "zone": "Top Shelf", "items": [ { "name": "Non-Fat Greek Yogurt", "category": "Dairy", "photo": 0 } ] }
  ]
}

Item rules:
- "name" must be a GENERIC ingredient name — no brand names. Use the most specific generic name you can determine.
- Categories: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other.

Return ONLY the raw JSON object, no markdown, no explanation.`
}

// Normalize an item name for cross-model matching in the recall matrix.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Post-answer non-food filter ───────────────────────────────────────────
// Deterministic safety net: strip obvious non-food the model hallucinated (nail polish,
// dishes, cookware, pet food). Two matchers, both portable to production scan-pantry:
//  • EXACT — bare ambiguous words (so we DON'T nuke "pudding cups", "ramen bowl", "pot pie")
//  • CONTAINS — multiword terms that never appear inside a food name
const NONFOOD_EXACT = new Set([
  'plate', 'plates', 'dinner plate', 'dinner plates', 'bowl', 'bowls', 'cup', 'cups',
  'mug', 'mugs', 'glass', 'glasses', 'pot', 'pots', 'pan', 'pans', 'skillet', 'kettle',
  'tray', 'trays', 'utensil', 'utensils', 'fork', 'knife', 'spoon', 'spatula',
  'container', 'containers', 'plastic container', 'plastic food container', 'food container',
  'prepared food container', 'toaster', 'blender', 'coffee maker', 'appliance', 'sponge',
  'sponges', 'napkin', 'napkins', 'foil', 'aluminum foil', 'battery', 'batteries',
  'cookbook', 'cookbooks',
])
const NONFOOD_CONTAINS = [
  'nail polish', 'dish soap', 'hand soap', 'paper towel', 'cutting board', 'trash bag',
  'garbage bag', 'dog food', 'dog biscuit', 'dog treat', 'cat food', 'cat treat', 'kibble',
  'toothpaste', 'shampoo', 'toiletr', 'dishware', 'cookware', 'kitchenware', 'plastic wrap',
]
function isNonFood(name) {
  const n = norm(name)
  if (NONFOOD_EXACT.has(n)) return true
  return NONFOOD_CONTAINS.some((t) => n.includes(t))
}

function flattenItems(raw) {
  const clean = String(raw).replace(/```json|```/g, '').trim()
  let parsed
  try { parsed = JSON.parse(clean) } catch {
    // Show what actually came back so a non-JSON reply (prose, an error string) is debuggable.
    return { names: [], removed: [], error: `JSON parse failed — got: "${clean.slice(0, 120).replace(/\s+/g, ' ')}"` }
  }
  const zones = parsed.zones ?? []
  const all = []
  for (const z of zones) for (const it of (z.items ?? [])) if (it?.name) all.push(it.name)
  const removed = all.filter(isNonFood)            // non-food hallucinations the filter caught
  const food = all.filter((n) => !isNonFood(n))

  // De-over-split: strip parenthetical qualifiers ("Hot Sauce (Red Cap)" → "Hot Sauce")
  // then collapse exact duplicates. Fixes the cap-color/can-color over-splitting. Does NOT
  // touch semantic dupes ("Protein Powder" vs "Whey Protein Isolate") — that needs fuzzy
  // matching which risks merging genuinely distinct items.
  const seen = new Set()
  const names = []
  let collapsed = 0
  for (const orig of food) {
    const canon = orig.replace(/\s*\([^)]*\)/g, '').trim()
    const key = norm(canon)
    if (!key) continue
    if (seen.has(key)) { collapsed++; continue }
    seen.add(key)
    names.push(canon)
  }
  return { names, removed, collapsed, error: null }
}

// Detect the REAL image type from magic bytes, not the extension — internet/phone
// downloads routinely mislabel files (a webp named .jpg, a HEIC named .jpeg). Returns
// the correct mime, or null for formats the vision APIs don't accept (HEIC/DNG/etc).
function sniffMime(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  return null // unsupported (HEIC, DNG raw, etc.)
}

async function callModel(m, base64, mime) {
  const t0 = Date.now()
  const res = await fetch(m.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
    body: JSON.stringify({
      model: m.model,
      max_tokens: m.maxTokens ?? 12000, // headroom so a thinking model's reasoning doesn't starve the answer
      ...(m.extra ?? {}), // per-model knobs (e.g. Pro's reasoning_effort)
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
          { type: 'text', text: buildPrompt(1) },
        ],
      }],
    }),
  })
  const ms = Date.now() - t0
  const data = await res.json()
  // Google sometimes returns errors as an ARRAY ([{error:...}]) — check both shapes.
  const errObj = Array.isArray(data) ? data[0]?.error : data.error
  if (errObj) return { names: [], removed: [], collapsed: 0, ms, error: errObj.message ?? JSON.stringify(errObj) }
  const choice = data.choices?.[0]
  const content = choice?.message?.content ?? ''
  // Diagnose empty output (the Pro problem): dump finish_reason, which fields the message
  // actually carries (output might be in a 'reasoning'/'reasoning_content' field), and a raw peek.
  if (!content || !String(content).trim()) {
    const fr = choice?.finish_reason ?? '(no choice)'
    const mkeys = choice?.message ? Object.keys(choice.message).join(',') : '(no message)'
    const rawPeek = JSON.stringify(data).slice(0, 240)
    return { names: [], removed: [], collapsed: 0, ms, error: `EMPTY content — finish_reason=${fr}, message fields=[${mkeys}]\n      raw: ${rawPeek}` }
  }
  const { names, removed, collapsed, error } = flattenItems(content)
  return { names, removed, collapsed, ms, error }
}

// ── LIST mode: print the Gemini models this key can actually call, then exit. ──
// Use this to find the real Pro id (gemini-3.1-pro 404'd). Run: LIST=1 GOOGLE_AI_KEY=... node ...
if (process.env.LIST) {
  const key = process.env.GOOGLE_AI_KEY
  if (!key) { console.error('Set GOOGLE_AI_KEY to list models.'); process.exit(1) }
  const data = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)).json()
  const errObj = Array.isArray(data) ? data[0]?.error : data.error
  if (errObj) { console.error('Error:', errObj.message ?? JSON.stringify(errObj)); process.exit(1) }
  const models = (data.models ?? [])
    .filter((m) => /gemini/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort()
  console.log('\nGemini models your key can call (support generateContent):\n')
  for (const m of models) console.log('  ' + m)
  console.log(`\n${models.length} models. Look for the "pro" one — that's the id to use.\n`)
  process.exit(0)
}

// ── LISTOR mode: print OpenRouter VISION models (image input), then exit. ──
// Run: LISTOR=1 OPENROUTER_API_KEY=sk-or-... node run.mjs  → get exact Qwen/Pixtral ids.
if (process.env.LISTOR) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) { console.error('Set OPENROUTER_API_KEY to list models.'); process.exit(1) }
  const data = await (await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } })).json()
  const models = (data.data ?? [])
    .filter((m) => JSON.stringify(m.architecture ?? {}).includes('image')) // image-capable
    .map((m) => m.id)
    .filter((id) => /qwen|pixtral|mistral|llama|gemini|gpt/i.test(id))     // the families worth testing
    .sort()
  console.log('\nOpenRouter vision models (image input) worth testing:\n')
  for (const m of models) console.log('  ' + m)
  console.log(`\n${models.length} shown. Grab the qwen/pixtral ids and paste them to me.\n`)
  process.exit(0)
}

// ── Run ──────────────────────────────────────────────────────────────────
const active = MODELS.filter((m) => {
  if (!m.apiKey) { console.log(`⚠️  skipping ${m.label} — no API key in env`); return false }
  return true
})
if (active.length === 0) { console.error('No API keys set. Provide OPENAI_API_KEY and/or GOOGLE_AI_KEY.'); process.exit(1) }

const files = (fs.existsSync(IMAGES_DIR)
  ? fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  : []
).slice(0, Number(process.env.LIMIT) || Infinity) // LIMIT=1 → just the first photo, for fast debug runs
if (files.length === 0) { console.error(`No images in ${IMAGES_DIR}. Drop some pantry photos there first.`); process.exit(1) }

console.log(`\nTesting ${files.length} photo(s) across ${active.length} model(s): ${active.map((m) => m.label).join(', ')}\n`)

const totals = Object.fromEntries(active.map((m) => [m.label, { items: 0, ms: 0, errors: 0, removed: 0, collapsed: 0 }]))

for (const file of files) {
  const buf = fs.readFileSync(path.join(IMAGES_DIR, file))
  const mime = sniffMime(buf)
  if (!mime) { console.log(`\n⚠️  skipping ${file} — not a jpeg/png/webp/gif (vision APIs can't read it)`); continue }
  const base64 = buf.toString('base64')
  console.log(`\n${'='.repeat(70)}\n📷 ${file}  [${mime}]\n${'='.repeat(70)}`)

  // Run all models on this image concurrently.
  const results = await Promise.all(active.map(async (m) => ({ m, r: await callModel(m, base64, mime) })))

  // Per-model summary line. Shows item count (after non-food filter), latency, and — when
  // the filter caught hallucinated non-food — exactly what it stripped, so we can verify it.
  for (const { m, r } of results) {
    const t = totals[m.label]
    if (r.error) { t.errors++; console.log(`  ${m.label.padEnd(26)} ERROR: ${r.error}`); continue }
    t.items += r.names.length; t.ms += r.ms; t.removed += (r.removed?.length ?? 0); t.collapsed += (r.collapsed ?? 0)
    const filtered = r.removed?.length ? `  🚫 ${r.removed.join(', ')}` : ''
    const merged = r.collapsed ? `  🔁 ${r.collapsed} over-splits merged` : ''
    console.log(`  ${m.label.padEnd(26)} ${String(r.names.length).padStart(2)} items  (${(r.ms / 1000).toFixed(1)}s)${merged}${filtered}`)
  }

  // Recall matrix: union of every item any model found, with ✓/· per model.
  const byModel = Object.fromEntries(results.map(({ m, r }) => [m.label, new Set(r.names.map(norm))]))
  const display = new Map() // norm -> first-seen original name
  for (const { r } of results) for (const n of r.names) if (!display.has(norm(n))) display.set(norm(n), n)

  if (display.size) {
    console.log(`\n  ${'item'.padEnd(34)} ${active.map((m) => m.label.split(' ')[0].slice(0, 6).padStart(7)).join('')}`)
    for (const [key, original] of [...display].sort((a, b) => a[1].localeCompare(b[1]))) {
      const marks = active.map((m) => (byModel[m.label]?.has(key) ? '   ✓  ' : '   ·  ').padStart(7)).join('')
      console.log(`  ${original.slice(0, 34).padEnd(34)}${marks}`)
    }
  }
}

// ── Totals ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}\n📊 TOTALS across ${files.length} photo(s)\n${'='.repeat(70)}`)
for (const m of active) {
  const t = totals[m.label]
  const avgItems = (t.items / files.length).toFixed(1)
  const avgMs = (t.ms / Math.max(1, files.length - t.errors) / 1000).toFixed(1)
  console.log(`  ${m.label.padEnd(26)} avg ${avgItems} items/photo   avg ${avgMs}s   errors: ${t.errors}   non-food filtered: ${t.removed}   over-splits merged: ${t.collapsed}`)
}
console.log(`
How to read this:
  • More items isn't automatically better — eyeball the matrix for items a model
    INVENTED (present for one model, implausible for the photo) vs. items it MISSED
    (·  where the others have ✓ on something you can actually see in the photo).
  • Pick the cheapest model whose ✓ column matches GPT-4o on REAL items.
  • Gemini is ~4–5× cheaper per image; if Pro matches GPT-4o recall here, switch the
    pantry-scan primary to it (GPT stays as fallback) for the same quality at lower cost.
`)
