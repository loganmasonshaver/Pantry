import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepsLookUntranslated, translateSteps, stepDetails } from './translate-steps.ts'

// Verbatim from the live pool — English titles over German detail, the exact defect.
const beefPastaSkillet = [
  { title: 'Sauté', detail: 'Zwiebel und Paprika in Ölspray anbraten, Knoblauch kurz mitziehen lassen.' },
  { title: 'Sauce', detail: 'Gewürze und passierte Tomaten dazu, ein paar Minuten köcheln.' },
  { title: 'Cream', detail: 'Nudeln kochen, Nudelwasser auffangen. Soße mit Buko Balance und Nudelwasser cremig pürieren.' },
]
const ovenEggs = [
  { title: 'Combine', detail: 'Alle Zutaten direkt in einer ofenfesten Form miteinander vermengen.' },
  { title: 'Bake', detail: 'Bei 165 Grad Umluft backen bis die Oberfläche goldbraun geworden ist. Ca. 20 Minuten, je nach Ofen.' },
]
const english = [
  { title: 'Heat Oil', detail: 'Warm olive oil in a skillet over medium-high heat.' },
  { title: 'Sear', detail: 'Sear chicken 6-7 minutes per side until golden, then add the jalapeño and cook 1 minute.' },
]

test('the live German recipes are caught', () => {
  assert.equal(stepsLookUntranslated(beefPastaSkillet), true)
  assert.equal(stepsLookUntranslated(ovenEggs), true)
})

test('English is not flagged — including an accented English word like jalapeño', () => {
  assert.equal(stepsLookUntranslated(english), false)
  assert.equal(stepsLookUntranslated(['Blend the mango with lemon and honey, then serve.']), false)
})

test('one stray marker word is not a language', () => {
  assert.equal(stepsLookUntranslated([{ title: 'Serve', detail: 'Top with chilli con carne leftovers and serve.' }]), false)
})

test('a good translation keeps titles, count and order', async () => {
  const out = await translateSteps(ovenEggs, async () => JSON.stringify([
    'Mix all the ingredients directly in an ovenproof dish.',
    'Bake at 165°C fan until the top is golden brown, about 20 minutes depending on the oven.',
  ]))
  assert.deepEqual(out?.map((s: any) => s.title), ['Combine', 'Bake'])
  assert.match((out as any)[1].detail, /165°C fan/)
})

test('a translation with the wrong step count is refused, not trimmed to fit', async () => {
  assert.equal(await translateSteps(ovenEggs, async () => JSON.stringify(['Mix and bake everything.'])), null)
})

test('an answer that is still German is refused', async () => {
  assert.equal(await translateSteps(ovenEggs, async () => JSON.stringify(stepDetails(ovenEggs))), null)
})

test('an unparseable answer is refused', async () => {
  assert.equal(await translateSteps(ovenEggs, async () => 'Sure! Here are your steps:'), null)
})

import { titleLooksNonEnglish, namesCopiedFromSource, translateIngredientNames } from './translate-steps.ts'

test('titleLooksNonEnglish: two distinct foreign words; English titles with a menu word are not', () => {
  assert.equal(titleLooksNonEnglish('Biscotto gelato proteico: per chi non sa cucinare #nutrizione #cucina'), true)
  assert.equal(titleLooksNonEnglish('High Protein CANNELLONI AUFLAUF 🍝🔥 schnelles Rezept'), true)
  assert.equal(titleLooksNonEnglish('YÜKSEK PROTEİNLİ PRATİK TİRAMİSU TOPLARI'), true)
  assert.equal(titleLooksNonEnglish('Jalapeño Taco Mac | Easy 54g Protein Meal'), false)
  assert.equal(titleLooksNonEnglish('Chicken Rice Cooker Sukiyaki'), false)
  assert.equal(titleLooksNonEnglish('Protein Gelato Sandwich'), false)
})

test('namesCopiedFromSource: counts names identical to a source line minus its quantity', () => {
  const src = ['150 g di yogurt greco 0%', '4 biscotti secchi', '50 ml di latte scremato', 'caffè espresso freddo q.b.', '10 g gocce di cioccolato fondente']
  assert.equal(namesCopiedFromSource(['yogurt greco 0%', 'biscotti secchi', 'latte scremato', 'caffè espresso freddo', 'gocce di cioccolato fondente'], src), 5)
  assert.equal(namesCopiedFromSource(['0% greek yogurt', 'dry biscuits', 'skim milk', 'cold espresso', 'dark chocolate chips'], src), 0)
})

test('translateIngredientNames: same count or null', async () => {
  const ok = await translateIngredientNames(['latte scremato', 'biscotti secchi'], async () => '["skim milk", "dry biscuits"]')
  assert.deepEqual(ok, ['skim milk', 'dry biscuits'])
  assert.equal(await translateIngredientNames(['latte scremato', 'biscotti secchi'], async () => '["skim milk"]'), null)
  assert.equal(await translateIngredientNames(['latte scremato'], async () => 'not json'), null)
})
