import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickFatSecretMatch, wantsRawMatch } from './fatsecret-match.ts'

const r = (food_name: string, food_type = 'Generic', food_description = '') => ({ food_id: food_name, food_name, food_type, food_description })

test('a raw protein takes the raw entry over the cooked top hit', () => {
  const results = [r('Ground Beef (Cooked)'), r('Ground Beef (85% Lean / 15% Fat)'), r('Raw Ground Beef', 'Brand'), r('Ground Beef (Raw)')]
  assert.equal(pickFatSecretMatch('ground beef', results)?.food_name, 'Ground Beef (Raw)')
  // No entry says raw: the first without a cooked-state word wins.
  assert.equal(pickFatSecretMatch('chicken breast', [r('Roasted Chicken Breast'), r('Chicken Breast (Skin Not Eaten, Cooked)'), r('Chicken Breast')])?.food_name, 'Chicken Breast')
  // Generic beats brand at equal rank.
  assert.equal(pickFatSecretMatch('salmon', [r('Atlantic Salmon', 'Brand'), r('Salmon (Raw)', 'Brand'), r('Salmon (Raw)')])?.food_name, 'Salmon (Raw)')
  assert.equal(pickFatSecretMatch('salmon', [r('Atlantic Salmon', 'Brand'), r('Salmon (Raw)', 'Brand'), r('Salmon (Raw)')])?.food_type, 'Generic')
})

test('an ingredient that names its cooked state keeps the top hit', () => {
  for (const n of ['cooked chicken', 'rotisserie chicken', 'canned tuna', 'bacon', 'chicken salad', 'chicken broth', 'shredded chicken'])
    assert.equal(wantsRawMatch(n), false, n)
  assert.equal(pickFatSecretMatch('rotisserie chicken', [r('Rotisserie Chicken (Cooked)'), r('Chicken (Raw)')])?.food_name, 'Rotisserie Chicken (Cooked)')
  // Not a protein at all: top hit, untouched.
  assert.equal(pickFatSecretMatch('cooked rice', [r('Cooked Rice'), r('Rice (Raw)')])?.food_name, 'Cooked Rice')
  assert.equal(pickFatSecretMatch('lime', [r('Limes')])?.food_name, 'Limes')
})

test('every result that lacks an id is ignored, and an empty list is null', () => {
  assert.equal(pickFatSecretMatch('beef', []), null)
  assert.equal(pickFatSecretMatch('beef', [{ food_name: 'Beef' }, r('Beef (Raw)')])?.food_name, 'Beef (Raw)')
})
