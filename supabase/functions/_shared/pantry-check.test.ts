import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMissing, isInPantry, isStructural } from './pantry-check.ts'

// Logan's real pantry, read from production 2026-09-07.
const PANTRY = [
  'Barbecue Sauce','Brown Sugar','Bulgarian Yogurt','Butter','Cauliflower','Chicken','Chicken Salad',
  'Chocolate Protein Bars','Chocolate Protein Powder','Cinnamon Granola Butter','Coffee Beans',
  'Coffee Creamer','Cooked Rice','Cookies','Cottage Cheese','Cream Cheese','Eggs','Garlic','Granola',
  'Ground Beef','Ground Pepper','Hot Sauce','Juice','Leafy Greens','Lime','Liquid Egg Whites',
  'Maple Syrup','Mayonnaise','Milk','Milk Chocolate Ice Cream Bars','Non-Fat Plain Greek Yogurt',
  'Oat Milk','Orange','Orange Juice','Pad Thai Sauce','Peanut Butter','Pecans','Pesto','Pickles',
  'Pineapple','Plantain Chips','Protein Cereal','Protein Powder','Ranch Dressing','Red Potatoes',
  'Salsa','Shredded Cheese','Soy Sauce','Sweet Relish','Syrup','Tomato Sauce','Whipped Cream',
  'Whole Milk Plain Yogurt','Yellow Onions','Yellow Potatoes','Yogurt',
]
const ASSUMED = ['salt','black pepper','cooking oil','olive oil','butter','all-purpose flour','sugar',
  'garlic powder','onion powder','paprika','cumin','chili powder','oregano','basil','Italian seasoning',
  'cinnamon','red pepper flakes','ice cubes']

// The two real meals that prompted this. The model declared the garnish and hid the tortilla.
const WRAP = [
  { name: 'cottage cheese', grams: '298g' }, { name: 'tortilla', grams: '50g' },
  { name: 'leafy greens', grams: '40g' }, { name: 'salsa', grams: '40g' },
  { name: 'black pepper', grams: '1g' },
]
const PLATE = [
  { name: 'chicken', grams: '114g' }, { name: 'cooked rice', grams: '146g' },
  { name: 'barbecue sauce', grams: '24g' }, { name: 'cauliflower', grams: '81g' },
  { name: 'olive oil', grams: '4ml' }, { name: 'paprika', grams: '1g' },
  { name: 'fresh parsley', grams: '1g' },
]

test('the tortilla wrap is NOT cookable — no tortilla in the pantry', () => {
  const m = findMissing(WRAP, PANTRY, ASSUMED)
  assert.deepEqual(m.structural, ['tortilla'])
  assert.deepEqual(m.garnish, [])
})

test('the chicken plate IS cookable — only a garnish is missing', () => {
  const m = findMissing(PLATE, PANTRY, ASSUMED)
  assert.deepEqual(m.structural, [], 'nothing structural is missing')
  assert.deepEqual(m.garnish, ['fresh parsley'])
})

test('assumed staples are never missing, or salt would disqualify every meal', () => {
  const m = findMissing([{ name: 'salt', grams: '2g' }, { name: 'olive oil', grams: '15ml' }], PANTRY, ASSUMED)
  assert.deepEqual(m, { structural: [], garnish: [] })
})

test('pantry matching is generous in both directions', () => {
  assert.equal(isInPantry('rice', PANTRY), true, 'covered by "Cooked Rice"')
  assert.equal(isInPantry('red potatoes', PANTRY), true)
  assert.equal(isInPantry('large eggs', PANTRY), true, 'head-noun match against "Eggs"')
  assert.equal(isInPantry('greek yogurt', PANTRY), true)
  assert.equal(isInPantry('tortilla', PANTRY), false)
  assert.equal(isInPantry('pasta', PANTRY), false)
  assert.equal(isInPantry('sourdough bread', PANTRY), false)
})

test('a vessel carb is structural even though BASE_FOODS omits it', () => {
  for (const n of ['tortilla', 'pita bread', 'burger bun', 'penne pasta', 'egg noodles'])
    assert.equal(isStructural(n, '60g'), true, n)
})

test('herbs and finishing touches are garnish at any weight', () => {
  for (const n of ['fresh parsley', 'chopped cilantro', 'lemon juice', 'sesame seeds', 'chives'])
    assert.equal(isStructural(n, '30g'), false, n)
})

test('a tiny unknown ingredient is a garnish, a large one is not', () => {
  assert.equal(isStructural('sumac', '2g'), false)
  assert.equal(isStructural('sumac', '200g'), true)
})

// The failure direction is deliberate: a false "present" costs a wrong shopping line, a false
// "missing" throws away a dinner the user could have cooked.
test('an unreadable ingredient name never disqualifies a meal', () => {
  assert.equal(isInPantry('', PANTRY), true)
  assert.deepEqual(findMissing([{ name: '', grams: '10g' }], PANTRY, ASSUMED), { structural: [], garnish: [] })
  assert.deepEqual(findMissing(undefined, PANTRY, ASSUMED), { structural: [], garnish: [] })
})

// Ice is assumed stock — but the entry must stay "ice cubes". isInPantry matches substrings both
// ways, so a bare 'ice' makes "rice" and "juice" resolve as in-pantry and they stop being flagged
// as missing. That would be silent: rice is a real staple in the pantry this ships against.
test('assumed ice covers a recipe line that just says "ice"', () => {
  assert.equal(isInPantry('ice', ASSUMED), true)
  assert.equal(isInPantry('crushed ice', ASSUMED), true)
})

test('assumed ice does NOT swallow rice or juice', () => {
  assert.equal(isInPantry('rice', ASSUMED), false)
  assert.equal(isInPantry('cooked rice', ASSUMED), false)
  assert.equal(isInPantry('brown rice', ASSUMED), false)
  assert.equal(isInPantry('orange juice', ASSUMED), false)
})

// ── head-noun plurals ──────────────────────────────────────────────────────────────────────────
// A missing STRUCTURAL ingredient disqualifies a whole meal in Cook Now, so a plural mismatch here
// costs a dinner. Measured against the real 55-item pantry, this was the largest single cause of
// spurious misses.
const REAL_PANTRY = ['Yellow Onions', 'Red Potatoes', 'Eggs', 'Leafy Greens', 'Shredded Cheese',
  'Ground Beef', 'Tomato Sauce', 'Chicken', 'Cooked Rice', 'Pickles']

test('a singular ingredient matches a plural pantry entry', () => {
  assert.equal(isInPantry('diced onion', REAL_PANTRY), true)
  assert.equal(isInPantry('red onion', REAL_PANTRY), true)
  assert.equal(isInPantry('baby potato', REAL_PANTRY), true)
})

test('a plural ingredient still matches, in both directions', () => {
  assert.equal(isInPantry('large eggs', REAL_PANTRY), true)
  assert.equal(isInPantry('russet potatoes', REAL_PANTRY), true)
  assert.equal(isInPantry('chicken breasts', REAL_PANTRY), true)
})

// The gate SHOULD still reject these. Naming a specific food the pantry does not have is the
// broken promise the nameGaps rule exists for — matching them would let "Spinach Frittata" ship
// on generic leafy greens. These assertions exist to stop a future loosening of the matcher from
// silently swallowing that rule.
test('a SPECIFIC food is still missing when the pantry only holds the GENERIC one', () => {
  assert.equal(isInPantry('spinach', REAL_PANTRY), false)
  assert.equal(isInPantry('kale', REAL_PANTRY), false)
  assert.equal(isInPantry('mozzarella', REAL_PANTRY), false)
})

test('a food the pantry simply does not have stays missing', () => {
  assert.equal(isInPantry('tortillas', REAL_PANTRY), false)
  assert.equal(isInPantry('shrimp', REAL_PANTRY), false)
  assert.equal(isInPantry('feta', REAL_PANTRY), false)
})

// DELIBERATE loose match, decided rather than inherited. "crushed tomatoes" resolves to
// "Tomato Sauce" through the head-noun prefix rule once -oes singularises correctly. They are
// different products, but swapping sauce for crushed tomatoes is ordinary cooking, and this
// module's rule is that a false MISSING drops a whole dinner while a false PRESENT costs one
// wrong shopping line. Asserted so the behaviour is visible if anyone tightens the matcher later.
test('a close substitute resolves rather than killing the meal', () => {
  assert.equal(isInPantry('crushed tomatoes', REAL_PANTRY), true)
  assert.equal(isInPantry('diced tomatoes', REAL_PANTRY), true)
})

test('a product made from a food does not stock the food — the Oat Milk porridge', () => {
  assert.equal(isInPantry('oats', ['Oat Milk']), false, 'porridge passed as cookable with no oats')
  assert.equal(isInPantry('oat', ['Oat Milk']), false)
  assert.equal(isInPantry('rice', ['Rice Vinegar']), false)
  assert.equal(isInPantry('tomatoes', ['Tomato Sauce']), false)
  assert.equal(isInPantry('almonds', ['Almond Butter']), false)
  assert.equal(isInPantry('chicken', ['Chicken Broth']), false)
})

test('the product itself, and the generous swaps, still match', () => {
  assert.equal(isInPantry('oat milk', ['Oat Milk']), true)
  assert.equal(isInPantry('milk', ['Oat Milk']), true, 'milk swap stays generous')
  assert.equal(isInPantry('rice', ['Cooked Rice']), true)
  assert.equal(isInPantry('chicken', ['Chicken Breast']), true)
  assert.equal(isInPantry('oats', ['Oat Milk', 'Rolled Oats']), true, 'real oats elsewhere in the pantry')
})

// Run 51 (2026-09-11) dropped a candidate with notCookableMissing ["water"]: the prompt promises
// water is always available and the staples array never had it.
test('plain water is never missing, but food named after water still is', () => {
  const pantry = ['Eggs', 'Cooked Rice']
  for (const w of ['water', 'Water', 'cold water', 'boiling water', 'reserved pasta water', ' filtered water ']) {
    const out = findMissing([{ name: w, grams: '240g' }], pantry, [])
    assert.deepEqual([...out.structural, ...out.garnish], [], w)
  }
  const coconut = findMissing([{ name: 'coconut water', grams: '240g' }], pantry, [])
  assert.deepEqual(coconut.structural, ['coconut water'])
  const melon = findMissing([{ name: 'watermelon', grams: '200g' }], pantry, [])
  assert.deepEqual(melon.structural, ['watermelon'])
})
