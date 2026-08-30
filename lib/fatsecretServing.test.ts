import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMacros, pickDefaultServing, type FoodServing } from './fatsecretServing.ts'

const srv = (d: string, extra: Partial<FoodServing> = {}): FoodServing => ({
  serving_id: extra.serving_id ?? d, serving_description: d,
  calories: '0', protein: '0', carbohydrate: '0', fat: '0', ...extra,
})

// ── parseMacros: must stay EXACT so callers can scale then round ──────────
// Regression: rounding here first made the kitchen-scale path log 0 g protein.

test('parseMacros does not round — a per-gram serving keeps its fractional protein', () => {
  // FatSecret "Chicken Breast" 1 breast (172g) = 284 cal / 53.4 P, synthesized to a 1 g serving.
  const oneG = srv('1 g', {
    serving_id: '__1g',
    calories: String(284 / 172), protein: String(53.4 / 172),
    carbohydrate: '0', fat: String(6.2 / 172),
  })
  const m = parseMacros(oneG)
  assert.ok(m.protein > 0.3 && m.protein < 0.32, `protein was ${m.protein}, expected ~0.31`)
  assert.ok(m.calories > 1.6 && m.calories < 1.7)
})

test('150 g logged by kitchen scale matches the true macros, not zeros', () => {
  const oneG = srv('1 g', {
    serving_id: '__1g',
    calories: String(284 / 172), protein: String(53.4 / 172),
    carbohydrate: '0', fat: String(6.2 / 172),
  })
  const b = parseMacros(oneG)
  const qty = 150
  // Exactly what saveLog / EditPortionModal compute.
  assert.equal(Math.round(b.calories * qty), 248)
  assert.equal(Math.round(b.protein * qty), 47) // was 0 before the fix
  assert.equal(Math.round(b.fat * qty), 5)      // was 0 before the fix
})

test('a small household serving scaled up keeps its protein', () => {
  // 1 tbsp peanut butter, logged as 6 tbsp.
  const tbsp = srv('1 tbsp (16g)', { calories: '94', protein: '3.6', carbohydrate: '3.5', fat: '8' })
  const b = parseMacros(tbsp)
  assert.equal(Math.round(b.protein * 6), 22) // rounding first gave 4 x 6 = 24
})

test('parseMacros falls back to 0 on missing or junk values', () => {
  const junk = srv('1 cup', { calories: '', protein: 'n/a', carbohydrate: undefined as any, fat: '2.5' })
  assert.deepEqual(parseMacros(junk), { calories: 0, protein: 0, carbs: 0, fat: 2.5 })
})

// ── pickDefaultServing ────────────────────────────────────────────────────

test('milk defaults to the cup, not the 100 g metric entry', () => {
  const servings = [
    srv('100 g', { is_default: '1' }),
    srv('1 cup (244g)'),
    srv('1 fl oz (30g)'),
  ]
  assert.equal(pickDefaultServing(servings)?.serving_description, '1 cup (244g)')
})

test('synthetic __ servings are never the default but stay in the list', () => {
  const servings = [
    srv('1 breast (172g)'),
    srv('100 g', { serving_id: '__100g', is_default: '1' }),
    srv('1 g', { serving_id: '__1g' }),
  ]
  assert.equal(pickDefaultServing(servings)?.serving_id, '1 breast (172g)')
})

test('a whole unit beats a fraction of the same unit', () => {
  const servings = [srv('0.25 cup (60g)'), srv('1 cup (240g)')]
  assert.equal(pickDefaultServing(servings)?.serving_description, '1 cup (240g)')
})

test('metric-only foods fall back to FatSecret is_default', () => {
  const servings = [srv('100 g'), srv('250 g', { is_default: '1' })]
  assert.equal(pickDefaultServing(servings)?.serving_description, '250 g')
})

test('is_default breaks a tie between equally-ranked household servings', () => {
  const servings = [srv('1 cup, chopped (120g)'), srv('1 cup, whole (150g)', { is_default: '1' })]
  assert.equal(pickDefaultServing(servings)?.serving_description, '1 cup, whole (150g)')
})

test('empty / undefined servings return null', () => {
  assert.equal(pickDefaultServing(undefined), null)
  assert.equal(pickDefaultServing([]), null)
})

// ── UNIT_PRIORITY shadowing matrix ────────────────────────────────────────
// First-match-wins keyword table. Three of these have been bitten by declaration order in this
// codebase already. Pin one canonical example to the row that must own it: each example is put up
// against the canonical example of EVERY other row, and must win iff its row is higher priority.

const ROWS: { row: number; label: string; example: string }[] = [
  { row: 0, label: 'cup',       example: '1 cup (240g)' },
  { row: 1, label: 'container', example: '1 container (170g)' },
  { row: 2, label: 'item-noun', example: '1 breast (172g)' },
  { row: 3, label: 'size-word', example: '1 medium (118g)' },
  { row: 4, label: 'fl oz',     example: '1 fl oz (30g)' },
  { row: 5, label: 'oz',        example: '1 oz (28g)' },
  { row: 6, label: 'tbsp',      example: '1 tbsp (16g)' },
  { row: 7, label: 'tsp',       example: '1 tsp (5g)' },
]

for (const a of ROWS) {
  for (const b of ROWS) {
    if (a.row >= b.row) continue
    test(`priority: "${a.example}" (${a.label}) beats "${b.example}" (${b.label})`, () => {
      // Both orderings — a stable-sort accident would only show up in one of them.
      assert.equal(pickDefaultServing([srv(a.example), srv(b.example)])?.serving_description, a.example)
      assert.equal(pickDefaultServing([srv(b.example), srv(a.example)])?.serving_description, a.example)
    })
  }
}

test('"1 fl oz" is not captured by the plain oz row', () => {
  // \boz\b matches inside "fl oz", so the fl-oz row must come first — it does, but pin it.
  assert.equal(pickDefaultServing([srv('1 oz (28g)'), srv('1 fl oz (30g)')])?.serving_description, '1 fl oz (30g)')
})

test('a serving with no recognised unit never wins over one that has a unit', () => {
  const servings = [srv('1 portion as prepared'), srv('1 tsp (5g)')]
  assert.equal(pickDefaultServing(servings)?.serving_description, '1 tsp (5g)')
})
