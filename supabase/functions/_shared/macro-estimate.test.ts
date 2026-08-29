// Run: node --test supabase/functions/_shared/macro-estimate.test.ts
//
// Fixtures marked REAL are meals Pantry actually generated for Logan on 2026-08-28/29, taken from
// device screenshots. They are the regression bar: the honest one must pass, and a hand-inflated
// copy of it must fail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateMacros, parseGrams, verifyMacros } from './macro-estimate.ts'

// REAL — "Savory Cottage Cheese and Egg Scramble". Audited by hand against USDA values and found
// accurate; the ~350g of egg whites is what the "7 liquid whites eggs" display bug was hiding.
const SCRAMBLE = {
  claim: { calories: 676, protein: 70, carbs: 33, fat: 31 },
  ingredients: [
    { name: 'liquid egg whites', grams: '350g' },
    { name: 'cottage cheese', grams: '170g' },
    { name: 'shredded cheese', grams: '40g' },
    { name: 'red potatoes', grams: '150g' },
    { name: 'butter', grams: '14g' },
    { name: 'salt', grams: '1g' },
    { name: 'black pepper', grams: '2g' },
  ],
}

// REAL — "Thai Peanut Sauce Chicken Rice Bowl". Only the first two rows were visible on screen;
// the rest are plausible fillers so the totals are checkable.
const THAI = {
  claim: { calories: 730, protein: 40, carbs: 92, fat: 22 },
  ingredients: [
    { name: 'chicken salad', grams: '200g' },
    { name: 'cooked rice', grams: '220g' },
    { name: 'peanut butter', grams: '20g' },
    { name: 'soy sauce', grams: '15ml' },
    { name: 'spinach', grams: '60g' },
    { name: 'carrots', grams: '40g' },
  ],
}

test('parseGrams handles the unit strings the generator emits', () => {
  assert.equal(parseGrams('120g'), 120)
  assert.equal(parseGrams('15ml'), 15)
  assert.equal(parseGrams('60 ml'), 60)
  assert.equal(parseGrams(200), 200)
  assert.equal(parseGrams(undefined), 0)
  assert.equal(parseGrams('to taste'), 0)
  assert.equal(parseGrams('0g'), 0)
  assert.ok(Math.abs(parseGrams('2 oz') - 56.7) < 0.1)
  assert.ok(Math.abs(parseGrams('1 lb') - 453.6) < 0.1)
})

test('specific table rows win over general ones', () => {
  // The ordering bugs that would matter most: egg whites must not read as whole eggs, greek
  // yogurt must not read as plain yogurt, chicken breast must not read as cooked chicken.
  const whites = estimateMacros([{ name: 'liquid egg whites', grams: '100g' }])
  assert.equal(whites.protein, 10.9)
  const eggs = estimateMacros([{ name: 'eggs', grams: '100g' }])
  assert.equal(eggs.protein, 12.6)

  const greek = estimateMacros([{ name: 'greek yogurt', grams: '100g' }])
  assert.equal(greek.protein, 10.3)
  const plain = estimateMacros([{ name: 'yogurt', grams: '100g' }])
  assert.equal(plain.protein, 3.5)

  const breast = estimateMacros([{ name: 'chicken breast', grams: '100g' }])
  assert.equal(breast.protein, 22.5)

  // "peanut butter" must not be captured by the /butter/ row
  const pb = estimateMacros([{ name: 'peanut butter', grams: '100g' }])
  assert.equal(pb.protein, 25.1)
  const butter = estimateMacros([{ name: 'butter', grams: '100g' }])
  assert.equal(butter.fat, 81.1)
})

test('seasonings count as covered so they do not suppress the check', () => {
  const e = estimateMacros([
    { name: 'chicken breast', grams: '200g' },
    { name: 'salt', grams: '2g' },
    { name: 'black pepper', grams: '1g' },
    { name: 'paprika', grams: '2g' },
  ])
  assert.equal(e.coverage, 1)
  assert.equal(e.protein, 45)
})

test('REAL honest meal passes — the scramble audited by hand', () => {
  const v = verifyMacros(SCRAMBLE.claim, SCRAMBLE.ingredients)
  assert.equal(v.ok, true)
  assert.equal(v.skipped, false)
  // Hand audit put protein at 67-75g against a claim of 70.
  assert.ok(v.estimate.protein > 65 && v.estimate.protein < 76, `protein ${v.estimate.protein}`)
  assert.ok(v.estimate.kcal > 620 && v.estimate.kcal < 740, `kcal ${v.estimate.kcal}`)
  assert.ok(v.proteinRatio > 0.85 && v.proteinRatio < 1.15, `ratio ${v.proteinRatio}`)
})

test('REAL second meal passes', () => {
  const v = verifyMacros(THAI.claim, THAI.ingredients)
  assert.equal(v.ok, true)
})

test('a meal that overstates protein is rejected', () => {
  // Same honest ingredients, protein claim doubled — this is the failure the pipeline could not
  // previously see, because every gate read the claim rather than the food.
  const v = verifyMacros({ ...SCRAMBLE.claim, protein: 145 }, SCRAMBLE.ingredients)
  assert.equal(v.ok, false)
  assert.match(v.reason, /protein/)
})

test('a meal that understates calories is rejected', () => {
  const v = verifyMacros({ ...SCRAMBLE.claim, calories: 300 }, SCRAMBLE.ingredients)
  assert.equal(v.ok, false)
  assert.match(v.reason, /kcal/)
})

test('borderline claims are allowed through — tolerances must not be tight', () => {
  // 1.3x protein is within the 1.5x bar on purpose: the table is approximate and portion weights
  // vary, so anything tighter would drop honest meals.
  const v = verifyMacros({ ...SCRAMBLE.claim, protein: Math.round(70 * 1.3) }, SCRAMBLE.ingredients)
  assert.equal(v.ok, true)
})

test('unknown ingredients drop coverage and the check abstains', () => {
  const v = verifyMacros(
    { calories: 900, protein: 200 },
    [{ name: 'mystery protein slurry', grams: '400g' }, { name: 'salt', grams: '2g' }],
  )
  assert.equal(v.skipped, true)
  assert.equal(v.ok, true, 'abstaining must never drop a meal')
  assert.match(v.reason, /coverage/)
})

test('a tiny or quantity-less meal is never judged', () => {
  assert.equal(verifyMacros({ protein: 99 }, [{ name: 'eggs', grams: '20g' }]).skipped, true)
  assert.equal(verifyMacros({ protein: 99 }, [{ name: 'eggs', grams: 'to taste' }]).skipped, true)
  assert.equal(verifyMacros({ protein: 99 }, []).skipped, true)
  assert.equal(verifyMacros({ protein: 99 }, undefined).skipped, true)
})

test('the Greek yogurt bowl from the pantry list is reproducible', () => {
  // 826 kcal / 66g protein. Reaching 66g from yogurt alone needs a very large tub, which is what
  // made it worth checking against the prompt's own quantity-realism rule.
  const v = verifyMacros(
    { calories: 826, protein: 66, carbs: 82, fat: 22 },
    [
      { name: 'greek yogurt', grams: '500g' },
      { name: 'granola', grams: '80g' },
      { name: 'pecans', grams: '15g' },
      { name: 'honey', grams: '20g' },
    ],
  )
  // Documents what the estimator says rather than asserting a verdict — the real ingredient list
  // is still unknown, and this fixture exists to be replaced with it.
  assert.ok(v.estimate.protein > 0)
  console.log(`  greek yogurt bowl -> est ${v.estimate.kcal} kcal / ${v.estimate.protein}g protein,`,
    `claimed 826 / 66, ratios kcal ${v.kcalRatio.toFixed(2)}x protein ${v.proteinRatio.toFixed(2)}x, ok=${v.ok}`)
})

// ── Shadowing guard ───────────────────────────────────────────────────────────────────────────
// The table resolves first-match-wins, so a broad row placed above a narrow one silently steals
// it and the narrow row becomes dead code. That is exactly how "peanut butter" ended up reporting
// 0.9g protein and "bell pepper" ended up as a zero-calorie seasoning. Every entry below pins one
// canonical name to the protein value its OWN row should produce; a reorder that breaks any of
// them fails here instead of shipping wrong macros.
const CANONICAL: Array<[string, number]> = [
  // seasonings must stay zero...
  ['salt', 0], ['black pepper', 0], ['paprika', 0], ['garlic powder', 0], ['water', 0],
  // ...but must NOT swallow whole foods whose names contain them
  ['bell pepper', 1], ['bell peppers', 1], ['garlic', 6.4],
  // nut butters before fats
  ['peanut butter', 25.1], ['almond butter', 21], ['butter', 0.85], ['olive oil', 0],
  ['pecans', 9.2], ['almonds', 21.2], ['walnuts', 15.2],
  // egg forms
  ['liquid egg whites', 10.9], ['egg whites', 10.9], ['eggs', 12.6], ['egg yolks', 15.9],
  // dairy specificity
  ['greek yogurt', 10.3], ['yogurt', 3.5], ['cottage cheese', 11.8], ['cream cheese', 6],
  ['parmesan', 38.5], ['feta', 14.2], ['mozzarella', 22.2], ['cheddar', 24.9],
  ['shredded cheese', 24.9], ['almond milk', 1.2], ['milk', 3.3], ['protein powder', 75],
  // meats
  ['chicken breast', 22.5], ['rotisserie chicken', 31], ['chicken salad', 14], ['chicken', 31],
  ['ground beef', 18.6], ['steak', 26], ['ground turkey', 19.7], ['turkey', 22],
  ['bacon', 37], ['salmon', 20.4], ['tuna', 25.5], ['shrimp', 20.1], ['tofu', 17.3],
  // starches
  ['cooked rice', 2.7], ['quinoa', 4.4], ['rolled oats', 16.9], ['granola', 10.1],
  ['bread', 9], ['tortillas', 8], ['sweet potato', 1.6], ['red potatoes', 2],
  ['black beans', 8.9], ['chickpeas', 8.9], ['lentils', 9],
  // produce
  ['avocado', 2], ['banana', 1.1], ['blueberries', 0.7], ['spinach', 2.9], ['romaine', 1.2],
  ['broccoli', 2.8], ['cauliflower', 1.9], ['tomatoes', 1], ['salsa', 1], ['onions', 1.1],
  ['carrots', 0.9], ['mushrooms', 3.1], ['lemon', 1.1],
  // condiments
  ['honey', 0.3], ['maple syrup', 0.3], ['soy sauce', 8.1], ['mayonnaise', 1],
  ['chicken broth', 0.9], ['pesto', 5], ['hummus', 7.9],
]

test('no table row is shadowed by a broader row above it', () => {
  const wrong: string[] = []
  for (const [name, expectedP] of CANONICAL) {
    const got = estimateMacros([{ name, grams: '100g' }])
    if (got.matchedG === 0) { wrong.push(`${name}: matched NOTHING`); continue }
    if (Math.abs(got.protein - expectedP) > 0.051) {
      wrong.push(`${name}: got ${got.protein}g protein, expected ${expectedP}g`)
    }
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`)
})

test('every canonical ingredient is recognised at all', () => {
  const unmatched = CANONICAL
    .map(([n]) => n)
    .filter(n => estimateMacros([{ name: n, grams: '100g' }]).unmatched.length > 0)
  assert.deepEqual(unmatched, [], `unrecognised: ${unmatched.join(', ')}`)
})
