// Run: node --test supabase/functions/_shared/dish-key.test.ts
//
// REMEMBERED is the real contents of profiles.recent_meal_names for Logan's account on
// 2026-08-29, read straight out of production. It is the regression bar for this file: every one
// of those 18 names produced a DISTINCT dishKey, so the repeat filter never fired once, and the
// user was served the same handful of dishes under reworded titles for days.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dishKey, isSameDish, matchesRecentDish, clusterDishes, ingredientSignature, ingredientOverlap, isSameDishDetailed, detectBases, overusedBases, proteinFamilies } from './dish-key.ts'

const REMEMBERED = [
  'Thai Peanut Sauce Chicken Rice Bowl',            // 1 — shown today
  'Mediterranean Greek Yogurt and Granola Bowl',    // 2 — shown today
  'Savory Cottage Cheese and Egg Scramble',         // 3 — shown today
  'Savory Cottage Cheese and Egg Breakfast Bowl',
  'Herb-Roasted Chicken Salad with Potatoes',
  'Ground Beef and Salsa Taco Bowl',
  'Cottage Cheese and Veggie Power Plate',
  'Savory Scrambled Egg and Potato Hash',
  'Egg White and Vegetable Scramble with Toast',
  'Chocolate Protein Smoothie',
  'Cottage Cheese and Pineapple Protein Bowl',
  'Greek Yogurt and Granola Power Bowl',
  'Thai Peanut Sauce Rice Bowl',
  'Egg White and Vegetable Scramble with Potatoes',
  'Greek Yogurt and Protein Power Bowl',
  'Cottage Cheese and Egg Savory Plate',
  'Savory Egg White and Cottage Scramble',
  'Protein-Packed Greek Yogurt Parfait',
]

test('dishKey still collapses pure reorderings', () => {
  assert.equal(dishKey('Chicken Fried Rice'), dishKey('Fried Rice with Chicken'))
  assert.equal(dishKey('Beef Tacos'), dishKey('Beef Taco'))
  assert.equal(dishKey(''), '')
  assert.equal(dishKey(null), '')
})

test('dishKey does NOT catch a one-word rewording — the gap that caused this', () => {
  // Documents the limitation rather than asserting it is fine. If dishKey is ever made fuzzy
  // itself, this test should be deleted, not "fixed".
  assert.notEqual(
    dishKey('Thai Peanut Sauce Chicken Rice Bowl'),
    dishKey('Thai Peanut Sauce Rice Bowl'),
  )
})

test('every name in the real memory has a distinct key — the filter had nothing to match on', () => {
  const keys = new Set(REMEMBERED.map(dishKey))
  assert.equal(keys.size, REMEMBERED.length, 'if these ever collide, dishKey changed meaning')
})

test('isSameDish catches the reworded repeats dishKey missed', () => {
  const SAME: Array<[string, string]> = [
    ['Thai Peanut Sauce Chicken Rice Bowl', 'Thai Peanut Sauce Rice Bowl'],
    ['Mediterranean Greek Yogurt and Granola Bowl', 'Greek Yogurt and Granola Power Bowl'],
    ['Savory Cottage Cheese and Egg Scramble', 'Cottage Cheese and Egg Savory Plate'],
    ['Savory Cottage Cheese and Egg Scramble', 'Savory Egg White and Cottage Scramble'],
    ['Savory Cottage Cheese and Egg Scramble', 'Savory Cottage Cheese and Egg Breakfast Bowl'],
    ['Egg White and Vegetable Scramble with Toast', 'Egg White and Vegetable Scramble with Potatoes'],
    ['Greek Yogurt and Granola Power Bowl', 'Greek Yogurt and Protein Power Bowl'],
  ]
  for (const [a, b] of SAME) {
    assert.ok(isSameDish(a, b), `should match: "${a}" vs "${b}"`)
    assert.ok(isSameDish(b, a), 'must be symmetric')
  }
})

test('two plates of the same base ingredient ARE the same dish to a reader', () => {
  // Both of these were asserted as NOT-matching until 2026-09-02, on the reasoning that they are
  // "genuinely different meals that happen to share a base ingredient". Logan looked at a feed
  // holding them and called it repetitive, so the judgement was wrong at the level that matters.
  //
  // The second pair is an honest FALSE POSITIVE and is kept here on purpose: a savory egg bowl and
  // a sweet pineapple bowl really are different meals, and the 0.6 ratio collapses them anyway.
  // It cannot be separated by token overlap — it shares exactly 3 of 5 with the shorter title, the
  // same as every true positive above it, so no threshold on NAMES can keep one and drop the other.
  // Fixing it needs ingredients, which generated_meals now stores. Until then this errs toward
  // collapsing, which is the right direction: a false positive costs one candidate out of five
  // generated for three slots (and the ranking keeps repeats as reserves if the pool runs thin),
  // while a false negative costs the user a feed that feels stale — the actual complaint.
  const SAME_NOW: Array<[string, string]> = [
    ['Cottage Cheese and Veggie Power Plate', 'Cottage Cheese and Egg Savory Plate'],
    ['Savory Cottage Cheese and Egg Breakfast Bowl', 'Cottage Cheese and Pineapple Protein Bowl'],
  ]
  for (const [a, b] of SAME_NOW) {
    assert.ok(isSameDish(a, b), `should match: "${a}" vs "${b}"`)
    assert.ok(isSameDish(b, a), 'must be symmetric')
  }
})

test('genuinely different meals sharing a base ingredient are NOT collapsed', () => {
  // The guard against over-collapsing. Every pair here survives the looser 0.6 ratio, which is what
  // makes that ratio the edge rather than an arbitrary number — 0.5 starts eating this list.
  const DIFFERENT: Array<[string, string]> = [
    ['Savory Cottage Cheese and Egg Scramble', 'Savory Scrambled Egg and Potato Hash'],
    ['Chocolate Protein Smoothie', 'Greek Yogurt and Protein Power Bowl'],
    ['Ground Beef and Salsa Taco Bowl', 'Herb-Roasted Chicken Salad with Potatoes'],
    ['Thai Peanut Sauce Chicken Rice Bowl', 'Ground Beef and Salsa Taco Bowl'],
    ['Mediterranean Greek Yogurt and Granola Bowl', 'Protein-Packed Greek Yogurt Parfait'],
  ]
  for (const [a, b] of DIFFERENT) {
    assert.ok(!isSameDish(a, b), `should NOT match: "${a}" vs "${b}"`)
  }
})

test('a short title cannot match on one shared word', () => {
  assert.ok(!isSameDish('Chocolate Protein Smoothie', 'Chocolate Oat Bowl'))
  assert.ok(isSameDish('Chocolate Protein Smoothie', 'Chocolate Protein Shake'))
})

test('empty and junk names never match anything', () => {
  for (const junk of ['', '   ', null, undefined, '!!!']) {
    assert.ok(!isSameDish(junk, 'Thai Peanut Sauce Rice Bowl'))
    assert.ok(!matchesRecentDish(junk, REMEMBERED))
  }
})

test('all three meals shown on 2026-08-29 match something older in the same memory', () => {
  // The finding that prompted this work: the user reported seeing the same meals as the day
  // before, and every one of the three had a near-duplicate already remembered.
  const shownToday = REMEMBERED.slice(0, 3)
  const older = REMEMBERED.slice(3)
  for (const meal of shownToday) {
    assert.ok(matchesRecentDish(meal, older), `"${meal}" should have been caught as a repeat`)
  }
})

test('matchesRecentDish would have rejected the whole batch', () => {
  // Under the OLD exact-key check, zero of the 18 were repeats. Under the new one, the memory
  // collapses to a much smaller set of genuinely distinct dishes.
  const distinct: string[] = []
  for (const name of REMEMBERED) if (!matchesRecentDish(name, distinct)) distinct.push(name)
  assert.ok(distinct.length < REMEMBERED.length, 'must collapse the reworded variants')
  assert.ok(distinct.length >= 8, `collapsed too hard: ${distinct.length} left of 18`)
  console.log(`  18 remembered names -> ${distinct.length} genuinely distinct dishes:`)
  for (const d of distinct) console.log(`    ${d}`)
})

test('clusterDishes collapses a window of reworded names to one per real dish', () => {
  // Verbatim from Logan's live 30-name window on 2026-09-02. Seven names, one cottage cheese bowl.
  const WINDOW = [
    'Cottage Cheese and Herb Potato Bowl',
    'Cottage Cheese and Fruit Power Bowl',
    'Savory Cottage Cheese and Egg Breakfast Bowl',
    'Cottage Cheese and Veggie Power Plate',
    'Cottage Cheese and Pineapple Protein Bowl',
    'Vanilla Berry Protein Yogurt Bowl',
    'Greek Yogurt Protein Power Bowl',
    'Mediterranean Greek Yogurt and Granola Bowl',
    'Thai Peanut Sauce Chicken Rice Bowl',
    'Ground Beef and Salsa Taco Bowl',
  ]
  const reps = clusterDishes(WINDOW)
  // 10 names -> 6. Deliberately compares each name against the REPRESENTATIVES kept so far, not
  // against every member of a cluster. Transitive grouping would give 4 here and 14 on the full
  // live window, but it chains: A~B and B~C collapses A into C even when A and C are unrelated.
  // Keeping more entries is the safe error — this exists to remember MORE real dishes, and a
  // wrongly-merged pair silently forgets one.
  assert.equal(reps.length, 6, `expected 6 distinct dishes, got ${reps.length}: ${reps.join(' | ')}`)
  assert.equal(reps[0], 'Cottage Cheese and Herb Potato Bowl') // newest of its cluster represents it
  assert.ok(reps.includes('Ground Beef and Salsa Taco Bowl'))
  // The point of the exercise: five cottage-cheese/yogurt restatements became two entries.
  assert.ok(reps.length < WINDOW.length)
})

test('clusterDishes drops junk and keeps order', () => {
  assert.deepEqual(clusterDishes(['', null, undefined, '!!!', 'Beef Tacos']), ['Beef Tacos'])
  assert.deepEqual(clusterDishes([]), [])
})

test('ingredientSignature ignores the things every dish contains', () => {
  const sig = ingredientSignature([
    { name: 'Salt' }, { name: 'olive oil' }, { name: 'Water' },
    { name: 'high-protein greek yogurt' }, { name: 'Chicken Breast' },
  ])
  assert.ok(!sig.has('salt') && !sig.has('olive oil') && !sig.has('water'))
  // Head-noun only, so a qualified name and its plain form are one ingredient.
  assert.ok(sig.has('greek yogurt'), [...sig].join(','))
  assert.ok(sig.has('chicken breast'))
})

test('ingredients can overrule a false-positive name match, and only in that direction', () => {
  const savoryEgg = {
    name: 'Savory Cottage Cheese and Egg Breakfast Bowl',
    ingredients: [{ name: 'cottage cheese' }, { name: 'eggs' }, { name: 'spinach' }, { name: 'chives' }],
  }
  const sweetPineapple = {
    name: 'Cottage Cheese and Pineapple Protein Bowl',
    ingredients: [{ name: 'cottage cheese' }, { name: 'pineapple' }, { name: 'honey' }, { name: 'granola' }],
  }
  // Names alone call these the same dish — the known false positive.
  assert.ok(isSameDish(savoryEgg.name, sweetPineapple.name))
  // The food says otherwise, and the food wins.
  assert.ok(!isSameDishDetailed(savoryEgg, sweetPineapple))

  // Same food AND same name stays a repeat.
  const savoryEggAgain = {
    name: 'Cottage Cheese and Egg Savory Plate',
    ingredients: [{ name: 'cottage cheese' }, { name: 'eggs' }, { name: 'spinach' }],
  }
  assert.ok(isSameDishDetailed(savoryEgg, savoryEggAgain))

  // Ingredients NEVER create a match that the name did not already make.
  assert.ok(!isSameDishDetailed(
    { name: 'Ground Beef and Salsa Taco Bowl', ingredients: [{ name: 'cottage cheese' }, { name: 'eggs' }] },
    savoryEgg,
  ))
})

test('no ingredient data means the name decides, exactly as before', () => {
  const a = { name: 'Egg White and Vegetable Scramble with Toast' }
  const b = { name: 'Egg White and Vegetable Scramble with Potatoes' }
  assert.equal(isSameDishDetailed(a, b), isSameDish(a.name, b.name))
  assert.ok(isSameDishDetailed(a, b))
})

test('detectBases matches longest-first so a specific base does not also count as a generic one', () => {
  const b = detectBases('Cottage Cheese and Herb Potato Bowl')
  assert.ok(b.has('cottage cheese'))
  assert.ok(!b.has('cheese'), 'cottage cheese must not also register as plain cheese')
  assert.ok(b.has('potato'))

  const e = detectBases('Egg White and Vegetable Scramble')
  assert.ok(e.has('egg white'))
  assert.ok(!e.has('egg'), 'egg white must not also register as plain egg')

  const g = detectBases('Mediterranean Greek Yogurt and Granola Bowl')
  assert.ok(g.has('greek yogurt') && !g.has('yogurt'))
})

test('detectBases reads the ingredient list too, not just the title', () => {
  // "Jello" says nothing; its ingredients do.
  const b = detectBases('Protein Pudding', [{ name: 'Non-Fat Plain Greek Yogurt' }, { name: 'protein powder' }])
  assert.ok(b.has('greek yogurt'))
  assert.ok(b.has('protein powder'))
})

test('overusedBases finds the real offenders in a real history, and stays quiet without one', () => {
  // Logan's live window, 2026-09-02. Cottage cheese and potato each ran ~27% of the last 15 meals.
  const HISTORY = [
    'Cottage Cheese and Herb Potato Bowl', 'Vanilla Berry Protein Yogurt Bowl',
    'Egg White and Vegetable Scramble', 'Chicken Salad and Roasted Potato Plate',
    'Creamy Cottage Cheese and Spinach Scramble', 'Greek Yogurt Protein Power Bowl',
    'Pesto Cauliflower and Egg White Frittata', 'Thai Peanut Sauce Chicken Rice Bowl',
    'Pesto Scrambled Eggs with Potatoes', 'Classic Beef Bolognese with Pasta',
    'Scrambled Egg and Cheese Breakfast Burrito Bowl', 'Cottage Cheese and Fruit Power Bowl',
    'Garlic Herb Chicken and Roasted Potatoes', 'Mediterranean Greek Yogurt and Granola Bowl',
    'Savory Cottage Cheese and Egg Scramble',
  ].map(name => ({ name }))
  assert.deepEqual(overusedBases(HISTORY), ['cottage cheese', 'potato'])

  // Never bans on thin history — a new user must not have their pantry restricted on 3 meals.
  assert.deepEqual(overusedBases([]), [])
  assert.deepEqual(overusedBases(HISTORY.slice(0, 3)), [])
})

test('overusedBases never bans more than topK, so a modest pantry keeps something to cook', () => {
  const ALL_COTTAGE = Array.from({ length: 15 }, () => ({ name: 'Cottage Cheese Egg Potato Rice Bowl' }))
  assert.equal(overusedBases(ALL_COTTAGE).length, 2)
  assert.equal(overusedBases(ALL_COTTAGE, { topK: 1 }).length, 1)
})

test('a different protein makes a different dish, whatever the titles share', () => {
  // From a real generation, 2026-09-02. These share thai/rice/bowl — 3 of 5, enough to pass the
  // ratio — but every shared word is STRUCTURAL and the protein is not. Flagging the beef bowl as
  // a repeat sorted a genuinely new dish to the back of the generation, penalising exactly the
  // variety the base ban had just produced.
  assert.ok(!isSameDish('Thai Basil Beef Rice Bowl', 'Thai Peanut Sauce Chicken Rice Bowl'))
  assert.ok(!isSameDish('Ground Beef and Salsa Taco Bowl', 'Herb-Roasted Chicken Salad with Potatoes'))
})

test('protein variants are one family, so a rewording still reads as a repeat', () => {
  // The guard must not become a new way to smuggle repeats through. greek yogurt/yogurt and
  // egg white/egg are the same protein, so these stay matched.
  assert.ok(isSameDish('Vanilla Berry Protein Yogurt Bowl', 'Greek Yogurt Protein Power Bowl'))
  assert.ok(isSameDish('Egg White and Vegetable Scramble with Toast', 'Egg White and Vegetable Scramble with Potatoes'))
  assert.ok(isSameDish('Chicken Salad and Roasted Potato Plate', 'Herb-Roasted Chicken Salad with Potatoes'))
  assert.deepEqual([...proteinFamilies('Greek Yogurt Bowl')], ['yogurt'])
  assert.deepEqual([...proteinFamilies('Egg White Scramble')], ['egg'])
  assert.deepEqual([...proteinFamilies('Ground Beef Tacos')], ['beef'])
})

test('carbs are the setting, not the subject — they never make two dishes different', () => {
  // rice/potato/pasta are excluded from the family map on purpose: sharing a starch says nothing,
  // and treating it as identity would call every rice bowl the same meal.
  assert.equal(proteinFamilies('Roasted Potato and Rice Plate').size, 0)
  // With no protein named on either side the guard stands aside and the token rule decides.
  assert.ok(isSameDish('Chocolate Protein Smoothie', 'Chocolate Protein Shake'))
})
