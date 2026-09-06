import { test } from 'node:test'
import assert from 'node:assert'
import { slotsForMealsPerDay, DEFAULT_SLOT_LABELS, slotId } from './mealSlots.ts'

test('counts map to ordered, day-shaped plans', () => {
  assert.deepEqual(slotsForMealsPerDay(3), ['Breakfast', 'Lunch', 'Dinner'])
  assert.deepEqual(slotsForMealsPerDay(4), ['Breakfast', 'Lunch', 'Dinner', 'Snack'])
  // 5 and 6 interleave snacks INTO the day rather than appending them, so the log reads in the
  // order the eating happens.
  assert.deepEqual(slotsForMealsPerDay(5),
    ['Breakfast', 'Morning snack', 'Lunch', 'Dinner', 'Evening snack'])
  assert.deepEqual(slotsForMealsPerDay(6),
    ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner', 'Evening snack'])
})

// The bug this guards: two slots sharing a name collapse to one slotId AND write the same `slot`
// string on every log row, so they can never be separated again. An earlier draft had "Lunch"
// twice at n=5.
test('no plan ever repeats a name, case-insensitively', () => {
  for (let n = 1; n <= 10; n++) {
    const labels = slotsForMealsPerDay(n)
    const lower = labels.map(l => l.toLowerCase())
    assert.equal(new Set(lower).size, labels.length, `n=${n} has a duplicate: ${labels.join(', ')}`)
    assert.equal(new Set(labels.map(slotId)).size, labels.length, `n=${n} has a slotId collision`)
  }
})

test('counts past six are numbered rather than left nameless', () => {
  const eight = slotsForMealsPerDay(8)
  assert.equal(eight.length, 8)
  assert.deepEqual(eight.slice(6), ['Snack #4', 'Snack #5'])
})

// meals_per_day is a free numeric field in Profile — a typo must not produce an empty day.
test('junk counts fall back instead of producing an empty or absurd day', () => {
  assert.deepEqual(slotsForMealsPerDay(0), DEFAULT_SLOT_LABELS)
  assert.deepEqual(slotsForMealsPerDay(null), DEFAULT_SLOT_LABELS)
  assert.deepEqual(slotsForMealsPerDay(undefined), DEFAULT_SLOT_LABELS)
  assert.equal(slotsForMealsPerDay(99).length, 10)
  assert.equal(slotsForMealsPerDay(-3).length, 1)
})
