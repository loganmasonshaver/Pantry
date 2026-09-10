import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewToday, NEW_WINDOW_HOURS, interleaveNewToday, newTodayReach } from './discoverFreshness.ts'

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

test('new recipes ALTERNATE with older ones instead of stacking at the top', () => {
  assert.deepEqual(interleaveNewToday(shelf, NOW).map(m => m.id), ['a', 'b', 'c', 'd', 'e'])
})

test('a batch of four new recipes no longer leads the shelf together', () => {
  const batch = [
    { id: 'n1', created_at: FRESH }, { id: 'n2', created_at: FRESH }, { id: 'n3', created_at: FRESH }, { id: 'n4', created_at: FRESH },
    { id: 'o1', created_at: OLD }, { id: 'o2', created_at: OLD }, { id: 'o3', created_at: OLD }, { id: 'o4', created_at: OLD },
  ]
  assert.deepEqual(interleaveNewToday(batch, NOW).map(m => m.id), ['o1', 'n1', 'o2', 'n2', 'o3', 'n3', 'o4', 'n4'])
})

test('both halves keep claim()\'s order; surplus of either side trails in order', () => {
  const more = [...shelf, { id: 'f', created_at: FRESH }, { id: 'g', created_at: FRESH }, { id: 'h', created_at: FRESH }]
  // old a,c,e and new b,d,f,g,h: a b c d e f, then g h.
  assert.deepEqual(interleaveNewToday(more, NOW).map(m => m.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
})

test('a shelf with nothing new, or only new, is untouched', () => {
  const allOld = shelf.filter(m => m.created_at === OLD)
  assert.deepEqual(interleaveNewToday(allOld, NOW), allOld)
  const allNew = shelf.filter(m => m.created_at === FRESH)
  assert.deepEqual(interleaveNewToday(allNew, NOW), allNew)
})

test('newTodayReach is how far the page must open so no new recipe is behind "Show more"', () => {
  assert.equal(newTodayReach(interleaveNewToday(shelf, NOW), NOW), 4) // d sits at index 3
  assert.equal(newTodayReach([{ created_at: OLD }], NOW), 0)
  assert.equal(newTodayReach([], NOW), 0)
})
