import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewToday, NEW_WINDOW_HOURS, newTodayFirst, countNewToday } from './discoverFreshness.ts'

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

// ── new first within a shelf ────────────────────────────────────────────────────────────────────
const FRESH = '2026-09-10T18:00:00Z'
const OLD = '2026-09-01T08:00:00Z'
const shelf = [
  { id: 'a', created_at: OLD }, { id: 'b', created_at: FRESH }, { id: 'c', created_at: OLD },
  { id: 'd', created_at: FRESH }, { id: 'e', created_at: OLD },
]

test('new recipes lead the shelf so none sit behind "Show more"', () => {
  assert.deepEqual(newTodayFirst(shelf, NOW).map(m => m.id), ['b', 'd', 'a', 'c', 'e'])
})

test('the partition is STABLE — both halves keep claim()\'s order', () => {
  // b before d, and a, c, e in their original order: the dish-form spread survives.
  const out = newTodayFirst(shelf, NOW).map(m => m.id)
  assert.ok(out.indexOf('b') < out.indexOf('d'))
  assert.deepEqual(out.slice(2), ['a', 'c', 'e'])
})

test('a shelf with nothing new, or only new, is untouched', () => {
  const allOld = shelf.filter(m => m.created_at === OLD)
  assert.deepEqual(newTodayFirst(allOld, NOW), allOld)
  const allNew = shelf.filter(m => m.created_at === FRESH)
  assert.deepEqual(newTodayFirst(allNew, NOW), allNew)
})

test('countNewToday counts only the window', () => {
  assert.equal(countNewToday(shelf, NOW), 2)
  assert.equal(countNewToday([], NOW), 0)
})
