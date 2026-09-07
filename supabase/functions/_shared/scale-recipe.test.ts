import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleToTarget, scaleVisualText, isScalable, SCALE_MIN, SCALE_MAX } from './scale-recipe.ts'

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
  assert.equal(out.factor, 1)
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
  assert.ok(out.factor < 1, 'scaled down')
  assert.ok(out.factor >= SCALE_MIN)
  const after = 806 * out.macroFactor
  assert.ok(Math.abs(after - 525) < Math.abs(806 - 525), `moved toward target: ${after.toFixed(0)}`)
})

test('a meal already in band is not touched', () => {
  const out = scaleToTarget(PESTO_BOWL, 540, 525)
  assert.equal(out.factor, 1)
  assert.deepEqual(out.ingredients, PESTO_BOWL)
})

test('the factor is clamped, because past that the dish stops being the dish', () => {
  assert.ok(scaleToTarget(PESTO_BOWL, 4000, 525).factor >= SCALE_MIN)
  assert.ok(scaleToTarget(PESTO_BOWL, 100, 525).factor <= SCALE_MAX)
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
