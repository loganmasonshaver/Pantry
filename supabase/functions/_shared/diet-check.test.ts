import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dietViolations, normaliseRestriction } from './diet-check.ts'

const meal = (...names: string[]) => ({ ingredients: names.map(name => ({ name })) })
const kinds = (v: ReturnType<typeof dietViolations>) => v.map(x => x.restriction).sort()

// Every one of these was served by the live generator during the 2026-09-12 sweep.
test('the sweep violations are caught', () => {
  assert.deepEqual(kinds(dietViolations(meal('ground turkey', 'broccoli', 'soy sauce'), ['gluten-free'])), ['gluten-free'])
  assert.deepEqual(kinds(dietViolations(meal('eggs', 'spinach', 'feta', 'butter'), ['dairy-free'])), ['dairy-free'])
  assert.deepEqual(kinds(dietViolations(meal('eggs', 'spinach', 'sourdough bread'), ['gluten-free'])), ['gluten-free'])
  assert.deepEqual(kinds(dietViolations(meal('greek yogurt', 'pecans', 'honey'), ['nut-free'])), ['nut-free'])
})

test('the diet styles the app can store', () => {
  assert.deepEqual(kinds(dietViolations(meal('chicken breast', 'rice'), ['Vegetarian'])), ['vegetarian'])
  assert.deepEqual(kinds(dietViolations(meal('salmon', 'rice'), ['Vegetarian'])), ['vegetarian'])
  assert.deepEqual(kinds(dietViolations(meal('salmon', 'rice'), ['Pescatarian'])), [], 'fish is the point of pescatarian')
  assert.deepEqual(kinds(dietViolations(meal('chicken thighs', 'rice'), ['Pescatarian'])), ['pescatarian'])
  assert.deepEqual(kinds(dietViolations(meal('tofu', 'greek yogurt'), ['Vegan'])), ['vegan'])
  assert.deepEqual(kinds(dietViolations(meal('tofu', 'oat milk', 'nutritional yeast'), ['Vegan'])), [])
})

// A false positive here costs a dinner, so the allowed lists carry real weight.
test('plant milks, nut butters and gluten-free swaps are not violations', () => {
  assert.deepEqual(dietViolations(meal('oat milk', 'coconut cream', 'vegan cheese', 'peanut butter'), ['dairy-free']), [])
  assert.deepEqual(dietViolations(meal('tamari', 'rice noodles', 'corn tortillas', 'gluten-free pasta'), ['gluten-free']), [])
  assert.deepEqual(dietViolations(meal('rolled oats', 'quinoa', 'buckwheat'), ['gluten-free']), [], 'oats are naturally gluten-free')
  assert.deepEqual(dietViolations(meal('nutmeg', 'nutritional yeast', 'butternut squash', 'coconut milk'), ['nut-free']), [])
  assert.deepEqual(dietViolations(meal('salmon', 'rice'), ['shellfish-free']), [], 'fish is not shellfish')
  assert.deepEqual(kinds(dietViolations(meal('shrimp', 'rice'), ['Shellfish-free'])), ['shellfish-free'])
})

test('labels are normalised, and an unknown one binds nothing', () => {
  assert.equal(normaliseRestriction('Dairy-free'), 'dairy-free')
  assert.equal(normaliseRestriction('no dairy'), 'dairy-free')
  assert.equal(normaliseRestriction('Gluten Free'), 'gluten-free')
  assert.equal(normaliseRestriction('Vegetarian'), 'vegetarian')
  assert.equal(normaliseRestriction('None'), null)
  assert.equal(normaliseRestriction('Classic'), null)
  assert.equal(normaliseRestriction('paleo'), null, 'the app cannot store it and a guessed rule is worse than none')
  assert.deepEqual(dietViolations(meal('chicken', 'bread'), ['paleo', 'None']), [])
})

test('several restrictions at once, each reported with what broke it', () => {
  const v = dietViolations(meal('chicken', 'soy sauce', 'butter', 'cashews'), ['gluten-free', 'dairy-free', 'nut-free'])
  assert.deepEqual(kinds(v), ['dairy-free', 'gluten-free', 'nut-free'])
  assert.deepEqual(v.find(x => x.restriction === 'nut-free')?.ingredients, ['cashews'])
})

test('bad input is not a violation', () => {
  assert.deepEqual(dietViolations(undefined, ['vegan']), [])
  assert.deepEqual(dietViolations(meal('chicken'), []), [])
})
