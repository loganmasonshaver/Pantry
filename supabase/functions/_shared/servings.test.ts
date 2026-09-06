import { test } from 'node:test'
import assert from 'node:assert/strict'
import { servingsForPortion, toPerServing, BATCH_RECIPE_KCAL, MAX_SERVINGS } from './servings.ts'

// The real profiles this shipped against, read from prod on 2026-09-05. The point of pinning them
// is that 16 of 18 must return 1: the feature has to be inert for everyone it was not built for.
const LIVE_PROFILES: [meals: number, goal: number, expected: number][] = [
  [6, 1000, 3],
  [6, 2761, 2],
  [6, 3900, 1],
  [5, 2706, 1],
  [5, 3074, 1],
  [4, 2100, 1],
  [3, 1708, 1],
  [3, 2000, 1],
  [3, 2761, 1],
]

test('servings for every live profile shape', () => {
  for (const [meals, goal, expected] of LIVE_PROFILES) {
    const portion = Math.round(goal / meals)
    assert.equal(servingsForPortion(portion), expected, `${meals} meals @ ${goal} kcal (${portion}/portion)`)
  }
})

test('the trigger is a portion under ~467 kcal', () => {
  assert.equal(servingsForPortion(467), 1)
  assert.equal(servingsForPortion(466), 2)
})

test('never exceeds MAX_SERVINGS however small the portion', () => {
  assert.equal(servingsForPortion(1), MAX_SERVINGS)
  assert.equal(servingsForPortion(BATCH_RECIPE_KCAL / 100), MAX_SERVINGS)
})

// A missing calorie_goal must degrade to today's behaviour, not to a 3-serving batch — 700/0 is
// Infinity and a naive clamp would return MAX_SERVINGS for the user with the least information.
test('missing or nonsense portion degrades to 1 serving', () => {
  assert.equal(servingsForPortion(0), 1)
  assert.equal(servingsForPortion(-500), 1)
  assert.equal(servingsForPortion(NaN), 1)
  assert.equal(servingsForPortion(undefined as unknown as number), 1)
})

const BATCH = { calories: 920, protein: 74, carbs: 88, fat: 30, name: 'Chicken Burrito Bowl' }

test('toPerServing divides macros and leaves everything else alone', () => {
  const out = toPerServing(BATCH, 2)
  assert.equal(out.calories, 460)
  assert.equal(out.protein, 37)
  assert.equal(out.carbs, 44)
  assert.equal(out.fat, 15)
  assert.equal(out.servings, 2)
  assert.equal(out.name, 'Chicken Burrito Bowl')
})

// The double-count this module exists to prevent: a single serving must be a pure no-op on the
// numbers, because that is the path 16 of 18 profiles take.
test('one serving changes no macro', () => {
  const out = toPerServing(BATCH, 1)
  assert.equal(out.calories, BATCH.calories)
  assert.equal(out.protein, BATCH.protein)
  assert.equal(out.servings, 1)
})

test('an invalid servings count never multiplies or divides', () => {
  for (const bad of [0, -2, NaN, undefined as unknown as number]) {
    const out = toPerServing(BATCH, bad)
    assert.equal(out.calories, BATCH.calories)
    assert.equal(out.servings, 1)
  }
})

// Round-trip: what the user logs, times the servings, must be recoverable as the batch the
// ingredients describe. Rounding may cost a couple of kcal; it may never cost a factor.
test('portion times servings reconstructs the batch within rounding', () => {
  for (const n of [1, 2, 3]) {
    const out = toPerServing(BATCH, n)
    assert.ok(Math.abs(out.calories * n - BATCH.calories) <= n, `servings=${n}`)
    assert.ok(Math.abs(out.protein * n - BATCH.protein) <= n, `servings=${n}`)
  }
})
