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

const DAY = 86_400_000
const bigShelf = [
  ...Array.from({ length: 4 }, (_, k) => ({ id: `n${k}`, created_at: FRESH })),
  ...Array.from({ length: 10 }, (_, k) => ({ id: `o${k}`, created_at: OLD })),
]

test('every new recipe lands inside the first page — none behind "Show more"', () => {
  // 4 new -> a window of max(6, 8) = 8 slots.
  const out = interleaveNewToday(bigShelf, NOW)
  assert.ok(newTodayReach(out, NOW) <= 8)
  assert.equal(out.length, bigShelf.length)
})

test('both halves keep claim()\'s order — only the positions are random', () => {
  const out = interleaveNewToday(bigShelf, NOW).map(m => m.id)
  assert.deepEqual(out.filter(id => id.startsWith('n')), ['n0', 'n1', 'n2', 'n3'])
  assert.deepEqual(out.filter(id => id.startsWith('o')), bigShelf.filter(m => m.id.startsWith('o')).map(m => m.id))
})

test('stable all day — the page must not reshuffle on every open', () => {
  assert.deepEqual(interleaveNewToday(bigShelf, NOW), interleaveNewToday(bigShelf, NOW + 60_000))
})

test('a different day gives a different arrangement', () => {
  const positions = (now: number) => interleaveNewToday(bigShelf, now).map((m, k) => m.id.startsWith('n') ? k : -1).filter(k => k >= 0)
  // Recipes stay "new" for 24h, so compare two days with the SAME recipes marked new.
  const later = bigShelf.map(m => m.created_at === FRESH ? { ...m, created_at: new Date(NOW + DAY - 3_600_000).toISOString() } : m)
  const posLater = interleaveNewToday(later, NOW + DAY).map((m, k) => m.id.startsWith('n') ? k : -1).filter(k => k >= 0)
  assert.notDeepEqual(positions(NOW), posLater)
})

test('a shelf with nothing new, or only new, is untouched', () => {
  const allOld = shelf.filter(m => m.created_at === OLD)
  assert.deepEqual(interleaveNewToday(allOld, NOW), allOld)
  const allNew = shelf.filter(m => m.created_at === FRESH)
  assert.deepEqual(interleaveNewToday(allNew, NOW), allNew)
})

test('newTodayReach is how far the page must open so no new recipe is behind "Show more"', () => {
  assert.ok(newTodayReach(interleaveNewToday(shelf, NOW), NOW) <= 5)
  assert.equal(newTodayReach([{ created_at: OLD }], NOW), 0)
  assert.equal(newTodayReach([], NOW), 0)
})

test('the arrangement really varies day to day — the first hash collapsed into one fixed block', () => {
  // With h*31+c the new recipes sat at slots 0-2 or 3-5 every day, i.e. stacked. Sample a week.
  const seen = new Set<string>()
  for (let d = 0; d < 8; d++) {
    const now = NOW + d * DAY
    const fresh = new Date(now - 3_600_000).toISOString()
    const s = [...[0, 1, 2].map(k => ({ id: `n${k}-${d}`, created_at: fresh })), ...Array.from({ length: 9 }, (_, k) => ({ id: `o${k}`, created_at: OLD }))]
    seen.add(interleaveNewToday(s, now).map((m, k) => m.id.startsWith('n') ? k : -1).filter(k => k >= 0).join(','))
  }
  assert.ok(seen.size >= 5, `only ${seen.size} distinct arrangements in 8 days`)
})
