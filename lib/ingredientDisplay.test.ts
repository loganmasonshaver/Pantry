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
  formatQuarter, scaleVisual, countMissingIngredients, formatRestTime, activeMinutes, formatTimeToEat, snapDisplayMinutes,
  isReadyWithin, formatDuration, countCountableIngredients, isNearlyThere,
  formatRestBadge, formatTimeBreakdown, formatTimeLine,
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
  // "6 slices", not "120g": the creator's count now wins for an unambiguous unit. What this test
  // pins is that it is not routed through the SPICE branch — it used to read "20 tbsp".
  assert.equal(getMeasuredDisplay('pepper jack cheese', '120g', '6 slices'), '6 slices')
  assert.equal(getMeasuredDisplay('chargrilled peppers', '100g', '2'), '100g')
  // ...and the real spice still goes through the spice branch. "salt & pepper" keeps salt, which is
  // why the non-spice senses are STRIPPED rather than used to negate the whole test.
  assert.equal(getMeasuredDisplay('black pepper', '6g', 'a pinch'), '1 tbsp')
  assert.equal(getMeasuredDisplay('salt & pepper', '6g', 'a pinch'), '1 tsp')
  assert.equal(getMeasuredDisplay('red pepper flakes', '6g', 'a pinch'), '1 tbsp')
  assert.equal(getMeasuredDisplay('white pepper', '2g', 'a pinch'), '1 tsp')
  // Pepperoni needs no rule at all — \b does not match inside the word.
  assert.equal(getMeasuredDisplay('turkey pepperoni', '80g', '34 slices'), '34 slices')
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

test("an unambiguous creator measure beats a gram count", () => {
  // "6 lbs ground beef" was rendering as "2722g" — the same quantity and useless, since nobody
  // buys, weighs or thinks in 2722 grams. A 15-serving batch recipe made it obvious because the
  // numbers get large, but it applied at every size.
  assert.equal(getMeasuredDisplay('96/4 ground beef', '2722g', '6 lbs'), '6 lbs')
  assert.equal(getMeasuredDisplay('Beef Bacon', '300g', '20 slices'), '20 slices')
  assert.equal(getMeasuredDisplay('Provolone cheese', '300g', '15 slices'), '15 slices')
  assert.equal(getMeasuredDisplay('Red onions', '340g', '12 oz'), '12 oz')
  assert.equal(getMeasuredDisplay('chicken tenders', '1360g', '3 lbs'), '3 lbs')
  // Decimal weights still become fractions on the way out.
  assert.equal(getMeasuredDisplay('shaved ribeye steak', '680g', '1.5 lbs'), '1½ lbs')

  // VOLUME COUNTS TOO. The first cut kept grams here, arguing a cup of a solid depends on packing
  // so grams are more precise. True and beside the point: a cook measures the cup. If the creator
  // wrote "2 cups", the list says two cups — the precision grams add is precision nobody uses, and
  // the macros are already stated separately at the top of the screen.
  assert.equal(getMeasuredDisplay('Greek Yoghurt', '500g', '2 cups'), '2 cups')
  assert.equal(getMeasuredDisplay('Low-fat quark', '500g', '2 cups'), '2 cups')
  assert.equal(getMeasuredDisplay('Green moong dal', '500g', '2 cups'), '2 cups')
  assert.equal(getMeasuredDisplay('oats', '40g', '1/2 cup'), '½ cup')
  assert.equal(getMeasuredDisplay('Water', '1000g', '1 Liter'), '1 Liter')

  // A vague visual is not a measurement and must not win.
  assert.equal(getMeasuredDisplay('red bell pepper', '150g', '1 medium'), '150g')
  assert.equal(getMeasuredDisplay('spinach', '60g', 'a handful'), '60g')
  // Liquids and seasonings keep their own tier — tbsp/tsp/cups are exact for a liquid.
  assert.equal(getMeasuredDisplay('buffalo wing sauce', '355g', '1.5 cups'), '1½ cups')
})

test('a container shows the count AND the size, like a recipe site', () => {
  // "1 (24-ounce) jar marinara sauce" (NYT Cooking, Serious Eats), "1 (15-ounce) can black beans"
  // (AllRecipes), "1 x 400g can chopped tomatoes" (BBC Good Food). Count is what you buy, size is
  // what disambiguates, and jar sizes vary between brands — printing one alone forces a choice
  // that printing both does not.
  assert.equal(getMeasuredDisplay('Vodka Sauce', '700g', '1 jar'), '1 jar (700g)')
  assert.equal(getMeasuredDisplay('cream of chicken soup', '300g', '1 can'), '1 can (300g)')
  assert.equal(getMeasuredDisplay('corn', '100g', '1/2 can'), '½ can (100g)')
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

test('slash fractions become glyphs, so one list uses one notation', () => {
  // A live list showed "1/2 tsp baking powder" directly above "⅛ tsp salt" — same units, two
  // notations, because only the COMPUTED side used glyphs and a creator's raw visual did not.
  assert.equal(toCookingFraction('1/2 tsp'), '½ tsp')
  assert.equal(toCookingFraction('1/4 cup'), '¼ cup')
  assert.equal(toCookingFraction('2/3 cup'), '⅔ cup')
  assert.equal(toCookingFraction('1/8 tsp'), '⅛ tsp')
  // A whole number before the fraction is a mixed number and stays attached.
  assert.equal(toCookingFraction('1 1/2 cups'), '1½ cups')
  // Not every slash is a fraction, and the ones that are not must survive untouched: "96/4" is a
  // beef lean ratio and "5/16" is not a measure any kitchen owns.
  assert.equal(toCookingFraction('5/16 tsp'), '5/16 tsp')
  assert.equal(toCookingFraction('96/4'), '96/4')
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
  // A stated count wins here too. Note the real render never reaches this path for a chicken
  // breast — getWholeUnitDisplay claims it first and prints "1 chicken breast".
  assert.equal(getMeasuredDisplay('chicken breast', '170g', '1 piece'), '1 piece')
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

// "fl oz" is the most common US liquid measure and was unrecognised: UNAMBIGUOUS_VISUAL knew `oz`
// but not `fl oz`, and `water` was missing from the liquid list, so BOTH routes back to the
// creator's own wording failed and the raw metric string was printed instead.
test('fl oz survives instead of falling through to the stored metric string', () => {
  assert.equal(getMeasuredDisplay('cold water', '950ml', '32 fl oz'), '32 fl oz')
  assert.equal(getMeasuredDisplay('boiling water', '950ml', '32 fl oz'), '32 fl oz')
  assert.equal(getMeasuredDisplay('whole milk', '240ml', '8 fl oz'), '8 fl oz')
  assert.equal(getMeasuredDisplay('heavy cream', '120ml', '4 fluid ounces'), '4 fluid ounces')
})

test('adding water to the liquid list does not capture watermelon', () => {
  // \b must not match inside "watermelon" — it is a solid and belongs on the grams path.
  assert.equal(getMeasuredDisplay('watermelon', '300g', 'a handful'), '300g')
})

// ── formatRestTime ────────────────────────────────────────────────────────────────────────────
test('formatRestTime says nothing when there is nothing to wait for', () => {
  assert.equal(formatRestTime(0), null)
  assert.equal(formatRestTime(undefined), null)
  assert.equal(formatRestTime(null), null)
  assert.equal(formatRestTime(-30), null)
})

test('formatRestTime keeps short waits exact — 20 min and 45 min are different decisions', () => {
  assert.equal(formatRestTime(20), '20 min')
  assert.equal(formatRestTime(45), '45 min')
  assert.equal(formatRestTime(89), '89 min')
})

test('formatRestTime rounds long waits to the half hour', () => {
  // The real case: overnight oats need ~480 minutes, and nobody plans that to the minute.
  assert.equal(formatRestTime(480), '8 hr')
  assert.equal(formatRestTime(487), '8 hr')
  assert.equal(formatRestTime(90), '1.5 hr')
  assert.equal(formatRestTime(120), '2 hr')
  // 1h45m is an exact tie between 1.5 and 2; rounding up is the safer direction for a wait.
  assert.equal(formatRestTime(105), '2 hr')
})

// ── activeMinutes / formatTimeToEat ────────────────────────────────────────────────────────────
test('activeMinutes adds the bake to the knife work — that total is what the budget bounds', () => {
  // The live case from the muffin-top bake: 10 min prep, 20 min in the oven. Counting only
  // prepTime let it pass a 15-minute budget and cost the user half an hour.
  assert.equal(activeMinutes(10, 20), 30)
})

test('activeMinutes treats a missing cookTime as zero, so meals cached before it shipped still read right', () => {
  assert.equal(activeMinutes(25, undefined), 25)
  assert.equal(activeMinutes(25, null), 25)
  assert.equal(activeMinutes(25, 'soon'), 25)
})

test('activeMinutes ignores negative and non-finite parts rather than subtracting them', () => {
  assert.equal(activeMinutes(20, -10), 20)
  assert.equal(activeMinutes(-5, 15), 15)
  assert.equal(activeMinutes(undefined, undefined), 0)
})

test('formatTimeToEat gives one number, not the ambiguous "10 min + 20 min"', () => {
  assert.equal(formatTimeToEat(10, 20), '30 min')
  assert.equal(formatTimeToEat(5, 0), '5 min')
})

// ── WHOLE_UNIT_FOODS: produce ─────────────────────────────────────────────────────────────────
test('countable produce reads as a count, not a weight', () => {
  // The live miss: a Greek yogurt parfait listed "150g orange" on the ingredient card.
  assert.deepEqual(getWholeUnitDisplay('orange', '150g'), { count: '1', name: 'orange' })
  assert.deepEqual(getWholeUnitDisplay('carrots', '180g'), { count: '3', name: 'carrots' })
  assert.deepEqual(getWholeUnitDisplay('kiwi', '150g'), { count: '2', name: 'kiwis' })
})

test('a more eager row cannot steal a match from the right one', () => {
  // "orange bell pepper" matches /orange/ too. If that row is found first the noun is no longer
  // name-final, and the ingredient loses its count entirely rather than falling through — which is
  // why bell pepper is ordered ahead of orange.
  assert.deepEqual(getWholeUnitDisplay('orange bell pepper', '120g'), { count: '1', name: 'orange bell pepper' })
  // Divided by the plain-tomato weight, 100g of cherry tomatoes would read as "1".
  assert.deepEqual(getWholeUnitDisplay('cherry tomatoes', '102g'), { count: '6', name: 'cherry tomatoes' })
  assert.deepEqual(getWholeUnitDisplay('sweet potato', '130g'), { count: '1', name: 'sweet potato' })
  assert.deepEqual(getWholeUnitDisplay('green onions', '45g'), { count: '3', name: 'green onions' })
})

test('a fruit named inside a derivative is still not a whole fruit', () => {
  // Name-final guard: these must stay weights, not become "1 orange".
  assert.equal(getWholeUnitDisplay('orange juice', '200g'), null)
  assert.equal(getWholeUnitDisplay('orange zest', '5g'), null)
  assert.equal(getWholeUnitDisplay('tomato paste', '30g'), null)
  assert.equal(getWholeUnitDisplay('mashed potatoes', '200g'), null)
})

test('a token amount of produce stays a weight — the 40% floor still applies', () => {
  assert.equal(getWholeUnitDisplay('orange', '40g'), null)
  assert.equal(getWholeUnitDisplay('onion', '30g'), null)
})

// ── formatRestBadge / formatTimeLine / formatTimeBreakdown ────────────────────────────────────
test('a short wait is not worth a badge — it is just part of making the thing', () => {
  assert.equal(formatRestBadge(0), null)
  assert.equal(formatRestBadge(10), null)
  assert.equal(formatRestBadge(29), null)
  assert.equal(formatRestBadge(undefined), null)
})

test('a wait that fits in an afternoon is a chill; past that it is overnight', () => {
  assert.equal(formatRestBadge(30), 'chill')
  assert.equal(formatRestBadge(120), 'chill')
  assert.equal(formatRestBadge(239), 'chill')
  assert.equal(formatRestBadge(240), 'overnight')
  assert.equal(formatRestBadge(480), 'overnight')
})

test('the card says how soon you eat, then the wait as a word', () => {
  // Overnight oats: five minutes of work, and the thing that matters is that it is not tonight.
  assert.equal(formatTimeLine(5, 0, 480), '5 min + overnight')
  // The muffin-top bake, once the oven minutes are filed as cook rather than rest.
  assert.equal(formatTimeLine(10, 20, 0), '30 min')
  // A 20-minute chill disappears rather than becoming an unlabelled second number.
  assert.equal(formatTimeLine(15, 0, 20), '15 min')
})

test('the detail screen keeps the real numbers, and drops the parts that are zero', () => {
  assert.equal(formatTimeBreakdown(10, 20, 0), '10 min prep · 20 min cook')
  assert.equal(formatTimeBreakdown(5, 0, 480), '5 min prep · 8 hr rest')
  assert.equal(formatTimeBreakdown(10, 20, 480), '10 min prep · 20 min cook · 8 hr rest')
  // A no-cook dish says "5 min", not "5 min prep" — there is nothing to distinguish it from.
  assert.equal(formatTimeBreakdown(5, 0, 0), '5 min')
})

// ── 5-minute display granularity ───────────────────────────────────────────────────────────────

test('a 3-minute prep shows as 5 — the model cannot tell 3 from 5 and the card should not imply it can', () => {
  assert.equal(formatTimeToEat(3, 0), '5 min')
  assert.equal(formatTimeBreakdown(3, 0, 0), '5 min')
})

test('snapping rounds UP, so the shown time is never less than the recipe claims', () => {
  assert.equal(snapDisplayMinutes(1), 5)
  assert.equal(snapDisplayMinutes(6), 10)
  assert.equal(snapDisplayMinutes(21), 25)
})

test('times already on a 5 are untouched', () => {
  assert.equal(formatTimeToEat(10, 20), '30 min')
  assert.equal(formatTimeToEat(5, 0), '5 min')
  assert.equal(snapDisplayMinutes(30), 30)
})

test('card total and detail breakdown reconcile after snapping — the reason parts snap, not the sum', () => {
  // 7 + 20 = 27. Snapping the TOTAL would print "30 min" over "7 min prep · 20 min cook".
  assert.equal(formatTimeToEat(7, 20), '30 min')
  assert.equal(formatTimeBreakdown(7, 20, 0), '10 min prep · 20 min cook')
})

test('zero and junk stay zero — a no-cook dish must not gain a phantom 5 minutes of oven', () => {
  assert.equal(snapDisplayMinutes(0), 0)
  assert.equal(snapDisplayMinutes(undefined), 0)
  assert.equal(snapDisplayMinutes('soon'), 0)
  assert.equal(formatTimeBreakdown(5, 0, 0), '5 min')
})

test('activeMinutes stays EXACT — the prep budget filters on it and must not inherit the rounding', () => {
  assert.equal(activeMinutes(3, 0), 3)
  assert.equal(activeMinutes(7, 20), 27)
})

// ── Discover time ──────────────────────────────────────────────────────────────────────────────

test('the McFlurry case: a 10-minute blend with a 16-hour freeze is NOT ready in 15', () => {
  assert.equal(isReadyWithin(10, 0, 960, 15), false)
  // It was — the old shelf read prepTime alone.
})

test('an ordinary quick dish is still ready in 15', () => {
  assert.equal(isReadyWithin(10, 0, 0, 15), true)
  assert.equal(isReadyWithin(5, 5, 0, 15), true)
})

test('oven time counts toward "ready in", a short set does not disqualify', () => {
  assert.equal(isReadyWithin(5, 20, 0, 15), false)
  // Under 30 minutes of rest has no badge, so it does not stop a dish being quick.
  assert.equal(isReadyWithin(10, 0, 20, 15), true)
})

test('an unknown time is never "ready" — no recipe qualifies on a zero', () => {
  assert.equal(isReadyWithin(0, 0, 0, 15), false)
  assert.equal(isReadyWithin(undefined, undefined, undefined, 15), false)
})

test('Discover cards use the same line as Home — busy minutes, then the wait as a word', () => {
  // Blueberry Lemon Cheesecake: 15 prep + 45 bake + 2 hr set. The card used to read "2 hr chill",
  // which hid an hour of work behind what sounded like fridge time.
  assert.equal(formatTimeLine(15, 45, 120), '60 min + chill')
  // Lentil Quinoa Flatbread: the step-1 soak cannot be skipped (step 2 blends the soaked grains).
  assert.equal(formatTimeLine(20, 20, 480), '40 min + overnight')
})

test('detail never calls a wait "chill" — an overnight lentil soak is not chilling', () => {
  // Lentil Quinoa Flatbread: step 1 soaks, step 2 blends the soaked grains into batter.
  assert.equal(formatTimeBreakdown(20, 20, 480), '20 min prep · 20 min cook · 8 hr rest')
})

test('legacy Discover rows with no rest data render exactly as before', () => {
  // rest_time is null on every row stored before this change until the backfill reaches it.
  assert.equal(formatTimeLine(20, undefined, null), '20 min')
  assert.equal(isReadyWithin(10, undefined, null, 15), true)
})

test('long times read in hours — a 4-hour slow cooker is not "255 min"', () => {
  assert.equal(formatTimeToEat(10, 245), '4.5 hr')
  assert.equal(formatTimeBreakdown(10, 245, 0), '10 min prep · 4.5 hr cook')
})

test('hours round UP to the half hour, never under-promising', () => {
  assert.equal(formatDuration(90), '1.5 hr')
  assert.equal(formatDuration(91), '2 hr')
  assert.equal(formatDuration(120), '2 hr')
})

test('everything under 90 minutes is unchanged — Cook Tonight is untouched', () => {
  assert.equal(formatDuration(30), '30 min')
  assert.equal(formatDuration(85), '85 min')
  assert.equal(formatTimeToEat(10, 20), '30 min')
})

// ── product qualifiers: pantry-specific covers recipe-generic ──────────────────────────────────
// Logan's real pantry entries, lowercased the way discover.tsx builds pantryNames.
const LOGAN = new Set(['non-fat plain greek yogurt', 'whole milk plain yogurt', 'yogurt', 'eggs',
  'ground beef', 'peanut butter', 'butter', 'cream cheese', 'oat milk', 'milk', 'orange', 'pineapple'])

test('his Non-Fat Plain Greek Yogurt covers a recipe asking for greek yogurt', () => {
  assert.equal(isAlreadyInList('plain greek yogurt', LOGAN), true)
  assert.equal(isAlreadyInList('greek yogurt', LOGAN), true)
  assert.equal(isAlreadyInList('non-fat greek yogurt', LOGAN), true)
  assert.equal(isAlreadyInList('high-protein greek yogurt', LOGAN), true)
})

test('size and fat-level qualifiers no longer hide food he owns', () => {
  assert.equal(isAlreadyInList('large eggs', LOGAN), true)
  assert.equal(isAlreadyInList('lean ground beef', LOGAN), true)
  assert.equal(isAlreadyInList('extra-lean ground beef', LOGAN), true)
})

test('the "Frozen Yogurt Fruit Melts" card now counts what is really missing', () => {
  const melts = [{ name: 'plain greek yogurt' }, { name: 'fruit' }, { name: 'vanilla extract' }]
  // Was 3. Greek yogurt is owned; vanilla genuinely is not; "fruit" is a category the matcher
  // cannot map to his oranges — a known gap, not this fix's to close.
  assert.equal(countMissingIngredients(melts, LOGAN), 2)
})

// The widening must not reopen any trap this file already documents.
test('a word that changes the FOOD is never stripped', () => {
  assert.equal(isAlreadyInList('greek yogurt', new Set(['yogurt'])), false)       // yogurt ≠ greek yogurt
  assert.equal(isAlreadyInList('high-protein greek yogurt', new Set(['yogurt'])), false)
  assert.equal(isAlreadyInList('butter', new Set(['peanut butter'])), false)       // not butter
  assert.equal(isAlreadyInList('cheese', new Set(['cream cheese'])), false)
  assert.equal(isAlreadyInList('milk', new Set(['oat milk'])), false)
  assert.equal(isAlreadyInList('coconut oil', new Set(['oil'])), false)
  assert.equal(isAlreadyInList('rice vinegar', new Set(['rice'])), false)
  assert.equal(isAlreadyInList('chicken broth', new Set(['chicken'])), false)
  assert.equal(isAlreadyInList('sweet potato', new Set(['potato'])), false)
})

test('a name made only of qualifiers never matches everything', () => {
  // "large" strips to "". Without the guard, "" === "" would call anything owned.
  assert.equal(isAlreadyInList('large', new Set(['plain'])), false)
  assert.equal(countMissingIngredients([{ name: 'large' }], new Set(['organic'])), 1)
})

test('whole milk still resolves to milk — the qualifier list did not break the old case', () => {
  assert.equal(isAlreadyInList('whole milk', LOGAN), true)
})

// ── "Almost in your kitchen" ───────────────────────────────────────────────────────────────────
test('missing 3 of 3 is not almost anything — the case Logan reported', () => {
  assert.equal(isNearlyThere(3, 3), false)
})

test('at most two missing, AND you already hold at least as many as you lack', () => {
  assert.equal(isNearlyThere(2, 3), false) // hold 1, lack 2 — Frozen Yogurt Fruit Melts, not almost
  assert.equal(isNearlyThere(1, 3), true)  // hold 2, lack 1
  assert.equal(isNearlyThere(2, 4), true)  // hold 2, lack 2 — half there
  assert.equal(isNearlyThere(2, 5), true)  // hold 3, lack 2 — a stricter rule wrongly dropped this
  assert.equal(isNearlyThere(3, 12), false) // plenty held, but three to buy is a shopping trip
})

test('fully cookable always qualifies; nothing to judge never does', () => {
  assert.equal(isNearlyThere(0, 4), true)
  assert.equal(isNearlyThere(0, 0), false)
  assert.equal(isNearlyThere(99, 0), false) // missingCount's "no ingredient data" sentinel
})

test('countable ingredients exclude assumed staples, matching the missing count', () => {
  assert.equal(countCountableIngredients([{ name: 'greek yogurt' }, { name: 'salt' }, { name: 'olive oil' }, { name: 'fruit' }]), 2)
})
