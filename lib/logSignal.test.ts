import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loggedRecently, markLogged, RECENT_LOG_MS } from './logSignal.ts'

test('nothing logged yet is never "recent" — a cold start refetch must not tick', () => {
  assert.equal(loggedRecently(Date.parse('2026-09-15T12:00:00Z')), false)
})

test('a log counts as recent inside the window and not after it', () => {
  const t = Date.parse('2026-09-15T12:00:00Z')
  markLogged(t)
  assert.equal(loggedRecently(t + 1_000), true)
  assert.equal(loggedRecently(t + RECENT_LOG_MS - 1), true)
  assert.equal(loggedRecently(t + RECENT_LOG_MS), false)
})
