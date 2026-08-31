import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIngredientBlock, stripBullet } from './ingredient-parse.ts'

test('a decimal quantity is not a numbered-list marker', () => {
  // \d+[.)] matched the DECIMAL POINT: "1.5 tsp Salt" was read as list item "1." followed by
  // "5 tsp Salt". Two ways that goes wrong and both are silent.
  assert.equal(stripBullet('1.5 tsp Salt'), '1.5 tsp Salt')
  assert.equal(stripBullet('0.5 cup Besan'), '0.5 cup Besan')
  assert.equal(stripBullet('2.5 oz dark chocolate'), '2.5 oz dark chocolate')
  assert.equal(stripBullet('1.5 lb chicken breast'), '1.5 lb chicken breast')
  // ...while genuine numbered and bulleted lists still strip exactly as before.
  assert.equal(stripBullet('1. Flour'), 'Flour')
  assert.equal(stripBullet('2) Sugar'), 'Sugar')
  assert.equal(stripBullet('• Milk'), 'Milk')
  assert.equal(stripBullet('- Salt'), 'Salt')
  assert.equal(stripBullet('🥚 Eggs'), 'Eggs')
})

test('REGRESSION: a decimal line is not silently dropped from a plain-text list', () => {
  // Verbatim from video FRyfG33qReo (bharatzkitchen, "NO FRY SOYA KEBAB"). The creator lists salt
  // TWICE — once for boiling, once for the kebab mix. The second is "1.5 tsp".
  //
  // The line was misclassified as a numbered-list item. The parser keeps ONLY bulleted lines when
  // there are >= 3 of them and falls back to quantified lines otherwise, so a LONE false bullet
  // landed in the discarded pile and the ingredient vanished. It then also vanished from the
  // retention contract built from this same output, so the model was never asked for it and the
  // gate never noticed — both sides agreeing on a wrong answer, which is the exact failure this
  // parser's own comments warn about.
  const desc = [
    'SOYA KABAB', '', 'FOR BOILING', '',
    '1 Liter Water', '1 tsp Salt', '150 gms Soya Chunks', '',
    'FOR  ROASTED BESAN', '',
    '3 tsp Desi Ghee', '1/2 Cup Besan', '1 tsp Kashmiri Red Chilli Powder',
    '1 tsp Cumin Seeds', '1 Coriander Seeds', '',
    'FOR KEBAB', '',
    '2 Onions', '30 - 50 GMS Coriander Leaves', '2 Inch Ginger ( 15 gms )',
    '5 Green Chillies', '10-12 Garlic Cloves ( 15-20 gms )', '1/2 Cup Poha',
    '2 Dried Red Chillies', '1.5 tsp Salt', '1 tsp Red chilli powder',
    '1 tsp Coriander Powder', '1 tsp Chat Masala', '1 tsp Garam Masala',
    '1 tsp Roasted Jeera Powder',
  ].join('\n')

  const out = parseIngredientBlock(desc)
  assert.equal(out.length, 21, 'every line the creator published must survive')
  assert.deepEqual(out.filter(x => /salt/i.test(x)), ['1 tsp Salt', '1.5 tsp Salt'])
  // And the quantity is intact — surviving as "5 tsp Salt" would be worse than being dropped.
  assert.ok(!out.some(x => x === '5 tsp Salt'), 'the quantity must not be inflated 3.3x')
})

test('a real numbered list is still parsed as one', () => {
  const desc = ['1. 200g flour', '2. 2 eggs', '3. 100ml milk', '4. 1 tsp salt'].join('\n')
  assert.deepEqual(parseIngredientBlock(desc), ['200g flour', '2 eggs', '100ml milk', '1 tsp salt'])
})

test('a block with fewer than three usable lines yields nothing', () => {
  // The >= 3 floor is what stops a stray quantity-looking line becoming a one-item "recipe".
  assert.deepEqual(parseIngredientBlock('2 eggs\n1 tsp salt'), [])
  assert.deepEqual(parseIngredientBlock(''), [])
})
