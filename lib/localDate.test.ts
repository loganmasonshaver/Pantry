import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todayStr } from './localDate.ts'

test('formats a local calendar date as YYYY-MM-DD', () => {
  assert.equal(todayStr(new Date(2026, 7, 29, 13, 0, 0)), '2026-08-29')
})

test('pads single-digit months and days', () => {
  assert.equal(todayStr(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05')
  assert.equal(todayStr(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31')
})

test('REGRESSION: late evening still reports the LOCAL day, not the UTC one', () => {
  // 8pm local. In any timezone behind UTC this instant is already tomorrow in UTC, which is what
  // made a freshly-written onboarding cache miss on the very next read.
  const lateEvening = new Date(2026, 7, 29, 20, 30, 0)
  assert.equal(todayStr(lateEvening), '2026-08-29')
  // Pin the contrast explicitly so the difference is visible if anyone reverts to toISOString.
  if (lateEvening.getTimezoneOffset() > 0) {
    assert.notEqual(todayStr(lateEvening), lateEvening.toISOString().slice(0, 10))
  }
})

test('REGRESSION: just after local midnight still reports the LOCAL day', () => {
  const justAfterMidnight = new Date(2026, 7, 30, 0, 15, 0)
  assert.equal(todayStr(justAfterMidnight), '2026-08-30')
})

test('a local date never disagrees with its own calendar fields', () => {
  // Walk a full year of local noons — the format must track the local calendar exactly.
  for (let i = 0; i < 365; i++) {
    const d = new Date(2026, 0, 1 + i, 12, 0, 0)
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    assert.equal(todayStr(d), expected)
  }
})
