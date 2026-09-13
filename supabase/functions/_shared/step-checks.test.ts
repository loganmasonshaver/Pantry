import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepIssues } from './step-checks.ts'

const steps = (...pairs: string[][]) => pairs.map(([title, detail]) => ({ title, detail }))

// All three from Cook Tonight run 51 (2026-09-11).
test('run 51: the frittata calls the oven preheated without preheating it', () => {
  const i = stepIssues({
    ingredients: [{ name: 'liquid egg whites' }, { name: 'cooked rice' }, { name: 'butter' }],
    steps: steps(['Sauté', 'Heat butter in an oven-safe skillet, add onions and cauliflower, and cook until tender.'],
      ['Cook', 'Cook on the stove for 5 minutes, then transfer to a preheated oven at 375°F for 10-15 minutes until set.']),
  })
  assert.equal(i.noPreheat, true, '"a preheated oven" is the bug, not the instruction')
  assert.equal(i.unseasoned, true)
})

test('a real preheat step clears it', () => {
  const i = stepIssues({ steps: steps(['Preheat', 'Preheat the oven to 375°F.'], ['Bake', 'Bake 20 minutes.']) })
  assert.equal(i.noPreheat, false)
})

test('run 51: the chicken step has no time, and the rice is never reheated', () => {
  const i = stepIssues({
    ingredients: [{ name: 'chicken' }, { name: 'cooked rice' }, { name: 'paprika' }],
    steps: steps(['Sear Chicken', 'Heat oil in a pan, season chicken with paprika, and sear until cooked through.'],
      ['Assemble', 'Serve chicken and cauliflower over a bed of warm cooked rice.']),
  })
  assert.equal(i.untimedCook, 1)
  assert.equal(i.coldCarb, true)
  assert.equal(i.unseasoned, true, 'paprika is not salt')
})

test('a followable recipe reports nothing', () => {
  const i = stepIssues({
    ingredients: [{ name: 'chicken' }, { name: 'cooked rice' }, { name: 'salt' }, { name: 'black pepper' }],
    steps: steps(['Sear', 'Season the chicken with salt and pepper and sear 6-7 minutes per side until golden.'],
      ['Reheat rice', 'Microwave the rice 60-90 seconds until steaming.']),
  })
  assert.deepEqual(i, { unseasoned: false, noPreheat: false, untimedCook: 0, coldCarb: false, unpreppedForms: 0 })
})

test('soy sauce is seasoning, and a parfait owes no salt', () => {
  assert.equal(stepIssues({ name: 'Thai Peanut Sauce Beef Stir-Fry', ingredients: [{ name: 'ground beef' }, { name: 'soy sauce' }], steps: [] }).unseasoned, false)
  assert.equal(stepIssues({ name: 'Cottage Cheese and Protein Cereal Bowl', ingredients: [{ name: 'cottage cheese' }, { name: 'protein cereal' }], steps: [] }).unseasoned, false)
  assert.equal(stepIssues({ name: 'Egg and Vegetable Scramble', ingredients: [{ name: 'eggs' }, { name: 'butter' }], steps: [] }).unseasoned, true)
})

test('bad input does not crash', () => {
  assert.equal(stepIssues(undefined).unseasoned, true)
  assert.equal(stepIssues({ steps: 'cook it' }).untimedCook, 0)
})

// Run 601 (2026-09-13): the Egg White and Vegetable Scramble's step 1 adds "diced onions" while the
// onion line reads "1/4 medium" — nothing dices anything.
test('run 601: a cut that first appears inside a cooking step is unprepped', () => {
  const scramble = {
    ingredients: [{ name: 'liquid egg whites', visual: '2 cups' }, { name: 'leafy greens', visual: '2¾ cups' }, { name: 'yellow onion', visual: '1/4 medium' }, { name: 'butter', visual: '1½ tbsp' }],
    steps: steps(['Sauté', 'Heat butter in a pan, add diced onions, and cook 3 minutes.'], ['Add Greens', 'Add greens and cook 2 minutes until wilted.']),
  }
  assert.equal(stepIssues(scramble).unpreppedForms, 1)
  // Naming the form on the ingredient line clears it — that is where a cook preps from.
  assert.equal(stepIssues({ ...scramble, ingredients: [{ name: 'diced yellow onion', visual: '1/4 medium' }, { name: 'butter' }] }).unpreppedForms, 0)
  assert.equal(stepIssues({ ...scramble, ingredients: [{ name: 'yellow onion', visual: '1/4 medium, diced' }, { name: 'butter' }] }).unpreppedForms, 0)
  // So does a step that gives the cut as an instruction before it is used.
  assert.equal(stepIssues({ ...scramble, steps: steps(['Prep', 'Dice the onion.'], ...scramble.steps.map(s => [s.title, s.detail])) }).unpreppedForms, 0)
})

test('the participle in a step never clears itself, and forms are counted once each', () => {
  const i = stepIssues({
    ingredients: [{ name: 'chicken' }, { name: 'garlic', visual: '2 cloves' }, { name: 'shredded cheese' }],
    steps: steps(['Cook', 'Add sliced chicken and minced garlic, cook 5 minutes.'], ['Finish', 'Top with sliced chicken and shredded cheese.']),
  })
  assert.equal(i.unpreppedForms, 2, 'sliced + minced; shredded is on the ingredient line')
})
