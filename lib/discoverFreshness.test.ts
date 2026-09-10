import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewToday, NEW_WINDOW_HOURS } from './discoverFreshness.ts'

const HOUR = 3_600_000
const NOW = Date.parse('2026-09-11T02:00:00Z') // 9pm US Central on Sep 10 — the evening case

test('a recipe added this morning is new', () => {
  assert.equal(isNewToday('2026-09-10T08:05:00Z', NOW), true)
})

test('still new in the evening, after the UTC date has rolled over — the bug this replaces', () => {
  // The old shelf compared generated_at to the CURRENT UTC date. At 9pm Central that is already
  // Sep 11 UTC, and a recipe from the 3am Central (08:00 UTC Sep 10) run no longer matched.
  assert.equal(isNewToday('2026-09-10T08:05:00Z', NOW), true)
})

test('the window is 24 hours and its edge is inclusive', () => {
  assert.equal(NEW_WINDOW_HOURS, 24)
  assert.equal(isNewToday(new Date(NOW - 24 * HOUR).toISOString(), NOW), true)
  assert.equal(isNewToday(new Date(NOW - 24 * HOUR - 1000).toISOString(), NOW), false)
})

test('yesterday is not new', () => {
  assert.equal(isNewToday('2026-09-09T08:05:00Z', NOW), false)
})

test('missing, unparseable and future timestamps are never new', () => {
  assert.equal(isNewToday(null, NOW), false)
  assert.equal(isNewToday(undefined, NOW), false)
  assert.equal(isNewToday('', NOW), false)
  assert.equal(isNewToday('not a date', NOW), false)
  assert.equal(isNewToday(new Date(NOW + HOUR).toISOString(), NOW), false)
})
