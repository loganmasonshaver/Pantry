// Sweep Cook Tonight across pantries it was never tuned on, and score every deck.
//
//   node scripts/cook-tonight-sweep/run.mjs                 # every case, 2 runs each
//   RUNS=3 CASES=vegan,keto-declared node .../run.mjs        # a subset, more runs
//   HISTORY=<uuid> node .../run.mjs                          # read one user's history (depth test)
//
// Uses the function's service-role dry run: no daily cap, no history written, no images, nothing a
// user can see. The service key is fetched from the Supabase CLI at run time and never written to
// disk — do not add it to .env, and do not print it.
//
// Results land in scripts/cook-tonight-sweep/results/<timestamp>/ (gitignored): raw.json holds every
// deck and funnel, report.md is the readable one.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PANTRIES, PROFILES, DIETS, CASES } from './fixtures.mjs'
import { scoreDeck } from './score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_REF = 'fdafjnkqqtpsjtddbfdz'
const FN_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/generate-meals`
const RUNS = Number(process.env.RUNS ?? 2)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3)
const ONLY = (process.env.CASES ?? '').split(',').map(s => s.trim()).filter(Boolean)

function serviceKey() {
  const out = execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '--reveal', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const keys = JSON.parse(out)
  const list = Array.isArray(keys) ? keys : keys.keys ?? []
  const secret = list.find(k => String(k.api_key ?? '').startsWith('sb_secret_'))
    ?? list.find(k => k.id === 'service_role')
  if (!secret) throw new Error('no service key from the CLI — is `npx supabase login` still valid?')
  return secret.api_key
}

const body = (c) => ({
  ingredients: PANTRIES[c.pantry],
  ...PROFILES[c.profile],
  dietaryRestrictions: DIETS[c.diet] ?? [],
  foodDislikes: c.foodDislikes ?? [],
  dislikedMeals: [],
  likedMeals: [],
  cuisinePreferences: [],
  recentMealNames: [],
  mode: c.mode ?? 'cookNow',
  staplesExcluded: [],
})

async function generate(c, key) {
  const t0 = Date.now()
  const qs = new URLSearchParams({ dryRun: 'true' })
  if (process.env.HISTORY) qs.set('asUser', process.env.HISTORY)
  const res = await fetch(`${FN_URL}?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body(c)),
  })
  const text = await res.text()
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 200)}`, ms: Date.now() - t0 }
  try {
    const { meals, funnel } = JSON.parse(text)
    return { meals, funnel, ms: Date.now() - t0 }
  } catch {
    return { error: `unparseable: ${text.slice(0, 200)}`, ms: Date.now() - t0 }
  }
}

// Bounded parallelism: the dry run skips the per-user rate limit, but the model is the real ceiling.
async function pool(tasks, n) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k]() }
  }))
  return out
}

const key = serviceKey()
const cases = CASES.filter(c => ONLY.length === 0 || ONLY.includes(c.id))
const jobs = cases.flatMap(c => Array.from({ length: RUNS }, (_, r) => async () => {
  const got = await generate(c, key)
  const profile = PROFILES[c.profile]
  const ctx = {
    pantry: PANTRIES[c.pantry],
    dietaryRestrictions: DIETS[c.diet] ?? [],
    foodDislikes: c.foodDislikes ?? [],
    proteinTarget: Math.round(profile.proteinGoal / profile.mealsPerDay),
    calorieTarget: Math.round(profile.calorieGoal / profile.mealsPerDay),
    maxPrepMinutes: profile.maxPrepMinutes,
  }
  const scored = got.error ? null : scoreDeck(got.meals, got.funnel, ctx)
  const line = got.error
    ? `✖ ${c.id} run${r + 1}: ${got.error}`
    : `${scored.hardCount ? '✖' : '✓'} ${c.id} run${r + 1}: ${scored.hardCount} hard, ${scored.softCount} soft (${(got.ms / 1000).toFixed(0)}s) — ${(got.meals ?? []).map(m => m.name).join(' | ')}`
  console.log(line)
  if (scored) for (const m of scored.meals) for (const h of m.hard) console.log(`    ✖ ${m.name}: ${h}`)
  if (scored) for (const h of scored.deckHard) console.log(`    ✖ deck: ${h}`)
  return { case: c, run: r + 1, ...got, scored }
}))

console.log(`sweep: ${cases.length} cases x ${RUNS} runs = ${jobs.length} generations, concurrency ${CONCURRENCY}\n`)
const results = await pool(jobs, CONCURRENCY)

// ── report ────────────────────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = join(HERE, 'results', stamp)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'raw.json'), JSON.stringify(results, null, 2))

const ok = results.filter(r => r.scored)
const hardByKind = {}
const softByKind = {}
const kind = (s) => s.replace(/:.*/, '').replace(/\d+/g, 'N').trim()
for (const r of ok) {
  for (const m of r.scored.meals) { for (const h of m.hard) hardByKind[kind(h)] = (hardByKind[kind(h)] ?? 0) + 1
                                    for (const s of m.soft) softByKind[kind(s)] = (softByKind[kind(s)] ?? 0) + 1 }
  for (const h of r.scored.deckHard) hardByKind[kind(h)] = (hardByKind[kind(h)] ?? 0) + 1
  for (const s of r.scored.deckSoft) softByKind[kind(s)] = (softByKind[kind(s)] ?? 0) + 1
}
const mealCount = ok.reduce((n, r) => n + r.scored.meals.length, 0)
const cleanDecks = ok.filter(r => r.scored.hardCount === 0).length
const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])

const md = [
  `# Cook Tonight sweep — ${stamp}`,
  ``,
  `${ok.length}/${results.length} generations returned a deck · ${mealCount} meals · **${cleanDecks}/${ok.length} decks with zero hard fails**`,
  ``,
  `## Hard fails by kind`,
  ...(sorted(hardByKind).length ? sorted(hardByKind).map(([k, n]) => `- **${n}** — ${k}`) : ['- none']),
  ``,
  `## Soft issues by kind`,
  ...(sorted(softByKind).length ? sorted(softByKind).map(([k, n]) => `- ${n} — ${k}`) : ['- none']),
  ``,
  `## By case`,
  `| case | decks clean | hard | soft | example deck |`,
  `|---|---|---|---|---|`,
  ...cases.map(c => {
    const rs = ok.filter(r => r.case.id === c.id)
    if (!rs.length) return `| ${c.id} | — | — | — | (no deck returned) |`
    const clean = rs.filter(r => r.scored.hardCount === 0).length
    const hard = rs.reduce((n, r) => n + r.scored.hardCount, 0)
    const soft = rs.reduce((n, r) => n + r.scored.softCount, 0)
    return `| ${c.id} | ${clean}/${rs.length} | ${hard} | ${soft} | ${(rs[0].meals ?? []).map(m => m.name).join(', ')} |`
  }),
  ``,
  `## Every hard fail`,
  ...ok.flatMap(r => [
    ...r.scored.meals.flatMap(m => m.hard.map(h => `- \`${r.case.id}\` **${m.name}** — ${h}`)),
    ...r.scored.deckHard.map(h => `- \`${r.case.id}\` **deck** — ${h}`),
  ]),
  ``,
].join('\n')
writeFileSync(join(dir, 'report.md'), md)

console.log(`\n${cleanDecks}/${ok.length} decks clean · ${mealCount} meals`)
console.log('hard:', sorted(hardByKind).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none')
console.log('soft:', sorted(softByKind).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none')
console.log(`\nreport: ${join(dir, 'report.md')}`)
