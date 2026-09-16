import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revealGoalLine } from './revealLine.ts'

const three = [
  { calories: 560, protein: 49 },
  { calories: 622, protein: 48 },
  { calories: 550, protein: 51 },
]

test('lose: calorie cap and protein floor, cut tail', () => {
  assert.equal(revealGoalLine(three, 'lose'), 'Each one is under 630 calories with at least 48 g of protein — built for your cut.')
})

test('gain: protein first, bulk tail', () => {
  assert.equal(revealGoalLine(three, 'gain'), 'Each one brings at least 48 g of protein — built for your bulk.')
})

test('maintain: both numbers, recomp tail', () => {
  assert.equal(revealGoalLine(three, 'maintain'), 'Each one is under 630 calories with at least 48 g of protein — built for your recomp.')
})

test('no goal: the sentence reads whole without a tail', () => {
  assert.equal(revealGoalLine(three, null), 'Each one is under 630 calories with at least 48 g of protein.')
  assert.equal(revealGoalLine(three, 'build'), 'Each one is under 630 calories with at least 48 g of protein.') // unknown value = no tail
})

test('an exact round ten still reads "under" the next ten', () => {
  assert.equal(revealGoalLine([{ calories: 620, protein: 40 }, { calories: 500, protein: 45 }], null), 'Each one is under 630 calories with at least 40 g of protein.')
})

test('one meal uses "It"', () => {
  assert.equal(revealGoalLine([{ calories: 505, protein: 32 }], 'lose'), 'It is under 510 calories with at least 32 g of protein — built for your cut.')
})

test('missing protein drops that clause; gain falls back to calories', () => {
  const noProt = [{ calories: 560, protein: 0 }, { calories: 600, protein: null }]
  assert.equal(revealGoalLine(noProt, 'lose'), 'Each one is under 610 calories — built for your cut.')
  assert.equal(revealGoalLine(noProt, 'gain'), 'Each one is under 610 calories — built for your bulk.')
})

test('missing calories keeps the protein clause', () => {
  assert.equal(revealGoalLine([{ calories: 0, protein: 30 }, { calories: null, protein: 35 }], null), 'Each one brings at least 30 g of protein.')
})

test('nothing usable → empty string, and no meals → empty string', () => {
  assert.equal(revealGoalLine([{ calories: 0, protein: 0 }], 'lose'), '')
  assert.equal(revealGoalLine([], 'lose'), '')
})
