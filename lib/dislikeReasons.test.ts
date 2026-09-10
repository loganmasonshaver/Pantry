import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DISLIKE_REASONS, suppressesDish, culpritCandidates, FLAVOUR_ISSUES } from './dislikeReasons.ts'

test('a wrong photo and a broken recipe do NOT delete the dish', () => {
  // The defect this whole table exists to fix: every thumbs-down used to feed the prompt's
  // "do NOT suggest these or anything similar" line, so reporting a bad image killed the recipe.
  assert.equal(suppressesDish('photo_mismatch'), false)
  assert.equal(suppressesDish('recipe_wrong'), false)
  assert.equal(suppressesDish('macros_fit'), false)
})

test('the two reasons that are about the dish itself suppress it', () => {
  assert.equal(suppressesDish('too_often'), true)
  assert.equal(suppressesDish('taste'), true)
})

test('a rating with no reason still suppresses — every row stored before the sheet has none', () => {
  assert.equal(suppressesDish(null), true)
  assert.equal(suppressesDish(undefined), true)
  assert.equal(suppressesDish(''), true)
})

test('an unrecognised reason does NOT suppress, so a client bug cannot silently ban dishes', () => {
  assert.equal(suppressesDish('not_a_reason'), false)
})

test('exactly two of the five reasons suppress, and they are the two about the food', () => {
  // Locks the routing table itself: flipping a flag here changes what a tap does to a user's
  // future meals, and nothing else in the app would notice.
  assert.deepEqual(
    DISLIKE_REASONS.filter(r => r.suppress).map(r => r.key),
    ['too_often', 'taste'],
  )
  assert.equal(DISLIKE_REASONS.length, 5)
})

// ── culprit chips + flavour row ────────────────────────────────────────────────────────────────

test('Beef Pasta Skillet: pasta water and spray oil are not culprit candidates', () => {
  const names = ['onion', 'bell pepper', 'garlic', 'passata', 'cream cheese', 'pasta water', 'lean ground beef', 'pasta', 'spray oil']
  assert.deepEqual(culpritCandidates(names), ['onion', 'bell pepper', 'garlic', 'passata', 'cream cheese', 'lean ground beef', 'pasta'])
})

test('neutral staples go; anything with a taste someone could object to stays', () => {
  assert.deepEqual(culpritCandidates(['water', 'ice cubes', 'salt', 'olive oil', 'cooking spray', 'baking powder', 'salt & pepper']), [])
  assert.deepEqual(culpritCandidates(['black pepper', 'coconut water', 'sesame oil', 'garlic salt']), ['black pepper', 'coconut water', 'sesame oil', 'garlic salt'])
})

test('duplicates and blanks collapse', () => {
  assert.deepEqual(culpritCandidates(['Onion', 'onion ', '', 'dill']), ['Onion', 'dill'])
})

test('the flavour row is the four keys the database CHECKs', () => {
  assert.deepEqual(FLAVOUR_ISSUES.map(f => f.key), ['too_bland', 'too_spicy', 'too_sweet', 'texture_off'])
})
