import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingIngredients, structuralMissing } from './mealReadiness.ts'

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
