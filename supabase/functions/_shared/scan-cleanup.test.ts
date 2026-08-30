import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanupResult, confScore, isNonFood, canonicalName, normName } from './scan-cleanup.ts'

const FLOOR = 30
const zone = (names: string[]) => ({ zones: [{ zone: 'fridge', items: names.map(n => ({ name: n })) }] })
const namesAfterCleanup = (names: string[]) => {
  const r: any = zone(names)
  cleanupResult(r, FLOOR)
  return (r.zones[0]?.items ?? []).map((i: any) => i.name)
}

// ── REGRESSION: a parenthetical used to smuggle dishware past the exact set ────────────────────
// The model is prompted to disambiguate with parentheticals ("Hot Sauce (Red Cap)"), so most names
// arrive carrying one. isNonFood ran on the RAW name while NONFOOD_EXACT holds canonical forms.
test('REGRESSION: dishware is dropped even when the model adds a qualifier', () => {
  assert.deepEqual(namesAfterCleanup(['Plate (white ceramic)']), [])
  assert.deepEqual(namesAfterCleanup(['Bowl (blue)']), [])
  assert.deepEqual(namesAfterCleanup(['Plastic Container (empty)']), [])
  assert.deepEqual(namesAfterCleanup(['Mugs (2)']), [])
  assert.deepEqual(namesAfterCleanup(['Aluminum Foil (roll)']), [])
})

test('a qualifier on real food is stripped, not dropped', () => {
  assert.deepEqual(namesAfterCleanup(['Hot Sauce (Red Cap)']), ['Hot Sauce'])
  assert.deepEqual(namesAfterCleanup(['Non-Fat Greek Yogurt (large tub)']), ['Non-Fat Greek Yogurt'])
})

// ── REGRESSION: 'cotton' as a bare substring ate real food ────────────────────────────────────
test('REGRESSION: cotton candy and cottonseed oil are food', () => {
  assert.equal(isNonFood('Cotton Candy'), false)
  assert.equal(isNonFood('Cottonseed Oil'), false)
  assert.equal(isNonFood('Cotton Candy Grapes'), false)
  // ...while the products the rule was aimed at still go.
  assert.equal(isNonFood('Cotton Balls'), true)
  assert.equal(isNonFood('Cotton Swabs'), true)
  assert.equal(isNonFood('Cotton Pads'), true)
})

// ── REGRESSION: 'q-tip' could never match its own normalized input ────────────────────────────
test('REGRESSION: Q-Tips is caught — normName turns the hyphen into a space', () => {
  assert.equal(normName('Q-Tips'), 'q tips')
  assert.equal(isNonFood('Q-Tips'), true)
  assert.equal(isNonFood('Q Tip Box'), true)
})

// ── The substring list must not eat real food ─────────────────────────────────────────────────
// Every NONFOOD_CONTAINS entry has to be specific enough that no food contains it. Pin the foods
// that a lazier list would have swallowed.
test('foods that a substring blocklist would wrongly swallow survive', () => {
  for (const food of [
    'Pot Roast', 'Cup Noodles', 'Glass Noodles', 'Sponge Cake', 'Panko Breadcrumbs',
    'Pan Seared Salmon', 'Hot Pot Broth', 'Cupcakes', 'Bowl of Rice', 'Trail Mix',
    'Cotton Candy', 'Dog Fish', 'Catfish', 'Cat Fish Fillet', 'Panettone',
  ]) {
    assert.equal(isNonFood(food), false, `"${food}" is food and must not be dropped`)
  }
})

test('genuine non-food is still dropped', () => {
  for (const junk of [
    'Plate', 'Plates', 'Dinner Plate', 'Bowl', 'Mug', 'Skillet', 'Spatula', 'Aluminum Foil',
    'Batteries', 'Cookbook', 'Dish Soap', 'Paper Towels', 'Dog Food', 'Cat Treats', 'Kibble',
    'Toothpaste', 'Shampoo', 'Plastic Wrap', 'Tissues', 'Nail Polish', 'Cutting Board',
  ]) {
    assert.equal(isNonFood(junk), true, `"${junk}" is not food and must be dropped`)
  }
})

// ── canonicalName ─────────────────────────────────────────────────────────────────────────────
test('canonicalName strips parentheticals and leaves everything else alone', () => {
  assert.equal(canonicalName('Hot Sauce (Red Cap)'), 'Hot Sauce')
  assert.equal(canonicalName('Milk (2%) (half gallon)'), 'Milk')
  assert.equal(canonicalName('Greek Yogurt'), 'Greek Yogurt')
  assert.equal(canonicalName('(unlabeled)'), '')
})

test('a name that is nothing but a qualifier is dropped, not kept as an empty item', () => {
  assert.deepEqual(namesAfterCleanup(['(unlabeled jar)']), [])
})

// ── dedupe + floor ────────────────────────────────────────────────────────────────────────────
test('dupes collapse across the whole result once canonicalized', () => {
  assert.deepEqual(namesAfterCleanup(['Milk (2%)', 'Milk', 'MILK']), ['Milk'])
})

test('items below the confidence floor are dropped, and unscored items are kept', () => {
  const r: any = { zones: [{ zone: 'fridge', items: [
    { name: 'Eggs', confidence: 95 },
    { name: 'Kimchi', confidence: 12 },
    { name: 'Tofu' }, // unscored → treated as fully confident
    { name: 'Miso', confidence: 'low' },
    { name: 'Natto', confidence: 'high' },
  ] }] }
  cleanupResult(r, FLOOR)
  assert.deepEqual(r.zones[0].items.map((i: any) => i.name), ['Eggs', 'Tofu', 'Miso', 'Natto'])
})

test('confScore normalizes the legacy string forms', () => {
  assert.equal(confScore(42), 42)
  assert.equal(confScore('low'), 30)
  assert.equal(confScore('high'), 90)
  assert.equal(confScore(undefined), 100)
  assert.equal(confScore(NaN), 100)
})

test('a zone left with no items is removed entirely', () => {
  const r: any = { zones: [
    { zone: 'fridge', items: [{ name: 'Plate (chipped)' }] },
    { zone: 'pantry', items: [{ name: 'Rice' }] },
  ] }
  cleanupResult(r, FLOOR)
  assert.deepEqual(r.zones.map((z: any) => z.zone), ['pantry'])
})

test('malformed items never crash the cleanup', () => {
  const r: any = { zones: [{ zone: 'fridge', items: [null, {}, { name: 42 }, { name: 'Rice' }] }] }
  cleanupResult(r, FLOOR)
  assert.deepEqual(r.zones[0].items.map((i: any) => i.name), ['Rice'])
})

test('a result with no zones is handled', () => {
  const r: any = {}
  cleanupResult(r, FLOOR)
  assert.deepEqual(r.zones, [])
})
