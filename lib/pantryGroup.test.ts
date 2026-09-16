import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupPantryRows, type PantryRow } from './pantryGroup.ts'

const ORDER = ['Meat & Fish', 'Produce', 'Dairy & Eggs'] as const
const row = (id: string, name: string, category: string | null, in_stock = true, extra: Partial<PantryRow> = {}): PantryRow =>
  ({ id, name, category, in_stock, created_at: '2026-08-01T00:00:00Z', ...extra })

test('aisles come back in the given order, and an unknown category lands after them', () => {
  const out = groupPantryRows([
    row('1', 'Pineapple', 'Produce'),
    row('2', 'Ground Beef', 'Meat & Fish'),
    row('3', 'Cat Food', 'Pet'),
    row('4', 'Eggs', 'Dairy & Eggs'),
  ], ORDER)
  assert.deepEqual(out.map(c => c.name), ['Meat & Fish', 'Produce', 'Dairy & Eggs', 'Pet'])
})

test('an empty aisle is omitted, not rendered as a heading with nothing under it', () => {
  const out = groupPantryRows([row('1', 'Pineapple', 'Produce')], ORDER)
  assert.deepEqual(out.map(c => c.name), ['Produce'])
})

test('out-of-stock rows sink to the bottom of their aisle, in-stock order preserved', () => {
  const out = groupPantryRows([
    row('1', 'Chicken Salad', 'Meat & Fish', false),
    row('2', 'Ground Beef', 'Meat & Fish'),
    row('3', 'Chicken', 'Meat & Fish'),
  ], ORDER)
  assert.deepEqual(out[0].ingredients.map(i => i.name), ['Ground Beef', 'Chicken', 'Chicken Salad'])
})

test('a null category is Other, and never silently dropped', () => {
  const out = groupPantryRows([row('1', 'Mystery', null)], ORDER)
  assert.equal(out[0].name, 'Other')
  assert.equal(out[0].ingredients[0].name, 'Mystery')
})

test('since prefers last_confirmed_at and falls back to created_at', () => {
  const out = groupPantryRows([
    row('1', 'Garlic', 'Produce', true, { last_confirmed_at: '2026-09-01T00:00:00Z' }),
    row('2', 'Lime', 'Produce', true, { last_confirmed_at: null }),
  ], ORDER)
  assert.equal(out[0].ingredients[0].since, '2026-09-01T00:00:00Z')
  assert.equal(out[0].ingredients[1].since, '2026-08-01T00:00:00Z')
})
