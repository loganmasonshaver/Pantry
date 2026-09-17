import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlatingStory, buildScanStory, STORY_MAX_CHARS, type StoryProfile } from './scanStory.ts'

// Logan's profile, read from production 2026-09-16.
const LOGAN: StoryProfile = {
  calorie_goal: 2200, protein_goal: 160, meals_per_day: 4, fitness_goal: null, diet_type: 'Classic',
  dietary_restrictions: [], food_dislikes: [], cooking_skill: null, max_prep_minutes: 30,
}

test("Logan's story: his numbers, interleaved with consistency lines (no goal on his profile)", () => {
  assert.deepEqual(buildScanStory(LOGAN, 14), [
    'Reading every shelf in your 14 photos',
    'Consistency beats perfect. This makes it easy',
    'Built around your 2,200-calorie day',
    'Eating better, from food you already own',
    'About 40g of protein in every meal',
    'No more guessing what is for dinner',
    'Around 550 calories a plate',
    'Nothing over 30 minutes',
  ])
})

test('a goal gets its own reassurance lines, then two about consistency', () => {
  const gain = buildScanStory({ ...LOGAN, fitness_goal: 'gain' }, 3)
  assert.ok(gain.includes('Muscle gets built in the kitchen, too'))
  assert.ok(gain.includes('Protein to grow on, every single meal'))
  assert.ok(!gain.some(l => /cut|fat loss|recomp/i.test(l)))
  const lose = buildScanStory({ ...LOGAN, fitness_goal: 'lose' }, 3)
  assert.ok(lose.includes('High protein keeps you full while you cut'))
  assert.ok(!lose.some(l => /muscle|gains|recomp/i.test(l)))
  const recomp = buildScanStory({ ...LOGAN, fitness_goal: 'maintain' }, 3)
  assert.ok(recomp.includes('A recomp runs on protein and consistency'))
  // Goal lines and fact lines alternate, starting with the scan.
  assert.equal(gain[0], 'Reading every shelf in your 3 photos')
  assert.equal(gain[1], 'Muscle gets built in the kitchen, too')
  assert.equal(gain[2], 'Built around your 2,200-calorie day')
})

test('restrictions, dislikes and skill each get a line; "None" and Classic do not', () => {
  const p: StoryProfile = { ...LOGAN, dietary_restrictions: ['Gluten-free', 'None'], food_dislikes: ['Olives', 'Tuna', 'Beets'], cooking_skill: 'adventurous' }
  const s = buildScanStory(p, 2)
  assert.ok(s.includes('Every pick stays gluten-free'))
  assert.ok(s.includes('And no olives or tuna. Ever.'))
  assert.ok(s.includes('With the bold flavors you like'))
  assert.ok(buildScanStory({ ...LOGAN, food_dislikes: ['mushrooms'] }, 2).includes('And no mushrooms. Ever.'))
  assert.ok(buildScanStory({ ...LOGAN, diet_type: 'Pescatarian' }, 2).includes('Pescatarian, all the way through'))
  assert.ok(!buildScanStory(LOGAN, 2).some(l => /classic/i.test(l)))
})

test('empty fields leave no holes: no "undefined", "NaN", "0g" or "null" in any line', () => {
  const profiles: (StoryProfile | null)[] = [
    null, {}, { calorie_goal: 0, protein_goal: 0, meals_per_day: 0 }, { protein_goal: 150 },
    { calorie_goal: 1800 }, { dietary_restrictions: null, food_dislikes: null }, LOGAN,
  ]
  for (const p of profiles) {
    for (const line of buildScanStory(p, 1)) {
      assert.ok(!/undefined|NaN|null|\b0g\b|\b0 calories/.test(line), `bad line: "${line}"`)
      assert.ok(line.trim().length > 0)
    }
  }
  // Protein per meal needs meals_per_day; calories alone still give the calorie-day line.
  const calOnly = buildScanStory({ calorie_goal: 1800 }, 1)
  assert.ok(calOnly.includes('Built around your 1,800-calorie day'))
  assert.ok(!calOnly.some(l => /a plate|protein in every/.test(l)))
})

test('one photo reads naturally, and a null profile still tells a story', () => {
  const s = buildScanStory(null, 1)
  assert.equal(s[0], 'Reading every shelf in your photo')
  assert.ok(s.length >= 3)
})

test('every line fits two lines of the big type', () => {
  const everyGoal = ['lose', 'gain', 'maintain', null]
  for (const g of everyGoal) {
    const p: StoryProfile = { ...LOGAN, fitness_goal: g, dietary_restrictions: ['Gluten-free', 'Dairy-free'], food_dislikes: ['mushrooms', 'olives'], cooking_skill: 'culinary', diet_type: 'Pescatarian' }
    for (const line of buildScanStory(p, 16)) assert.ok(line.length <= STORY_MAX_CHARS, `${line.length} chars: "${line}"`)
  }
})

test("plating story: Logan's numbers, in the order a short wait reads them", () => {
  assert.deepEqual(buildPlatingStory(LOGAN, 80), [
    'Putting all 80 items to work',
    'Aiming for 40g of protein a plate',
    "Built from what's already in your kitchen",
    'Ready in 30 minutes or less',
    'Plating your picks now',
  ])
})

test('plating story: fits the big type, leaves no holes, and never counts the meals', () => {
  const profiles: (StoryProfile | null)[] = [LOGAN, null, {}, { protein_goal: 0, meals_per_day: 0, max_prep_minutes: 0 }]
  for (const p of profiles) {
    for (const n of [0, 1, 7, 1250]) {
      const lines = buildPlatingStory(p, n)
      assert.ok(lines.length >= 2, 'a wait always has something to read')
      for (const line of lines) {
        assert.ok(line.length <= STORY_MAX_CHARS, `too long for two lines: "${line}"`)
        assert.ok(!/undefined|NaN|null|\b0g\b|\b0 items|\b0 minutes/.test(line), `bad line: "${line}"`)
        // The deck can hold fewer than three, and a Cook Now meal can still need an item.
        assert.ok(!/\bthree\b|\b3 (meals|picks)|cook right now|no shopping/i.test(line), `claims too much: "${line}"`)
      }
    }
  }
  assert.equal(buildPlatingStory(null, 1)[0], 'Putting your new item to work')
  assert.equal(buildPlatingStory(null, 1250)[0], 'Putting all 1,250 items to work')
})
