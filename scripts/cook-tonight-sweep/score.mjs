// Scores one Cook Tonight deck against the bar.
//
// Deliberately imports the PRODUCTION modules rather than re-implementing their rules: a harness
// with its own copy of "cookable" grades the generator against a rule it never had, and drifts the
// moment either side changes. Anything this file decides for itself (dietary violations, deck-level
// variety) is something production has no opinion on yet — which is itself worth knowing.

import { findMissing } from '../../supabase/functions/_shared/pantry-check.ts'
import { assumedStaplesFor } from '../../supabase/functions/_shared/staples.ts'
import { nameIngredientGaps, nameFormGaps, ghostIngredients } from '../../supabase/functions/_shared/recipe-integrity.ts'
import { isCompleteMeal, savoryClash } from '../../supabase/functions/_shared/meal-completeness.ts'
import { stepIssues } from '../../supabase/functions/_shared/step-checks.ts'
import { flavourAxes } from '../../supabase/functions/_shared/flavour-axes.ts'
import { detectBases, dishArchetype, isSameDish } from '../../supabase/functions/_shared/dish-key.ts'
import { dietViolations } from '../../supabase/functions/_shared/diet-check.ts'
import { pantryCarbs } from '../../supabase/functions/_shared/meal-completeness.ts'
import { FORBIDDEN } from './fixtures.mjs'

const names = (ings) => (Array.isArray(ings) ? ings : []).map(i => String(i?.name ?? i ?? ''))
const SWEET_DISH = /\b(parfait|smoothie|shake|oats|porridge|pancakes?|crepes?|waffles?|pudding|dessert|ice cream|cheesecake|muffins?|cookies?|bites|clusters?)\b/i

/** HARD = the deck is not shippable. SOFT = measured, tracked against a baseline. */
export function scoreMeal(meal, ctx) {
  const hard = []
  const soft = []
  const ings = names(meal?.ingredients)
  const staples = assumedStaplesFor(ctx.dietaryRestrictions, [])

  // 1. Cookable from THIS pantry — the promise the feature is named after.
  const missing = findMissing(meal?.ingredients, ctx.pantry, staples)
  if (missing.structural.length) hard.push(`not cookable: needs ${missing.structural.join(', ')}`)

  // 2. The title promises a food, or a form, the dish does not contain.
  const gaps = [...nameIngredientGaps(String(meal?.name ?? ''), meal?.ingredients),
                ...nameFormGaps(String(meal?.name ?? ''), meal?.ingredients)]
  if (gaps.length) hard.push(`name promises ${gaps.join(', ')}`)

  // 3. A step tells you to cook something the recipe never lists.
  const ghosts = ghostIngredients(meal?.steps, meal?.ingredients, staples)
  if (ghosts.length) hard.push(`steps use unlisted ${ghosts.join(', ')}`)

  // 4/5. Plate coherence.
  if (savoryClash(meal)) hard.push('sweet food in a savory dish')
  // A pantry with no carb in it cannot produce one — the keto shelf. Production exempts this too.
  if (pantryCarbs(ctx.pantry).length > 0 && !isCompleteMeal(meal, ctx.dietaryRestrictions))
    hard.push('no carb base (and not a drink or egg dish)')

  // 6. A restriction violated is food the user cannot eat — the most serious failure here. Checked
  // by production's own rules AND by an independent list, because a shared list cannot catch its own
  // blind spot. A disagreement is reported as "independent check only" and read by hand: the first
  // one was coconut milk, where the independent list was the wrong one.
  for (const v of dietViolations(meal, ctx.dietaryRestrictions)) hard.push(`${v.restriction} violated: ${v.ingredients.join(', ')}`)
  const flagged = new Set(dietViolations(meal, ctx.dietaryRestrictions).flatMap(v => v.ingredients))
  for (const r of ctx.dietaryRestrictions) {
    const re = FORBIDDEN[String(r).toLowerCase()]
    if (!re) continue
    const bad = ings.filter(n => re.test(n) && !flagged.has(n))
    if (bad.length) soft.push(`independent check only: ${r} vs ${bad.join(', ')}`)
  }
  // 7. A disliked food is one the user explicitly rejected.
  for (const d of ctx.foodDislikes ?? []) {
    const bad = ings.filter(n => n.toLowerCase().includes(String(d).toLowerCase()))
    if (bad.length) hard.push(`dislike "${d}" served: ${bad.join(', ')}`)
  }

  // 8. Macros. The bands the function itself enforces, read from the caller's own targets.
  const p = Number(meal?.protein) || 0, c = Number(meal?.calories) || 0
  if (ctx.proteinTarget > 0 && p < 0.70 * ctx.proteinTarget) hard.push(`protein ${p}g under floor (${Math.round(0.75 * ctx.proteinTarget)}g)`)
  else if (ctx.proteinTarget > 0 && p < 0.75 * ctx.proteinTarget) soft.push(`protein ${p}g just under the ${Math.round(0.75 * ctx.proteinTarget)}g floor`)
  if (c > ctx.calorieTarget * 1.4) hard.push(`calories ${c} over band`)
  if (c < ctx.calorieTarget * 0.75) hard.push(`calories ${c} under band`)

  // 9. The time budget the user set.
  const active = (Number(meal?.prepTime) || 0) + (Number(meal?.cookTime) || 0)
  if (ctx.maxPrepMinutes > 0 && active > ctx.maxPrepMinutes) hard.push(`${active} min over the ${ctx.maxPrepMinutes} min budget`)

  // SOFT — followability and flavour, measured against tonight's baselines.
  const si = stepIssues(meal)
  if (si.unseasoned) soft.push('unseasoned')
  if (si.noPreheat) soft.push('oven never preheated')
  if (si.untimedCook > 0) soft.push(`${si.untimedCook} cooking step(s) with no time`)
  if (si.coldCarb) soft.push('cold pre-cooked carb never reheated')
  const axes = flavourAxes(meal)
  if (axes.length < 2 && !SWEET_DISH.test(String(meal?.name ?? ''))) soft.push(`${axes.length} flavour axis`)

  // The prompt bans invented marketing names by name ("power bowl / protein bowl") and demands real,
  // established dishes. Worth counting: it is the difference between a recipe and a macro assembly.
  if (/\b(power|protein|super|mega|ultimate|energy|balanced|wholesome)\s+(bowl|plate|stack|box)\b/i.test(String(meal?.name ?? '')))
    soft.push('invented marketing name')

  // "A protein used in an absurd quantity is diet food wearing a recipe's clothes" — the prompt's own
  // rule, unenforced. 360g of egg whites (run 51) is most of a carton in one serving.
  const servings = Math.max(1, Number(meal?.servings) || 1)
  for (const ing of (Array.isArray(meal?.ingredients) ? meal.ingredients : [])) {
    const g = parseFloat(String(ing?.grams ?? '').replace(/[^0-9.]/g, ''))
    if (Number.isFinite(g) && g / servings >= 350 && !/\b(water|milk|broth|stock|juice)\b/i.test(String(ing?.name ?? '')))
      soft.push(`${Math.round(g / servings)}g of ${ing?.name} in one serving`)
  }

  // The same food listed twice buys a free point toward every count that judges the recipe.
  const seen = new Set()
  for (const n of ings.map(x => x.toLowerCase().trim())) {
    if (seen.has(n)) soft.push(`duplicate ingredient line "${n}"`)
    seen.add(n)
  }

  return { name: String(meal?.name ?? ''), hard, soft, protein: p, calories: c, axes: axes.length }
}

export function scoreDeck(meals, funnel, ctx) {
  const scored = (meals ?? []).map(m => scoreMeal(m, ctx))
  const deckHard = []
  const deckSoft = []

  if (!meals?.length) deckHard.push('empty deck')

  // Two of the same dish, or the same shape three times — the user sees one idea, not three.
  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      if (isSameDish(scored[i].name, scored[j].name)) deckHard.push(`duplicate dish: ${scored[i].name} / ${scored[j].name}`)
    }
  }
  const forms = (meals ?? []).map(m => dishArchetype(m?.name)).filter(Boolean)
  if (forms.length >= 3 && new Set(forms).size === 1) deckSoft.push(`all ${forms.length} the same form (${forms[0]})`)

  // A repeat shown while a fresh candidate of the same or better tier sat unshown.
  const cands = funnel?.rankCandidates ?? []
  const shownNames = new Set(funnel?.namesShown ?? [])
  const shownRepeats = cands.filter(c => shownNames.has(c.name) && c.repeat)
  const freshUnshown = cands.filter(c => !shownNames.has(c.name) && !c.repeat && !c.clash && !c.notCookable)
  for (const r of shownRepeats) {
    const better = freshUnshown.find(f => (f.tier ?? 0) <= (r.tier ?? 0))
    if (better) deckHard.push(`repeat "${r.name}" shown over fresh "${better.name}"`)
  }

  // Every savory dish on one base reads as one meal three ways.
  const bases = (meals ?? []).map(m => [...detectBases(m?.name, m?.ingredients)])
  const shared = bases.length >= 3 ? bases[0].filter(b => bases.every(set => set.includes(b))) : []
  const CARBY = /^(rice|potato|pasta|oats|granola|bread)$/
  if (shared.some(b => CARBY.test(b))) deckSoft.push(`every dish built on ${shared.filter(b => CARBY.test(b)).join('/')}`)

  // The deck is shown all day; the client floats what fits the hour, which needs one to exist.
  const slots = (meals ?? []).map(m => String(m?.slot ?? ''))
  if (slots.length >= 3 && !slots.some(s => s === 'lunch' || s === 'dinner')) deckSoft.push('no lunch/dinner in the deck')

  return {
    meals: scored,
    deckHard,
    deckSoft,
    hardCount: scored.reduce((n, m) => n + m.hard.length, 0) + deckHard.length,
    softCount: scored.reduce((n, m) => n + m.soft.length, 0) + deckSoft.length,
  }
}
