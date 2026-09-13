import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flavourAxes, flavourShelf, itemAxes, isSweetDish } from './flavour-axes.ts'

const meal = (...names: string[]) => ({ ingredients: names.map(name => ({ name })) })

// The three meals Cook Tonight run 48 shipped (2026-09-10), which the prompt's rule should have stopped.
test('run 48 reached 0, 0 and 1 axes', () => {
  assert.deepEqual(flavourAxes(meal('eggs', 'shredded cheese', 'cooked rice', 'butter')), [])
  assert.deepEqual(flavourAxes(meal('eggs', 'liquid egg whites', 'cauliflower', 'butter', 'cooked rice')), [])
  assert.deepEqual(flavourAxes(meal('cottage cheese', 'cooked rice', 'pecans', 'black pepper')), ['heat'])
})

test('a dish built the way the prompt asks reaches several', () => {
  // Served 2026-09-10 17:14.
  assert.deepEqual(flavourAxes(meal('chicken', 'cauliflower', 'soy sauce', 'garlic', 'oil', 'black pepper')),
    ['heat', 'umami', 'aromatic'])
  assert.deepEqual(flavourAxes(meal('ground beef', 'cooked rice', 'salsa', 'hot sauce')), ['acid', 'heat'])
})

test('sweet peppers and dried powders do not count', () => {
  assert.deepEqual(flavourAxes(meal('chicken', 'red bell pepper', 'roasted red peppers')), [])
  assert.deepEqual(flavourAxes(meal('chicken', 'olive oil', 'garlic powder', 'onion powder')), [])
  assert.deepEqual(flavourAxes(meal('eggs', 'salt and pepper')), ['heat'])
})

test('browned butter counts from the steps, soy milk is not soy sauce', () => {
  assert.deepEqual(flavourAxes({ ingredients: [{ name: 'butter' }, { name: 'pasta' }],
    steps: [{ title: 'Brown', detail: 'Brown the butter until nutty.' }] }), ['aromatic'])
  assert.deepEqual(flavourAxes(meal('soy milk', 'protein powder')), [])
})

test('seasoning blends and cooked tomato count — creators list them instead of the spices', () => {
  assert.deepEqual(flavourAxes(meal('chicken breast', 'bell peppers', 'red onion', 'fajita seasoning')), ['heat'])
  assert.deepEqual(flavourAxes(meal('ground beef', 'rice', 'pizza sauce', 'turkey pepperoni')), ['umami'])
  // Served 2026-09-07 and read as zero-axis until curry powder counted.
  assert.deepEqual(flavourAxes(meal('chicken', 'cauliflower', 'curry powder', 'olive oil', 'garlic powder', 'cooked rice', 'salt')), ['heat'])
})

test('bad input is zero axes, not a crash', () => {
  assert.deepEqual(flavourAxes(undefined), [])
  assert.deepEqual(flavourAxes({ ingredients: 'eggs' }), [])
})

// Logan's shelf on 2026-09-13, the day a soup was built on water and salt with all of this in reach.
test('the pantry shelf groups items by the axis they can supply, in the ranker\'s vocabulary', () => {
  const shelf = flavourShelf(['Soy Sauce', 'Lime', 'Salsa', 'Butter', 'Peanut Butter', 'Shredded Cheese', 'Garlic Powder', 'Red Pepper Flakes', 'Black pepper', 'Yellow Onions', 'Olive oil', 'Pad Thai Sauce', 'Sweet Relish', 'soy sauce'])
  assert.deepEqual(shelf.umami, ['Soy Sauce', 'Pad Thai Sauce'])
  assert.deepEqual(shelf.acid, ['Lime', 'Salsa', 'Sweet Relish'])
  assert.deepEqual(shelf.heat, ['Red Pepper Flakes', 'Black pepper'])
  assert.deepEqual(shelf.aromatic, ['Yellow Onions'])
  assert.deepEqual(shelf.fat, ['Butter', 'Olive oil'], 'peanut butter is a spread, not a cooking fat')
  assert.deepEqual(itemAxes('Shredded Cheese'), [], 'cheddar is not on the umami list the ranker uses')
  assert.deepEqual(itemAxes('Garlic Powder'), [], 'a powder is not an aromatic cooked in fat')
  assert.deepEqual(itemAxes('Pesto'), ['umami', 'aromatic'])
})

test('sweet dishes are exempt from the savory axes', () => {
  assert.equal(isSweetDish('Bulgarian Yogurt and Protein Shake'), true)
  assert.equal(isSweetDish('Greek Yogurt and Protein Cereal Bowl'), true)
  assert.equal(isSweetDish('Chicken and Rice Soup'), false)
  assert.equal(isSweetDish('Egg White and Vegetable Scramble'), false)
  // Named for a fruit or nut, no meat or egg in the title: sweet, whatever the list above says.
  assert.equal(isSweetDish('Bulgarian Yogurt and Pineapple Protein Bowl'), true)
  assert.equal(isSweetDish('Bulgarian Yogurt and Pecan Power Plate'), true)
  assert.equal(isSweetDish('Greek Yogurt and Orange Protein Bowl'), true)
  assert.equal(isSweetDish('Pineapple Chicken Rice Bowl'), false)
  assert.equal(isSweetDish('Savory Greek Yogurt and Egg Omelet'), false)
})
