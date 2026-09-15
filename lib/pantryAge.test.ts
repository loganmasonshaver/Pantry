import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ageLabel, ageLabelLong, daysSince, isPerishable, isStale, STALE_AFTER_DAYS } from './pantryAge.ts'

const NOW = Date.parse('2026-09-15T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

test('age labels: today, days, weeks, months', () => {
  assert.equal(ageLabel(ago(0), NOW), 'today')
  assert.equal(ageLabel(ago(0.5), NOW), 'today')
  assert.equal(ageLabel(ago(2), NOW), '2d')
  assert.equal(ageLabel(ago(6), NOW), '6d')
  assert.equal(ageLabel(ago(7), NOW), '1w')
  assert.equal(ageLabel(ago(35), NOW), '5w')
  assert.equal(ageLabel(ago(60), NOW), '2mo')
  assert.equal(ageLabel(ago(100), NOW), '3mo')
})

test('long labels read as a sentence, pluralise, and bucket exactly like the short form', () => {
  assert.equal(ageLabelLong(ago(0), NOW), 'today')
  assert.equal(ageLabelLong(ago(1), NOW), '1 day ago')
  assert.equal(ageLabelLong(ago(2), NOW), '2 days ago')
  assert.equal(ageLabelLong(ago(7), NOW), '1 week ago')
  assert.equal(ageLabelLong(ago(49), NOW), '7 weeks ago')
  assert.equal(ageLabelLong(ago(60), NOW), '2 months ago')
  assert.equal(ageLabelLong(ago(100), NOW), '3 months ago')
  assert.equal(ageLabelLong(undefined, NOW), 'today')
  assert.equal(ageLabelLong(ago(-3), NOW), 'today')
})

test('stale is 21+ days AND still in stock; out-of-stock items are never nagged about', () => {
  assert.equal(STALE_AFTER_DAYS, 21)
  assert.equal(isStale(ago(20), true, NOW), false)
  assert.equal(isStale(ago(21), true, NOW), true)
  assert.equal(isStale(ago(90), false, NOW), false)
})

test('only perishable aisles are ever asked about; staples and frozen are not', () => {
  for (const c of ['Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery']) assert.equal(isPerishable(c), true, c)
  for (const c of ['Spices & Seasonings', 'Canned & Jarred', 'Oils & Vinegars', 'Grains & Pasta', 'Frozen', 'Other', '']) {
    assert.equal(isPerishable(c), false, c || '(empty)')
  }
})

test('a missing or unparseable date reads as fresh, never as stale', () => {
  assert.equal(daysSince(null, NOW), 0)
  assert.equal(daysSince('garbage', NOW), 0)
  assert.equal(isStale(undefined, true, NOW), false)
  assert.equal(ageLabel(undefined, NOW), 'today')
})

test('a future timestamp clamps to today rather than going negative', () => {
  assert.equal(ageLabel(ago(-3), NOW), 'today')
})
