import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WALL_BUDGET_MS, MIN_ATTEMPT_MS, llmLoopEndMs, decideAttempt, pickProvider, countDelta, addCounts,
} from './attempt-budget.ts'

test('the loop end moves earlier as survivors grow, and never lets the tail estimate run past the wall', () => {
  assert.equal(llmLoopEndMs(0), 105_000)
  assert.equal(llmLoopEndMs(3), 97_500)
  assert.equal(llmLoopEndMs(11), 77_500)
  assert.ok(llmLoopEndMs(3) < llmLoopEndMs(0))
  // The recipe ceiling stops the reserve growing without bound.
  assert.equal(llmLoopEndMs(40), llmLoopEndMs(22))
  assert.ok(llmLoopEndMs(40) > 0 && llmLoopEndMs(40) < WALL_BUDGET_MS)
})

test('the Sep 16 run shape now gets a third attempt: 3 survivors at 50 s with ~22 s attempts', () => {
  const d = decideAttempt(2, 50_000, 3, [22_000, 18_000])
  assert.equal(d.start, true)
  assert.equal(d.expectedMs, 22_000)
  // And its call is clamped to the loop end, not the old 85 s.
  assert.equal(d.callTimeoutMs, 47_500)
})

test('a slow model day still stops: one 50 s attempt, 10 survivors at 55 s', () => {
  const d = decideAttempt(1, 55_000, 10, [50_000])
  assert.equal(d.start, false)
})

test('the first attempt always starts, and the unmeasured estimate is the floor', () => {
  const d = decideAttempt(0, 200_000, 0, [])
  assert.equal(d.start, true)
  assert.equal(d.expectedMs, MIN_ATTEMPT_MS)
  // Past the loop end, the call still gets the floor rather than an instant abort.
  assert.equal(d.callTimeoutMs, 15_000)
})

test('a started later attempt can never be clamped below the time it was expected to take', () => {
  for (let elapsed = 0; elapsed < 120_000; elapsed += 1_000) {
    for (const survivors of [0, 3, 8, 11]) {
      const d = decideAttempt(1, elapsed, survivors, [30_000])
      if (d.start) assert.ok(d.callTimeoutMs >= d.expectedMs || d.callTimeoutMs === 90_000)
    }
  }
})

test('the call timeout is capped at 90 s on an early first attempt', () => {
  assert.equal(decideAttempt(0, 5_000, 0, []).callTimeoutMs, 90_000)
})

test('OpenAI gets a slot only right after a primary attempt that returned nothing', () => {
  assert.equal(pickProvider('Google', 'OpenAI', false), 'Google')
  assert.equal(pickProvider('Google', 'OpenAI', true), 'OpenAI')
  // A forced single provider has no fallback and keeps every slot.
  assert.equal(pickProvider('OpenAI', null, true), 'OpenAI')
})

test('countDelta keeps only the reasons that fired this attempt', () => {
  const before = { noMacros: 0, nearDup: 3, dropped: 1, nameGap: 2 }
  const after = { noMacros: 3, nearDup: 4, dropped: 1, nameGap: 2 }
  assert.deepEqual(countDelta(after, before), { noMacros: 3, nearDup: 1 })
})

test('addCounts keeps the full key shape, zeros included', () => {
  const keys = ['noMacros', 'nearDup', 'dropped']
  assert.deepEqual(addCounts({}, { nearDup: 3 }, keys), { noMacros: 0, nearDup: 3, dropped: 0 })
  assert.deepEqual(addCounts({ noMacros: 1, nearDup: 3, dropped: 0 }, { noMacros: 2 }, keys), { noMacros: 3, nearDup: 3, dropped: 0 })
})
