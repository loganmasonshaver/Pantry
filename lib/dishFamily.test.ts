import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dishFamilies, capFamiliesOnPage, familyCap, FAMILY_PAGE_CAP, BROAD_FAMILY_PAGE_CAP } from './dishFamily.ts'

const sorted = (name: string) => dishFamilies(name).sort()

test('a family word anywhere in the name counts, not just the last noun', () => {
  assert.deepEqual(sorted('Blueberry Cheesecake Yogurt'), ['cheesecake'])
  assert.deepEqual(sorted('Cheesecake Dip'), ['cheesecake', 'dip'])
  assert.deepEqual(sorted('Blueberry Cheesecake Chia Pudding'), ['cheesecake', 'pudding'])
  assert.deepEqual(sorted('Peanut Butter Cheesecake Brownie Bake'), ['brownie', 'cheesecake'])
  assert.deepEqual(sorted('Creamy Tuna Pasta Salad'), ['pasta', 'salad'])
  assert.deepEqual(sorted('Paneer Tiramisu'), ['paneer', 'tiramisu'])
})

test('phrases win over their words, and look-alikes are not families', () => {
  assert.deepEqual(sorted('Strawberry Cheesecake Ice Cream'), ['cheesecake', 'ice cream'])
  assert.deepEqual(sorted('Mint Chocolate Ninja Creami'), ['ice cream'])
  assert.deepEqual(sorted('Buffalo Chicken Mac and Cheese'), ['pasta'])
  assert.deepEqual(sorted('Air Fryer Rice Paper Bagels'), ['toast'])           // bagel, not rice
  assert.deepEqual(sorted('Cacao Prune Overnight Oats'), ['oats'])
  assert.deepEqual(sorted('Tiramisu Protein Balls'), ['bites', 'tiramisu'])
})

test('with no family word the last noun stands in, and takes the broad cap', () => {
  assert.deepEqual(dishFamilies('Kofta Style Beef Bowl'), ['bowl'])
  assert.equal(familyCap('bowl'), BROAD_FAMILY_PAGE_CAP)
  assert.equal(familyCap('pasta'), BROAD_FAMILY_PAGE_CAP)
  assert.equal(familyCap('cheesecake'), FAMILY_PAGE_CAP)
  assert.equal(familyCap('ice cream'), FAMILY_PAGE_CAP)
  assert.equal(familyCap('paneer'), FAMILY_PAGE_CAP)
})

const meal = (id: string, name: string, created_at = '2026-09-01T08:00:00Z') => ({ id, name, created_at })
const notNew = () => false

test('a narrow family is capped across the page; unrelated dishes are untouched; input order is kept', () => {
  const pool = [
    ...Array.from({ length: 8 }, (_, i) => meal(`c${i}`, `Flavour ${i} Cheesecake`)),
    meal('x', 'Korean Beef Bowl'), meal('y', 'Chicken Jollof Rice'),
  ]
  const r = capFamiliesOnPage(pool, { day: 259, isNew: notNew })
  assert.equal(r.shown.filter(m => m.id.startsWith('c')).length, FAMILY_PAGE_CAP)
  assert.ok(r.shown.some(m => m.id === 'x') && r.shown.some(m => m.id === 'y'))
  const ids = r.shown.map(m => m.id)
  assert.deepEqual(ids, pool.map(m => m.id).filter(id => ids.includes(id)))
})

test('a dish in two families needs room in both', () => {
  const pool = [
    ...Array.from({ length: 4 }, (_, i) => meal(`c${i}`, `Flavour ${i} Cheesecake`)),
    meal('both', 'Cheesecake Brownie'), meal('b', 'Fudgy Brownie'),
  ]
  const r = capFamiliesOnPage(pool, { day: 1, isNew: (m) => m.id !== 'both' })
  assert.equal(r.hidden.map(m => m.id).join(), 'both')
})

test('pinned meals always show and still count; NEW TODAY is admitted before older meals', () => {
  const pool = Array.from({ length: 10 }, (_, i) => meal(`c${i}`, `Flavour ${i} Cheesecake`))
  const r = capFamiliesOnPage(pool, { day: 5, isNew: m => m.id === 'c9' || m.id === 'c8', pinnedIds: ['c0', 'c1', 'c2'] })
  const shown = r.shown.map(m => m.id).sort()
  // 3 pinned use 3 of the 4 slots; the fourth goes to a NEW TODAY dish, never to an older one.
  assert.equal(shown.length, FAMILY_PAGE_CAP)
  assert.deepEqual(shown.slice(0, 3), ['c0', 'c1', 'c2'])
  assert.ok(['c8', 'c9'].includes(shown[3]))
})

test('which older dishes fill a family changes from day to day', () => {
  const pool = Array.from({ length: 20 }, (_, i) => meal(`c${i}`, `Flavour ${i} Cheesecake`))
  const day = (d: number) => capFamiliesOnPage(pool, { day: d, isNew: notNew }).shown.map(m => m.id).join()
  assert.notEqual(day(259), day(260))
  assert.equal(day(259), day(259))
})
