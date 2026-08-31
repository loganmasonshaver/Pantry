import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIngredientBlock, parseIngredientSections, parseMethodBlock, parseUnquantifiedExtras, stripBullet, truncatedAgainstSource } from './ingredient-parse.ts'

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

test('a name cut off mid-generation is detected against the creator list', () => {
  const kebab = ['1 tsp Salt', '1.5 tsp Salt', '1 tsp Roasted Jeera Powder', '1/2 Cup Poha', '2 Onions']
  // The three fragments actually found in stored rows, each the LAST entry of its array.
  assert.equal(truncatedAgainstSource(['Salt', 'Roas', 'Poha'], kebab), 'Roas')
  assert.equal(truncatedAgainstSource(['ga'], ['2 tsp garlic powder', '1 tbsp mayo']), 'ga')
  assert.equal(truncatedAgainstSource(['Turmeric Powd'], ['1/2 tsp Turmeric Powder', '200g paneer']), 'Turmeric Powd')
  // The repaired list is clean.
  assert.equal(truncatedAgainstSource(['Salt', 'Roasted Jeera Powder', 'Poha'], kebab), null)
})

test('a real ingredient is never mistaken for a fragment', () => {
  // The false positive this must not have: "Salt" IS a prefix of "Salted butter". It is only a
  // fragment if the creator never listed it whole — which is why the whole-word check runs first.
  assert.equal(truncatedAgainstSource(['Salt'], ['1 tsp Salt', '50g Salted butter']), null)
  // A PLURAL is not a cut. Without the plural guard this rejected any recipe writing the singular
  // of an ingredient the creator pluralised — which is most of them.
  assert.equal(truncatedAgainstSource(['egg', 'oil'], ['2 eggs', '1 tbsp oil', '200g flour']), null)
  assert.equal(truncatedAgainstSource(['potato'], ['500g potatoes']), null)
  assert.equal(truncatedAgainstSource(['chilli'], ['2 Dried Red Chillies']), null)
  // Nothing to compare against is not evidence of a cut.
  assert.equal(truncatedAgainstSource(['Roas'], []), null)
  assert.equal(truncatedAgainstSource([], ['1 tsp Salt']), null)
})

test("the creator's published method is captured, numbering stripped", () => {
  // Verbatim shape from video JozX89H7GdE ("Kala Chana Dosa"). The creator published 9 numbered
  // steps; the stored recipe had 5, losing "drain the water", "medium heat" and "flip and cook for
  // another 1-2 minutes" — all of it inside the description the model was already shown.
  const desc = [
    '2 tbsp curd', '1 tsp oil or ghee per dosa', '',
    'Method', '',
    '1. Soak the kala chana overnight and drain the water.',
    '2. Grind until smooth to make a lump-free batter.',
    '3. Rest the batter for 10–15 minutes so the suji absorbs the moisture.',
    '4. Cook on medium heat until golden and crisp, then flip and cook for another 1–2 minutes.',
    '', '#kalachanadosa #highproteindosa',
  ].join('\n')
  const out = parseMethodBlock(desc)
  assert.equal(out.length, 4)
  assert.equal(out[0], 'Soak the kala chana overnight and drain the water.')
  // The detail that matters survives verbatim — this is the whole point of the checklist.
  assert.match(out[3], /medium heat/)
  assert.match(out[3], /1–2 minutes/)
  // The hashtag block is not method.
  assert.ok(!out.some(x => x.includes('#')))
})

test('marketing prose after the method is not method', () => {
  // One sampled description ran 16 real steps then 12 lines of health claims. These lines are
  // EMOJI-LED, so an anchored pattern slides straight past the emoji and keeps consuming.
  const desc = [
    'Instructions',
    '1 Soak the lentils and quinoa in water overnight.',
    '2 Blend until completely smooth.',
    '3 Cook on both sides until golden brown.',
    '‼️ Consult your doctor before use, especially if you have chronic conditions',
    '❤️ Supports Heart and Vascular Health',
    'Nutritional values per 100 g of the finished dish',
  ].join('\n')
  const out = parseMethodBlock(desc)
  assert.equal(out.length, 3)
  assert.ok(!out.some(x => /consult|Supports Heart|Nutritional/i.test(x)))
})

test('a description with no method yields nothing', () => {
  // 8 of 14 sampled videos publish no method at all — the empty result must be clean, not noisy,
  // because an empty checklist is simply omitted from the prompt.
  assert.deepEqual(parseMethodBlock('2 eggs\n100g flour\n1 tsp salt'), [])
  assert.deepEqual(parseMethodBlock(''), [])
  // "Preparation time 10-15 minutes" is NOT a method heading, though a looser rule read it as one.
  assert.deepEqual(parseMethodBlock('Preparation time 10-15 minutes\nCooking time 10 minutes'), [])
})

test('ingredients listed without a quantity are recovered', () => {
  // "Green Onion" was silently lost from hPCcDaUmGKw: QTY_START needs a leading quantity, so the
  // line never reached the checklist and the retention gate never missed it.
  const desc = [
    'Crispy Pasta Bang Bang Salmon Salad',   // line 0 is the title, never an ingredient
    '(Per Serving - 2 Total)',
    '2 Large Cucumber',
    '250g Salmon (raw weight)',
    'Salt and Pepper to Taste',
    'Cooking Spray',
    'Green Onion',
    'Instructions:',
    'Prepare the pasta by following the instructions on the packaging.',
  ].join('\n')
  const out = parseUnquantifiedExtras(desc)
  assert.ok(out.includes('Green Onion'))
  assert.ok(out.includes('Cooking Spray'))
  // The method is not an ingredient list.
  assert.ok(!out.some(x => /Prepare the pasta/.test(x)))
  // "(Per Serving - 2 Total)" sits ABOVE the first quantified line, so it is title-zone noise.
  assert.ok(!out.some(x => /Per Serving/.test(x)))
})

test('the title zone and promo lines are not ingredients', () => {
  // The ingredient block STARTS at the first quantified line. That one rule removed every
  // stylised-unicode title from the sampled corpus, which no wordlist would have caught.
  const desc = [
    'HIGH PROTEIN MOMO',
    '𝗥𝗘𝗖𝗜𝗣𝗘 𝗙𝗢𝗥 No Maida High Protein Momo',   // above any quantity -> not an ingredient
    'Save this recipe and try it today!',
    '100g semolina',
    'Coriander leaves',                          // below a quantity -> a real ingredient
    'Follow for more easy recipes.',
    '📊 Macros (entire recipe)',
  ].join('\n')
  const out = parseUnquantifiedExtras(desc)
  assert.deepEqual(out, ['Coriander leaves'])
})

test('sections: an UNBULLETED list needs a colon or a leading "For"', () => {
  // hPCcDaUmGKw. Garlic powder appears three times and paprika twice — faithful, because the
  // creator seasons the pasta, the salmon and the dressing separately.
  const desc = [
    'Crispy Pasta Bang Bang Salmon Salad',   // line 0: the title is not a section of itself
    'Ingredients:',
    '2 Large Cucumber',
    '2 Tsp Garlic Powder',
    'Salt and Pepper to Taste',
    'Cooking Spray',                          // an unquantified INGREDIENT sitting mid-list
    '150g Edamame',
    '',
    'Salmon Seasonings:',
    '2 Tsp Garlic Powder',
    '',
    'Bang Bang Dressing:',
    '125g Greek yogurt',
    '1 Tsp Garlic Powder',
  ].join('\n')
  const got = parseIngredientSections(desc)
  const by = (l: string) => got.find(r => r.line === l)?.section
  assert.equal(by('2 Large Cucumber'), null)
  assert.equal(by('150g Edamame'), null, '"Cooking Spray" is an ingredient, not a heading')
  assert.equal(by('125g Greek yogurt'), 'bang bang dressing')
  // ONE ENTRY PER OCCURRENCE, not per unique line — the property every consumer depends on.
  // Keying a Map by line text collapses these to the last section, which mislabels every repeat
  // except one: exactly the case sections exist to explain. Caught in review, not by reading.
  assert.deepEqual(got.filter(r => /Garlic Powder/i.test(r.line)).map(r => r.section),
    [null, 'salmon seasonings', 'bang bang dressing'])
  assert.equal(got.filter(r => r.line === '2 Tsp Garlic Powder').length, 2,
    'an identical line under two parts must yield two entries')
})

test('sections: a BULLETED list treats any unbulleted line as the heading', () => {
  // CHDU7aKdcBs. No colons and no blank lines — the only signal is that ingredients are bulleted
  // and headings are not, which is already why parseIngredientBlock keeps only bulleted lines.
  const desc = [
    'High Protein Funfetti Cake', 'Ingredients', 'Cake',
    '* 35g oat flour', '* 50g nonfat Greek yogurt',
    'Frosting', '* 100g nonfat Greek yogurt',
    'Topping', '* 20g sprinkles',
  ].join('\n')
  const got = parseIngredientSections(desc)
  const by = (l: string) => got.find(r => r.line === l)?.section
  assert.equal(by('35g oat flour'), 'cake')
  assert.equal(by('100g nonfat Greek yogurt'), 'frosting')
  assert.equal(by('20g sprinkles'), 'topping')
  // The duplicate Greek yogurt is FAITHFUL — 50g in the cake, 100g in the frosting. A blanket
  // ingredient dedupe would silently halve recipes like this one.
  assert.deepEqual(got.filter(r => /Greek yogurt/.test(r.line)).map(r => r.section), ['cake', 'frosting'])
})

test('sections: "FOR X" headings, and no sections at all', () => {
  // FRyfG33qReo uses "FOR BOILING" / "FOR KEBAB" with no colons.
  const desc = ['SOYA KABAB', 'FOR BOILING', '1 Liter Water', '1 tsp Salt',
                'FOR KEBAB', '2 Onions', '1.5 tsp Salt'].join('\n')
  const got = parseIngredientSections(desc)
  assert.equal(got.find(r => r.line === '1 Liter Water')?.section, 'boiling')
  assert.equal(got.find(r => r.line === '2 Onions')?.section, 'kebab')
  // A plain single-part list gets null throughout, which is what suppresses the label in the UI.
  const plain = parseIngredientSections('Title\n2 eggs\n100g flour\n1 tsp salt')
  assert.ok(plain.length >= 3)
  assert.ok(plain.every(r => r.section === null))
})
