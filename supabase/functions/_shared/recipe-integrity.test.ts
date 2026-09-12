import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countedIngredients, hasFractionalIndivisible, isNonEnglishSource, isNonIngredientLine, looksUntranslated, massBearingIngredients, nameFormGaps, nameIngredientGaps, nameTechniqueGaps, dryStapleOverload, realIngredients, recoverMergedIngredients, sectionHeadingIngredient, ghostIngredients, unusedIngredients } from './recipe-integrity.ts'
import { readFileSync, readdirSync } from 'node:fs'

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

test('preference placeholders are not ingredients, but named foods survive', () => {
  // "your fave seasoning!" names a preference, not a food. It rendered on Discover as a shoppable
  // row with an "+ Add" button (video 5QygSHOw4z0) and counted toward the 100%-retention threshold.
  for (const junk of [
    'fave seasoning!', 'your fave seasoning', 'favorite seasoning', 'fav spices',
    'preferred toppings', 'My Favourite Herbs', 'your favourite condiments',
  ]) assert.equal(isNonIngredientLine(junk), true, `"${junk}" should be rejected`)
  // The rule needs a preference word IMMEDIATELY before a generic CATEGORY noun. Anything that
  // still names an actual food is kept — the defect is a missing food noun, not the word
  // "favorite". "milk of choice" is live in the pool and is ordinary substitution phrasing.
  for (const good of [
    'favorite hot sauce', 'milk of choice', 'Carob molasses (optional)', 'taco seasoning',
    'everything bagel seasoning', 'cajun seasoning blend', 'soy sauce', 'fresh herbs',
    'mixed spices', 'favorite protein powder',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
})

test('method scaffolding and bare macro blocks are not ingredients', () => {
  // All 25 of these shapes were found STORED in the live pool and hand-checked as junk.
  for (const junk of [
    'whisking step', 'placement step', 'flip step', 'folding step', 'topping step',
    'method placeholder', 'kernel prep', 'mixing', 'instruction label', 'oven temp',
    'protein header', 'Air fryer heat', 'parchment paper setup',
    'dry mix', 'wet mix', 'batter mix',
    'Directions', "What you'll need", 'Method', 'Notes',
    // A bare macro block satisfies neither the digit rule ("504 kcal") nor the colon rule
    // ("Protein: 51g"). One live row stored these with the macro VALUE as the weight.
    'protein', 'carbs', 'fat', 'calories', 'total calories', 'total protein',
  ]) assert.equal(isNonIngredientLine(junk), true, `"${junk}" should be rejected`)

  for (const good of [
    // Anchoring keeps every one of these — the macro words are substrings, not the whole name.
    'protein powder', 'low fat yogurt', 'high-protein macaroni', 'carb balance tortillas',
    'chocolate protein powder', 'fat free milk',
    // "Milk and water mixture" (120g) is a real combined ingredient — it names two foods. Only the
    // dry/wet/batter GROUPING shape is method scaffolding, which is why /mixture$/ was not added.
    'Milk and water mixture', 'cake mix', 'pancake mix', 'brownie mix',
    // \bheat$ must not reach "wheat" — no word boundary between the w and the h.
    'wheat', 'cracked wheat', 'buckwheat',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
})

test('a 0g ingredient is junk, but only an explicit zero', () => {
  const items = [
    { name: 'chicken breast', grams: '900g' },
    { name: 'Superhero', grams: '0g' },      // a creator's channel tags, echoed as ingredients
    { name: 'Band Geeks', grams: '0g' },
    { name: 'salt', grams: '5g' },
    { name: 'olive oil' },                    // no grams field at all — absence is not evidence
    { name: 'water', grams: '' },
  ]
  assert.deepEqual(massBearingIngredients(items).map(i => i.name),
    ['chicken breast', 'salt', 'olive oil', 'water'])
  // Source-side entries are bare strings parsed from a description and carry no mass to judge.
  assert.deepEqual(massBearingIngredients(['flour', 'Superhero']), ['flour', 'Superhero'])
  assert.deepEqual(massBearingIngredients(undefined), [])
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

// ── Fractional discrete items ────────────────────────────────────────────────────────────────
test('a scaled-down batch is caught', () => {
  // The stored cheesecake this gate exists for.
  // Reports the visual+name pairing, which is what the creator's line actually says — the raw
  // concatenation would read "0.5 large 25g eggs" and match nothing.
  assert.equal(hasFractionalIndivisible([{ visual: '0.5 large', grams: '25g', name: 'eggs' }]), '0.5 large eggs')
  assert.ok(hasFractionalIndivisible([{ name: '0.5 large eggs' }]))
  assert.ok(hasFractionalIndivisible(['1.5 eggs']))
  assert.ok(hasFractionalIndivisible([{ visual: '.5 slice', grams: '15g', name: 'bread' }]))
})

test('REGRESSION: the gate is not silently inert', () => {
  // It was, for 19 days. A literal backspace byte (0x08) inside its String.raw template made the
  // compiled regex demand a backspace after the item name, so it never matched anything — while
  // still reading correctly in an editor, a review and a diff. This asserts it actually fires.
  assert.notEqual(hasFractionalIndivisible([{ name: '0.5 large eggs' }]), null)
})

test('common kitchen fractions are NOT scaling artefacts', () => {
  // Measured over the 161-row live pool: accepting "1/2" and "½" rejected three recipes, all
  // legitimate, and caught nothing real. Halving a can, a packet or an onion is what cooking is.
  for (const ok of [
    { visual: '1/2 can', grams: '100g', name: 'corn' },
    { visual: '1/2 packet', grams: '14g', name: 'jello powder' },
    { visual: '1/4 sliced', grams: '30g', name: 'onion' },
    { visual: '½ bar', grams: '50g', name: 'dark chocolate' },
    { visual: '1 large', grams: '50g', name: 'egg' },
    { visual: '2 slices', grams: '60g', name: 'bread' },
    // A decimal followed by a UNIT is a weight, not a scaled count. This was the last false
    // positive over the live pool.
    { visual: '1.5 lb', grams: '680g', name: 'chicken breast' },
    { visual: '0.5 kg', grams: '500g', name: 'chicken thigh' },
    { visual: '2.5 oz', grams: '70g', name: 'dark chocolate bar' },
  ]) assert.equal(hasFractionalIndivisible([ok]), null, JSON.stringify(ok))
})

test('no source file carries a stray control character', () => {
  // The class of bug above, guarded generally: an invisible byte inside a String.raw template or a
  // string literal changes behaviour while looking correct everywhere a human would check.
  const bad: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue
      const text = readFileSync(p, 'latin1')
      // Tab, LF and CR are legitimate; nothing else below 0x20 belongs in source.
      const m = text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/)
      if (m) bad.push(`${p}: byte 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')}`)
    }
  }
  walk('supabase/functions')
  assert.deepEqual(bad, [])
})

// ── language-independent instruction detection ───────────────────────────────────────────────
test('instructions are caught without knowing the language', () => {
  for (const instruction of [
    // The two real Russian lines that got a galette rejected: they sat in the parsed SOURCE list,
    // so the contract demanded the model copy a method step in as an ingredient.
    'тесто убрать в холодильник на 30 минут (можно в морозильную камеру на 15 минут)',
    '190–195°C — 30–35 мин (ориентируйтесь на свою духовку)',
    // ...and English ones the verb list misses because they do not start with a listed verb.
    'Add Salt, Oregano, Mix it Well and Cook for about 5-7 minutes.',
    'Take a Pan, Add Butter, Toast the bread on both the sides until golden brown and crispy.',
    'Now apply the cheese spread mixture on the toasted bread and',
    'Wrap it from both sides carefully so that it doesn’t break.',
    'Dip in melted dark chocolate. Sprinkle flaky sea salt on top and enjoy',
    'Backe bei 180°C für 25 Minuten',
  ]) assert.equal(isNonIngredientLine(instruction), true, `"${instruction}" should be rejected`)
})

test('long ingredient lines and emoji names survive the word count', () => {
  // Measured against 723 stored names (max 6 words) and 63 real source lines (max 9). The bread
  // line reads 11 tokens but only 9 WORDS — excluding emoji is what keeps it.
  for (const good of [
    'Bread 🍞 or Bread 🥖 (we’re using Zero Maida Garlic Bread)',
    '1 cup (200g) cottage cheese (or cream cheese, ricotta).',
    '1 cup (250 ml) 10% cream or milk',
    'масло сливочное (растопленное) — 100 г',
    'Bell Peppers (Green, Red, Yellow) 🫑',
    // A time unit is NOT a rejection signal — these are real products.
    '10 minute rice', '5 minute oats', 'Minute Rice',
  ]) assert.equal(isNonIngredientLine(good), false, `"${good}" should be kept`)
})

test('a section heading stored as an ingredient is rejected', () => {
  // Both confirmed against their source videos. The creator sectioned the description and the model
  // stored the SECTION NAME instead of the food under it:
  //   "Topping\n * 20g sprinkles"          -> "toppings", sprinkles gone      (CHDU7aKdcBs)
  //   "Egg yolk & sesame seeds for topping" -> "topping", both foods gone      (tPBBlyX-mtQ)
  // The retention gate cannot see it: one heading substituted for one food still counts as one.
  assert.equal(sectionHeadingIngredient([{ name: 'oat flour' }, { name: 'toppings' }]), 'toppings')
  assert.equal(sectionHeadingIngredient([{ name: 'topping' }]), 'topping')
  assert.equal(sectionHeadingIngredient([{ name: 'Frosting' }]), 'Frosting')
  assert.equal(sectionHeadingIngredient([{ name: 'seasoning' }]), 'seasoning')

  // GENERIC IS NOT THE TEST — nameable-and-buyable is. These are equally generic and all legitimate
  // recipe wording; 20 of the 25 bare-generic names in the live pool are exactly these, so a rule
  // that caught them would reject most of the feed to fix three rows.
  for (const ok of ['milk', 'oil', 'flour', 'cheese', 'sweetener', 'water', 'salt',
                    'sesame seeds', 'sprinkles', 'taco seasoning', 'chocolate frosting'])
    assert.equal(sectionHeadingIngredient([{ name: ok }]), null, `"${ok}" must be kept`)

  assert.equal(sectionHeadingIngredient([]), null)
  assert.equal(sectionHeadingIngredient(undefined), null)
})

// Real case from the 2026-09-04 dry runs: Apple Pie Cottage Cheese Cake. The creator lists sugar
// three times at different amounts; the model returned one "sugar" entry, so retention saw 13
// against 15 and rejected the recipe. Three prompt attempts failed to stop the merge.
test('recoverMergedIngredients restores a food the model consolidated', () => {
  const src = [
    '3 eggs', '1/2 cup (100 g) sugar', '2 cups (300 g) all-purpose flour',
    '2 tbsp sugar', '1 tsp vanilla extract', '1 tbsp sugar',
  ]
  const model = [
    { name: 'eggs', grams: '150g' },
    { name: 'sugar', grams: '100g' },
    { name: 'all-purpose flour', grams: '300g' },
    { name: 'vanilla extract', grams: '5g' },
  ]
  const { ingredients, recovered } = recoverMergedIngredients(model, src)
  assert.equal(recovered.length, 2, `expected the two surplus sugar lines, got ${JSON.stringify(recovered)}`)
  assert.equal(ingredients.filter(i => i.name === 'sugar').length, 3, 'three sugar entries after recovery')
  // Quantities come from the creator's own lines, never invented.
  const qtys = ingredients.filter(i => i.name === 'sugar').map(i => i.grams)
  assert.ok(qtys.includes('2 tbsp') && qtys.includes('1 tbsp'), `creator quantities kept: ${qtys.join(', ')}`)
})

test('recoverMergedIngredients does NOT invent a food the model omitted entirely', () => {
  // The case retention exists to catch. A source line for a food with no entry at all is a genuine
  // drop and must still fail — recovering it would defeat the contract.
  const src = ['2 eggs', '100g butter', '200g chocolate']
  const model = [{ name: 'eggs', grams: '100g' }, { name: 'butter', grams: '100g' }]
  const { ingredients, recovered } = recoverMergedIngredients(model, src)
  assert.equal(recovered.length, 0, 'nothing recovered')
  assert.equal(ingredients.length, 2, 'chocolate must NOT be invented')
})

test('recoverMergedIngredients is a no-op when the model already matched the source', () => {
  const src = ['2 eggs', '100g butter']
  const model = [{ name: 'eggs', grams: '100g' }, { name: 'butter', grams: '100g' }]
  const { ingredients, recovered } = recoverMergedIngredients(model, src)
  assert.equal(recovered.length, 0)
  assert.equal(ingredients.length, 2)
})

// ── grain derivatives ──────────────────────────────────────────────────────────────────────────
// "Protein Powder and Coffee Overnight Oats" was generated on 2026-09-07 from a pantry with no
// rolled oats: the model substituted granola, kept the name, and left step 3 saying "to allow oats
// to soften". It closed its own gap because `oat milk` contributes the token `oat` — the identical
// hole MEAT_DERIVATIVE was written to close for `chicken broth`.
const OATS_NO_OATS = [
  { name: 'chocolate protein powder' }, { name: 'oat milk' }, { name: 'brewed coffee' },
  { name: 'granola' }, { name: 'cinnamon' },
]

test('oat milk does not satisfy a dish named for oats', () => {
  assert.deepEqual(nameIngredientGaps('Protein Powder and Coffee Overnight Oats', OATS_NO_OATS), ['oat'])
})

test('real oats close the gap', () => {
  assert.deepEqual(
    nameIngredientGaps('Protein Powder and Coffee Overnight Oats', [...OATS_NO_OATS, { name: 'rolled oats' }]),
    [],
  )
})

test('granola does not stand in for oats', () => {
  // Granola IS made of oats, and that is exactly why the model reached for it. It bakes hard and
  // never softens, so a dish whose whole method is an overnight soak cannot be built from it.
  assert.deepEqual(nameIngredientGaps('Overnight Oats', [{ name: 'granola' }, { name: 'oat milk' }]), ['oat'])
})

test('a name that says the derivative turns the filter off', () => {
  // "Oat Milk Latte" is genuinely about the milk — the same escape hatch MEAT_DERIVATIVE gets for
  // "Chicken Broth Ramen".
  assert.deepEqual(nameIngredientGaps('Oat Milk Latte', [{ name: 'oat milk' }, { name: 'espresso' }]), [])
})

test('rice flour is not rice', () => {
  assert.deepEqual(nameIngredientGaps('Chicken Rice Bowl', [{ name: 'chicken breast' }, { name: 'rice flour' }]), ['rice'])
  assert.deepEqual(nameIngredientGaps('Chicken Rice Bowl', [{ name: 'chicken breast' }, { name: 'cooked rice' }]), [])
})

// Regression on my own rule: "protein" and "powder" were briefly in GRAIN_DERIVATIVE, and because
// the escape hatch reads the DISH NAME, that made the check inert on the exact meal it was written
// for. A term that shows up in dish names cannot be a member of that set.
test('a derivative term common in dish names does not disable the check', () => {
  assert.deepEqual(nameIngredientGaps('Protein Powder Overnight Oats', [{ name: 'oat milk' }, { name: 'whey protein powder' }]), ['oat'])
})

test('flavour-led foods are unaffected — a chocolate protein shake is still chocolate', () => {
  assert.deepEqual(nameIngredientGaps('Chocolate Protein Shake', [{ name: 'chocolate protein powder' }, { name: 'oat milk' }]), [])
})

// ── berry, the generic promise ────────────────────────────────────────────────────────────────
// "Bulgarian Yogurt and Berry Smoothie" shipped 2026-09-07 with yogurt, protein powder, orange
// juice, oat milk and cinnamon. No berries, no fruit at all.
test('a Berry dish with no berry in it is a gap', () => {
  assert.deepEqual(
    nameIngredientGaps('Bulgarian Yogurt and Berry Smoothie',
      [{ name: 'bulgarian yogurt' }, { name: 'chocolate protein powder' }, { name: 'orange juice' }, { name: 'oat milk' }]),
    ['berry'],
  )
})

// The reason "berry" was originally excluded from DEFINING_FOODS, and why it needs the synonym
// group: tokens() stems "blueberries" to "blueberry", never to "berry".
test('any specific berry satisfies a generic Berry name', () => {
  assert.deepEqual(nameIngredientGaps('Berry Protein Smoothie', [{ name: 'blueberries' }, { name: 'protein powder' }]), [])
  assert.deepEqual(nameIngredientGaps('Mixed Berry Bowl', [{ name: 'strawberries' }, { name: 'greek yogurt' }]), [])
})

test('the specific berries still work on their own', () => {
  assert.deepEqual(nameIngredientGaps('Blueberry Pancakes', [{ name: 'blueberries' }, { name: 'eggs' }]), [])
  assert.deepEqual(nameIngredientGaps('Blueberry Pancakes', [{ name: 'flour' }, { name: 'eggs' }]), ['blueberry'])
})

// ── steps vs ingredients ──────────────────────────────────────────────────────────────────────
const BOLOGNESE_STEPS = [
  { title: 'Boil Pasta', detail: 'Cook pasta according to package directions in salted water.' },
  { title: 'Sauté Beef', detail: 'In a pan, brown the ground beef with diced onion and minced garlic.' },
  { title: 'Combine', detail: 'Toss the cooked pasta with the sauce until well coated.' },
]
const BOLOGNESE_INGS = [
  { name: 'ground beef', grams: '90g' }, { name: 'tomato sauce', grams: '180g' },
  { name: 'all-purpose flour', grams: '42g' }, { name: 'garlic', grams: '6g' },
  { name: 'yellow onion', grams: '40g' }, { name: 'olive oil', grams: '4ml' },
]

test('a step that cooks pasta with no pasta listed is a ghost', () => {
  assert.deepEqual(ghostIngredients(BOLOGNESE_STEPS, BOLOGNESE_INGS, []), ['pasta'])
})

test('an ingredient in the list closes the ghost', () => {
  assert.deepEqual(ghostIngredients(BOLOGNESE_STEPS, [...BOLOGNESE_INGS, { name: 'penne pasta', grams: '115g' }], []), [])
})

test('assumed staples are not ghosts', () => {
  const steps = [{ title: 'Toast', detail: 'Toast the bread and butter it.' }]
  assert.deepEqual(ghostIngredients(steps, [{ name: 'bread', grams: '60g' }], ['butter']), [])
})

test('the phantom flour is an orphan and the oil is not', () => {
  // 42g of flour appears in no step — 153 kcal summed into the macros. The 4ml of olive oil is
  // implied by "In a pan, brown the ground beef" and must not be stripped.
  const orphans = unusedIngredients(BOLOGNESE_STEPS, BOLOGNESE_INGS).map((i: any) => i.name)
  assert.deepEqual(orphans, ['all-purpose flour'])
})

test('a seasoning a step only gestures at is never stripped', () => {
  const steps = [{ title: 'Season', detail: 'Season to taste.' }]
  const ings = [{ name: 'salt', grams: '3g' }, { name: 'black pepper', grams: '1g' }, { name: 'paprika', grams: '2g' }]
  assert.deepEqual(unusedIngredients(steps, ings), [])
})

test('a small quantity is left alone — being wrong there costs more than being right', () => {
  assert.deepEqual(unusedIngredients([{ title: 'Mix', detail: 'Mix it all.' }], [{ name: 'chia seeds', grams: '5g' }]), [])
})

test('head-noun matching means "cooked rice" is satisfied by a step saying "rice"', () => {
  const steps = [{ title: 'Serve', detail: 'Spoon the rice into a bowl.' }]
  assert.deepEqual(unusedIngredients(steps, [{ name: 'cooked rice', grams: '150g' }]), [])
})

// ── dish forms ───────────────────────────────────────────────────────────────────────────────
const ings = (...names: string[]) => names.map(name => ({ name }))

// Both real: Cook Tonight run 48 (2026-09-10) and the taco dish in PRELAUNCH §2l.
test('a wrap or taco with nothing to wrap it in is a gap', () => {
  assert.deepEqual(nameFormGaps('Egg and Cheese Breakfast Wrap', ings('eggs', 'shredded cheese', 'cooked rice', 'butter')),
    ['wrap (no tortilla or wrap)'])
  assert.deepEqual(nameFormGaps('Beef and Shredded Cheese Tacos', ings('ground beef', 'shredded cheese', 'salsa', 'taco seasoning')),
    ['taco (no tortilla or shell)'])
  assert.deepEqual(nameFormGaps('High-Protein Breakfast Burrito', ings('eggs', 'black beans', 'salsa')), ['burrito (no tortilla)'])
  assert.deepEqual(nameFormGaps('Chicken Salad Sandwich with Pickles', ings('chicken salad', 'pickles')), ['sandwich (no bread)'])
})

test('the form is satisfied by any real carrier', () => {
  assert.deepEqual(nameFormGaps('Chicken Lettuce Wraps', ings('chicken', 'butter lettuce', 'soy sauce')), [])
  assert.deepEqual(nameFormGaps('Breakfast Burrito', ings('eggs', 'large flour tortilla')), [])
  assert.deepEqual(nameFormGaps('Crispy Beef Tacos', ings('ground beef', 'hard taco shells')), [])
  assert.deepEqual(nameFormGaps('Avocado Toast', ings('sourdough', 'avocado')), [])
  assert.deepEqual(nameFormGaps('Sweet Potato Toast', ings('sweet potato', 'peanut butter')), [])
  assert.deepEqual(nameFormGaps('Protein Ice Cream Sandwich', ings('chocolate wafer cookies', 'greek yogurt')), [])
  // Both from the live Discover pool.
  assert.deepEqual(nameFormGaps('Chocolate Sweet Potato Ice Cream Sandwich', ings('pre-baked sweet potato', 'rice cakes', 'chocolate chips')), [])
  assert.deepEqual(nameFormGaps('Protein Loaded Roti Wrap', ings('sweet potato', 'kala chana', 'roti')), [])
})

// Measured against the pool before shipping: these are the shapes that must NOT fire.
test('a form word used as a flavour, or disclaimed, promises nothing', () => {
  for (const name of ['Beef and Salsa Taco Bowl', 'Burrito Bowl', 'Taco Pasta', 'Taco Salad', 'Chicken Taco Soup',
                      'Egg Roll in a Bowl', 'Bacon Wrapped Chicken', 'Toasted Sesame Chicken', 'Deconstructed Burrito',
                      'Wrap-Style Chicken Plate', 'Burrito-Inspired Rice']) {
    assert.deepEqual(nameFormGaps(name, ings('chicken', 'cooked rice')), [], name)
  }
})

test('a flavouring line does not carry the form', () => {
  assert.deepEqual(nameFormGaps('Chicken Tacos', ings('chicken', 'taco seasoning', 'tortilla chips')), ['taco (no tortilla or shell)'])
})

// ── techniques and portions ─────────────────────────────────────────────────────────────────
// All six from the 2026-09-12 eye test over 54 sweep meals.
test('a technique in the title must happen in the steps', () => {
  const st = (...d: string[]) => d.map(detail => ({ title: '', detail }))
  assert.deepEqual(nameTechniqueGaps('Cheesy Black Bean & Onion Spaghetti Bake', st('Boil spaghetti.', 'Top with cheese, cover, let sit on low heat.'), ings('spaghetti', 'cheese')),
    ['baked, but nothing goes in an oven'])
  assert.deepEqual(nameTechniqueGaps('Pork Chop with Roasted Sweet Potato', st('Sauté in a skillet 10 minutes.'), ings('pork chops', 'sweet potato')),
    ['roasted, but nothing goes in an oven'])
  assert.deepEqual(nameTechniqueGaps('Grilled Peanut Butter & Banana Toast', st('Toast the bread.'), ings('bread', 'peanut butter')),
    ['grilled, but nothing is grilled'])
  assert.deepEqual(nameTechniqueGaps('Tuna Caesar Lettuce Wraps', st('Warm tortillas.'), ings('canned tuna', 'flour tortillas', 'bagged caesar salad')),
    ['lettuce wraps with no lettuce'])
  assert.deepEqual(nameTechniqueGaps('Greek Yogurt Herb Bowl', st('Assemble.'), ings('greek yogurt', 'granola', 'orange')),
    ['herb in the name, no herb in the dish'])
  assert.deepEqual(nameTechniqueGaps('Turkey and Egg Power Scramble', st('Slice eggs and heat.'), ings('deli turkey', 'hard-boiled eggs')),
    ['a scramble of hard-boiled eggs'])
})

test('honest titles pass, and a grilled cheese is pan-fried by definition', () => {
  const st = (...d: string[]) => d.map(detail => ({ title: '', detail }))
  assert.deepEqual(nameTechniqueGaps('Garlic Butter Chicken and Roasted Potatoes', st('Preheat oven to 400°F.', 'Roast potatoes 20 minutes.'), ings('chicken', 'red potatoes')), [])
  assert.deepEqual(nameTechniqueGaps('Grilled Cheese and Egg Sandwich', st('Toast in a skillet until golden.'), ings('bread', 'cheese', 'eggs')), [])
  assert.deepEqual(nameTechniqueGaps('Lemon Herb Seared Salmon with Quinoa', st('Sear salmon.'), ings('salmon', 'quinoa', 'parsley')), [])
  assert.deepEqual(nameTechniqueGaps('Chicken Lettuce Wraps', st('Fill leaves.'), ings('chicken', 'butter lettuce')), [])
  assert.deepEqual(nameTechniqueGaps('Bacon and Spinach Scramble', st('Scramble eggs.'), ings('eggs', 'bacon', 'spinach')), [])
})

test('the measured false positives: no-bake, microwave, pre-roasted ingredients, dried herb blends', () => {
  const st = (...d: string[]) => d.map(detail => ({ title: '', detail }))
  assert.deepEqual(nameTechniqueGaps('No-Bake Protein Brownies', st('Press into a pan and chill.'), ings('oats', 'peanut butter')), [])
  assert.deepEqual(nameTechniqueGaps('Microwave Chocolate Baked Oats', st('Microwave 2 minutes.'), ings('oats', 'cocoa')), [])
  assert.deepEqual(nameTechniqueGaps('Roasted Chana Protein Brownie', st('Blend and chill.'), ings('roasted chana', 'dates')), [])
  assert.deepEqual(nameTechniqueGaps('Garlic Herb Chicken Thighs with Zucchini', st('Sear 7 minutes per side.'), ings('chicken thighs', 'italian seasoning')), [])
})

test('a dry grain or legume by the pot is flagged; cooked and canned are not', () => {
  assert.deepEqual(dryStapleOverload({ ingredients: [{ name: 'red lentils', grams: '334g', visual: '1¾ cups' }] }), ['334g dry red lentils'])
  assert.deepEqual(dryStapleOverload({ ingredients: [{ name: 'jasmine rice', grams: '150g', visual: '1 cup cooked' }] }), [])
  assert.deepEqual(dryStapleOverload({ ingredients: [{ name: 'cooked rice', grams: '250g', visual: '1.5 cups' }] }), [])
  assert.deepEqual(dryStapleOverload({ ingredients: [{ name: 'canned black beans', grams: '316g', visual: '1¼ cups' }] }), [])
  assert.deepEqual(dryStapleOverload({ ingredients: [{ name: 'quinoa', grams: '90g', visual: '1/2 cup dry' }] }), [], 'a normal dry portion')
  // Batch scale: 400g of dry rice across 4 servings is 100g each.
  assert.deepEqual(dryStapleOverload({ servings: 4, ingredients: [{ name: 'basmati rice', grams: '400g', visual: '2 cups' }] }), [])
})
