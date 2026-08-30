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
  isNeedToBuy, roundDisplayGrams, stripAdjectives, stripStepNumber, toEyeball,
} from './ingredientDisplay.ts'

// ── the two already-fixed bugs, pinned so they cannot come back ────────────────────────────────
test('REGRESSION: a liquid never gets a whole-unit count', () => {
  assert.equal(getWholeUnitDisplay('liquid egg whites', '350g'), null)
  assert.equal(getWholeUnitDisplay('egg whites', '200g'), null) // noun not name-final
  assert.equal(getWholeUnitDisplay('carton of eggs', '300g'), null)
})

test('REGRESSION: the label never repeats the adjective', () => {
  assert.deepEqual(getWholeUnitDisplay('garlic cloves', '15g'), { count: '3', name: 'garlic cloves' })
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
