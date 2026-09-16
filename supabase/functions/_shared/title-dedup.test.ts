import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contentWords, preparePool, findTitleRepeat, filterTitleRepeats, nameContains } from './title-dedup.ts'

const POOL = [
  'Cottage Cheese Flatbread', 'Strawberry Cheesecake Ice Cream', 'Banana Bread High Protein Pancakes',
  'Tiramisu Chia Pudding', 'Creamy Mushroom Pasta', 'Skillet Nachos', 'Brownies',
]

test('contentWords drops title junk, numbers, emoji and stopwords, and singularises', () => {
  assert.deepEqual([...contentWords('Banana Bread Protein Pancakes 🥞 40g protein | EASY recipe!')].sort(), ['banana', 'bread', 'pancake'])
  assert.deepEqual([...contentWords('High Protein')], [])
})

test('the 2026-09-16 repeats are caught from their titles', () => {
  const pool = preparePool(POOL)
  assert.equal(findTitleRepeat('Cottage Cheese Flatbread 😍 High Protein Lunch Idea!', pool), 'Cottage Cheese Flatbread')
  assert.equal(findTitleRepeat('STRAWBERRY CHEESECAKE PROTEIN ICE CREAM (Ninja Creami)', pool), 'Strawberry Cheesecake Ice Cream')
  assert.equal(findTitleRepeat('Banana Bread Protein Pancakes 🥞 40g protein', pool), 'Banana Bread High Protein Pancakes')
  assert.equal(findTitleRepeat('TIRAMISU CHIA PUDDING | 30g protein', pool), 'Tiramisu Chia Pudding')
  // The zucchini version was rejected downstream at 0.75 anyway; removing it early is consistent.
  assert.equal(findTitleRepeat('Cottage Cheese Zucchini Flatbread', pool), 'Cottage Cheese Flatbread')
})

test('a different dish sharing words is kept', () => {
  const pool = preparePool(POOL)
  assert.equal(findTitleRepeat('Vegan Mushroom Pasta in 15 minutes', pool), null)          // no "creamy"
  assert.equal(findTitleRepeat('Strawberry Cheesecake Overnight Oats', pool), null)       // not ice cream
  assert.equal(findTitleRepeat('Loaded Chicken Skillet Nachos Bake', pool), null)         // 2-word name, title too wide
  assert.equal(findTitleRepeat('Skillet Nachos (10 min)', pool), 'Skillet Nachos')        // 2-word name, tight title
  assert.equal(findTitleRepeat('Fudgy Protein Brownies', pool), null)                    // 1-word pool names never match
})

test('filterTitleRepeats splits and reports, and refuses to gut the list', () => {
  const videos = [
    { title: 'Cottage Cheese Flatbread 😍' }, { title: 'Chicken Jollof Rice' }, { title: 'Tiramisu Chia Pudding' },
    { title: 'Dunkaroo dip' }, { title: 'Skillet nachos' }, { title: 'Nougat bites' }, { title: 'Korean beef bowls' },
    { title: 'White chicken bolognese' },
  ]
  const r = filterTitleRepeats(videos, POOL)  // 3 of 8 = 37.5%, under the 40% guard
  assert.equal(r.skipped, false)
  assert.equal(r.kept.length, 5)
  assert.deepEqual(r.dropped.map(d => d.matched), ['Cottage Cheese Flatbread', 'Tiramisu Chia Pudding', 'Skillet Nachos'])
  // Over the drop share: nothing is removed and the caller is told.
  const heavy = filterTitleRepeats(videos.slice(0, 3), POOL)
  assert.equal(heavy.skipped, true)
  assert.equal(heavy.kept.length, 3)
})

test('nameContains: a known name plus at most one word is the same dish', () => {
  const w = contentWords
  assert.equal(nameContains(w('Creamy Paneer Pasta'), w('Paneer Pasta')), true)
  assert.equal(nameContains(w('Tiramisu Snack Balls'), w('Tiramisu Protein Balls')), true)
  assert.equal(nameContains(w('Tiramisu Bites'), w('Tiramisu Protein Balls')), true)
  assert.equal(nameContains(w('Peanut Butter Energy Truffles'), w('Peanut Butter Balls')), true)
  assert.equal(nameContains(w('Double Chocolate Cheesecake'), w('Chocolate Cheesecake')), true)
  assert.equal(nameContains(w('Chicken Fried Rice with Egg'), w('Chicken Rice')), false)   // two extra words
  assert.equal(nameContains(w('Creamy Vegan Tofu Pasta'), w('Creamy Vegan Mushroom Pasta')), false)
  assert.equal(nameContains(w('Fudgy Brownies'), w('Brownies')), false)                    // one-word names never claim
})
