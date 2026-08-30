// Run: node --test lib/ingredientDisplay.test.ts
//
// These functions transform model-written ingredient strings for display: unit conversion,
// pluralisation, adjective stripping, word reordering. Four transformations over untrusted text,
// with no tests until "7 liquid whites eggs" turned up on a real recipe and made accurate macros
// read as inflated. This file is the sweep of the rest of that family.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanIngredientName, formatHalf, getMeasuredDisplay, getWholeUnitDisplay,
  gramsToProteinScoops, gramsToSeedsSpoons, gramsToSpiceTsp, isAlreadyInList,
  isNeedToBuy, roundDisplayGrams, stripAdjectives, stripStepNumber, toEyeball, toCookingFraction,
  formatQuarter, scaleVisual, countMissingIngredients,
} from './ingredientDisplay.ts'

// ── the two already-fixed bugs, pinned so they cannot come back ────────────────────────────────
test('REGRESSION: a liquid never gets a whole-unit count', () => {
  assert.equal(getWholeUnitDisplay('liquid egg whites', '350g'), null)
  assert.equal(getWholeUnitDisplay('egg whites', '200g'), null) // noun not name-final
  assert.equal(getWholeUnitDisplay('carton of eggs', '300g'), null)
})

test('REGRESSION: the label never repeats the adjective', () => {
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '15g'), { count: '5', name: 'garlic cloves' })
})

test("the creator's stated count beats the grams-derived one", () => {
  // The live defect: "Seasoned Sheet Pan Chicken" stored 900g with visual "6 pieces" and the
  // screen told the cook to use 5. The weights in WHOLE_UNIT_FOODS are population averages;
  // chicken breasts across the live pool run 142-300g each, so grams/average cannot reproduce a
  // count the creator already wrote down.
  assert.deepEqual(getWholeUnitDisplay('chicken breasts', '900g', '6 pieces'), { count: '6', name: 'chicken breasts' })
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '20g', '7 cloves'), { count: '7', name: 'garlic cloves' })
  assert.deepEqual(getWholeUnitDisplay('chicken breast', '300g', '1 large breast'), { count: '1', name: 'chicken breast' })
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '20g', '12'), { count: '12', name: 'garlic cloves' })
  // A range takes the low end.
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '15g', '4-5'), { count: '4', name: 'garlic cloves' })
})

test('a WEIGHT visual is not read as a count', () => {
  // "2 lbs" starts with a digit but is 907g of chicken, not two breasts. Reading it as a count
  // would be a 3x understatement, so these must fall through to the grams-derived path.
  assert.deepEqual(getWholeUnitDisplay('chicken breast', '907g', '2 lb'), { count: '5', name: 'chicken breasts' })
  assert.deepEqual(getWholeUnitDisplay('chicken breast', '900g', '2 lbs'), { count: '5', name: 'chicken breasts' })
  assert.deepEqual(getWholeUnitDisplay('chicken breast', '680g', '1.5 lb'), { count: '4', name: 'chicken breasts' })
  // No visual at all still derives from grams.
  assert.deepEqual(getWholeUnitDisplay('eggs', '150g', undefined), { count: '3', name: 'eggs' })
  // The sub-40% guard still applies to the derived path...
  assert.equal(getWholeUnitDisplay('eggs', '5g'), null)
  // ...but a stated count is the creator's own number and is not second-guessed.
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '2g', '1 clove'), { count: '1', name: 'garlic clove' })
})

test('"pepper" the vegetable and the cheese are not spices', () => {
  // 150g of bell pepper rendered as "25 tbsp" and 120g of pepper jack as "20 tbsp" — the seasoning
  // branch matched \bpepper\b and converted their weight into spoons. Seven live rows read that way.
  assert.equal(getMeasuredDisplay('red bell pepper', '150g', '1'), '150g')
  assert.equal(getMeasuredDisplay('green bell pepper', '150g', '1 medium'), '150g')
  assert.equal(getMeasuredDisplay('pepper jack cheese', '120g', '6 slices'), '120g')
  assert.equal(getMeasuredDisplay('chargrilled peppers', '100g', '2'), '100g')
  // ...and the real spice still goes through the spice branch. "salt & pepper" keeps salt, which is
  // why the non-spice senses are STRIPPED rather than used to negate the whole test.
  assert.equal(getMeasuredDisplay('black pepper', '6g', 'a pinch'), '1 tbsp')
  assert.equal(getMeasuredDisplay('salt & pepper', '6g', 'a pinch'), '1 tsp')
  assert.equal(getMeasuredDisplay('red pepper flakes', '6g', 'a pinch'), '1 tbsp')
  assert.equal(getMeasuredDisplay('white pepper', '2g', 'a pinch'), '1 tsp')
  // Pepperoni needs no rule at all — \b does not match inside the word.
  assert.equal(getMeasuredDisplay('turkey pepperoni', '80g', '34 slices'), '80g')
})

test('a packet is a measurement, and the actionable one', () => {
  // "1 packet ranch seasoning" became "5 tbsp": arithmetically fine, useless in a kitchen and
  // wrong on a grocery list. Six live rows.
  // Count AND size, the way recipe publishers print packaged goods.
  assert.equal(getMeasuredDisplay('ranch seasoning', '30g', '1 packet'), '1 packet (30g)')
  assert.equal(getMeasuredDisplay('fajita seasoning', '60g', '2 packets'), '2 packets (60g)')
  assert.equal(getMeasuredDisplay('chili seasoning', '30g', '1 pack'), '1 pack (30g)')
  // A vague descriptor still falls through to a computed spoon measure — that is why tier 2 exists.
  assert.equal(getMeasuredDisplay('paprika', '6g', 'a pinch'), '1 tbsp')
  assert.equal(getMeasuredDisplay('cumin', '2g', 'to taste'), '1 tsp')
})

test('a container shows the count AND the size, like a recipe site', () => {
  // "1 (24-ounce) jar marinara sauce" (NYT Cooking, Serious Eats), "1 (15-ounce) can black beans"
  // (AllRecipes), "1 x 400g can chopped tomatoes" (BBC Good Food). Count is what you buy, size is
  // what disambiguates, and jar sizes vary between brands — printing one alone forces a choice
  // that printing both does not.
  assert.equal(getMeasuredDisplay('Vodka Sauce', '700g', '1 jar'), '1 jar (700g)')
  assert.equal(getMeasuredDisplay('cream of chicken soup', '300g', '1 can'), '1 can (300g)')
  assert.equal(getMeasuredDisplay('corn', '100g', '1/2 can'), '1/2 can (100g)')
  // Not gated on liquid/seasoning: canned goods and boxed pasta are the most shoppable rows on the
  // list and were rendering as bare grams while the creator had written "1 can".
  assert.equal(getMeasuredDisplay('drained and rinsed black beans', '250g', '1 can'), '1 can (250g)')
  assert.equal(getMeasuredDisplay('Carb Diem elbow pasta', '454g', '2 boxes'), '2 boxes (455g)')
  assert.equal(getMeasuredDisplay('konjac noodles', '200g', '1 pack'), '1 pack (200g)')

  // A creator who already stated the size gets nothing appended, or it reads "1 400g can (400g)".
  assert.equal(getMeasuredDisplay('tomato sauce', '400g', '1 400g can'), '1 400g can')
  assert.equal(getMeasuredDisplay('Sliced jalapeños', '340g', '12 oz jar'), '12 oz jar')

  // NATURAL units get no size. "1 cinnamon stick" and "2 cloves garlic" are how recipes are
  // written; nobody prints a gram weight for a clove.
  assert.equal(getMeasuredDisplay('Cinnamon', '5g', '1 stick'), '1 stick')
  // Plain measures are untouched.
  assert.equal(getMeasuredDisplay('buffalo wing sauce', '355g', '1.5 cups'), '1½ cups')
})

test('decimals render as the fractions a kitchen actually has', () => {
  assert.equal(toCookingFraction('0.75 tsp'), '¾ tsp')
  assert.equal(toCookingFraction('0.5 tsp'), '½ tsp')
  assert.equal(toCookingFraction('0.25 cup'), '¼ cup')
  assert.equal(toCookingFraction('1.5 cups'), '1½ cups')
  assert.equal(toCookingFraction('6.75 cups'), '6¾ cups')
  assert.equal(toCookingFraction('2.5 oz'), '2½ oz')
  // No clean fraction exists for these — left exactly as written rather than rounded into a lie.
  assert.equal(toCookingFraction('1.4 oz'), '1.4 oz')
  assert.equal(toCookingFraction('0.9 tsp'), '0.9 tsp')
  // Reaches the rendered string, not just the helper.
  assert.equal(getMeasuredDisplay('garlic powder', undefined, '0.75 tsp'), '¾ tsp')
  assert.equal(getMeasuredDisplay('chicken broth', undefined, '1.5 cups'), '1½ cups')
})

test('whole-unit counting still works where it should', () => {
  assert.deepEqual(getWholeUnitDisplay('large eggs', '150g'), { count: '3', name: 'large eggs' })
  assert.deepEqual(getWholeUnitDisplay('eggs', '100g'), { count: '2', name: 'eggs' })
  assert.deepEqual(getWholeUnitDisplay('chicken breast', '340g'), { count: '2', name: 'chicken breasts' })
  assert.equal(getWholeUnitDisplay('cottage cheese', '170g'), null)
  assert.equal(getWholeUnitDisplay('eggs', undefined), null)
  assert.equal(getWholeUnitDisplay('eggs', '0g'), null)
})

// ── formatHalf: the rounding bug found in this sweep ───────────────────────────────────────────
test('formatHalf handles whole and half steps', () => {
  assert.equal(formatHalf(1), '1')
  assert.equal(formatHalf(1.5), '1½')
  assert.equal(formatHalf(0.5), '½')
  assert.equal(formatHalf(3), '3')
})

test('formatHalf does not TRUNCATE a value near the next whole number', () => {
  // 3.8 scoops displayed as "3" understates by 20%. Math.floor is only correct for the exact-half
  // case this function was written for; everything else needs rounding.
  assert.equal(formatHalf(3.8), '4', 'should round up, not floor')
  assert.equal(formatHalf(2.9), '3')
  assert.equal(formatHalf(4.2), '4')
})

test('formatHalf does not collapse a small value to zero', () => {
  // whole===0 falls through to `whole || Math.round(n)`, and Math.round(0.3) is 0 -> "0".
  assert.notEqual(formatHalf(0.3), '0', '0.3 of something is not "0"')
})

// ── quantity conversions ───────────────────────────────────────────────────────────────────────
test('protein scoops land on sane fractions', () => {
  assert.equal(gramsToProteinScoops(30), '1 scoop')
  assert.equal(gramsToProteinScoops(15), '½ scoop')
  assert.equal(gramsToProteinScoops(60), '2 scoops')
  assert.equal(gramsToProteinScoops(45), '1½ scoops')
})

test('a large protein dose is not understated', () => {
  // 115g is 3.83 scoops. Anything that renders "3" is wrong by nearly a full scoop.
  const s = gramsToProteinScoops(115)
  assert.notEqual(s, '3 scoops', `115g rendered as ${s}`)
})

test('seed and spice spoons are monotonic — more grams never shows less', () => {
  for (const [fn, name] of [[gramsToSeedsSpoons, 'chia seeds'], [gramsToSpiceTsp, 'paprika']] as const) {
    let prevNum = -1
    for (let g = 1; g <= 40; g++) {
      const out = fn(name, g)
      const m = out.match(/^([\d½¼¾⅛]+)/)
      assert.ok(m, `no leading quantity in "${out}" for ${g}g of ${name}`)
      // only compare within the same unit; tsp -> tbsp legitimately resets the number
      const unit = /tbsp/.test(out) ? 'tbsp' : 'tsp'
      const num = ({ '⅛': 0.125, '¼': 0.25, '½': 0.5, '¾': 0.75 } as Record<string, number>)[m[1]] ?? parseFloat(m[1])
      const scaled = unit === 'tbsp' ? num * 3 : num
      assert.ok(scaled >= prevNum - 1e-9, `${g}g of ${name} -> "${out}" went backwards`)
      prevNum = scaled
    }
  }
})

test('salt is treated as denser than other spices', () => {
  assert.notEqual(gramsToSpiceTsp('salt', 6), gramsToSpiceTsp('paprika', 6))
})

test('roundDisplayGrams cleans only above 20g', () => {
  assert.equal(roundDisplayGrams(44), 45)
  assert.equal(roundDisplayGrams(58), 60)
  assert.equal(roundDisplayGrams(12), 12)
  assert.equal(roundDisplayGrams(2.4), 2)
})

// ── getMeasuredDisplay: the resolution ladder ──────────────────────────────────────────────────
test('measured display routes each ingredient class correctly', () => {
  assert.match(getMeasuredDisplay('whey protein powder', '30g', undefined), /scoop/)
  assert.match(getMeasuredDisplay('chia seeds', '8g', undefined), /tsp|tbsp/)
  assert.equal(getMeasuredDisplay('olive oil', '15g', '1 tbsp'), '1 tbsp')  // real unit wins
  assert.match(getMeasuredDisplay('paprika', '4g', 'a pinch'), /tsp/)       // pinch is not a unit
  assert.equal(getMeasuredDisplay('chicken breast', '170g', '1 piece'), '170g')
  assert.equal(getMeasuredDisplay('red potatoes', '44g', undefined), '45g') // rounded
})

test('measured display never returns an empty string for real input', () => {
  const cases: Array<[string, string | undefined, string | undefined]> = [
    ['salt', undefined, 'to taste'],
    ['olive oil', undefined, undefined],
    ['cottage cheese', '170g', undefined],
    ['mystery item', '12 units', undefined],
  ]
  for (const [n, g, v] of cases) {
    const out = getMeasuredDisplay(n, g, v)
    if (g || v) assert.notEqual(out, '', `"${n}" produced nothing from grams=${g} visual=${v}`)
  }
})

// ── name cleaning ──────────────────────────────────────────────────────────────────────────────
test('cleanIngredientName strips leading quantities and fixes inverted modifiers', () => {
  assert.equal(cleanIngredientName('4 eggs'), 'eggs')
  assert.equal(cleanIngredientName('½ avocado'), 'avocado')
  assert.equal(cleanIngredientName('juice lemon'), 'lemon juice')
  assert.equal(cleanIngredientName('chicken breast *'), 'chicken breast')
})

test('cleanIngredientName leaves a legitimate name alone', () => {
  for (const n of ['olive oil', 'cottage cheese', 'greek yogurt', 'black pepper']) {
    assert.equal(cleanIngredientName(n), n)
  }
})

test('isNeedToBuy keys off the trailing asterisk only', () => {
  assert.equal(isNeedToBuy('salsa *'), true)
  assert.equal(isNeedToBuy('salsa'), false)
  assert.equal(isNeedToBuy('cream * cheese'), false)
})

test('stripAdjectives removes cooking words without eating the food', () => {
  assert.match(stripAdjectives('grilled chicken breast'), /chicken/)
  assert.match(stripAdjectives('fresh spinach'), /spinach/)
  assert.notEqual(stripAdjectives('shredded cheese').trim(), '', 'stripped the whole name')
  assert.notEqual(stripAdjectives('cooked rice').trim(), '')
})

test('isAlreadyInList matches regardless of cooking adjectives', () => {
  assert.equal(isAlreadyInList('grilled chicken', new Set(['chicken'])), true)
  assert.equal(isAlreadyInList('salmon', new Set(['chicken'])), false)
})

// ── eyeball mode ───────────────────────────────────────────────────────────────────────────────
test('toEyeball leaves already-toolless descriptions alone', () => {
  assert.equal(toEyeball('2 slices', 'bread'), '2 slices')
  assert.equal(toEyeball('a handful', 'spinach'), 'a handful')
  assert.equal(toEyeball('large egg', 'egg'), 'large egg')
  assert.equal(toEyeball(undefined, 'anything'), '')
})

test('toEyeball converts measuring-tool units into descriptors', () => {
  const out = toEyeball('1 tbsp', 'olive oil')
  assert.ok(!/tbsp/i.test(out), `still says tbsp: "${out}"`)
  assert.notEqual(out.trim(), '')
})

// ── step text ──────────────────────────────────────────────────────────────────────────────────
test('stripStepNumber removes creator-pasted numbering', () => {
  assert.equal(stripStepNumber('1. Heat the pan'), 'Heat the pan')
  assert.equal(stripStepNumber('Step 2: Add eggs'), 'Add eggs')
  assert.equal(stripStepNumber('01) Season'), 'Season')
  assert.equal(stripStepNumber('Heat the pan'), 'Heat the pan')
})

test('stripStepNumber does not eat a leading number that is part of the instruction', () => {
  // "350F oven" and "2 minutes per side" are content, not numbering.
  assert.match(stripStepNumber('350F oven, 20 minutes'), /350/)
})

// ── second sweep: four more bugs of the same family ────────────────────────────────────────────
// All four are the same shape as the egg-whites one — a transformation over model-written text
// that is right for the case it was written for and wrong for a neighbouring one.

test('REGRESSION: a percentage in the name survives', () => {
  // The unicode-fraction strip used a [\d…] class, so it re-stripped the bare digit the
  // leading-quantity rule had correctly left alone: "2% milk" -> "% milk".
  assert.equal(cleanIngredientName('2% milk'), '2% milk')
  assert.equal(cleanIngredientName('1% milk'), '1% milk')
  assert.equal(cleanIngredientName('100% whey protein'), '100% whey protein')
  assert.equal(cleanIngredientName('2% greek yogurt'), '2% greek yogurt')
})

test('quantity stripping still works after that fix', () => {
  assert.equal(cleanIngredientName('4 eggs'), 'eggs')
  assert.equal(cleanIngredientName('½ avocado'), 'avocado')
  assert.equal(cleanIngredientName('1½ cups flour'), 'cups flour')
  assert.equal(cleanIngredientName('chicken breast *'), 'chicken breast')
})

test('REGRESSION: the SPICE cloves is not a garlic clove', () => {
  // /\bcloves?\b/ caught the powdered spice: "ground cloves" rendered "1 ground garlic clove".
  assert.equal(getWholeUnitDisplay('ground cloves', '2g'), null)
  assert.equal(getWholeUnitDisplay('whole cloves', '3g'), null)
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '15g'), { count: '5', name: 'garlic cloves' })
})

test('REGRESSION: a trace amount is not rounded up to a whole unit', () => {
  // Math.max(1, round(g/weight)) turned 5g of egg into "1 egg" — a 10x overstatement.
  assert.equal(getWholeUnitDisplay('eggs', '5g'), null, '5g is not an egg')
  assert.equal(getWholeUnitDisplay('eggs', '10g'), null)
  assert.equal(getWholeUnitDisplay('chicken breast', '40g'), null)
  assert.equal(getWholeUnitDisplay('garlic cloves', '1g'), null)
  // but a real portion still counts
  assert.deepEqual(getWholeUnitDisplay('eggs', '100g'), { count: '2', name: 'eggs' })
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '15g'), { count: '5', name: 'garlic cloves' })
})

test('REGRESSION: owning an ingredient does not hide a different one that contains its name', () => {
  // The old substring matching dropped genuinely missing items from the grocery list.
  assert.equal(isAlreadyInList('rice vinegar', new Set(['rice'])), false)
  assert.equal(isAlreadyInList('coconut oil', new Set(['oil'])), false)
  assert.equal(isAlreadyInList('almond milk', new Set(['milk'])), false)
  assert.equal(isAlreadyInList('chicken broth', new Set(['chicken'])), false)
})

test('real duplicates are still caught', () => {
  assert.equal(isAlreadyInList('chicken', new Set(['chicken'])), true)
  assert.equal(isAlreadyInList('grilled chicken', new Set(['chicken'])), true)
  assert.equal(isAlreadyInList('chicken', new Set(['diced chicken'])), true)
  assert.equal(isAlreadyInList('4 eggs', new Set(['eggs'])), true)
})

test('the name-final guard survives a pattern with alternation', () => {
  // The guard builds a regex from the row's source; without grouping, `$` would bind to only the
  // last branch of an alternation and silently stop guarding. The garlic row now has one.
  assert.equal(getWholeUnitDisplay('garlic cloves in oil', '15g'), null)
})

test('REGRESSION: Eyeball mode never names a measuring tool', () => {
  // The "already descriptive" guard fired on the leading article alone, so any visual starting
  // with "a"/"an" returned unchanged — including ones naming a cup or a tablespoon, which is
  // precisely what Eyeball mode exists to avoid.
  const TOOL = /\b(tbsp|tablespoons?|tsp|teaspoons?|cups?|ounces?|oz|grams?)\b/i
  for (const [v, n] of [['a cup of rice', 'rice'], ['a tablespoon of oil', 'olive oil'],
                        ['a tsp of salt', 'salt'], ['an ounce of cheese', 'cheddar']] as const) {
    const out = toEyeball(v, n)
    assert.ok(!TOOL.test(out), `"${v}" still names a tool: "${out}"`)
  }
})

test('genuinely tool-free descriptions are still passed through', () => {
  assert.equal(toEyeball('a handful', 'spinach'), 'a handful')
  assert.equal(toEyeball('a drizzle', 'olive oil'), 'a drizzle')
  assert.equal(toEyeball('large egg', 'egg'), 'large egg')
  assert.equal(toEyeball('2 slices', 'bread'), '2 slices')
})

// ── formatQuarter ─────────────────────────────────────────────────────────────────────────────
test('formatQuarter snaps to quarter steps and never rounds a real amount to nothing', () => {
  assert.equal(formatQuarter(1), '1')
  assert.equal(formatQuarter(1.68), '1\u00BE')
  assert.equal(formatQuarter(0.75), '\u00BE')
  assert.equal(formatQuarter(0.5), '\u00BD')
  assert.equal(formatQuarter(0.25), '\u00BC')
  assert.equal(formatQuarter(2), '2')
  assert.equal(formatQuarter(2.5), '2\u00BD')
  // A tiny amount floors at a quarter rather than vanishing — the formatHalf lesson.
  assert.equal(formatQuarter(0.02), '\u00BC')
  assert.equal(formatQuarter(0), '0')
  assert.equal(formatQuarter(NaN), '0')
  assert.equal(formatQuarter(-3), '0')
})

// ── scaleVisual ───────────────────────────────────────────────────────────────────────────────
test('scaleVisual scales a leading whole number and keeps the rest of the string', () => {
  assert.equal(scaleVisual('1 cup', 1.68), '1\u00BE cup')
  assert.equal(scaleVisual('2 medium', 1.5), '3 medium')
  assert.equal(scaleVisual('1 clove, minced', 2), '2 clove, minced')
  assert.equal(scaleVisual('1 large potato, sliced lengthwise', 0.5), '\u00BD large potato, sliced lengthwise')
})

test('scaleVisual handles the fraction forms the templates actually use', () => {
  // The fraction branch must be tried FIRST — matching \d+ first would eat the "1" of "1/2" and
  // leave "/2 tsp" dangling.
  assert.equal(scaleVisual('1/2 tsp', 2), '1 tsp')
  assert.equal(scaleVisual('1/4 cup', 2), '\u00BD cup')
  assert.equal(scaleVisual('3/4 cup', 2), '1\u00BD cup')
  assert.equal(scaleVisual('1/3 cup', 3), '1 cup')
  assert.equal(scaleVisual('1.5 cup', 2), '3 cup')
  assert.equal(scaleVisual('0.5 tsp', 3), '1\u00BD tsp')
})

test('scaleVisual scales both ends of a range', () => {
  assert.equal(scaleVisual('3-4 slices', 2), '6-8 slices')
  assert.equal(scaleVisual('15-18 leaves', 2), '30-36 leaves')
})

test('scaleVisual leaves qualitative visuals alone — they carry no number to scale', () => {
  for (const v of ['pinch', 'a handful', 'half', 'small', 'to taste', 'crumbled', '1 generous handful'.replace('1 ', '')]) {
    assert.equal(scaleVisual(v, 2), v, `"${v}" should be untouched`)
  }
})

test('scaleVisual is a no-op at scale 1 and on nonsense scales', () => {
  assert.equal(scaleVisual('1 cup', 1), '1 cup')
  assert.equal(scaleVisual('1 cup', 0), '1 cup')
  assert.equal(scaleVisual('1 cup', -2), '1 cup')
  assert.equal(scaleVisual('1 cup', NaN), '1 cup')
  assert.equal(scaleVisual(undefined, 2), undefined)
})

// ── Eyeball / Measured composition ────────────────────────────────────────────────────────────
// The helpers were each tested; the COMPOSITION the recipe screen actually renders was not. This
// is the exact pipeline of app/meal/[id].tsx renderRow, over a scaled template ingredient.

// Mirrors the scaling both call sites perform on a template ingredient.
const scaleIng = (ing: { name: string; visual: string; grams: string }, scale: number) => {
  const baseGrams = parseFloat(String(ing.grams).replace(/[^0-9.]/g, '')) || 0
  const unit = String(ing.grams).replace(/[0-9. ]/g, '') || 'g'
  return { name: ing.name, visual: scaleVisual(ing.visual, scale), grams: `${Math.round(baseGrams * scale)}${unit}` }
}
// Mirrors renderRow's portion selection.
const portionFor = (ing: any, mode: 'Eyeball' | 'Measured') => {
  const whole = getWholeUnitDisplay(ing.name, ing.grams)
  if (whole) return whole.count
  return mode === 'Eyeball' ? toEyeball(ing.visual ?? ing.grams, ing.name) : getMeasuredDisplay(ing.name, ing.grams, ing.visual)
}

test('REGRESSION: Measured mode reflects the scaled amount, not the base recipe', () => {
  // getMeasuredDisplay tier 1 returns a liquid's `visual` verbatim. When only grams were scaled,
  // a 1.68x pudding still listed "1 cup" of coconut milk while the card claimed the scaled macros.
  const milk = { name: 'unsweetened light coconut milk', visual: '1 cup', grams: '240g' }
  assert.equal(portionFor(scaleIng(milk, 1), 'Measured'), '1 cup')
  assert.equal(portionFor(scaleIng(milk, 1.68), 'Measured'), '1\u00BE cup')
  assert.equal(portionFor(scaleIng(milk, 0.75), 'Measured'), '\u00BE cup')

  const syrup = { name: 'maple syrup', visual: '1 tbsp', grams: '21g' }
  assert.equal(portionFor(scaleIng(syrup, 2), 'Measured'), '2 tbsp')

  const vanilla = { name: 'vanilla extract', visual: '1/2 tsp', grams: '2g' }
  assert.equal(portionFor(scaleIng(vanilla, 2), 'Measured'), '1 tsp')
})

test('REGRESSION: an Eyeball count scales too', () => {
  // toEyeball passes counts through unchanged, so a stale visual showed the base count forever.
  const cloves = { name: 'garlic, minced', visual: '2 cloves', grams: '10g' }
  assert.equal(portionFor(scaleIng(cloves, 2), 'Eyeball'), '4 cloves')
})

test('Eyeball stays qualitative for descriptor rows regardless of scale', () => {
  // "a drizzle" is the point of Eyeball mode — it must NOT sprout a number.
  const syrup = { name: 'maple syrup', visual: '1 tbsp', grams: '21g' }
  assert.equal(portionFor(scaleIng(syrup, 1.68), 'Eyeball'), 'a drizzle')
  const berries = { name: 'mixed berries', visual: '1 cup', grams: '150g' }
  assert.equal(portionFor(scaleIng(berries, 1.68), 'Eyeball'), 'a big handful')
})

test('whole-unit foods take their count from the scaled grams in BOTH modes', () => {
  const eggs = { name: 'large eggs', visual: '2 large', grams: '100g' }
  const scaled = scaleIng(eggs, 2) // 200g = 4 eggs
  assert.equal(portionFor(scaled, 'Measured'), '4')
  assert.equal(portionFor(scaled, 'Eyeball'), '4')
})

// ── countMissingIngredients: the badge and the recipe list must agree ─────────────────────────
const pantry = (...names: string[]) => new Set(names.map(n => n.toLowerCase().trim()))

test('REGRESSION: a substring of a pantry item is NOT owned', () => {
  // The old Discover matcher compared substrings both ways, so these all counted as owned and the
  // card read "Have it all" over a recipe that listed them under YOU'LL NEED.
  assert.equal(countMissingIngredients(['high-protein Greek yogurt'], pantry('yogurt')), 1)
  assert.equal(countMissingIngredients(['coconut oil'], pantry('oil')), 1)
  assert.equal(countMissingIngredients(['chicken broth'], pantry('chicken')), 1)
  assert.equal(countMissingIngredients(['rice vinegar'], pantry('rice')), 1)
  assert.equal(countMissingIngredients(['milk of choice'], pantry('milk')), 1)
})

test('a genuine match still counts as owned, before and after adjective stripping', () => {
  assert.equal(countMissingIngredients(['Greek yogurt'], pantry('greek yogurt')), 0)
  assert.equal(countMissingIngredients(['grilled chicken breast'], pantry('chicken breast')), 0)
  assert.equal(countMissingIngredients(['chicken breast'], pantry('boneless chicken breast')), 0)
})

test('assumed staples are not missing — the badge stops counting salt', () => {
  assert.equal(countMissingIngredients(['salt', 'black pepper', 'olive oil'], pantry()), 0)
  // ...unless the user's diet rules them out.
  assert.equal(countMissingIngredients(['butter'], pantry(), new Set(['butter'])), 1)
})

test('accepts both object and plain-string ingredient shapes', () => {
  assert.equal(countMissingIngredients([{ name: 'Greek yogurt' }, 'salt', { name: 'mango' }], pantry('greek yogurt')), 1)
})

test('a meal with no ingredient data reports 0, not a sentinel', () => {
  // The old code returned 99 here, which would render as a literal "Missing 99" badge.
  assert.equal(countMissingIngredients([], pantry('milk')), 0)
  assert.equal(countMissingIngredients(undefined, pantry('milk')), 0)
  assert.equal(countMissingIngredients([{ name: '  ' }, ''], pantry('milk')), 0)
})

test('the screenshot case: the smoothie really needs all three', () => {
  // Card said "Missing 1"; the recipe screen listed three. With a pantry that merely CONTAINS the
  // words, substring matching hid two of them.
  const p = pantry('mango', 'pineapple', 'milk')
  assert.equal(countMissingIngredients(
    ['frozen mango chunks', 'fresh pineapple chunks', 'milk of choice'], p), 3)
})

test('counting a full Discover pass stays off the render-blocking path', () => {
  // This runs inside a useMemo on Discover. stripAdjectives used to build 21 RegExp objects per
  // call and was invoked once per pantry entry per ingredient, so this shape took ~3 SECONDS —
  // a visible freeze. Pin it: the pantry is stripped once and matched by lookup.
  const bigPantry = new Set(Array.from({ length: 200 }, (_, i) => `pantry item number ${i} with a longish name`))
  const meals = Array.from({ length: 600 }, (_, m) =>
    Array.from({ length: 8 }, (_, i) => ({ name: `grilled ingredient ${m}-${i} chunks` })))
  const started = process.hrtime.bigint()
  for (const ings of meals) countMissingIngredients(ings, bigPantry)
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.ok(ms < 600, `600x8 over a 200-item pantry took ${Math.round(ms)}ms — was ~3000ms before the fix`)
})
