import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNonIngredientLine, realIngredients, countedIngredients, nameIngredientGaps,
         looksUntranslated, isNonEnglishSource } from './recipe-integrity.ts'

// ── junk lines ───────────────────────────────────────────────────────────────────────────────
test('section headings, macro lines and boilerplate are not ingredients', () => {
  for (const junk of [
    'Składniki', 'Makroskładniki', 'Łap przepis', 'Zutaten', 'Ingredients:', 'ingredients label',
    'Kalorien: 504 kcal', '425 kcal', 'Protein: 51,3 g', 'Eiweiß: 51,3 g',
    'description tag', 'full recipe on my site', 'link in bio', 'https://example.com', '@creator',
    '— — —', '   ', 'Season with: salt, black pepper, and garlic powder.', 'Cook eggs',
    // Found in stored rows after the first pass: a German macro line, a bare macro header with
    // neither colon nor number, and more instruction verbs.
    'Kohlenhydrate: 40,6 g', 'Fett: 12 g', 'kcal/protein/fat/carbs',
    'Place tortilla on a board', 'Layer the salmon', 'Fold in the berries', 'Serve with rice',
  ]) assert.equal(isNonIngredientLine(junk), true, `"${junk}" should be rejected`)
})

test('real ingredients are never mistaken for junk', () => {
  for (const good of [
    'Eggs', '125g High-protein Greek yogurt', 'frozen strawberries', 'Ore-Ida Potatoes O’Brien',
    'bone-in, skin-on chicken thighs', "Frank’s Mild Wing Sauce", 'reduced-fat feta cheese',
    'Whey Protein 360 Platinum Vanilla', 'Zero Sugar Cool Whip', 'cocoa powder', 'Medjool dates',
    // These begin with an instruction verb but are foods — the rule needs a following word AND
    // must not fire on a bare noun.
    'Top Ramen', 'Rolls', 'Roll', 'Cooking spray', 'Heavy cream', 'Season salt',
    // "spread" is NOT treated as an instruction verb: "Chicken Spread" and "Chocolate Spread" are
    // real dishes in this pool. Missing the odd "Spread cream cheese" line is far cheaper than
    // deleting a real ingredient, since a false positive here silently shortens a recipe.
    'Spread cream cheese', 'Chocolate spread', 'Wrap', 'Slice of sourdough',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
})

test('realIngredients strips junk and accepts both shapes', () => {
  const ings = [{ name: 'Greek yogurt' }, { name: 'Składniki' }, 'blueberries', { name: 'Kalorien: 504 kcal' }]
  assert.deepEqual(realIngredients(ings).map((i: any) => i.name ?? i), ['Greek yogurt', 'blueberries'])
})

test('the count collapses duplicates — they buy a free point at the retention gate', () => {
  const ings = [{ name: 'Olive oil spray' }, { name: 'chicken' }, { name: 'olive oil spray' }]
  assert.equal(realIngredients(ings).length, 3)   // stored list keeps them
  assert.equal(countedIngredients(ings).length, 2) // counted list does not
})

// ── name / ingredient coherence ──────────────────────────────────────────────────────────────
test('REGRESSION: the reported meal is rejected', () => {
  // Source video bp3sXQKLMqg is "Fluffy High-protein Blueberry Pancakes"; the stored recipe kept
  // neither the blueberries nor the lemon, and was stamped source_verified.
  assert.deepEqual(
    nameIngredientGaps('Blueberry-Lemon High-Protein Pancakes',
      [{ name: 'Eggs' }, { name: 'High-protein Greek yogurt' }, { name: 'Maple syrup' }]),
    ['blueberry', 'lemon'],
  )
})

test('every other confirmed drop in the live pool is caught', () => {
  const cases: [string, string[], string[]][] = [
    ['Parmesan-Crusted Chicken Sheet Pan', ['thin-sliced chicken breast', 'red potatoes', 'green beans'], ['parmesan']],
    ['Chicken and Tuna Salad', ['lettuce', 'boiled eggs', 'canned tuna', 'red onion'], ['chicken']],
    ['Chocolate Biscoff Protein Bowl', ['Thick fat-free skyr', 'Chocolate whey protein', 'cocoa powder'], ['biscoff']],
    ['Buffalo Ranch Chicken Pasta', ['chicken breast', 'bowtie pasta', "Frank's Mild Wing Sauce"], ['ranch']],
  ]
  for (const [name, ings, expected] of cases) {
    assert.deepEqual(nameIngredientGaps(name, ings.map(n => ({ name: n }))), expected, name)
  }
})

test('plurals do not read as drops — the -oes rule', () => {
  // "potatoes" stemmed to "potatoe" before this rule and reported three false missing potatoes.
  assert.deepEqual(nameIngredientGaps('Street Corn Sweet Potato Bowl',
    [{ name: 'sweet potatoes' }, { name: 'corn kernels' }]), [])
  assert.deepEqual(nameIngredientGaps('Blueberry Cheesecake Yogurt', [{ name: 'Blueberries' }]), [])
  assert.deepEqual(nameIngredientGaps('Matcha Strawberry Date Bark',
    [{ name: 'Medjool dates' }, { name: 'strawberries, thinly sliced' }, { name: 'matcha powder' }]), [])
})

test('synonyms are not drops', () => {
  assert.deepEqual(nameIngredientGaps('Chocolate Blended Oats',
    [{ name: 'High Protein Oats' }, { name: 'Cocoa Powder' }]), [])
  assert.deepEqual(nameIngredientGaps('Air Fryer Salmon Pasta',
    [{ name: 'salmon fillets' }, { name: 'dry fettuccine' }]), [])
  assert.deepEqual(nameIngredientGaps('Tiramisu Protein Oats',
    [{ name: 'Haferflocken' }, { name: 'Skyr' }]), [])
})

test('a junk-only or empty list is left to the count gate, not reported as a name gap', () => {
  assert.deepEqual(nameIngredientGaps('Blueberry Pancakes', []), [])
  assert.deepEqual(nameIngredientGaps('Blueberry Pancakes', [{ name: 'Składniki' }]), [])
})

test('a name with no defining food is never rejected', () => {
  assert.deepEqual(nameIngredientGaps('Crispy Air Fryer Breakfast Bowl', [{ name: 'eggs' }]), [])
})

// ── untranslated output ──────────────────────────────────────────────────────────────────────
test('a list carried through in its source language is flagged', () => {
  for (const ings of [
    ['borówki', 'woda', 'skórka z pomarańczy', 'serek wiejski wysokobiałkowy'],
    ['Haferflocken', 'Skyr', 'Chiasamen', 'Backkakao'],
    ['pechuga de pollo', 'aceite de oliva', 'cebolla picada'],
    ["blanc de poulet", "oignon émincé", "crème fraîche épaisse"],
  ]) assert.equal(looksUntranslated(ings.map(n => ({ name: n }))), true, ings[0])
})

test('English recipes are never flagged, including non-Western cuisines', () => {
  // These are the ones that broke the two detectors tried before this. Indian recipes score
  // nothing against a Western food table, but they are plainly written in English.
  for (const ings of [
    ['dry soy chunks', 'soaked chana dal', 'lauki', 'coriander seeds'],
    ['boiled Kala chana', 'paneer', 'beetroot', 'green chillie'],
    ['Green moong dal', 'Jaggery', 'Desi ghee', 'Crushed almonds'],
    ['rajma', 'paneer', 'sweet corn', 'olive oil', 'smoked sea salt'],
    ['Eggs', 'High-protein Greek yogurt', 'Maple syrup'],
  ]) assert.equal(looksUntranslated(ings.map(n => ({ name: n }))), false, ings[0])
})

test('an all-brand English list is why this is never used alone', () => {
  // "Quest Salted Caramel Milkshake, Xanthan Gum, Monk Fruit Sweetener, Honey" is a real, English
  // meal with no marker words. The source-language gate is what keeps it from being deleted.
  const brandy = ['Quest Salted Caramel Milkshake', 'Xanthan Gum', 'Monk Fruit Sweetener'].map(n => ({ name: n }))
  assert.equal(looksUntranslated(brandy), true)          // the text check alone would drop it...
  assert.equal(isNonEnglishSource('en-US'), false)       // ...and this is what stops that
})

test('source language: only an explicit non-English tag counts', () => {
  for (const l of ['de', 'pl', 'es', 'fr-CA', 'hi']) assert.equal(isNonEnglishSource(l), true, String(l))
  for (const l of ['en', 'en-US', 'en-GB', '', null, undefined]) assert.equal(isNonEnglishSource(l as any), false, String(l))
})
