import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeLike } from './sqlLike.ts'

test('REGRESSION: a percent sign in a food name is a literal, not a wildcard', () => {
  // These are the names that actually broke it — percent signs are everywhere in dairy aisles.
  assert.equal(escapeLike('2% Milk'), '2\\% Milk')
  assert.equal(escapeLike('0% Greek Yogurt'), '0\\% Greek Yogurt')
  assert.equal(escapeLike('100% Whole Wheat Bread'), '100\\% Whole Wheat Bread')
})

test('underscores are escaped too', () => {
  assert.equal(escapeLike('cooked_rice'), 'cooked\\_rice')
})

test('backslash is escaped FIRST so the added escapes are not re-escaped', () => {
  assert.equal(escapeLike('a\\b'), 'a\\\\b')
  // A backslash already in front of a percent must not accidentally form a valid escape.
  assert.equal(escapeLike('50\\%'), '50\\\\\\%')
})

test('ordinary names are unchanged', () => {
  for (const n of ['Chicken Breast', 'Greek Yogurt', 'Extra-Virgin Olive Oil', 'Salt & Pepper', '']) {
    assert.equal(escapeLike(n), n)
  }
})

test('a name that is nothing but wildcards cannot match everything', () => {
  assert.equal(escapeLike('%'), '\\%')
  assert.equal(escapeLike('%%'), '\\%\\%')
})
