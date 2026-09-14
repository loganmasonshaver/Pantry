import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleToTarget, scaleVisualText, isScalable, topUpProtein, anchorCap, clampPortions, scaleIngredient, SCALE_MIN, SCALE_MAX, DENSE_MIN, roundGrams, roundIngredientGrams, fundProtein } from './scale-recipe.ts'

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


// ── protein first ─────────────────────────────────────────────────────────────────────────────
// Logan's row 503 (2026-09-12): 32g against a 40g target on 140g of ground beef. "Why not more beef?"
const BOLOGNESE = [
  { name: 'ground beef', visual: '1 cup', grams: '140g' },
  { name: 'tomato sauce', visual: '½ cup', grams: '120g' },
  { name: 'red potatoes', visual: '2 medium', grams: '200g' },
  { name: 'yellow onion', visual: '¼ cup', grams: '40g' },
  { name: 'olive oil', visual: '1 tsp', grams: '5ml' },
]

test('the protein anchor grows toward the target, and only the anchor', () => {
  const out = topUpProtein(BOLOGNESE, 32, 40, 546, 735)
  const beef = out.ingredients[0]
  assert.ok(parseFloat(String(beef.grams)) > 160 && parseFloat(String(beef.grams)) <= 250, `beef grew: ${beef.grams}`)
  assert.ok(out.added.protein >= 7, `+${out.added.protein.toFixed(1)}g protein`)
  for (let i = 1; i < BOLOGNESE.length; i++) assert.deepEqual(out.ingredients[i], BOLOGNESE[i], 'nothing else moves')
  assert.match(out.reason, /ground beef 140g → \d+g/)
})

test('a meal at target is left alone', () => {
  assert.equal(topUpProtein(BOLOGNESE, 41, 40, 546, 735).added.protein, 0)
})

test('the portion cap and the calorie ceiling both bind', () => {
  const big = [{ name: 'chicken breast', visual: '250g', grams: '250g' }, { name: 'cooked rice', visual: '1 cup', grams: '180g' }]
  assert.equal(topUpProtein(big, 50, 80, 600, 900).added.protein, 0, 'chicken is already at 250g')
  const tight = topUpProtein(BOLOGNESE, 32, 60, 546, 560)
  assert.ok(tight.added.kcal <= 15, `ceiling held: +${tight.added.kcal.toFixed(0)} kcal`)
})

test('counted eggs are not an anchor, and protein powder is capped at a scoop and a half', () => {
  const eggs = [{ name: 'eggs', visual: '2 large', grams: '100g' }, { name: 'cooked rice', visual: '1 cup', grams: '180g' }]
  assert.equal(topUpProtein(eggs, 14, 40, 400, 700).added.protein, 0)
  assert.equal(anchorCap('chocolate protein powder'), 60)
  assert.equal(anchorCap('ground beef'), 250)
  assert.equal(anchorCap('non-fat plain greek yogurt'), 350)
  const shake = [{ name: 'protein powder', visual: '1 scoop', grams: '30g' }, { name: 'milk', visual: '1 cup', grams: '240ml' }]
  const out = topUpProtein(shake, 30, 60, 300, 700)
  assert.ok(parseFloat(String(out.ingredients[0].grams)) <= 60, `powder capped: ${out.ingredients[0].grams}`)
})

test('the anchor that buys the most protein per calorie grows first', () => {
  const two = [{ name: 'chicken breast', visual: '100g', grams: '100g' }, { name: 'ground beef', visual: '100g', grams: '100g' }, { name: 'cooked rice', visual: '1 cup', grams: '180g' }]
  const out = topUpProtein(two, 45, 60, 600, 900)
  assert.ok(parseFloat(String(out.ingredients[0].grams)) > 100, 'chicken (leaner) grew')
  assert.equal(String(out.ingredients[1].grams), '100g', 'beef did not')
})


// Replaying Logan's Thai Peanut Sauce Beef Stir-Fry (row 503) through the first draft grew the SOY
// SAUCE from 15ml to 115ml: 8g protein per 100g at 53 kcal is the best ratio in the dish.
test('a condiment is never the protein anchor', () => {
  const stirFry = [
    { name: 'ground beef', visual: '1 cup', grams: '130g' }, { name: 'cooked rice', visual: '½ cup', grams: '90g' },
    { name: 'peanut butter', visual: '1 tbsp', grams: '16g' }, { name: 'soy sauce', visual: '1 tbsp', grams: '15ml' },
  ]
  const out = topUpProtein(stirFry, 32, 40, 531, 735)
  assert.match(out.reason, /^ground beef/)
  assert.equal(String(out.ingredients[3].grams), '15ml', 'soy sauce untouched')
})


// ── portions ──────────────────────────────────────────────────────────────────────────────────
// Logan's phone, 2026-09-13 13:26: "Egg White and Vegetable Scramble", 504g of liquid egg whites in
// one serving — the model wrote 360g, then the calorie resize grew it 1.4x to look like 525 kcal.
const SCRAMBLE = [
  { name: 'liquid egg whites', visual: '1½ cups', grams: '360g' },
  { name: 'leafy greens', visual: '2 handfuls', grams: '60g' },
  { name: 'yellow onion', visual: '¼ cup', grams: '30g' },
  { name: 'butter', visual: '1 tbsp', grams: '14g' },
]

test('the calorie resize grows dense food first and never pushes a protein past its portion', () => {
  const out = scaleToTarget(SCRAMBLE, 298, 525)
  const whites = parseFloat(String(out.ingredients[0].grams))
  assert.ok(whites <= 360, `egg whites did not grow: ${whites}g`)
  assert.ok(parseFloat(String(out.ingredients[3].grams)) > 14, 'butter (dense) grew instead')
})

test('a protein written past its portion is clamped back before anything else runs', () => {
  const out = clampPortions([{ name: 'liquid egg whites', visual: '2 cups', grams: '504g' }, { name: 'butter', visual: '1 tbsp', grams: '14g' }])
  assert.equal(String(out.ingredients[0].grams), '350g')
  assert.deepEqual(out.clamped, ['liquid egg whites 504g → 350g'])
  assert.ok(out.factors.protein < 0.75 && out.factors.protein > 0.65, `macros follow: x${out.factors.protein.toFixed(2)}`)
  assert.equal(clampPortions(SCRAMBLE).clamped.length, 0, 'a normal portion is left alone')
  assert.equal(anchorCap('eggs'), 250, 'five eggs is a lot; ten is not a meal')
  assert.equal(anchorCap('liquid egg whites'), 350)
})

test('a scaled count keeps its grams honest', () => {
  const eggs = scaleIngredient({ name: 'eggs', visual: '4 large', grams: '200g' }, 1.395)
  assert.equal(eggs.visual, '6 large')
  assert.equal(eggs.grams, '300g', 'six eggs weigh 300g, not 279g')
})

test('grams round to a number a cook weighs to; a protein anchor only ever rounds up', () => {
  assert.equal(roundGrams(147), 150)
  assert.equal(roundGrams(143), 140)
  assert.equal(roundGrams(143, 'up'), 150)
  assert.equal(roundGrams(109), 110)
  assert.equal(roundGrams(49), 50)
  assert.equal(roundGrams(42), 40)
  assert.equal(roundGrams(42, 'up'), 45)
  assert.equal(roundGrams(7), 7)
  assert.equal(roundGrams(1), 1)
  assert.equal(roundGrams(100), 100)
  assert.equal(roundGrams(100, 'up'), 100, 'already on the step')
})

// Run 759: 147 g of ground beef at 39 g protein against a 40 g target.
test('run 759: the beef rounds up to 150 g, the card gains the protein, a bare-gram visual follows', () => {
  const r = roundIngredientGrams([
    { name: 'ground beef', grams: '147g', visual: '147g' },
    { name: 'cooked rice', grams: '100g', visual: '½ cup' },
    { name: 'pineapple', grams: '109g', visual: '¾ cup' },
    { name: 'pecans', grams: '7g', visual: '¾ tbsp' },
    { name: 'oat milk', grams: '168ml', visual: '¾ cup' },
  ])
  assert.equal(r.changed, true)
  assert.deepEqual(r.ingredients.map(i => i.grams), ['150g', '100g', '110g', '7g', '170ml'])
  assert.equal(r.ingredients[0].visual, '150g', 'a visual that is only the figure is rewritten')
  assert.equal(r.ingredients[2].visual, '¾ cup', 'a measure is left alone')
  assert.ok(r.delta.protein > 0 && r.delta.protein < 1, `beef +3 g is about half a gram of protein: ${r.delta.protein}`)
})

test('rounding is a no-op on numbers already round, and never touches a count-only item', () => {
  const r = roundIngredientGrams([{ name: 'eggs', grams: '150g', visual: '3 large' }, { name: 'salt', grams: '2g', visual: 'to taste' }, { name: 'garlic', visual: '2 cloves' }])
  assert.equal(r.changed, false)
  assert.deepEqual(r.delta, { protein: 0, kcal: 0, carbs: 0, fat: 0 })
})

// Run 759's beef and rice bowl after the resize: at the calorie ceiling with the beef short. The
// plain top-up can add nothing; funding takes the calories from the rice first.
test('fundProtein cuts the rice to grow the beef when the ceiling stops the plain top-up', () => {
  const ings = [
    { name: 'ground beef', grams: '160g', visual: '160g' }, { name: 'cooked rice', grams: '120g', visual: '¾ cup' },
    { name: 'barbecue sauce', grams: '15g', visual: '1 tbsp' }, { name: 'yellow onion', grams: '40g', visual: '1/4 medium' },
    { name: 'cooking oil', grams: '8ml', visual: '½ tbsp' }, { name: 'salt', grams: '2g', visual: 'to taste' },
  ]
  const target = 40, ceiling = 604, protein = 33, kcal = 600
  const plain = topUpProtein(ings, protein, target, kcal, ceiling)
  assert.ok(plain.added.protein < 1, `the plain top-up is ceiling-bound: ${plain.reason}`)
  const fund = fundProtein(ings, protein, target, kcal, ceiling)
  const g = (name: string) => parseFloat(String(fund.ingredients.find(i => i.name === name)?.grams))
  assert.ok(g('cooked rice') < 120, `rice was cut: ${fund.reason}`)
  assert.ok(g('cooked rice') >= 60, 'never below half of the original')
  assert.ok(g('ground beef') > 160, `beef grew: ${fund.reason}`)
  assert.ok(protein + fund.added.protein >= target - 0.5, `protein reaches the target: ${protein + fund.added.protein}`)
  assert.ok(kcal + fund.added.kcal <= ceiling + 1, `calories stay inside the ceiling: ${kcal + fund.added.kcal}`)
  assert.ok(fund.cut.length >= 1, `rice, and the oil if the rice alone was not enough: ${fund.cut.join(' | ')}`)
  assert.equal(g('barbecue sauce'), 15, 'a condiment is never the thing that gets cut')
})

test('fundProtein is the plain top-up when the anchor fits without a cut, and a no-op at target', () => {
  // '120g', not '1 breast': a counted item is fixed by design and the top-up refuses to grow it.
  const ings = [{ name: 'chicken breast', grams: '120g', visual: '120g' }, { name: 'cooked rice', grams: '150g', visual: '1 cup' }]
  const fits = fundProtein(ings, 30, 40, 400, 700)
  assert.deepEqual(fits.cut, [])
  assert.ok(fits.added.protein > 9, fits.reason)
  assert.equal(fundProtein(ings, 41, 40, 500, 604).added.protein, 0)
})
