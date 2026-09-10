import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareCandidates, isSubstantial, selectDeck, type Candidate } from './rank-deck.ts'

// Cook Tonight run 48 (2026-09-10 18:03), from pipeline_runs.rankCandidates: tier, repeat and fit are
// the recorded values. Slots were recorded only for the three shown; the other seven are read off
// their names (the funnel did not store them then — it does now).
const RUN_48: Candidate[] = [
  { name: 'Thai Basil Chicken Rice Bowl', slot: 'dinner', _tier: 0, _repeat: true, _fitScore: 0.05 },
  { name: 'Beef and Salsa Taco Bowl', slot: 'dinner', _tier: 0, _repeat: true, _fitScore: 0.264 },
  { name: 'Greek Yogurt and Granola Parfait', slot: 'breakfast', _tier: 0, _repeat: true, _fitScore: 0.016 },
  { name: 'Egg and Vegetable Scramble', slot: 'breakfast', _tier: 0, _repeat: false, _fitScore: 0.26 },
  { name: 'Cottage Cheese and Rice Bowl', slot: 'any', _tier: 0, _repeat: false, _fitScore: 0.283 },
  { name: 'Chicken and Cauliflower Rice Skillet', slot: 'dinner', _tier: 0, _repeat: true, _fitScore: 0.142 },
  { name: 'Beef and Vegetable Stir-Fry', slot: 'dinner', _tier: 0, _repeat: true, _fitScore: 0.05 },
  { name: 'Greek Yogurt and Protein Cereal Bowl', slot: 'breakfast', _tier: 0, _repeat: true, _fitScore: 0.091 },
  { name: 'Egg and Cheese Breakfast Wrap', slot: 'breakfast', _tier: 1, _repeat: false, _fitScore: 0.769 },
  { name: 'Chicken and Pesto Rice Plate', slot: 'dinner', _tier: 0, _repeat: true, _fitScore: 0.038 },
]
const names = (d: Candidate[]) => d.map(m => String(m.name))

test('run 48 replayed: the under-floor wrap is out and a dinner is in', () => {
  const { deck, promoted } = selectDeck(RUN_48, 3)
  assert.ok(!names(deck).includes('Egg and Cheese Breakfast Wrap'), '24g tier-1 dish no longer beats tier-0 repeats')
  assert.ok(deck.some(isSubstantial), 'at least one lunch/dinner')
  assert.ok(deck.some(m => !isSubstantial(m)), 'at least one lighter meal')
  assert.deepEqual(promoted, ['Chicken and Pesto Rice Plate'], 'the best-fitting dinner, even though it is a repeat')
  assert.deepEqual(names(deck), ['Egg and Vegetable Scramble', 'Cottage Cheese and Rice Bowl', 'Chicken and Pesto Rice Plate'])
})

test('tier outranks freshness, freshness outranks fit', () => {
  const freshLow = { name: 'a', _tier: 1, _repeat: false, _fitScore: 0 }
  const repeatOk = { name: 'b', _tier: 0, _repeat: true, _fitScore: 0.9 }
  const freshOk = { name: 'c', _tier: 0, _repeat: false, _fitScore: 0.9 }
  assert.ok(compareCandidates(repeatOk, freshLow) < 0)
  assert.ok(compareCandidates(freshOk, repeatOk) < 0)
})

test('a clash sorts last and is never promoted to fill a slot', () => {
  const deck = selectDeck([
    { name: 'Greek Yogurt Parfait', slot: 'breakfast', _tier: 0 },
    { name: 'Protein Pancakes', slot: 'breakfast', _tier: 0 },
    { name: 'Overnight Oats', slot: 'breakfast', _tier: 0 },
    { name: 'Protein-Fortified Creamy Rice Soup', slot: 'lunch', _tier: 0, _clash: true },
  ], 3)
  assert.ok(!names(deck.deck).includes('Protein-Fortified Creamy Rice Soup'))
  assert.deepEqual(deck.promoted, [])
})

test('coverage works in both directions', () => {
  const { deck, promoted } = selectDeck([
    { name: 'Chicken Rice Bowl', slot: 'dinner', _fitScore: 0.1 },
    { name: 'Beef Stir-Fry', slot: 'dinner', _fitScore: 0.2 },
    { name: 'Pesto Chicken Plate', slot: 'lunch', _fitScore: 0.3 },
    { name: 'Greek Yogurt Parfait', slot: 'breakfast', _fitScore: 0.9 },
  ], 3)
  assert.deepEqual(promoted, ['Greek Yogurt Parfait'])
  assert.equal(deck.filter(isSubstantial).length, 2)
})

test('a deck that already covers both is exactly the top n', () => {
  const pool = RUN_48.map(m => ({ ...m, _repeat: false }))
  const { deck, promoted } = selectDeck(pool, 3)
  assert.deepEqual(promoted, [])
  assert.deepEqual(names(deck), names([...pool].sort(compareCandidates).slice(0, 3)))
})

test('a breakfast name outranks a loose lunch tag', () => {
  assert.equal(isSubstantial({ name: 'Cottage Cheese and Pineapple Protein Bowl', slot: 'lunch' }), true)
  assert.equal(isSubstantial({ name: 'Egg White Scramble with Salsa and Plantain Chips', slot: 'lunch' }), false)
  assert.equal(isSubstantial({ name: 'Egg and Cheese Breakfast Wrap', slot: 'dinner' }), false)
  assert.equal(isSubstantial({ name: 'Chicken Ranch Salad Plate', slot: 'lunch' }), true)
  assert.equal(isSubstantial({ name: 'Cottage Cheese and Rice Bowl', slot: 'any' }), false)
})

test('nothing to patch with leaves the deck alone', () => {
  const allBreakfast = RUN_48.filter(m => m.slot === 'breakfast')
  const { deck, promoted } = selectDeck(allBreakfast, 3)
  assert.equal(deck.length, 3)
  assert.deepEqual(promoted, [])
})
