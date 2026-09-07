import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flavourMismatches } from './flavour-match.ts'

const PANTRY = ['Cottage Cheese', 'Protein Powder', 'Chocolate Protein Powder', 'Pineapple', 'Oat Milk', 'Cinnamon']

test('the live case: chocolate powder in a pineapple bake, with plain powder on the shelf', () => {
  const hits = flavourMismatches(
    'Cottage Cheese and Fruit Protein Muffin-Top Bake',
    ['cottage cheese', 'chocolate protein powder', 'pineapple', 'oat milk', 'cinnamon'],
    PANTRY,
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0].flavour, 'chocolate')
  assert.equal(hits[0].plainAlternative, 'protein powder')
})

test('a dish that IS about the flavour is not a mistake', () => {
  // Reaching for chocolate powder in a chocolate mousse is the entire point.
  assert.deepEqual(
    flavourMismatches('Chocolate Protein Mousse', ['chocolate protein powder', 'oat milk'], PANTRY),
    [],
  )
})

test('no plain alternative on the shelf means there was no choice to make', () => {
  assert.deepEqual(
    flavourMismatches('Pineapple Bake', ['chocolate protein powder'], ['Chocolate Protein Powder', 'Pineapple']),
    [],
  )
})

test('an explicitly plain item is never a mismatch, however it is worded', () => {
  assert.deepEqual(
    flavourMismatches('Fruit Bowl', ['plain greek yogurt', 'unsweetened almond milk'],
      ['Plain Greek Yogurt', 'Greek Yogurt', 'Unsweetened Almond Milk', 'Almond Milk']),
    [],
  )
})

test('the longest base wins, so almond milk is not read as flavoured milk', () => {
  // With a naive "milk" match, plain "Almond Milk" would look like the plain version of
  // "Chocolate Milk" and every almond-milk recipe would flag.
  assert.deepEqual(
    flavourMismatches('Berry Smoothie', ['almond milk'], ['Almond Milk', 'Milk', 'Chocolate Milk']),
    [],
  )
})

test('flavoured yogurt is caught, and greek beats plain yogurt as the base', () => {
  const hits = flavourMismatches(
    'Savory Breakfast Bowl',
    ['vanilla greek yogurt', 'spinach'],
    ['Greek Yogurt', 'Vanilla Greek Yogurt', 'Spinach'],
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0].flavour, 'vanilla')
  assert.equal(hits[0].plainAlternative, 'greek yogurt')
})

test('a flavour word outside the staple list is not a staple choice', () => {
  // "vanilla extract" is not the flavoured version of a plain "extract" anyone stocks, and the
  // pantry-pairing requirement is what keeps it out. Same for chocolate chips.
  assert.deepEqual(
    flavourMismatches('Banana Bread', ['vanilla extract', 'chocolate chips', 'banana'],
      ['Vanilla Extract', 'Chocolate Chips', 'Banana']),
    [],
  )
})

test('the longer flavour name wins, so salted caramel is not reported as caramel', () => {
  const hits = flavourMismatches('Apple Bowl', ['salted caramel protein powder'],
    ['Protein Powder', 'Salted Caramel Protein Powder'])
  assert.equal(hits[0].flavour, 'salted caramel')
})

test('nothing to say about an empty or malformed meal', () => {
  assert.deepEqual(flavourMismatches('', [], []), [])
  assert.deepEqual(flavourMismatches(null, [null, undefined, ''], PANTRY), [])
})
