import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSpare } from './spareChoice.ts'

const none = new Set<string>()
const meal = (id: string, name: string, ingredients: string[]) => ({ id, name, ingredients: ingredients.map(n => ({ name: n })) })

// Logan's case: "Cooked Ground Meat" was a scan phantom, marked missing, so the pantry no longer has it.
const pantry = new Set(['chicken breast', 'rice', 'eggs', 'spinach', 'greek yogurt', 'granola', 'tortillas', 'cheddar cheese'])
const deck = [
  meal('a', 'Beef Taco Skillet', ['cooked ground meat', 'tortillas', 'cheddar cheese']),
  meal('b', 'Chicken Rice Bowl', ['chicken breast', 'rice']),
  meal('c', 'Greek Yogurt Parfait', ['greek yogurt', 'granola']),
]

test('the first cookable spare replaces the meal built on the missing item', () => {
  const spares = [
    meal('s1', 'Beef Burrito', ['cooked ground meat', 'tortillas']), // needs the phantom too
    meal('s2', 'Spinach Egg Scramble', ['eggs', 'spinach']),
    meal('s3', 'Cheesy Egg Quesadilla', ['eggs', 'tortillas', 'cheddar cheese']),
  ]
  assert.equal(pickSpare(spares, deck, 'a', pantry, none)?.id, 's2')
})

test('never a second dish of a form already on screen, nor the same dish spelled differently', () => {
  const spares = [
    meal('s1', 'Egg and Spinach Rice Bowl', ['eggs', 'spinach', 'rice']), // a second bowl
    meal('s2', 'Rice Bowl with Chicken', ['chicken breast', 'rice']),     // the same dish as "b"
    meal('s3', 'Spinach Egg Scramble', ['eggs', 'spinach']),
  ]
  assert.equal(pickSpare(spares, deck, 'a', pantry, none)?.id, 's3')
})

test('null when nothing fits, and a spare already in the deck is not offered twice', () => {
  assert.equal(pickSpare([meal('s1', 'Beef Burrito', ['cooked ground meat'])], deck, 'a', pantry, none), null)
  const swapped = [meal('s2', 'Spinach Egg Scramble', ['eggs', 'spinach']), deck[1], deck[2]]
  assert.equal(pickSpare([swapped[0]], swapped, 'b', pantry, none), null)
})
