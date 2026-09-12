// Re-score a finished sweep with the current scorer — no API calls. The decks are in raw.json, so a
// scorer fix must never cost another sweep: node .../rescore.mjs results/<dir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PANTRIES, PROFILES, DIETS } from './fixtures.mjs'
import { scoreDeck } from './score.mjs'

const dir = process.argv[2]
const rows = JSON.parse(readFileSync(join(dir, 'raw.json'), 'utf8'))
const hard = {}, soft = {}
const kind = (s) => s.replace(/:.*/, '').replace(/\d+/g, 'N').trim()
let clean = 0, decks = 0, meals = 0
for (const r of rows) {
  if (!r.meals) continue
  const pr = PROFILES[r.case.profile]
  const ctx = { pantry: PANTRIES[r.case.pantry], dietaryRestrictions: DIETS[r.case.diet] ?? [],
    foodDislikes: r.case.foodDislikes ?? [], proteinTarget: Math.round(pr.proteinGoal / pr.mealsPerDay),
    calorieTarget: Math.round(pr.calorieGoal / pr.mealsPerDay), maxPrepMinutes: pr.maxPrepMinutes }
  const s = scoreDeck(r.meals, r.funnel, ctx)
  decks++; meals += s.meals.length
  if (!s.hardCount) clean++
  else for (const m of s.meals) for (const h of m.hard) console.log(`✖ ${r.case.id} ${m.name}: ${h}`)
  for (const h of s.deckHard) console.log(`✖ ${r.case.id} deck: ${h}`)
  for (const m of s.meals) { for (const h of m.hard) hard[kind(h)] = (hard[kind(h)] ?? 0) + 1
                             for (const x of m.soft) soft[kind(x)] = (soft[kind(x)] ?? 0) + 1 }
  for (const h of s.deckHard) hard[kind(h)] = (hard[kind(h)] ?? 0) + 1
  for (const x of s.deckSoft) soft[kind(x)] = (soft[kind(x)] ?? 0) + 1
}
const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
console.log(`\n${clean}/${decks} decks clean · ${meals} meals`)
console.log('hard:', sorted(hard) || 'none')
console.log('soft:', sorted(soft) || 'none')
