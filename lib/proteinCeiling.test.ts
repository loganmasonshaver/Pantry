import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pantryProteinCeiling } from './proteinCeiling.ts'

test('a stocked pantry can carry a 40g meal; a beans-and-cheese one cannot carry 38g', () => {
  const logan = ['Chicken', 'Ground Beef', 'Eggs', 'Liquid Egg Whites', 'Cottage Cheese', 'Cooked Rice', 'Pecans']
  assert.ok(pantryProteinCeiling(logan, 525) >= 50, `logan ceiling ${pantryProteinCeiling(logan, 525)}`)
  const carbHeavy = ['White Rice', 'Spaghetti', 'Peanut Butter', 'Milk', 'Sliced Cheese', 'Canned Black Beans', 'Bananas']
  const c = pantryProteinCeiling(carbHeavy, 550)
  assert.ok(c < 38, `carb-heavy ceiling ${c}`)
})

test('few sources is not the test — whether they can carry a meal is', () => {
  assert.ok(pantryProteinCeiling(['Eggs', 'Ribeye Steak', 'Butter'], 525) >= 40, 'eggs and steak alone reach 40g')
  assert.ok(pantryProteinCeiling(['Milk', 'Yogurt', 'Bread'], 525) < 20)
})

test('plant milks and nut butters do not count, and powder is capped at a scoop and a half', () => {
  assert.equal(pantryProteinCeiling(['Oat Milk', 'Almond Butter', 'Rice'], 525), 0)
  const powderOnly = pantryProteinCeiling(['Protein Powder'], 525)
  assert.ok(powderOnly <= 45, `powder alone ${powderOnly}`)
})
