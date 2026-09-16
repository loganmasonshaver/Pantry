import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMissing, isInPantry, isStructural, thinPantryMessage, MIN_PANTRY_FOR_COOK_NOW } from './pantry-check.ts'

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

// This used to assert the OPPOSITE: "crushed tomatoes" resolving to "Tomato Sauce" as a deliberate
// loose match. It came from the head-noun prefix clause ("tomato sauce" starts with "tomato "), and
// that clause is the one that made "Banana Peppers" cover banana and passed a banana smoothie as
// cookable with no banana on the shelf. It also disagreed with the test right below, where plain
// "tomatoes" against "Tomato Sauce" is missing — the adjective was the only difference. A product
// made from a food does not stock the food, crushed or not; the model can still be told the sauce
// is there and choose it itself.
test('an adjective does not turn a derived product back into the food', () => {
  assert.equal(isInPantry('crushed tomatoes', REAL_PANTRY), false)
  assert.equal(isInPantry('diced tomatoes', REAL_PANTRY), false)
  assert.equal(isInPantry('tomato sauce', REAL_PANTRY), true)
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

// The 2026-09-12 sweep served two protein shakes from a pantry holding no protein powder: the
// head-noun rule matched it against the ASSUMED staple "garlic powder" on the last word alone.
test('a class word as the last word is not a match — the modifier is the ingredient', () => {
  const staples = ['salt', 'black pepper', 'garlic powder', 'onion powder', 'olive oil', 'cooking oil']
  assert.equal(isInPantry('protein powder', staples), false, 'garlic powder does not stock protein powder')
  assert.equal(isInPantry('protein powder', ['Milk', 'Corn Flakes', 'Bananas']), false)
  assert.equal(isInPantry('sesame oil', ['Vegetable Oil']), false)
  assert.equal(isInPantry('chicken broth', ['Beef Broth']), false)
  assert.equal(isInPantry('tomato sauce', ['Soy Sauce']), false)
  // The honest matches still work — they never needed the last-word guess.
  assert.equal(isInPantry('whole milk', ['Milk']), true)
  assert.equal(isInPantry('protein powder', ['Chocolate Protein Powder']), true)
  assert.equal(isInPantry('soy sauce', ['Soy Sauce']), true)
  assert.equal(isInPantry('diced onion', ['Yellow Onions']), true, 'a real food head noun still matches')
  assert.equal(isInPantry('large eggs', ['Eggs']), true)
})

// ── Same-food rule: a name inside another name is only a match when both name the same food ──
// Logan's 2026-09-16 pantry: "Banana Peppers" (a fridge-door jar) and "Banana Cream Pudding Mix",
// no bananas. The old substring test called both "banana", a banana smoothie passed as cookable,
// and Home said "Ready to cook" over a shelf with no banana on it.
test('a different food that contains the word is NOT a match', () => {
  const p = ['Banana Peppers', 'Banana Cream Pudding Mix']
  assert.equal(isInPantry('banana', p), false)
  assert.equal(isInPantry('bananas', p), false)
  assert.equal(isInPantry('egg', ['Eggplant']), false)
  assert.equal(isInPantry('rice', ['Licorice']), false)
  assert.equal(isInPantry('salt', ['Salted Butter']), false)
  assert.equal(isInPantry('apple', ['Apple Cider Vinegar']), false)
  assert.equal(isInPantry('banana', ['Banana Bread']), false)
  assert.equal(isInPantry('chicken', ['Chicken Salad']), false)
  assert.equal(isInPantry('corn', ['Corn Tortillas']), false)
  // ...and the reverse direction: a recipe's product is not covered by the food it is made from.
  assert.equal(isInPantry('chicken stock', ['Chicken']), false)
  assert.equal(isInPantry('coconut milk', ['Coconut']), false)
  assert.equal(isInPantry('peanut butter', ['Peanuts']), false)
})

test('the same food plus adjectives, a cut, or a plural IS a match, both directions', () => {
  assert.equal(isInPantry('chicken', ['Chicken Breast']), true)
  assert.equal(isInPantry('chicken', ['Boneless Skinless Chicken Thighs']), true)
  assert.equal(isInPantry('chicken breasts', ['Chicken']), true)
  assert.equal(isInPantry('diced chicken', ['Chicken Breast']), true)
  assert.equal(isInPantry('chicken breast', ['Chicken Thighs']), true) // same bird; generous on purpose
  assert.equal(isInPantry('onion', ['Yellow Onions']), true)
  assert.equal(isInPantry('diced onion', ['Yellow Onions']), true)
  assert.equal(isInPantry('rice', ['Cooked Rice']), true)
  assert.equal(isInPantry('potato', ['Red Potatoes']), true)
  assert.equal(isInPantry('garlic', ['Garlic Cloves']), true)
  assert.equal(isInPantry('garlic cloves', ['Garlic']), true)
  assert.equal(isInPantry('broccoli florets', ['Broccoli']), true)
  assert.equal(isInPantry('pineapple', ['Pineapple Chunks']), true)
  assert.equal(isInPantry('salmon', ['Salmon Fillets']), true)
  assert.equal(isInPantry('steak', ['Ribeye Steak']), true)
  assert.equal(isInPantry('cheddar', ['Cheddar Cheese']), true)
  assert.equal(isInPantry('cheddar cheese', ['Cheddar']), true)
  assert.equal(isInPantry('cheese', ['Shredded Cheese']), true)
  assert.equal(isInPantry('cheese', ['Cottage Cheese']), true)
  assert.equal(isInPantry('milk', ['Oat Milk']), true) // the documented swap
  assert.equal(isInPantry('egg', ['Eggs']), true)
  assert.equal(isInPantry('spinach', ['Baby Spinach']), true)
  assert.equal(isInPantry('beef', ['Ground Beef']), true)
})

test('form words: a qualified spice stays missing; the bare word is the one cheap false positive', () => {
  // "ground cloves" against Garlic: the form word is stripped, "ground" is left, nothing matches.
  assert.equal(isInPantry('ground cloves', ['Garlic']), false)
  // Bare "cloves" against Garlic Cloves reads as present. It has the same shape as "steak" against
  // "Ribeye Steak", which must match, and nothing structural tells the spice from the part. Cheap:
  // a couple of grams of a spice is a garnish, so it costs an OPTIONAL line, never a meal.
  assert.equal(isInPantry('cloves', ['Garlic Cloves']), true)
  assert.equal(isInPantry('egg', ['Liquid Egg Whites']), false)
  assert.equal(isInPantry('egg whites', ['Liquid Egg Whites']), true)
})

test('thin-pantry message carries the count and reads whole at one', () => {
  assert.equal(thinPantryMessage(4), 'Not enough in your pantry yet for full meals — 4 ingredients so far. Scan another shelf or add a few basics.')
  assert.equal(thinPantryMessage(1), 'Not enough in your pantry yet for full meals — 1 ingredient so far. Scan another shelf or add a few basics.')
  assert.ok(MIN_PANTRY_FOR_COOK_NOW >= 4)
})
