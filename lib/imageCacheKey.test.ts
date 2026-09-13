import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageCacheKey } from './imageCacheKey.ts'

test('same name, different mains, different phone-cache keys', () => {
  const a = imageCacheKey('Egg White and Vegetable Scramble', ['liquid egg whites', 'yellow potatoes', 'cauliflower', 'shredded cheese'])
  const b = imageCacheKey('Egg White and Vegetable Scramble', ['liquid egg whites', 'leafy greens', 'yellow onion', 'butter'])
  assert.notEqual(a, b)
  assert.ok(a.startsWith('Egg White and Vegetable Scramble|'))
})

test('staples and counts do not change the key; no ingredients keeps the bare name', () => {
  assert.equal(imageCacheKey('Omelette', ['3 eggs', 'salt', 'black pepper', 'butter', 'cheese']), imageCacheKey('Omelette', ['cheese', 'eggs']))
  assert.equal(imageCacheKey('Omelette'), 'Omelette')
  assert.equal(imageCacheKey('Omelette', ['salt', 'olive oil']), 'Omelette')
})
