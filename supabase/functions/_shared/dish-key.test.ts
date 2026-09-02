// Run: node --test supabase/functions/_shared/dish-key.test.ts
//
// REMEMBERED is the real contents of profiles.recent_meal_names for Logan's account on
// 2026-08-29, read straight out of production. It is the regression bar for this file: every one
// of those 18 names produced a DISTINCT dishKey, so the repeat filter never fired once, and the
// user was served the same handful of dishes under reworded titles for days.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dishKey, isSameDish, matchesRecentDish } from './dish-key.ts'

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
