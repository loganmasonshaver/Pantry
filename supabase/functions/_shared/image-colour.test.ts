import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flavourColour, rewriteInvisibleIngredients, INVISIBLE_INGREDIENT } from './image-colour.ts'

test('bug #3: monk fruit sweetener is colourless, not fruit-punch red-orange', () => {
  // A chocolate Oreo McFlurry was rendered vivid red-orange because of this one ingredient.
  assert.equal(flavourColour('monk fruit sweetener'), null)
  assert.equal(flavourColour('Monk Fruit Sweetener'), null)
  assert.equal(flavourColour('monk fruit extract'), null)
})

test('every non-nutritive sweetener is colourless, whatever its name', () => {
  for (const s of ['stevia', 'erythritol', 'allulose sweetener', 'sucralose', 'xylitol', 'splenda', 'sugar-free sweetener']) {
    assert.equal(flavourColour(s), null, s)
  }
})

test('the McFlurry case end to end: no colour is claimed for the dish', () => {
  const out = rewriteInvisibleIngredients(['chocolate protein shake', 'monk fruit sweetener', 'cocoa powder', 'oreo thins'])
  assert.equal(out[1], 'flavouring (dissolves completely — adds no colour and NO solid pieces or chunks)')
  assert.ok(!out.join(' ').includes('red-orange'))
  // Visible ingredients pass through untouched — the chocolate still reaches the description.
  assert.equal(out[0], 'chocolate protein shake')
  assert.equal(out[2], 'cocoa powder')
})

test('real flavour concentrates still carry their colour — the Jello fix must survive this one', () => {
  assert.equal(flavourColour('orange flavoured drink enhancer'), 'a bright orange')
  assert.equal(flavourColour('strawberry flavoring drops'), 'a vivid red')
  assert.equal(flavourColour('fruit flavored zero sugar water drink enhancer'), 'a vivid red-orange')
  assert.equal(flavourColour('coffee extract'), 'a deep brown')
})

test('bug #1 stays fixed: "flavoured" does not contain a red', () => {
  assert.equal(flavourColour('vanilla flavoured syrup'), null)
})

test('bug #2 stays fixed: plain extracts are colourless, never "a distinctly coloured tone"', () => {
  assert.equal(flavourColour('vanilla extract'), null)
  assert.equal(flavourColour('almond extract'), null)
})

test('cocoa and baking powder are never stripped as invisible', () => {
  assert.equal(INVISIBLE_INGREDIENT.test('cocoa powder'), false)
  assert.equal(INVISIBLE_INGREDIENT.test('baking powder'), false)
})
