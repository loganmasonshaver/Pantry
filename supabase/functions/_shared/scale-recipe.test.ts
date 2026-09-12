import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleToTarget, scaleVisualText, isScalable, SCALE_MIN, SCALE_MAX, DENSE_MIN } from './scale-recipe.ts'

// The real over-shooting recipe this was written for: 806 kcal against a 525 target.
const PESTO_BOWL = [
  { name: 'chicken', visual: '1 palm-sized piece', grams: '200g' },
  { name: 'cooked rice', visual: '1 cup', grams: '180g' },
  { name: 'pesto', visual: '2 tbsp', grams: '32g' },
  { name: 'leafy greens', visual: '1 handful', grams: '30g' },
]

// A recipe whose quantities are all COUNTED. This is the "0.5 large eggs" case.
const EGG_PLATE = [
  { name: 'eggs', visual: '3 large', grams: '150g' },
  { name: 'bread', visual: '2 slices', grams: '60g' },
  { name: 'garlic', visual: '2 cloves', grams: '6g' },
]

test('a counted ingredient is never scalable', () => {
  for (const ing of EGG_PLATE) assert.equal(isScalable(ing), false, JSON.stringify(ing))
})

test('a measured ingredient is scalable', () => {
  assert.equal(isScalable({ visual: '1 cup' }), true)
  assert.equal(isScalable({ visual: '2 tbsp' }), true)
  assert.equal(isScalable({ visual: '1 palm-sized piece' }), true)
  assert.equal(isScalable({ visual: '30g' }), true)
})

// The landmine CLAUDE.md names by name. Obeyed by construction, not by rounding afterwards.
test('an all-counted recipe is left completely alone rather than producing half an egg', () => {
  const out = scaleToTarget(EGG_PLATE, 900, 525)
  assert.equal(out.denseFactor, 1)
  assert.equal(out.leanFactor, 1)
  assert.equal(out.macroFactor, 1)
  assert.deepEqual(out.ingredients, EGG_PLATE)
  assert.match(out.reason, /counted/)
})

test('counted ingredients survive untouched inside a mixed recipe', () => {
  const mixed = [...EGG_PLATE, { name: 'olive oil', visual: '3 tbsp', grams: '45g' }]
  const out = scaleToTarget(mixed, 900, 525)
  for (let i = 0; i < EGG_PLATE.length; i++) assert.deepEqual(out.ingredients[i], EGG_PLATE[i])
})

test('an over-sized recipe comes down and lands nearer the target', () => {
  const out = scaleToTarget(PESTO_BOWL, 806, 525)
  assert.ok(out.denseFactor < 1, 'scaled down')
  assert.ok(out.denseFactor >= DENSE_MIN)
  assert.ok(out.leanFactor >= SCALE_MIN)
  const after = 806 * out.macroFactor
  assert.ok(Math.abs(after - 525) < Math.abs(806 - 525), `moved toward target: ${after.toFixed(0)}`)
})

test('a meal already in band is not touched', () => {
  const out = scaleToTarget(PESTO_BOWL, 540, 525)
  assert.equal(out.macroFactor, 1)
  assert.deepEqual(out.ingredients, PESTO_BOWL)
})

test('the factor is clamped, because past that the dish stops being the dish', () => {
  const down = scaleToTarget(PESTO_BOWL, 4000, 525)
  assert.ok(down.denseFactor >= DENSE_MIN && down.leanFactor >= SCALE_MIN)
  const up = scaleToTarget(PESTO_BOWL, 100, 525)
  assert.ok(up.denseFactor <= SCALE_MAX && up.leanFactor <= SCALE_MAX)
})

test('bad input never mangles a recipe', () => {
  for (const bad of [[undefined, 806, 525], [PESTO_BOWL, 0, 525], [PESTO_BOWL, 806, 0]] as const) {
    const out = scaleToTarget(bad[0] as never, bad[1], bad[2])
    assert.equal(out.macroFactor, 1)
  }
})

test('grams and visual move together, so they cannot desync', () => {
  const out = scaleToTarget(PESTO_BOWL, 806, 525)
  const rice = out.ingredients.find(i => i.name === 'cooked rice')!
  assert.notEqual(String(rice.grams), '180g')
  assert.notEqual(String(rice.visual), '1 cup')
  assert.match(String(rice.grams), /^\d+g$/, 'grams keeps its unit')
})

test('scaleVisualText keeps ranges, units and qualitative text', () => {
  assert.equal(scaleVisualText('1 cup', 0.5), '½ cup')
  assert.equal(scaleVisualText('2 tbsp', 0.75), '1½ tbsp')
  assert.equal(scaleVisualText('3-4 slices', 2), '6-8 slices')
  assert.equal(scaleVisualText('1/2 tsp', 2), '1 tsp')
  assert.equal(scaleVisualText('to taste', 0.5), 'to taste')
  assert.equal(scaleVisualText('a drizzle', 2), 'a drizzle')
  assert.equal(scaleVisualText(undefined, 2), undefined)
})

test('the unit agrees with the scaled number, so no "1 cups"', () => {
  assert.equal(scaleVisualText('2 cups', 0.5), '1 cup')
  assert.equal(scaleVisualText('1 cup', 2), '2 cups')
  // Abbreviations never take a plural — "3 tbsps" is not how a recipe is written.
  assert.equal(scaleVisualText('1 tbsp', 3), '3 tbsp')
  assert.equal(scaleVisualText('2 scoops', 0.5), '1 scoop')
  // A fractional amount is still "less than one of them" grammatically.
  assert.equal(scaleVisualText('2 cups', 0.25), '½ cup')
  // Only a recognised unit agrees. A hyphenated eyeball descriptor is left exactly as written
  // rather than guessed at — the food itself is never pluralised.
  assert.equal(scaleVisualText('1 palm-sized piece', 2), '2 palm-sized piece')
})

// Real regression: "1½ cups" of rice x0.70 is 1.05, which formats to "1" but is greater than one.
// The plural decision has to read the rounded value or it prints "1 cups".
test('the plural follows the number the reader sees, not the raw value', () => {
  assert.equal(scaleVisualText('1½ cups', 0.7), '1 cup')
  assert.equal(scaleVisualText('1 cup', 1.05), '1 cup')
})

// This function's OWN output uses ½ ¼ ¾, so a visual that has already been scaled once must
// survive being scaled again. "1½ cups" x0.7 produced "¾½ cups" before the glyph was consumed
// together with its whole number.
test('glyph fractions scale instead of being mangled', () => {
  assert.equal(scaleVisualText('1½ cups', 0.7), '1 cup')
  assert.equal(scaleVisualText('½ cup', 2), '1 cup')
  assert.equal(scaleVisualText('2½ scoops', 0.4), '1 scoop')
  assert.equal(scaleVisualText('¾ tsp', 2), '1½ tsp')
})

test('under a quarter cup, the visual switches to tablespoons instead of freezing at ¼', () => {
  assert.equal(scaleVisualText('¼ cup', 0.5), '2 tbsp')
  assert.equal(scaleVisualText('¼ cup chopped', 0.5), '2 tbsp chopped')
  assert.equal(scaleVisualText('½ cup', 0.5), '¼ cup')
})

// ── protein first ─────────────────────────────────────────────────────────────────────────────
// Cook Tonight run 48, BEFORE the old scaler touched it (quantities from the FatSecret trace):
// 784 kcal, ~46g protein. The old uniform cut shipped 549 kcal and 33g.
const COTTAGE_BOWL = [
  { name: 'cottage cheese', visual: '1½ cups', grams: '341g' },
  { name: 'cooked rice', visual: '1 cup', grams: '180g' },
  { name: 'pecans', visual: '¼ cup', grams: '30g' },
  { name: 'black pepper', visual: 'to taste', grams: '1g' },
]

test('calorie-dense food is cut before protein', () => {
  const out = scaleToTarget(COTTAGE_BOWL, 784, 525)
  const g = (n: string) => out.ingredients.find(i => i.name === n)!.grams
  assert.equal(g('cottage cheese'), '341g', 'the protein anchor is untouched')
  assert.equal(g('cooked rice'), '90g')
  assert.equal(g('pecans'), '15g')
  assert.equal(out.ingredients.find(i => i.name === 'pecans')!.visual, '2 tbsp', 'visual agrees with the grams')
  assert.ok(out.factors.protein > 0.9, `protein kept: x${out.factors.protein.toFixed(2)}`)
  assert.ok(784 * out.macroFactor <= 525 * 1.15, `in band: ${(784 * out.macroFactor).toFixed(0)}`)
})

test('the protein anchor survives in the pesto bowl too', () => {
  const out = scaleToTarget(PESTO_BOWL, 806, 525)
  assert.equal(out.ingredients.find(i => i.name === 'chicken')!.grams, '200g')
  assert.ok(out.factors.protein > out.macroFactor, 'protein falls less than calories')
})

test('lean food is trimmed only when dense food cannot get the dish into band', () => {
  const lean = [
    { name: 'chicken', visual: '300g', grams: '300g' },
    { name: 'olive oil', visual: '1 tsp', grams: '5g' },
  ]
  const out = scaleToTarget(lean, 900, 525)
  assert.ok(out.leanFactor < 1 && out.leanFactor >= SCALE_MIN)
  // To the band's edge, not the target: past that it is protein given up for nothing.
  assert.ok(900 * out.macroFactor > 525, `stops at the edge: ${(900 * out.macroFactor).toFixed(0)}`)
})

// Run 48's wrap: two counted eggs and three measured items at 690 kcal. The old formula moved the
// measured share by the plain ratio and shipped 559 against 525.
test('counted food no longer leaves the result short of target', () => {
  const wrap = [
    { name: 'eggs', visual: '2 large', grams: '100g' },
    { name: 'shredded cheese', visual: '½ cup', grams: '56g' },
    { name: 'cooked rice', visual: '1 cup', grams: '180g' },
    { name: 'butter', visual: '1 tbsp', grams: '14g' },
  ]
  const down = scaleToTarget(wrap, 690, 525)
  assert.equal(down.ingredients[0].grams, '100g')
  assert.ok(Math.abs(690 * down.macroFactor - 525) < 525 * 0.02, `${(690 * down.macroFactor).toFixed(0)}`)
  const small = [{ name: 'eggs', visual: '2 large', grams: '100g' }, { name: 'cooked rice', visual: '1 cup', grams: '180g' }]
  const up = scaleToTarget(small, 430, 525)
  assert.ok(Math.abs(430 * up.macroFactor - 525) < 525 * 0.02, `${(430 * up.macroFactor).toFixed(0)}`)
})

// The asian pantry on a cutting target (467 kcal) shipped 690 kcal meals: "1 pack" of udon and
// "15 large" shrimp were counted, so the only movable food left was a spoon of soy sauce.
test('a count of four or more is bulk and scales to whole items', () => {
  assert.equal(isScalable({ visual: '15 large' }), true)
  assert.equal(isScalable({ visual: '8 florets' }), true)
  assert.equal(isScalable({ visual: '3 large' }), false, 'the 0.5-egg landmine stays shut')
  assert.equal(isScalable({ visual: '2 medium' }), false)
  assert.equal(isScalable({ visual: '1 pack' }), false)
  assert.equal(scaleVisualText('15 large', 0.7), '11 large')
  assert.equal(scaleVisualText('8 florets', 0.5), '4 florets')
  assert.equal(scaleVisualText('4 slices', 0.3), '1 slices', 'never below one')
  // Measured visuals keep their fractions.
  assert.equal(scaleVisualText('1 cup', 0.5), '½ cup')
})

test('the cutting-target shrimp bowl now comes down', () => {
  const meal = [
    { name: 'shrimp', grams: '170g', visual: '15 large' },
    { name: 'udon', grams: '200g', visual: '1 pack' },
    { name: 'frozen edamame', grams: '56g', visual: '¼ cup' },
    { name: 'soy sauce', grams: '11ml', visual: '¾ tbsp' },
  ]
  const out = scaleToTarget(meal, 689, 467)
  assert.ok(689 * out.macroFactor < 620, `moved well down: ${(689 * out.macroFactor).toFixed(0)}`)
  assert.equal(out.ingredients[0].visual, '11 large')
})

// "1¼ pinchs" reached a real recipe.
test('units ending in ch/sh take -es', () => {
  assert.equal(scaleVisualText('1 pinch', 1.25), '1¼ pinches')
  assert.equal(scaleVisualText('1 dash', 2), '2 dashes')
  assert.equal(scaleVisualText('1 splash', 2), '2 splashes')
  assert.equal(scaleVisualText('1 cup', 2), '2 cups')
})
