import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDietTags } from './diet-tags.ts'

const tag = (ings: string[], name = '', steps: any[] = []) =>
  classifyDietTags(ings.map(n => ({ name: n })), name, steps)

// ── the seven rows that shipped mis-tagged ───────────────────────────────────────────────────
test('REGRESSION: non-Anglo dairy is dairy', () => {
  // curd (Indian), skyr (Icelandic), quark (German) — none were in the vocabulary, so all three
  // read as vegan and dairy-free in production.
  for (const d of ['curd', 'fresh curd', 'dahi', 'skyr', 'quark', 'low-fat quark', 'kefir', 'labneh', 'malai']) {
    const t = tag([d])
    assert.equal(t.is_dairy_free, false, `${d} should be dairy`)
    assert.ok(!t.compatible_diets.includes('Vegan'), `${d} should not be vegan`)
  }
})

test('REGRESSION: the British spelling counts', () => {
  // "Greek yoghurt (Skyr)" was tagged Vegan because the list held only 'yogurt'.
  const t = tag(['Greek yoghurt (Skyr)', 'cocoa powder'])
  assert.equal(t.is_dairy_free, false)
  assert.ok(!t.compatible_diets.includes('Vegan'))
})

test('REGRESSION: the four live examples come out right', () => {
  assert.equal(tag(['soya chunks', 'soaked rice', 'soaked chana dal', 'curd'], 'Soya Chunks Pancakes').is_dairy_free, false)
  assert.equal(tag(['skyr', 'all-purpose flour', 'eggs'], 'Skyr Pancakes with Gooseberries').is_dairy_free, false)
  assert.ok(!tag(['Low-fat quark', 'Spelt flour'], 'Protein Chocolate Buns').compatible_diets.includes('Vegan'))
  assert.ok(!tag(['boiled Kala chana', 'oats', 'curd'], 'Kala Chana Protein Balls').compatible_diets.includes('Vegan'))
})

test('bean curd is TOFU, not dairy — the new keyword must not strip vegan from tofu', () => {
  const t = tag(['bean curd', 'soy sauce', 'spring onion'])
  assert.equal(t.is_dairy_free, true)
  assert.ok(t.compatible_diets.includes('Vegan'))
  // soy curd likewise
  assert.equal(tag(['soy curd', 'chilli oil']).is_dairy_free, true)
})

test('a nut or seed butter is not dairy', () => {
  for (const b of ['peanut butter', 'almond butter', 'cashew butter', 'sunflower seed butter']) {
    assert.equal(tag([b]).is_dairy_free, true, b)
  }
  assert.equal(tag(['butter, melted']).is_dairy_free, false) // real butter still counts
})

test('gluten vocabulary covers the grains that were missing', () => {
  for (const g of ['spelt flour', 'semolina', 'durum wheat', 'biscoff biscuit', 'oreo cookies', 'sourdough', 'roti', 'chapati']) {
    assert.equal(tag([g]).is_gluten_free, false, g)
  }
})

test("'cake' is not a gluten keyword — rice and crab cakes are not wheat", () => {
  assert.equal(tag(['rice cakes', 'avocado']).is_gluten_free, true)
  assert.equal(tag(['crab cakes', 'lemon']).is_gluten_free, true)
})

test('the diet ladder still nests correctly', () => {
  assert.deepEqual(tag(['chicken breast', 'rice']).compatible_diets, ['Classic'])
  assert.deepEqual(tag(['salmon', 'rice']).compatible_diets, ['Classic', 'Pescatarian'])
  assert.deepEqual(tag(['cheddar', 'pasta']).compatible_diets, ['Classic', 'Pescatarian', 'Vegetarian'])
  assert.deepEqual(tag(['black beans', 'rice']).compatible_diets, ['Classic', 'Pescatarian', 'Vegetarian', 'Vegan'])
})

test('eggs and honey block vegan but not vegetarian', () => {
  assert.ok(!tag(['eggs', 'spinach']).compatible_diets.includes('Vegan'))
  assert.ok(tag(['eggs', 'spinach']).compatible_diets.includes('Vegetarian'))
  assert.ok(!tag(['honey', 'oats']).compatible_diets.includes('Vegan'))
  assert.ok(tag(['eggplant', 'rice']).compatible_diets.includes('Vegan')) // not "egg"
})

test('the name and steps are scanned too, not just the ingredients', () => {
  assert.equal(tag(['chicken breast', 'olive oil'], 'Parmesan-Crusted Chicken Sheet Pan').is_dairy_free, false)
  assert.equal(tag(['chicken', 'oil'], 'Sheet Pan Chicken', [{ title: 'Finish', detail: 'Top with grated parmesan.' }]).is_dairy_free, false)
})

test('REGRESSION: plain-string ingredients are scanned, not silently skipped', () => {
  // Creator recipes store strings, AI ones store objects. Reading only i.name made the whole list
  // invisible for the string form — a stored brownie listing "1 large egg" and "1 tbsp butter"
  // shipped tagged dairy-free, gluten-free AND nut-free.
  const strings = ['1/2 an avocado', '2 tbsp unsweetened cocoa powder', '1 large egg', '1 tbsp butter, melted']
  const t = classifyDietTags(strings as any, 'Fudgy Avocado Brownie', [])
  assert.equal(t.is_dairy_free, false, 'butter is dairy')
  assert.ok(!t.compatible_diets.includes('Vegan'), 'egg and butter block vegan')
  // and the object form still behaves identically
  const objs = strings.map(n => ({ name: n }))
  assert.deepEqual(classifyDietTags(objs, 'Fudgy Avocado Brownie', []), t)
})
