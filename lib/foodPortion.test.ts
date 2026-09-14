import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FoodServing } from './fatsecretServing.ts'
import {
  availableUnits, metricBasis, portionMetric, fatsecretNutrients, applyOverride, correctionPortion,
  legacyBasis, logFields, unitFromLog, unitKey, unitFromKey, parseAmount, formatAmount, convertAmount,
  calorieSplit, dayImpact, unitLabel, servingTitle, portionText, correctionToStore, defaultCorrectionPortion, correctionStartAmount, type Override, type Unit,
} from './foodPortion.ts'

const srv = (id: string, desc: string, kcal: number, p: number, c: number, f: number, grams?: number, unit = 'g', extra: Partial<FoodServing> = {}): FoodServing => ({
  serving_id: id, serving_description: desc,
  calories: String(kcal), protein: String(p), carbohydrate: String(c), fat: String(f),
  metric_serving_amount: grams === undefined ? undefined : String(grams), metric_serving_unit: grams === undefined ? undefined : unit,
  ...extra,
})

// Cheddar, FatSecret-shaped: normalizeServings has already appended "(113g)".
const cheddar = [
  srv('c1', '1 cup shredded (113g)', 455, 28, 1.5, 37, 113, 'g', { fiber: '0', sodium: '702' }),
  srv('c2', '1 slice (21g)', 85, 5.2, 0.3, 6.9, 21),
  srv('c3', '0.5 cup', 228, 14, 0.8, 18.5),
]
// Whole milk: the shape of the one correction in production (fatsecret:794, 150/8/11/8 = 1 cup).
const milk = [
  srv('m1', '1 cup (244g)', 149, 7.7, 11.7, 7.9, 244),
  srv('m2', '1 fl oz (30g)', 18, 1, 1.4, 1, 30.5),
]
const honey = [srv('h1', '1 tbsp', 64, 0.1, 17.3, 0, 15, 'ml')]
const noMetric = [srv('n1', '1 bar', 200, 20, 22, 7)]

const cup: Unit = { kind: 'serving', servingId: 'c1' }
const slice: Unit = { kind: 'serving', servingId: 'c2' }
const grams: Unit = { kind: 'g' }

test('REGRESSION: a cup correction logged by the gram scales by weight — it used to log 36,000 kcal', () => {
  const override: Override = { calories: 150, protein: 8, carbs: 11, fat: 8, ...legacyBasis(milk, milk[0])! }
  const base = fatsecretNutrients(grams, 240, milk)!
  const { nutrients, overridden } = applyOverride(base, override, grams, 240, milk)
  assert.equal(overridden, true)
  assert.equal(Math.round(nutrients.calories), Math.round(150 * 240 / 244)) // 148, not 36,000
})

test('a correction made on the cup scales onto the slice by weight', () => {
  const override: Override = { calories: 400, protein: 30, carbs: 1, fat: 30, ...correctionPortion(cup, cheddar).basis }
  const { nutrients } = applyOverride(fatsecretNutrients(slice, 1, cheddar)!, override, slice, 1, cheddar)
  assert.equal(Math.round(nutrients.calories), Math.round(400 * 21 / 113))
})

test('a correction with no weight applies only to the serving it was made on', () => {
  const override: Override = { calories: 250, protein: 25, carbs: 20, fat: 8, basis_amount: null, basis_unit: null, serving_id: 'n1' }
  const bar: Unit = { kind: 'serving', servingId: 'n1' }
  assert.equal(applyOverride(fatsecretNutrients(bar, 2, noMetric)!, override, bar, 2, noMetric).nutrients.calories, 500)
  // cheddar's half-cup has no weight — a cup correction reaches it by RATIO to FatSecret's cup
  const half: Unit = { kind: 'serving', servingId: 'c3' }
  const cupFix: Override = { ...override, serving_id: 'c1' }
  const viaRatio = applyOverride(fatsecretNutrients(half, 1, cheddar)!, cupFix, half, 1, cheddar)
  assert.equal(viaRatio.overridden, true)
  assert.equal(Math.round(viaRatio.nutrients.calories), Math.round(228 * 250 / 455))
  // a correction whose serving no longer exists on the food cannot be scaled at all
  const orphan: Override = { ...override, serving_id: 'zzz' }
  assert.equal(applyOverride(fatsecretNutrients(half, 1, cheddar)!, orphan, half, 1, cheddar).overridden, false)
})

test('a gram correction never applies to a millilitre portion', () => {
  const override: Override = { calories: 999, protein: 0, carbs: 0, fat: 0, basis_amount: 100, basis_unit: 'g', serving_id: null }
  const ml: Unit = { kind: 'ml' }
  assert.equal(applyOverride(fatsecretNutrients(ml, 30, honey)!, override, ml, 30, honey).overridden, false)
})

test('units: servings, then grams + ounces for a gram basis, millilitres for a volume basis, nothing for neither', () => {
  assert.deepEqual(availableUnits(cheddar).map(u => u.kind), ['serving', 'serving', 'serving', 'g', 'oz'])
  assert.deepEqual(availableUnits(honey).map(u => u.kind), ['serving', 'ml'])
  assert.deepEqual(availableUnits(noMetric).map(u => u.kind), ['serving'])
  // synthetic servings from an older build are not offered as servings
  assert.deepEqual(availableUnits([...cheddar, srv('__100g', '100 g', 403, 25, 1, 33, 100)]).length, 5)
})

test('the basis is the largest gram serving', () => {
  assert.equal(metricBasis(cheddar)!.ref.serving_id, 'c1')
  assert.equal(metricBasis(honey)!.unit, 'ml')
})

test('FatSecret nutrients by serving, by gram and by ounce agree', () => {
  assert.equal(fatsecretNutrients(cup, 2, cheddar)!.calories, 910)
  assert.equal(Math.round(fatsecretNutrients(grams, 113, cheddar)!.calories), 455)
  assert.equal(Math.round(fatsecretNutrients({ kind: 'oz' }, 1, cheddar)!.calories), Math.round(455 * 28.349523125 / 113))
  assert.equal(fatsecretNutrients({ kind: 'g' }, 100, noMetric), null)
})

test('extras scale, and a value FatSecret does not have stays undefined rather than 0', () => {
  const n = fatsecretNutrients(cup, 2, cheddar)!
  assert.equal(n.sodium, 1404)
  assert.equal(n.sugar, undefined)
})

test('log fields round-trip through unitFromLog', () => {
  for (const [u, a] of [[cup, 2], [grams, 150], [{ kind: 'oz' }, 1.5], [{ kind: 'ml' }, 30]] as [Unit, number][]) {
    const f = logFields(u, a)
    const back = unitFromLog(f.serving_id, f.quantity, [...cheddar, ...honey], cheddar[0])
    assert.deepEqual(back, { unit: u, amount: a })
  }
})

test('old synthetic serving ids reopen as weight, and an unknown id falls back to the default serving', () => {
  assert.deepEqual(unitFromLog('__100g', 1.5, cheddar, cheddar[0]), { unit: grams, amount: 150 })
  assert.deepEqual(unitFromLog('gone', 3, cheddar, cheddar[0]), { unit: cup, amount: 3 })
})

test('unit keys round-trip, and a key for a unit the food lacks is null', () => {
  assert.deepEqual(unitFromKey(unitKey(slice), cheddar), slice)
  assert.deepEqual(unitFromKey('oz', cheddar), { kind: 'oz' })
  assert.equal(unitFromKey('oz', noMetric), null)
  assert.equal(unitFromKey('serving:missing', cheddar), null)
})

test('amount parsing: comma decimals, and zero / empty / junk are not amounts', () => {
  assert.equal(parseAmount('1,5'), 1.5)
  for (const t of ['', '0', '.', 'abc', '-2']) assert.equal(parseAmount(t), null)
})

test('amount formatting per unit', () => {
  assert.equal(formatAmount(113.4, grams), '113')
  assert.equal(formatAmount(2.5, grams), '2.5')
  assert.equal(formatAmount(1.4999, { kind: 'oz' }), '1.5')
  assert.equal(formatAmount(1.333333, cup), '1.33')
})

test('switching unit keeps the portion', () => {
  assert.equal(convertAmount(cup, 1, grams, cheddar), 113)
  assert.equal(Math.round(convertAmount(grams, 226, cup, cheddar) * 100) / 100, 2)
  assert.equal(Math.round(convertAmount(slice, 1, cup, cheddar) * 1000) / 1000, Math.round(21 / 113 * 1000) / 1000)
  // no weight for the half cup → a starting amount, not a wrong conversion
  assert.equal(convertAmount({ kind: 'serving', servingId: 'c3' }, 1, grams, cheddar), 100)
})

test('calorie split: cheddar reads 25 / 1 / 74, and the three always sum to 100', () => {
  assert.deepEqual(calorieSplit({ calories: 455, protein: 28, carbs: 1, fat: 37 }), { protein: 25, carbs: 1, fat: 74 })
  const s = calorieSplit({ calories: 80, protein: 8, carbs: 12, fat: 0 })!
  assert.equal(s.protein + s.carbs + s.fat, 100)
  assert.equal(calorieSplit({ calories: 0, protein: 0, carbs: 0, fat: 0 }), null)
})

test('day impact: logging adds on top, editing replaces the entry instead of counting it twice', () => {
  assert.deepEqual(dayImpact(2200, 620, 455), { basePct: (620 / 2200) * 100, addPct: (455 / 2200) * 100, left: 1125 })
  const edit = dayImpact(2200, 1075, 161, 455)
  assert.equal(edit.left, 2200 - 620 - 161)
  const over = dayImpact(2000, 1900, 400)
  assert.equal(over.left, -300)
  assert.ok(over.basePct + over.addPct <= 100)
})

test('labels: the grams suffix is stripped, "1 " drops beside the number, fractions keep theirs', () => {
  assert.equal(servingTitle(cheddar[0]), '1 cup shredded')
  assert.equal(unitLabel(cup, cheddar), 'cup shredded')
  assert.equal(unitLabel({ kind: 'serving', servingId: 'c3' }, cheddar), '× 0.5 cup')
  assert.equal(unitLabel({ kind: 'ml' }, honey), 'milliliters')
})

test('portion metric for a serving with no weight is unknown', () => {
  assert.equal(portionMetric({ kind: 'serving', servingId: 'n1' }, 1, noMetric), null)
})

test('portion text', () => {
  assert.equal(portionText(cup, 1, cheddar, true), '1 cup shredded (113 g)')
  assert.equal(portionText({ kind: 'serving', servingId: 'c3' }, 2, cheddar), '2 × 0.5 cup')
  assert.equal(portionText(grams, 150, cheddar), '150 g')
})

test('a correction on a millilitre cup still applies when logging grams, by ratio to FatSecret', () => {
  // FatSecret whole milk: the cup is a volume, the gram basis is a separate 100 g serving.
  const milkMl = [
    srv('cup', '1 cup', 146, 7.9, 11.4, 7.9, 244, 'ml'),
    srv('hg', '100 g', 60, 3.2, 4.7, 3.3, 100, 'g'),
  ]
  const override: Override = { calories: 150, protein: 8, carbs: 11, fat: 8, ...legacyBasis(milkMl, milkMl[0])! }
  assert.equal(override.basis_unit, 'ml')
  const base = fatsecretNutrients(grams, 240, milkMl)!
  assert.equal(base.calories, 144)
  const { nutrients, overridden } = applyOverride(base, override, grams, 240, milkMl)
  assert.equal(overridden, true)
  assert.equal(Math.round(nutrients.calories), Math.round(144 * 150 / 146))
})

test('the ratio tier leaves a macro FatSecret reports as 0 at 0', () => {
  const food = [srv('a', '1 bar', 200, 0, 30, 8, 50, 'ml'), srv('b', '100 g', 400, 0, 60, 16, 100, 'g')]
  const override: Override = { calories: 200, protein: 10, carbs: 30, fat: 8, basis_amount: 50, basis_unit: 'ml', serving_id: 'a' }
  const { nutrients } = applyOverride(fatsecretNutrients(grams, 50, food)!, override, grams, 50, food)
  assert.equal(nutrients.protein, 0)
  assert.equal(nutrients.calories, 200)
})

test('a label read as 2 tbsp (32 g) stores per ONE tbsp, and every later portion scales from it', () => {
  const pb = [srv('tb', '1 tbsp (16g)', 95, 3.6, 3.5, 8.1, 16), srv('hg', '100 g', 590, 22, 22, 50, 100)]
  const tbsp: Unit = { kind: 'serving', servingId: 'tb' }
  const { nutrients, basis } = correctionToStore(tbsp, 2, { calories: 190, protein: 7, carbs: 7, fat: 16 }, pb)
  assert.deepEqual(nutrients, { calories: 95, protein: 3.5, carbs: 3.5, fat: 8 })
  assert.deepEqual(basis, { basis_amount: 16, basis_unit: 'g', serving_id: 'tb' })
  const ov: Override = { ...nutrients, ...basis }
  assert.equal(applyOverride(fatsecretNutrients(tbsp, 3, pb)!, ov, tbsp, 3, pb).nutrients.calories, 285)
  assert.equal(Math.round(applyOverride(fatsecretNutrients(grams, 50, pb)!, ov, grams, 50, pb).nutrients.calories), Math.round(190 * 50 / 32))
})

test('a label read as ½ cup doubles to the cup, and a weightless serving × 1.5 normalizes with no basis', () => {
  const { nutrients: perCup, basis } = correctionToStore(cup, 0.5, { calories: 200, protein: 14, carbs: 1, fat: 16 }, cheddar)
  assert.equal(perCup.calories, 400)
  assert.equal(basis.basis_amount, 113)
  const bar: Unit = { kind: 'serving', servingId: 'n1' }
  const n = correctionToStore(bar, 1.5, { calories: 300, protein: 30, carbs: 33, fat: 9 }, noMetric)
  assert.deepEqual(n.basis, { basis_amount: null, basis_unit: null, serving_id: 'n1' })
  assert.equal(n.nutrients.calories, 200)
  const ov: Override = { ...n.nutrients, ...n.basis }
  assert.equal(applyOverride(fatsecretNutrients(bar, 2, noMetric)!, ov, bar, 2, noMetric).nutrients.calories, 400)
})

test('weight portions store as typed with the typed weight as basis', () => {
  const { nutrients, basis } = correctionToStore(grams, 45, { calories: 180, protein: 9, carbs: 20, fat: 6 }, cheddar)
  assert.equal(nutrients.calories, 180)
  assert.deepEqual(basis, { basis_amount: 45, basis_unit: 'g', serving_id: null })
})

test('the sheet opens on the correction\'s serving, else the label serving, else 100 g', () => {
  assert.deepEqual(defaultCorrectionPortion(cheddar, null, cheddar[0]), { unit: cup, amount: 1 })
  const ov: Override = { calories: 1, protein: 0, carbs: 0, fat: 0, basis_amount: 21, basis_unit: 'g', serving_id: 'c2' }
  assert.deepEqual(defaultCorrectionPortion(cheddar, ov, cheddar[0]), { unit: slice, amount: 1 })
  const metricOnly = [srv('__100g', '100 g', 60, 3, 5, 3, 100)]
  assert.deepEqual(defaultCorrectionPortion(metricOnly, null, metricOnly[0]), { unit: grams, amount: 100 })
  assert.equal(correctionStartAmount({ kind: 'ml' }), 100)
  assert.equal(correctionStartAmount(cup), 1)
})
