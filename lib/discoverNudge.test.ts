import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverNudge, DISCOVER_NUDGE_AFTER } from './discoverNudge.ts'

const CAP = 6

test('the automatic first generation and one refresh never nudge', () => {
  assert.equal(discoverNudge(0, CAP), 'none')
  assert.equal(discoverNudge(1, CAP), 'none')
  assert.equal(discoverNudge(2, CAP), 'none')
})

test('the second deliberate refresh is where the nudge starts', () => {
  assert.equal(DISCOVER_NUDGE_AFTER, 3)
  assert.equal(discoverNudge(3, CAP), 'redo')
  assert.equal(discoverNudge(5, CAP), 'redo')
})

test('at the cap Discover stops being a suggestion and becomes the action', () => {
  assert.equal(discoverNudge(6, CAP), 'capped')
  // Over the cap is possible — a second device, a race on the server count.
  assert.equal(discoverNudge(9, CAP), 'capped')
})

test('an unknown count never nags — a failed read must not accuse anyone of spamming', () => {
  assert.equal(discoverNudge(null, CAP), 'none')
  assert.equal(discoverNudge(Number.NaN, CAP), 'none')
})

test('a cap at or below the threshold still reads as capped, not as a mild suggestion', () => {
  assert.equal(discoverNudge(3, 3), 'capped')
  assert.equal(discoverNudge(2, 2), 'capped')
})
