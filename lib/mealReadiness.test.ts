import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingIngredients, structuralMissing, isOptionalGap, neededMissing } from './mealReadiness.ts'

const pantry = new Set(['chicken breast', 'rice', 'cheddar cheese', 'onion'])
const none = new Set<string>()

test('two-way substring: pantry "chicken breast" covers meal "chicken", and the reverse', () => {
  assert.deepEqual(missingIngredients([{ name: 'chicken' }], pantry, none), [])
  assert.deepEqual(missingIngredients([{ name: 'cheese' }], pantry, none), [])
  assert.deepEqual(missingIngredients([{ name: 'red onion' }], pantry, none), [])
})

test('assumed staples never count as missing, unless the user excluded one', () => {
  assert.deepEqual(missingIngredients([{ name: 'salt' }, { name: 'olive oil' }], pantry, none), [])
  assert.deepEqual(missingIngredients([{ name: 'butter' }], pantry, new Set(['butter'])), ['butter'])
})

test('a real gap is reported with the creator wording, in recipe order', () => {
  const out = missingIngredients([{ name: 'chicken' }, { name: 'Greek yogurt' }, { name: 'rice' }, { name: 'cilantro' }], pantry, none)
  assert.deepEqual(out, ['Greek yogurt', 'cilantro'])
})

test('structural list from the server wins over the full ingredient list', () => {
  const meal = { ingredients: [{ name: 'chicken' }, { name: 'cilantro' }], structural_missing: [] as string[] }
  // Server says nothing structural is missing; the garnish gap is not a store trip.
  assert.deepEqual(structuralMissing(meal, pantry, none), [])
  // Server-named structural gaps are still re-checked against the live pantry.
  assert.deepEqual(structuralMissing({ ...meal, structural_missing: ['chicken', 'tortillas'] }, pantry, none), ['tortillas'])
})

test('a meal cached before the split falls back to any gap', () => {
  const meal = { ingredients: [{ name: 'chicken' }, { name: 'cilantro' }] }
  assert.deepEqual(structuralMissing(meal, pantry, none), ['cilantro'])
})

test('no ingredients means nothing missing, not a crash', () => {
  assert.deepEqual(missingIngredients(undefined, pantry, none), [])
  assert.deepEqual(structuralMissing({}, pantry, none), [])
})

test('a server-listed garnish is optional; the match is exact and case-insensitive', () => {
  const meal = { garnish_missing: ['Fresh lime juice', 'cilantro'] }
  assert.equal(isOptionalGap('fresh lime juice', meal), true)
  assert.equal(isOptionalGap(' Cilantro ', meal), true)
  // Not a substring match: "lime" is not the listed "fresh lime juice", so it stays needed.
  assert.equal(isOptionalGap('lime', meal), false)
  assert.equal(isOptionalGap('', meal), false)
})

test('no garnish list means nothing is optional (meals cached before the split)', () => {
  assert.equal(isOptionalGap('cilantro', {}), false)
  assert.equal(isOptionalGap('cilantro', { garnish_missing: 'cilantro' }), false)
})

test('needed = every live gap except the listed garnishes, including ones the server never saw', () => {
  const meal = {
    ingredients: [{ name: 'chicken' }, { name: 'tortillas' }, { name: 'fresh lime juice' }, { name: 'sour cream' }],
    garnish_missing: ['fresh lime juice'],
  }
  // sour cream is in neither server list (it ran out after generation) — needed, not hidden.
  assert.deepEqual(neededMissing(meal, pantry, none), ['tortillas', 'sour cream'])
  // Everything missing is a garnish → nothing needed → Ready to cook.
  assert.deepEqual(neededMissing({ ingredients: [{ name: 'rice' }, { name: 'fresh lime juice' }], garnish_missing: ['fresh lime juice'] }, pantry, none), [])
})
