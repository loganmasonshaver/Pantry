// Run: node --test lib/categoryMatch.test.ts
//
// Grocery categorisation is keyword matching over user- and model-written food names, and the
// grocery list is explicitly "ordered like a grocery store walkthrough" — so a wrong category
// sends you to the wrong aisle. It returned declaration order until this file existed, and
// Produce / Meat & Fish / Dairy sit at the top of that order with very generic keywords.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STORE_CATEGORIES, autoCategoryMatches } from './categoryMatch.ts'

const cat = (name: string) => autoCategoryMatches(name)[0] ?? 'Other'

test('REGRESSION: a modifier no longer beats the head noun', () => {
  // Every one of these was wrong: the leftmost generic keyword won because its category happened
  // to be declared first. "black pepper" is not produce; "peanut butter" is not dairy.
  const cases: Array<[string, string]> = [
    ['black pepper', 'Spices & Seasonings'],   // was Produce, matching "pepper"
    ['garlic powder', 'Spices & Seasonings'],  // was Produce, matching "garlic"
    ['onion powder', 'Spices & Seasonings'],   // was Produce, matching "onion"
    ['coconut oil', 'Oils & Vinegars'],        // was Produce, matching "coconut"
    ['coconut milk', 'Canned & Jarred'],       // was Produce
    ['peanut butter', 'Canned & Jarred'],      // was Dairy & Eggs, matching "butter"
    ['chicken broth', 'Canned & Jarred'],      // was Meat & Fish, matching "chicken"
    ['tomato sauce', 'Canned & Jarred'],       // was Produce, matching "tomato"
    ['apple cider vinegar', 'Oils & Vinegars'],// was Produce, matching "apple"
    ['rice vinegar', 'Oils & Vinegars'],       // was Grains & Pasta, matching "rice"
    ['almond milk', 'Beverages'],              // was Dairy & Eggs, matching "milk"
  ]
  const wrong = cases.filter(([n, want]) => cat(n) !== want).map(([n, want]) => `${n}: got ${cat(n)}, want ${want}`)
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`)
})

test('the items that were already right stay right', () => {
  assert.equal(cat('sweet potato'), 'Produce')
  assert.equal(cat('olive oil'), 'Oils & Vinegars')
  assert.equal(cat('salsa'), 'Canned & Jarred')
  assert.equal(cat('chicken breast'), 'Meat & Fish')
  assert.equal(cat('cottage cheese'), 'Dairy & Eggs')
  assert.equal(cat('brown rice'), 'Grains & Pasta')
  assert.equal(cat('black beans'), 'Legumes')
  assert.equal(cat('chia seeds'), 'Nuts & Seeds')
})

test('every returned category is a real store category', () => {
  const names = ['black pepper', 'peanut butter', 'sourdough bread', 'greek yogurt', 'frozen peas',
                 'apple cider vinegar', 'protein powder', 'sriracha', 'baking soda']
  for (const n of names) {
    for (const c of autoCategoryMatches(n)) {
      assert.ok(STORE_CATEGORIES.includes(c), `"${n}" produced unknown category "${c}"`)
    }
  }
})

test('an unknown item matches nothing rather than guessing', () => {
  // categorizeItem falls back to the LLM on an empty result; a wrong keyword hit would rob it of
  // that chance and file the item silently.
  assert.deepEqual(autoCategoryMatches('zzzqqq'), [])
  assert.deepEqual(autoCategoryMatches(''), [])
})

test('word boundaries still hold — no substring false positives', () => {
  // The original comment claims boundaries prevent "cod" matching "avacodo". Verify it.
  assert.ok(!autoCategoryMatches('avacodo').includes('Meat & Fish'))
  assert.ok(!autoCategoryMatches('grapefruit').includes('Beverages')) // not matching bare "ape"/"fruit" oddly
})

test('plurals resolve to the same category as their singular', () => {
  for (const [one, many] of [['tomato', 'tomatoes'], ['scallop', 'scallops'], ['egg', 'eggs'], ['bean', 'beans']]) {
    assert.equal(cat(one), cat(many), `"${one}" and "${many}" disagree`)
  }
})

test('ranking is deterministic and puts the best answer first', () => {
  // Multi-category items are expected (the source comment cites peanut butter). What matters is
  // that index 0 is the most specific, since categorizeItem returns matches[0].
  const m = autoCategoryMatches('peanut butter')
  assert.ok(m.length > 1, 'expected more than one category to match')
  assert.equal(m[0], 'Canned & Jarred')
  assert.deepEqual(autoCategoryMatches('peanut butter'), m, 'not deterministic')
})
