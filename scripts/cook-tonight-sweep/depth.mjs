// Seven days on ONE pantry, with history accumulating — the test a breadth sweep cannot do.
//
//   node scripts/cook-tonight-sweep/depth.mjs vegetarian standard 7
//
// A sweep asks "is a first deck good?". This asks the question that decides whether anyone keeps
// paying: is day SEVEN still good, when the repeat window is full, the base ban has fired a few
// times, and the model has already used its best ideas for this pantry? Day 1 was never the risk.
//
// Each day: dry-run the generator as a synthetic user, score the deck, then write the shown meals
// into generated_meals as that user, exactly as a real generation would — so the next day reads a
// real history. Cleans up after itself unless KEEP=1.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PANTRIES, PROFILES, DIETS } from './fixtures.mjs'
import { scoreDeck } from './score.mjs'
import { dishArchetype, detectBases } from '../../supabase/functions/_shared/dish-key.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REF = 'fdafjnkqqtpsjtddbfdz'
const BASE = `https://${REF}.supabase.co`
const [pantryName = 'logan', profileName = 'standard', daysArg = '7', dietName = 'none'] = process.argv.slice(2)
const DAYS = Number(daysArg)

// Deterministic per archetype, so a re-run replaces its own history rather than piling on.
const USER = {
  logan: '11111111-1111-4111-8111-111111111111', thin: '22222222-2222-4222-8222-222222222222',
  vegetarian: '33333333-3333-4333-8333-333333333333', vegan: '44444444-4444-4444-8444-444444444444',
  keto: '55555555-5555-4555-8555-555555555555', carbHeavy: '66666666-6666-4666-8666-666666666666',
  bigMixed: '77777777-7777-4777-8777-777777777777', asian: '88888888-8888-4888-8888-888888888888',
  prepped: '99999999-9999-4999-8999-999999999999', messy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}[pantryName]
if (!USER) throw new Error(`no synthetic user for pantry "${pantryName}"`)

function serviceKey() {
  const out = execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '--reveal', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const list = JSON.parse(out)
  const keys = Array.isArray(list) ? list : list.keys ?? []
  return (keys.find(k => String(k.api_key ?? '').startsWith('sb_secret_')) ?? keys.find(k => k.id === 'service_role')).api_key
}
const KEY = serviceKey()
const rest = (path, init = {}) => fetch(`${BASE}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
})

const profile = PROFILES[profileName]
const ctx = {
  pantry: PANTRIES[pantryName],
  dietaryRestrictions: DIETS[dietName] ?? [],
  foodDislikes: [],
  proteinTarget: Math.round(profile.proteinGoal / profile.mealsPerDay),
  calorieTarget: Math.round(profile.calorieGoal / profile.mealsPerDay),
  maxPrepMinutes: profile.maxPrepMinutes,
}

console.log(`depth: ${pantryName} / ${profileName} / ${dietName}, ${DAYS} days as ${USER}\n`)
await rest(`generated_meals?user_id=eq.${USER}`, { method: 'DELETE' })

const days = []
let recentMealNames = [] // the client's own rolling window, passed up exactly as the app does
for (let day = 1; day <= DAYS; day++) {
  const res = await fetch(`${BASE}/functions/v1/generate-meals?dryRun=true&asUser=${USER}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredients: PANTRIES[pantryName], ...profile,
      dietaryRestrictions: DIETS[dietName] ?? [], foodDislikes: [], dislikedMeals: [], likedMeals: [],
      cuisinePreferences: [], recentMealNames, mode: 'cookNow', staplesExcluded: [],
    }),
  })
  const text = await res.text()
  if (!res.ok) { console.log(`day ${day}: HTTP ${res.status} ${text.slice(0, 160)}`); break }
  const { meals, funnel } = JSON.parse(text)
  const scored = scoreDeck(meals, funnel, ctx)
  days.push({ day, meals, funnel, scored })

  const flag = scored.hardCount ? '✖' : '✓'
  console.log(`${flag} day ${day}: ${scored.hardCount} hard, ${scored.softCount} soft · repeats shown ${funnel.repeatsShown ?? 0}/${meals.length} · fresh ${funnel.fresh}/${funnel.modelReturned} · bans [${(funnel.bannedBases ?? []).join(', ')}]`)
  console.log(`    ${meals.map(m => `${m.name} (${m.protein}g)`).join(' | ')}`)
  for (const m of scored.meals) for (const h of m.hard) console.log(`    ✖ ${m.name}: ${h}`)
  for (const h of scored.deckHard) console.log(`    ✖ deck: ${h}`)

  // Become yesterday: the same two writes a real generation makes.
  await rest('generated_meals', {
    method: 'POST',
    body: JSON.stringify(meals.map(m => ({ user_id: USER, name: String(m.name ?? '').trim(), meal_data: m, mode: 'cookNow' }))),
  })
  recentMealNames = [...meals.map(m => String(m.name ?? '').trim()), ...recentMealNames].slice(0, 30)
}

// ── what a week looked like ────────────────────────────────────────────────────────────────────
const all = days.flatMap(d => d.meals)
const forms = all.map(m => dishArchetype(m?.name)).filter(Boolean)
const bases = all.flatMap(m => [...detectBases(m?.name, m?.ingredients)])
const count = (xs) => Object.entries(xs.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
const hardTotal = days.reduce((n, d) => n + d.scored.hardCount, 0)
const repeatsLate = days.slice(-3).reduce((n, d) => n + (d.funnel.repeatsShown ?? 0), 0)

console.log(`\n${DAYS} days · ${all.length} meals · ${hardTotal} hard fails · ${days.filter(d => !d.scored.hardCount).length}/${days.length} clean days`)
console.log(`distinct dishes: ${new Set(all.map(m => m.name)).size}/${all.length}`)
console.log(`forms: ${count(forms).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
console.log(`bases: ${count(bases).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
console.log(`repeats shown in the last 3 days: ${repeatsLate}`)
console.log(`protein by day: ${days.map(d => d.meals.map(m => m.protein).join('/')).join('  ')}`)

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = join(HERE, 'results', `depth-${pantryName}-${profileName}-${stamp}`)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'raw.json'), JSON.stringify(days, null, 2))
console.log(`\nraw: ${join(dir, 'raw.json')}`)

if (!process.env.KEEP) await rest(`generated_meals?user_id=eq.${USER}`, { method: 'DELETE' })
else console.log(`history KEPT for ${USER} — delete it before trusting another depth run`)
