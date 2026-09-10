import { test } from 'node:test'
import assert from 'node:assert'
import { isAssumedStaple, stapleKey } from '../constants/staples.ts'

// The bug: a creator's "32 fl oz water (COLD)" parses to "cold water", which missed the exact
// match on `water`, so Protein Jello asked the user to buy 64 fl oz of water in two grocery rows.
test('state-qualified staples are still assumed', () => {
  for (const n of ['cold water', 'boiling water', 'hot water', 'warm water', 'ice water',
                   'tap water', 'filtered water', 'room temperature water', 'chilled water']) {
    assert.equal(isAssumedStaple(n), true, n)
  }
  assert.equal(isAssumedStaple('water'), true)
  assert.equal(isAssumedStaple('cold butter'), true)   // butter is already a staple
})

// The whole reason the match is exact: "bell pepper" must never resolve to the basic "pepper".
// Stripping state words cannot reintroduce that, because the result must still hit the alias set.
test('stripping state words does not turn real foods into staples', () => {
  for (const n of ['ice cream', 'iced tea', 'hot chocolate', 'hot sauce', 'cold brew',
                   'boiled egg', 'boiled eggs', 'warm milk', 'bell pepper', 'red pepper',
                   'frozen berries', 'fresh basil leaves']) {
    assert.equal(isAssumedStaple(n), false, n)
  }
})

test('a name that is only a state word does not collapse to empty', () => {
  // "" would compare equal across unrelated ingredients — fall back to the normalized name.
  assert.equal(stapleKey('ice'), 'ice')
  // Ice itself IS a staple now — an explicit alias, not a product of stripping. generate-meals has
  // assumed "ice cubes" since 2026-09-07; this list was never synced and still said false, which is
  // how a smoothie kept reading "Better with: ice cubes".
  assert.equal(isAssumedStaple('ice'), true)
})

test('an opt-out on any variant suppresses every variant', () => {
  const excluded = new Set([stapleKey('cold water')])   // what excludeStaple now persists
  assert.equal(stapleKey('cold water'), 'water')
  assert.equal(isAssumedStaple('boiling water', excluded), false)
  assert.equal(isAssumedStaple('water', excluded), false)
  assert.equal(isAssumedStaple('cold water', excluded), false)
})

test('ice is an assumed staple in every form a recipe writes it — and rice is not', () => {
  assert.equal(isAssumedStaple('ice cubes'), true)
  assert.equal(isAssumedStaple('ice'), true)
  assert.equal(isAssumedStaple('Ice Cube'), true)
  assert.equal(isAssumedStaple('crushed ice'), true)
  assert.equal(isAssumedStaple('rice'), false)
  assert.equal(isAssumedStaple('iced coffee'), false)
})
