import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dishArchetype, spreadByArchetype, ARCHETYPE_PER_SHELF } from './dishArchetype.ts'

const meal = (name: string, id = name) => ({ id, name })

test('the dish form is the noun a photo would show', () => {
  // The pair that was reported: genuinely different recipes, identical on screen.
  assert.equal(dishArchetype(meal('Yogurt Chocolate Cheesecake')), 'cheesecake')
  assert.equal(dishArchetype(meal('Double Chocolate Protein Cheesecake')), 'cheesecake')
  // Plural and singular collide.
  assert.equal(dishArchetype(meal('Bueno Dark Protein Brownies')), 'brownie')
  assert.equal(dishArchetype(meal('Fudgy Banana Brownie')), 'brownie')
  // Method words are noise, not form: the form is what it looks like, not how it was cooked.
  assert.equal(dishArchetype(meal('Air Fryer Chocolate Oats Cake')), 'cake')
  assert.equal(dishArchetype(meal('No-Bake Protein Brownies')), 'brownie')
  assert.equal(dishArchetype(meal('Microwave Chocolate Baked Oats')), 'oat')
  // Different forms stay different.
  assert.notEqual(dishArchetype(meal('Chocolate Protein Mousse')), dishArchetype(meal('Chocolate Donuts')))
  // ss/us/is are singular in food words and must not be chopped.
  assert.equal(dishArchetype(meal('Couscous')), 'couscous')
  assert.equal(dishArchetype(meal('Beetroot Hummus')), 'hummus')
  // Nothing readable -> empty, so the caller can opt out rather than group on ''.
  assert.equal(dishArchetype(meal('')), '')
  assert.equal(dishArchetype({ id: 'x' }), '')
})

test('spread separates forms on BOTH grid axes and loses nothing', () => {
  // Six brownies and two cheesecakes, the live sweet-treat shape in miniature.
  const meals = [
    ...Array.from({ length: 6 }, (_, i) => meal(`Brownie ${i}`, `b${i}`)),
    ...Array.from({ length: 2 }, (_, i) => meal(`Cheesecake ${i}`, `c${i}`)),
    meal('Mousse 0', 'm0'), meal('Protein Donuts', 'd0'), meal('Lava Cake', 'k0'),
  ]
  const out = spreadByArchetype(meals)
  assert.equal(out.length, meals.length, 'nothing may be dropped — this section is the last one')
  assert.deepEqual(new Set(out.map(m => m.id)), new Set(meals.map(m => m.id)))
  // i-1 is the row neighbour, i-2 the one directly above in a two-column grid.
  let row = 0, col = 0
  for (let i = 1; i < out.length; i++) {
    const f = dishArchetype(out[i])
    if (f && f === dishArchetype(out[i - 1])) row++
    if (i >= 2 && f && f === dishArchetype(out[i - 2])) col++
  }
  assert.equal(row, 0, 'no two of a form side by side')
  assert.equal(col, 0, 'no two of a form stacked in a column')
})

test('an arithmetically forced repeat is emitted, not looped on', () => {
  // One form is the clear majority: separation is impossible, so it must still terminate and
  // return everything rather than spin looking for an alternative that does not exist.
  const meals = Array.from({ length: 5 }, (_, i) => meal(`Brownie ${i}`, `b${i}`)).concat(meal('Lava Cake', 'k0'))
  const out = spreadByArchetype(meals)
  assert.equal(out.length, 6)
  assert.deepEqual(new Set(out.map(m => m.id)), new Set(meals.map(m => m.id)))
})

test('meals with no readable form are never grouped together', () => {
  // An empty form must not become a shared bucket key, or unrelated meals get spaced apart as if
  // they matched — and, worse, counted against each other by the shelf cap.
  const meals = [meal('', 'a'), meal('', 'b'), meal('', 'c')]
  assert.equal(spreadByArchetype(meals).length, 3)
})

test('the per-shelf cap is 2', () => {
  assert.equal(ARCHETYPE_PER_SHELF, 2)
})
