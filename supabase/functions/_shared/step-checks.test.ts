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
  assert.deepEqual(i, { unseasoned: false, noPreheat: false, untimedCook: 0, coldCarb: false })
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
