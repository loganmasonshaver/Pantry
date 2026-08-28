// Text-model A/B for the OpenAI-only paths, using the VERBATIM production prompt from
// supabase/functions/generate-recipe/index.ts.
//
// Built after the vision A/B taught the lesson this harness exists to respect: LIST PRICE LIES.
// gpt-5.6-terra advertised 20% cheaper than production and measured 85% MORE expensive, because
// it emitted 2531 output tokens where gpt-5.4 emitted 582. Cost is priceIn*inTok + priceOut*outTok,
// and outTok is a property of the model's verbosity, not of its price card. So this measures real
// usage off the API response and never estimates.
//
// Run: OPENAI_API_KEY=sk-... node scripts/text-eval/run.mjs
const KEY = process.env.OPENAI_API_KEY
if (!KEY) { console.error('Set OPENAI_API_KEY'); process.exit(1) }

// Prices per 1M tokens, from the OpenAI pricing page on 2026-08-28.
const MODELS = [
  { label: 'gpt-4o-mini (PRODUCTION)', model: 'gpt-4o-mini', priceIn: 0.15, priceOut: 0.60 },
  { label: 'gpt-5-nano',               model: 'gpt-5-nano',  priceIn: 0.05, priceOut: 0.40, newGen: true },
  { label: 'gpt-4.1-nano',             model: 'gpt-4.1-nano', priceIn: 0.10, priceOut: 0.40 },
]

// Verbatim from generate-recipe (non-annotate branch). Kept byte-identical on purpose: a harness
// that tests a paraphrased prompt measures the paraphrase, not production.
const buildPrompt = (description) => `Generate a complete recipe for: "${description}"

Rules:
- Create a practical, real recipe that people actually cook
- Include accurate macro estimates per serving
- Each ingredient must have both a visual portion size AND gram weight
- Steps should be clear and concise
- Only suggest real, coherent meals — no bizarre combinations

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "name": "Recipe Name",
  "prepTime": 25,
  "calories": 500,
  "protein": 45,
  "carbs": 40,
  "fat": 15,
  "ingredients": [{"name": "chicken breast", "amount": "1 palm-sized piece (150g)"}],
  "steps": ["Step one", "Step two"]
}`

// Deliberately mixed: one plain, one that needs real macro sense, one that invites a bizarre
// combination (the prompt forbids those — a weak model takes the bait).
const CASES = [
  'high protein chicken and rice bowl',
  'cottage cheese pancakes with 40g protein',
  'peanut butter and pickle smoothie',
]

const call = async (m, prompt) => {
  const body = {
    model: m.model,
    messages: [{ role: 'user', content: prompt }],
    // gpt-5.x take max_completion_tokens and reject a forced temperature — same quirk the vision
    // harness hit. Production sends temperature 0.7 / max_tokens 2000 for this path.
    ...(m.newGen ? { max_completion_tokens: 2000 } : { max_tokens: 2000, temperature: 0.7 }),
  }
  const t0 = Date.now()
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - t0
  const j = await r.json()
  if (!r.ok) return { err: j?.error?.message || `HTTP ${r.status}`, ms }
  const txt = j.choices?.[0]?.message?.content ?? ''
  const u = j.usage || {}
  const cost = ((u.prompt_tokens || 0) * m.priceIn + (u.completion_tokens || 0) * m.priceOut) / 1e6
  // Does it actually parse and carry the fields the app reads? A cheap model that returns prose
  // or markdown-fenced JSON is unusable at any price — generate-recipe JSON.parses this directly.
  let ok = false, name = '', ing = 0, steps = 0, macros = false
  try {
    const p = JSON.parse(txt.replace(/```json|```/g, '').trim())
    name = p.name || ''
    ing = (p.ingredients || []).length
    steps = (p.steps || []).length
    macros = ['calories','protein','carbs','fat'].every(k => typeof p[k] === 'number')
    ok = !!name && ing > 0 && steps > 0 && macros
  } catch {}
  return { ms, cost, inTok: u.prompt_tokens || 0, outTok: u.completion_tokens || 0, ok, name, ing, steps, macros, raw: txt }
}

const rows = []
for (const c of CASES) {
  console.log(`\n${'='.repeat(70)}\n📝 ${c}\n${'='.repeat(70)}`)
  for (const m of MODELS) {
    const r = await call(m, buildPrompt(c))
    if (r.err) { console.log(`  ✗ ${m.label.padEnd(26)} ERROR: ${r.err}`); rows.push({ m, err: true }); continue }
    console.log(`  ${r.ok ? '✓' : '⚠'} ${m.label.padEnd(26)} $${r.cost.toFixed(5)}  ${(r.ms/1000).toFixed(1)}s  ${r.inTok}+${r.outTok}tok  ${r.ing}ing/${r.steps}steps${r.ok ? '' : '  ← INVALID JSON or missing fields'}`)
    console.log(`     → "${r.name}"`)
    rows.push({ m, ...r })
  }
}

console.log(`\n${'='.repeat(70)}\n📊 TOTALS — valid output is a gate, cost only matters after it\n${'='.repeat(70)}`)
console.log('  model                        valid   $/call   avg s   avg outTok')
for (const m of MODELS) {
  const rs = rows.filter(r => r.m.model === m.model && !r.err)
  if (!rs.length) { console.log(`  ${m.label.padEnd(28)} all calls errored`); continue }
  const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length
  console.log(`  ${m.label.padEnd(28)} ${rs.filter(r=>r.ok).length}/${rs.length}    $${avg(r=>r.cost).toFixed(5)}  ${avg(r=>r.ms/1000).toFixed(1)}    ${Math.round(avg(r=>r.outTok))}`)
}
console.log(`
How to read this:
  • valid = parsed as JSON AND had name + ingredients + steps + all 4 macros. generate-recipe
    JSON.parses the response directly, so anything below 3/3 is disqualifying at any price.
  • $/call is MEASURED (real usage tokens x today's prices), never estimated from the price card.
  • avg outTok is the number that betrayed gpt-5.6-terra in the vision run — a chattier model
    costs more than its rate suggests.
  • Case 3 ("peanut butter and pickle smoothie") is a trap: the prompt forbids bizarre
    combinations. A model that cheerfully generates it is ignoring the constraint list.`)
