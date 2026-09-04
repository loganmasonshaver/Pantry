// Run: node --test supabase/functions/_shared/macro-estimate.test.ts
//
// Fixtures marked REAL are meals Pantry actually generated for Logan on 2026-08-28/29, taken from
// device screenshots. They are the regression bar: the honest one must pass, and a hand-inflated
// copy of it must fail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePerServingMacros, estimateMacros, macroIncoherence, parseGrams, parseQty, verifyMacros } from './macro-estimate.ts'

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
  // ── South Asian staples. The table was Western-biased: paneer alone was 1,815g across 13 live
  // rows with no entry, and 21.5% of all weighed grams in the pool went unpriced.
  ['paneer', 18.3], ['low fat paneer', 24], ['chhena', 18], ['curd', 3.5], ['dahi', 3.5],
  ['quark', 11.5], ['skyr', 11.5],
  ['soya chunks', 52], ['chana dal', 22], ['moong dal', 22], ['rajma', 24], ['roasted chana', 22],
  ['besan', 22.4], ['gram flour', 22.4], ['atta', 13.2], ['semolina', 12.7], ['sooji', 12.7],
  ['lauki', 0.6],
  // Pulses are listed DRY; the soaked/boiled prefix must win and roughly halve the density.
  ['boiled kala chana', 9.5], ['soaked chana dal', 9.5],
  // "bean curd" is TOFU, not dahi — without the compound guard the curd row claims it.
  ['bean curd', 17.3], ['soy curd', 17.3],
  // ── chocolate. "milk chocolate" was shadowed by the dairy \bmilk\b row (3.3g, 50 kcal — an 11x
  // calorie understatement) until it moved into the compound block. Cocoa POWDER is not chocolate.
  ['chocolate', 5], ['dark chocolate', 7.8], ['white chocolate', 5.9], ['milk chocolate', 7.6],
  ['chocolate chips', 4.2], ['cocoa powder', 19.6], ['cacao powder', 19.6],
  // A ready-to-drink shake is mostly water — must beat the chocolate rows.
  ['chocolate protein shake', 8], ['protein milkshake', 8],
  // ── seeds, flours, shapes
  ['sunflower seeds', 20.8], ['pumpkin seeds', 30.2], ['sesame seeds', 17.7], ['hemp hearts', 31.6],
  ['pistachios', 20.2],
  ['self rising flour', 10.3], ['all purpose flour', 10.3], ['coconut flour', 18],
  ['orzo', 5], ['elbow macaroni', 5], ['dry fettuccine', 5], ['sourdough loaf', 9],
  // Konjac is a noodle by shape only — ~10 kcal/100g against pasta's 131.
  ['konjac noodles', 0.2], ['shirataki noodles', 0.2],
  // High-protein pasta must beat the generic pasta row, or a recipe built on it reads as a
  // protein overclaim. Plain pasta above must stay at 5 — that is the half this can break.
  ['high-protein macaroni', 9], ['protein pasta', 9], ['protein penne', 9], ['protein noodles', 9],
  ['chickpea pasta', 11], ['lentil pasta', 11], ['edamame spaghetti', 11], ['banza rotini', 11],
  // ── produce & sauces
  ['capsicum', 1], ['frozen mixed vegetables', 3], ['frozen peas', 5.4], ['dates', 2.5],
  ['medjool dates', 2.5], ['mango', 0.8], ['pineapple', 0.5],
  ['vodka sauce', 2], ['bolognese sauce', 2], ['buffalo wing sauce', 1], ['media crema', 2.5],
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

// ── Household units ───────────────────────────────────────────────────────────────────────────
// The generator does not always put grams in the `grams` field. A real meal shipped "1 scoop",
// "1 tbsp" and "1 tsp"; reading those as 1g each lost ~24g of protein and made an honest meal
// look like it overstated by 1.51x. This block is the regression bar for that false positive.

test('parseQty converts household measures instead of reading them as 1g', () => {
  assert.equal(parseQty('1 scoop').g, 30)
  assert.equal(parseQty('2 scoops').g, 60)
  assert.equal(parseQty('1 tbsp').g, 15)
  assert.equal(parseQty('1 tablespoon').g, 15)
  assert.equal(parseQty('1 tsp').g, 5)
  assert.equal(parseQty('2 teaspoons').g, 10)
  assert.equal(parseQty('1 cup').g, 240)
  assert.equal(parseQty('2 cloves').g, 10)
  assert.equal(parseQty('3 slices').g, 90)
  for (const q of ['1 scoop', '1 tbsp', '120g', '15ml', '2 oz', '200']) {
    assert.equal(parseQty(q).known, true, q)
  }
})

test('an unrecognised unit is reported as unusable, never guessed', () => {
  const p = parseQty('1 palm-sized piece')
  assert.equal(p.g, 0)
  assert.equal(p.known, false)
  assert.equal(parseQty('to taste').known, false)
})

// REAL — "Mediterranean Greek Yogurt and Granola Bowl", 826 kcal / 66g protein, from the device
// on 2026-08-29. Hand-checked as accurate. Before parseQty understood household units this meal
// scored 1.51x and would have been DROPPED in production.
const YOGURT_BOWL = {
  claim: { calories: 826, protein: 66, carbs: 82, fat: 28 },
  ingredients: [
    { name: 'non-fat plain greek yogurt', grams: '340g' },
    { name: 'protein powder', grams: '1 scoop' },
    { name: 'granola', grams: '60g' },
    { name: 'pecans', grams: '20g' },
    { name: 'cinnamon granola butter', grams: '1 tbsp' },
    { name: 'maple syrup', grams: '1 tsp' },
  ],
}

test('REAL Greek yogurt bowl passes — the false positive that nearly shipped', () => {
  const v = verifyMacros(YOGURT_BOWL.claim, YOGURT_BOWL.ingredients)
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.skipped, false)
  assert.ok(v.proteinRatio > 0.85 && v.proteinRatio < 1.2, `proteinRatio ${v.proteinRatio}`)
})

test('the scoop is what carries that meal — dropping it must abstain, not accuse', () => {
  // Same bowl with an unreadable quantity on the protein powder. The estimate is then missing a
  // third of the protein, so the check must decline to judge rather than call the meal a liar.
  const v = verifyMacros(YOGURT_BOWL.claim, [
    ...YOGURT_BOWL.ingredients.slice(0, 1),
    { name: 'protein powder', grams: '1 heaping palmful' },
    ...YOGURT_BOWL.ingredients.slice(2),
  ])
  assert.equal(v.skipped, true)
  assert.equal(v.ok, true)
  assert.match(v.reason, /unreadable quantity/)
})

test('a zero-macro seasoning with no weight does NOT suppress the check', () => {
  // "salt, to taste" is everywhere. It must not push every meal into abstain.
  const v = verifyMacros(
    { calories: 676, protein: 70, carbs: 33, fat: 31 },
    [...SCRAMBLE.ingredients.slice(0, 5), { name: 'salt', grams: 'to taste' }, { name: 'black pepper', grams: 'to taste' }],
  )
  assert.equal(v.skipped, false, v.reason)
  assert.equal(v.ok, true)
})

// ── macroIncoherence ──────────────────────────────────────────────────────────────────────────
// Cases are REAL ROWS read out of trending_meals on 2026-09-04, not invented numbers, so the
// thresholds are pinned to the distribution they were tuned against.
test('macroIncoherence rejects the row with two macros missing', () => {
  // Live: 540 kcal on a pasta dish with 0 carbs and 0 fat. The worst row in the pool at 64% off,
  // and invisible to a reader precisely BECAUSE the number is large.
  const r = macroIncoherence({ calories: 540, protein: 48, carbs: 0, fat: 0 })
  assert.ok(r && r.includes('carbs and fat both 0'), `expected a zero-pair rejection, got ${r}`)
})

test('macroIncoherence accepts Jello — 12% is 12 kcal', () => {
  // The row Logan reported. It really is off, but by 12 kcal; rejecting it would mean rejecting
  // every small dish that rounds. fat=0 here is CORRECT — gelatin and water have no fat.
  assert.equal(macroIncoherence({ calories: 100, protein: 20, carbs: 2, fat: 0 }), null)
})

test('macroIncoherence accepts the protein-dessert band', () => {
  // Sugar alcohols and fiber yield well under Atwater's 4 kcal/g, so these gaps are the
  // approximation being wrong about real food, not the data being wrong.
  assert.equal(macroIncoherence({ calories: 126, protein: 19, carbs: 12, fat: 2 }), null)  // Brownie Muffin 12.7%
  assert.equal(macroIncoherence({ calories: 245, protein: 22, carbs: 35, fat: 5 }), null)  // Funfetti Protein Cake 11.4%
  assert.equal(macroIncoherence({ calories: 280, protein: 6, carbs: 45, fat: 4 }), null)   // Choc Sweet Potato 14.3%
})

test('macroIncoherence accepts a large dish with a large absolute gap but a small fraction', () => {
  // Philly Cheesesteak Pasta: 37 kcal off, more than Jello in absolute terms, but 10.3%.
  assert.equal(macroIncoherence({ calories: 360, protein: 37, carbs: 24, fat: 17 }), null)
})

test('macroIncoherence rejects a gross overstatement that has no zeros', () => {
  // Both conditions must fire: 330 kcal gap AND 66%. This is the backstop for a failure mode the
  // zero-pair rule would miss.
  const r = macroIncoherence({ calories: 500, protein: 10, carbs: 10, fat: 10 })
  assert.ok(r && r.includes('off by'), `expected an Atwater rejection, got ${r}`)
})

test('macroIncoherence abstains when calories are absent — that is the noMacros gate', () => {
  assert.equal(macroIncoherence({ calories: 0, protein: 0, carbs: 0, fat: 0 }), null)
})

// ── computePerServingMacros ───────────────────────────────────────────────────────────────────
test('computePerServingMacros divides a full batch by the serving count', () => {
  // 250g chicken breast is the single ingredient, over 2 servings.
  const one = computePerServingMacros([{ name: 'chicken breast', grams: '250g' }], 1)
  const two = computePerServingMacros([{ name: 'chicken breast', grams: '250g' }], 2)
  assert.ok(one && two, 'both should be computable from a single weighed ingredient')
  assert.equal(two!.protein, Math.round(one!.protein / 2))
  assert.equal(two!.calories, Math.round(one!.calories / 2))
})

test('computePerServingMacros abstains when an ingredient cannot be weighed', () => {
  // "to taste" leaves a hole. Publishing a total that is knowingly missing food is the failure
  // mode this returns null to avoid.
  assert.equal(
    computePerServingMacros([{ name: 'chicken breast', grams: '250g' }, { name: 'olive oil', grams: 'to taste' }], 1),
    null,
  )
})

test('computePerServingMacros abstains on a dish too small to reason about', () => {
  assert.equal(computePerServingMacros([{ name: 'salt', grams: '1g' }], 1), null)
})

test('computePerServingMacros treats a missing/zero serving count as 1, never divides by zero', () => {
  const a = computePerServingMacros([{ name: 'chicken breast', grams: '250g' }], 0)
  const b = computePerServingMacros([{ name: 'chicken breast', grams: '250g' }], 1)
  assert.deepEqual(a, b)
})
