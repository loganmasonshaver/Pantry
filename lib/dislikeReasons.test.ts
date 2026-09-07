import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DISLIKE_REASONS, suppressesDish } from './dislikeReasons.ts'

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
