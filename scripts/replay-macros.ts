// Replay every live trending row through the macro code WITHOUT a pipeline run.
// No YouTube quota, no auth, no writes — the pipeline's arithmetic against candidates it has
// already seen. This is what caught the fact that coverage guards alone pass 98% of rows while
// half of those disagree with the stored number by over 25%.
//
//   npx supabase db query --linked --file scripts/dump-candidates.sql > /tmp/dump.json
//   node scripts/replay-macros.ts /tmp/candidates.json
//
// Read the OVERALL MEDIAN first: near 1.00 means the arithmetic is calibrated and the outliers are
// per-row problems (usually a wrong serving count). A median far from 1.00 means the lookup table
// itself has drifted, which is a different and much bigger problem.
import { COMPUTED_AGREEMENT_BAND, computePerServingMacros, estimateMacros, macroIncoherence } from '../supabase/functions/_shared/macro-estimate.ts'
import { readFileSync } from 'node:fs'

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

let computed = 0, keptModel = 0, abstained = 0, incoherent = 0
const ratios: number[] = []
const disagreements: string[] = []

for (const r of rows) {
  const c = computePerServingMacros(r.ingredients, r.servings)
  if (!c || !r.calories) { abstained++; continue }
  ratios.push(c.calories / r.calories)
  const agrees = Math.abs(c.calories - r.calories) / r.calories <= COMPUTED_AGREEMENT_BAND
  if (agrees) {
    computed++
    if (macroIncoherence(c)) incoherent++
  } else {
    keptModel++
    const est = estimateMacros(r.ingredients)
    const implied = Math.round(est.kcal / r.calories)   // servings the batch would really be
    disagreements.push(
      `${r.name.slice(0, 38).padEnd(38)} model ${String(r.calories).padStart(4)}kcal vs computed ${String(c.calories).padStart(4)}kcal` +
      `  servings=${r.servings}${implied !== r.servings && implied >= 1 ? ` (batch implies ~${implied})` : ''}`)
  }
}
console.log(`candidates ${rows.length}`)
console.log(`  -> computed (agreed, replaced) ${computed}`)
console.log(`  -> model kept (disagreed)      ${keptModel}`)
console.log(`  -> model kept (abstained)      ${abstained}`)
console.log(`  overall median computed/stored ratio: ${med(ratios).toFixed(2)}   [want ~1.00]`)
console.log(`  computed rows the coherence gate would reject: ${incoherent}   [want 0]`)
console.log(`\ndisagreements — each is a candidate wrong serving count, check against the video:`)
disagreements.slice(0, 20).forEach(d => console.log('   ' + d))
if (disagreements.length > 20) console.log(`   … and ${disagreements.length - 20} more`)
