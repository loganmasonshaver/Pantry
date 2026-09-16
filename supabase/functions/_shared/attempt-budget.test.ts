import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WALL_BUDGET_MS, MIN_ATTEMPT_MS, llmLoopEndMs, decideAttempt, pickProvider, countDelta, addCounts, nextAttemptOrder, chunkOrder,
} from './attempt-budget.ts'

test('the loop end moves earlier as survivors grow, and never lets the tail estimate run past the wall', () => {
  assert.equal(llmLoopEndMs(0), 117_000)
  assert.equal(llmLoopEndMs(3), 114_000)
  assert.equal(llmLoopEndMs(11), 106_000)
  assert.ok(llmLoopEndMs(3) < llmLoopEndMs(0))
  // The recipe ceiling stops the reserve growing without bound.
  assert.equal(llmLoopEndMs(40), llmLoopEndMs(22))
  assert.ok(llmLoopEndMs(40) > 0 && llmLoopEndMs(40) < WALL_BUDGET_MS)
})

test('the Sep 16 cron shape gets a third attempt: 3 survivors at 50 s with ~22 s attempts', () => {
  const d = decideAttempt(2, 50_000, 3, [22_000, 18_000])
  assert.equal(d.start, true)
  assert.equal(d.expectedMs, 27_500) // 1.25x the slowest so far
  // And its call is clamped to the loop end, not the old 85 s.
  assert.equal(d.callTimeoutMs, 64_000)
})

test('the Sep 16 real run shape (10 survivors at 73 s, attempts of 27.6 and 36.1 s) does NOT start a third', () => {
  // 73 s + 1.25 x 36.1 s = 118 s, past the 107 s loop end for 10 survivors. The old estimate would
  // have started it and hit the clamp at 39 s with nothing to show.
  const d = decideAttempt(2, 72_990, 10, [27_593, 36_056])
  assert.equal(d.start, false)
})

test('a fast-model day (17 s attempts, Sep 13) keeps getting attempts deep into the run', () => {
  assert.equal(decideAttempt(3, 60_000, 6, [17_000, 17_000, 17_000]).start, true)
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

test('nextAttemptOrder leaves out kept and dead videos, keeps every other one, and rotates per attempt', () => {
  const terminal = new Set([1, 3, 7])           // video_index values, 1-based
  const a1 = nextAttemptOrder(8, terminal, 1, 5)
  assert.deepEqual([...a1].sort(), [1, 3, 4, 5, 7])   // positions 0,2,6 are gone
  const a2 = nextAttemptOrder(8, terminal, 2, 5)
  assert.deepEqual([...a2].sort(), [...a1].sort())
  assert.notEqual(a1[0], a2[0])                        // a different video leads
  assert.deepEqual(nextAttemptOrder(3, new Set([1, 2, 3]), 1, 5), [])
  assert.deepEqual(nextAttemptOrder(4, new Set(), 0, 5), [0, 1, 2, 3])
})

test('chunkOrder: balanced shards, capped concurrency, off means one call', () => {
  const ids = Array.from({ length: 25 }, (_, i) => i)
  assert.deepEqual(chunkOrder(ids, 6).map(s => s.length), [5, 5, 5, 5, 5])
  assert.deepEqual(chunkOrder(ids, 3).map(s => s.length), [5, 5, 5, 5, 5])   // capped at 5 calls, size grows
  assert.deepEqual(chunkOrder(ids.slice(0, 7), 6).map(s => s.length), [4, 3])
  assert.deepEqual(chunkOrder(ids, 0), [ids])
  assert.deepEqual(chunkOrder([], 6), [])
  assert.deepEqual(chunkOrder(ids, 6).flat(), ids)                           // nothing lost, order kept
})
