import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasCarbSource, isDrink, carbRequired, isCompleteMeal, isZeroCalorie } from './meal-completeness.ts'

const ing = (...names: string[]) => names.map(name => ({ name }))

test('the 2026-09-10 stir-fry is NOT complete — protein, one vegetable, soy sauce', () => {
  assert.equal(isCompleteMeal({ name: 'Chicken and Cauliflower Stir-Fry',
    ingredients: ing('chicken', 'cauliflower', 'soy sauce', 'garlic', 'oil', 'black pepper') }), false)
})

test('the same batch\'s complete dishes pass', () => {
  assert.equal(isCompleteMeal({ name: 'Pan-Fried Eggs with Potatoes', ingredients: ing('eggs', 'yellow potatoes', 'butter', 'paprika', 'salt') }), true)
  assert.equal(isCompleteMeal({ name: 'Curried Cauliflower and Chicken Plate', ingredients: ing('chicken', 'cauliflower', 'curry powder', 'cooked rice') }), true)
})

test('a drink is exempt — a shake with no starch is still a complete shake', () => {
  assert.equal(isDrink('Chocolate Protein Power Shake'), true)
  assert.equal(isCompleteMeal({ name: 'Chocolate Protein Power Shake', ingredients: ing('chocolate protein powder', 'milk', 'peanut butter', 'ice cubes') }), true)
})

test('keto, low-carb and carnivore users are the prompt\'s own exception', () => {
  assert.equal(carbRequired(['Keto']), false)
  assert.equal(carbRequired(['low carb']), false)
  assert.equal(carbRequired(['None']), true)
  assert.equal(isCompleteMeal({ name: 'Garlic Butter Steak', ingredients: ing('steak', 'butter', 'broccoli') }, ['Low-Carb']), true)
})

test('a carb WORD that is not a carb base does not complete the plate', () => {
  assert.equal(hasCarbSource(ing('chicken', 'rice vinegar', 'green beans', 'oat milk', 'panko')), false)
  assert.equal(hasCarbSource(ing('shrimp', 'bean sprouts', 'cornstarch', 'coffee beans')), false)
})

test('real bases in their usual forms all count', () => {
  for (const base of ['cooked rice', 'whole wheat tortillas', 'sourdough toast', 'rolled oats', 'black beans', 'udon noodles', 'hash browns', 'sweet potatoes', 'granola'])
    assert.equal(hasCarbSource(ing('chicken', base)), true, base)
})

test('water and ice are zero-calorie; anything with them in a longer name is not', () => {
  for (const n of ['water', 'cold water', 'ice', 'ice cubes', 'Ice Cubes', 'crushed ice', 'sparkling water'])
    assert.equal(isZeroCalorie(n), true, n)
  for (const n of ['coconut water', 'ice cream', 'rice', 'iced coffee', 'water chestnuts'])
    assert.equal(isZeroCalorie(n), false, n)
})

test('flour is the base when the dish is MADE of it — wraps, crepes, pancakes', () => {
  assert.equal(isCompleteMeal({ name: 'Egg White and Cheese Breakfast Wrap', ingredients: ing('liquid egg whites', 'flour', 'shredded cheese', 'leafy greens') }), true)
  assert.equal(isCompleteMeal({ name: 'Greek Yogurt Protein Crepes', ingredients: ing('greek yogurt', 'protein powder', 'eggs', 'all-purpose flour') }), true)
})

test('a spoon of flour thickening a sauce does NOT complete a protein-and-veg plate', () => {
  assert.equal(isCompleteMeal({ name: 'Creamy Chicken and Broccoli Skillet', ingredients: ing('chicken', 'broccoli', 'milk', 'all-purpose flour', 'butter') }), false)
})

test('cauliflower rice is a vegetable, not rice', () => {
  assert.equal(hasCarbSource(ing('chicken', 'cauliflower rice', 'soy sauce')), false)
})
