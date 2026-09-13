import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageFingerprint, singularize } from './image-fingerprint.ts'

// The two "Egg White and Vegetable Scramble" recipes that shared one photo (2026-09-02 and 09-13).
test('the two scrambles that shared a photo get different fingerprints', () => {
  const sep2 = imageFingerprint(['liquid egg whites', 'yellow potatoes', 'cauliflower', 'shredded cheese', 'yellow onions', 'butter', 'salt', 'paprika'])
  const sep13 = imageFingerprint(['liquid egg whites', 'leafy greens', 'yellow onion', 'butter', 'salt', 'black pepper'])
  assert.equal(sep2, 'cauliflower+egg white+potato')
  assert.equal(sep13, 'egg white+leafy green+onion')
})

test('the two Sep 7 scrambles that differ only by potato colour share one', () => {
  const a = imageFingerprint(['liquid egg whites', 'yellow potatoes', 'leafy greens', 'butter', 'garlic powder'])
  const b = imageFingerprint(['liquid egg whites', 'red potatoes', 'leafy greens', 'butter', 'salt'])
  assert.equal(a, b)
  assert.equal(a, 'egg white+leafy green+potato')
})

test('quantities, units, prep words and staples never buy a second image', () => {
  // What the trending pipeline sends: the visual hint glued to the name.
  const trending = imageFingerprint(['2 tbsp olive oil', '1 lb boneless skinless chicken breast', '1/2 cup Greek yogurt', '1 slice American cheese', 'salt to taste'])
  assert.equal(trending, 'american cheese+chicken+yogurt')
  // What imageIngredientNames sends: a count on whole items.
  assert.equal(imageFingerprint(['3 eggs', 'cooked rice', 'diced yellow onion']), 'egg+onion+rice')
  assert.equal(imageFingerprint(['eggs', 'white rice', 'onion']), 'egg+onion+rice')
})

test('order of the mains does not matter, order of the list does', () => {
  assert.equal(imageFingerprint(['chicken', 'rice', 'broccoli']), imageFingerprint(['broccoli', 'chicken', 'rice']))
  // The fourth item is not part of the key — a garnish change is not a new photo.
  assert.equal(imageFingerprint(['chicken', 'rice', 'broccoli', 'sesame seeds']), imageFingerprint(['chicken', 'rice', 'broccoli', 'lime']))
})

test('invisible ingredients are skipped, not counted as one of the three', () => {
  assert.equal(imageFingerprint(['chicken broth', 'soy sauce', 'lemon juice', 'garlic', 'vanilla extract', 'chicken', 'rice']), 'chicken+rice')
  assert.equal(imageFingerprint(['salt', 'black pepper', 'olive oil', 'ice cubes', 'water']), '')
  assert.equal(imageFingerprint([]), '')
  assert.equal(imageFingerprint(undefined), '')
})

test('the fingerprint keeps what a photo shows', () => {
  assert.notEqual(imageFingerprint(['chicken salad', 'cooked rice']), imageFingerprint(['chicken', 'cooked rice']))
  assert.notEqual(imageFingerprint(['sweet potato']), imageFingerprint(['potato']))
  assert.notEqual(imageFingerprint(['ground beef']), imageFingerprint(['beef']))
  assert.notEqual(imageFingerprint(['chocolate protein powder', 'oat milk']), imageFingerprint(['protein powder', 'oat milk']))
  assert.equal(imageFingerprint(['vanilla protein powder', 'oat milk']), imageFingerprint(['protein powder', 'oat milk']))
})

test('accepts {name} objects and bad input', () => {
  assert.equal(imageFingerprint([{ name: 'Eggs' }, { name: 'Spinach' }, null, 42, { name: '' }]), 'egg+spinach')
})

test('singularize matches the name key rules', () => {
  assert.equal(singularize('potatoes'), 'potato')
  assert.equal(singularize('hummus'), 'hummus')
  assert.equal(singularize('cheese'), 'cheese')
  assert.equal(singularize('berries'), 'berry')
  assert.equal(singularize('tacos'), 'taco')
})
