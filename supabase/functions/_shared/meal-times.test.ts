import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseTimes, TIME_RULES } from './meal-times.ts'

test('a correctly split answer passes through untouched', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 10, cookTime: 0, restTime: 960 }), { prepTime: 10, cookTime: 0, restTime: 960 })
})

test('a freeze filed as prep is MOVED into rest, not thrown away — the dish still takes a day', () => {
  // Brownie Batter Protein Ice Cream was stored as prep_time 1020.
  assert.deepEqual(normaliseTimes({ prepTime: 1020, cookTime: 0, restTime: 0 }), { prepTime: 0, cookTime: 0, restTime: 1020 })
})

test('a wait mis-filed as cook time is moved the same way', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 10, cookTime: 480, restTime: 0 }), { prepTime: 10, cookTime: 0, restTime: 480 })
})

test('an ordinary long active time is left alone', () => {
  // A 3-hour braid or a slow braise is real work time, well under the slip threshold.
  assert.deepEqual(normaliseTimes({ prepTime: 45, cookTime: 180, restTime: 0 }), { prepTime: 45, cookTime: 180, restTime: 0 })
})

test('junk becomes zero, never NaN and never negative', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 'soon', cookTime: -5, restTime: null }), { prepTime: 0, cookTime: 0, restTime: 0 })
  assert.deepEqual(normaliseTimes({}), { prepTime: 0, cookTime: 0, restTime: 0 })
})

test('rest is capped so a unit slip cannot claim a week', () => {
  assert.equal(normaliseTimes({ prepTime: 10, restTime: 99999 }).restTime, 4320)
})

test('the rules name both failure directions seen in the live pool', () => {
  assert.ok(TIME_RULES.includes('NEVER fold a freeze'))
  assert.ok(TIME_RULES.includes('NEVER drop it'))
  // Storage notes were the main false positive when keyword matching was measured against the pool.
  assert.ok(TIME_RULES.includes('storage and reheating notes'))
})

test('the rules forbid a zero for a mandatory step the creator did not time', () => {
  // Measured on the dry run: "bake until golden brown" came back cookTime 0 and "cool and chill
  // before serving" restTime 0, while an optional "or freeze 5 more minutes" correctly came back 0.
  assert.ok(TIME_RULES.includes('MANDATORY step with NO stated duration'))
  assert.ok(TIME_RULES.includes('OPTIONAL one'))
})
