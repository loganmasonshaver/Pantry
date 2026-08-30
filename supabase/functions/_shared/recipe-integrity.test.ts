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
    // Every one of these was caught by a broad equipment net over the live pool and is FOOD.
    // They are the reason the equipment rules are anchored to non-food qualifiers rather than
    // matching /paper/, /wrap/ or /spray/ outright.
    'rice paper sheet', 'flour wrap', 'Ole Xtreme Wellness High Fiber Wrap', 'Oil spray',
    'oil spray', 'everything bagel seasoning', 'bagel seasoning', 'chicken skewers',
    'Crunchy Taco Wrap', 'cupcake', 'baking powder', 'baking soda',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
})

test('equipment and packaging are not ingredients', () => {
  for (const kit of [
    'parchment paper setup', 'parchment', 'Parchment paper', 'Butter paper', 'wax paper',
    'baking paper', 'greaseproof paper', 'paper towel', 'paper towels',
    'aluminium foil', 'aluminum foil', 'tin foil', 'Foil',
    'bamboo skewers', 'wooden skewer', 'toothpicks',
    'cupcake liners', 'muffin liner', 'baking cups',
    'cling film', 'plastic wrap', 'piping bag', 'ziploc bag',
  ]) assert.equal(isNonIngredientLine(kit), true, `"${kit}" should be rejected`)
})

test('non-Latin ingredient lines are not punctuation', () => {
  // \W is ASCII-only, so the old punctuation-only rule classified every Cyrillic, Devanagari and
  // CJK line as junk and deleted it. A real Russian source list collapsed from 12 items to 1.
  for (const good of [
    'творог — 200 г', 'щепотка соли', 'мука — 200 г', 'яйцо — 1 шт',
    'मैदा — 100 ग्राम', '片栗粉 大さじ1', 'ζάχαρη 100 γρ',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
  // ...but genuinely letterless lines still are junk.
  for (const junk of ['— — —', '   ', '···', '1/2', '###']) {
    assert.equal(isNonIngredientLine(junk), true, `"${junk}" should be rejected`)
  }
})

test('emptying a non-Latin list used to blind the untranslated gate', () => {
  // looksUntranslated returns false when there is nothing to judge. Before the fix realIngredients
  // deleted every Cyrillic line first, so the gate saw an empty list and passed the recipe — blind
  // to exactly the scripts it exists to catch.
  const russian = [{ name: 'творог — 200 г' }, { name: 'мука — 200 г' }, { name: 'яйцо — 1 шт' }]
  assert.equal(realIngredients(russian).length, 3)
  assert.equal(looksUntranslated(russian), true)
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

// ── meat named, only a flavouring present ────────────────────────────────────────────────────
test('a broth or stock line does not satisfy the meat the dish is named after', () => {
  // The real 2026-08-30 row, verbatim. It shipped claiming 61g protein per serving.
  assert.deepEqual(
    nameIngredientGaps('Marry Me Chicken Pasta', [
      { name: 'chicken broth' }, { name: 'minced garlic' }, { name: 'sun dried tomatoes' },
      { name: 'fat free cottage cheese' }, { name: 'grated parmesan' }, { name: 'penne pasta' },
    ]),
    ['chicken'],
  )
  for (const flavouring of [
    'chicken stock', 'chicken bouillon', 'beef broth', 'beef stock cube', 'chicken seasoning',
    'chicken bouillon powder', 'beef flavoring', 'chicken stock granules', 'chicken base',
  ]) {
    const meat = /beef/.test(flavouring) ? 'beef' : 'chicken'
    assert.deepEqual(
      nameIngredientGaps(`${meat} Rice Bowl`, [{ name: flavouring }, { name: 'rice' }]),
      [meat],
      flavouring,
    )
  }
})

test('the real meat still satisfies the name even when a broth is also listed', () => {
  assert.deepEqual(
    nameIngredientGaps('Marry Me Chicken Pasta',
      [{ name: 'chicken breast' }, { name: 'chicken broth' }, { name: 'penne pasta' }]), [])
  assert.deepEqual(
    nameIngredientGaps('Beef Rice Bowl',
      [{ name: 'ground beef' }, { name: 'beef stock' }, { name: 'jasmine rice' }]), [])
})

test('a dish named for the broth itself is not reported as a gap', () => {
  // Otherwise this invents a gap in the one case where the flavouring genuinely IS the dish.
  assert.deepEqual(nameIngredientGaps('Chicken Broth Ramen',
    [{ name: 'chicken broth' }, { name: 'ramen noodles' }]), [])
  assert.deepEqual(nameIngredientGaps('Beef Stock Pho',
    [{ name: 'beef stock' }, { name: 'rice noodles' }]), [])
})

test('a rendered fat does not satisfy the meat the dish is named after', () => {
  // The real 2026-08-19 row: claims 750 kcal and 76g protein for one serving, while its
  // ingredients total ~344 kcal and ~9.2g. The steak was dropped; only beef tallow remained,
  // and it reached the name through the steak->beef synonym.
  assert.deepEqual(
    nameIngredientGaps('Garlic Butter Steak Sweet Potato', [
      { name: 'baked sweet potato' }, { name: 'beef tallow' }, { name: 'light butter' },
      { name: 'garlic cloves' }, { name: 'Parmesan' }, { name: 'asparagus spears' },
    ]),
    ['steak'],
  )
  for (const fat of ['beef tallow', 'beef dripping', 'beef suet', 'lard', 'beef gelatin']) {
    assert.deepEqual(nameIngredientGaps('Steak Bowl', [{ name: fat }, { name: 'rice' }]), ['steak'], fat)
  }
  // But "fat" as a descriptor is not a derivative — this is real beef and must stay.
  assert.deepEqual(nameIngredientGaps('Beef Chili', [{ name: 'low fat beef mince' }]), [])
})

test('over-generic synonyms no longer stand in for the food', () => {
  // 'ground' let a beef dish be satisfied by ground TURKEY; 'strip' would have been satisfied by
  // bacon strips; corn syrup is not honey and caesar dressing is not ranch.
  assert.deepEqual(nameIngredientGaps('Beef Chili', [{ name: 'ground turkey' }, { name: 'beans' }]), ['beef'])
  assert.deepEqual(nameIngredientGaps('Steak Salad', [{ name: 'bacon strips' }, { name: 'lettuce' }]), ['steak'])
  assert.deepEqual(nameIngredientGaps('Hot Honey Chicken', [{ name: 'corn syrup' }, { name: 'chicken breast' }]), ['honey'])
  assert.deepEqual(nameIngredientGaps('Maple Pecan Bites', [{ name: 'golden syrup' }, { name: 'pecans' }]), ['maple'])
  assert.deepEqual(nameIngredientGaps('Ranch Chicken Bowl', [{ name: 'caesar dressing' }, { name: 'chicken' }]), ['ranch'])
})

test('the synonyms that were actually load-bearing still work', () => {
  // Measured over 161 live rows, these were the ONLY names a synonym ever rescued.
  assert.deepEqual(nameIngredientGaps('Yogurt Chocolate Cheesecake', [{ name: 'Cocoa powder' }]), [])
  assert.deepEqual(nameIngredientGaps('Cottage Cheese Chocolate Lava Cake', [{ name: 'cacao powder' }]), [])
  assert.deepEqual(nameIngredientGaps('Chocolate Chip Baked Oats', [{ name: 'sugar free choc chips' }, { name: 'oats' }]), [])
  assert.deepEqual(nameIngredientGaps('Air Fryer Salmon Pasta', [{ name: 'dry fettuccine' }, { name: 'salmon fillet' }]), [])
  // And the ordinary spellings of the meats keep passing.
  assert.deepEqual(nameIngredientGaps('Beef Chili', [{ name: 'ground beef' }, { name: 'beans' }]), [])
  assert.deepEqual(nameIngredientGaps('Steak Bowl', [{ name: 'sirloin' }, { name: 'rice' }]), [])
  assert.deepEqual(nameIngredientGaps('Steak Bowl', [{ name: 'beef strips' }, { name: 'rice' }]), [])
})

test('flavour-led foods are NOT held to the meat rule', () => {
  // A chocolate protein powder really does make the dish chocolate; a stock made from an animal
  // is not that animal. Restricting the rule to meat is what keeps these passing.
  assert.deepEqual(nameIngredientGaps('Brownie Batter Protein Ice Cream',
    [{ name: 'chocolate protein shake' }, { name: 'black cocoa powder' }]), [])
  assert.deepEqual(nameIngredientGaps('Vanilla Almond Bites',
    [{ name: 'vanilla extract' }, { name: 'almond butter' }]), [])
  assert.deepEqual(nameIngredientGaps('Chocolate Peanut Butter Cups',
    [{ name: 'chocolate protein powder' }, { name: 'peanut butter' }]), [])
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
