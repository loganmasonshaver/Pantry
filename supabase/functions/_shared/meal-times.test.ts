import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseTimes, normalisePhases, TIME_RULES, PHASE_RULES } from './meal-times.ts'

test('a correctly split answer passes through untouched', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 10, cookTime: 0, restTime: 960 }), { prepTime: 10, cookTime: 0, restTime: 960 })
})

test('a freeze filed as prep is MOVED into rest, not thrown away — the dish still takes a day', () => {
  // Brownie Batter Protein Ice Cream was stored as prep_time 1020.
  assert.deepEqual(normaliseTimes({ prepTime: 1020, cookTime: 0, restTime: 0 }), { prepTime: 0, cookTime: 0, restTime: 1020 })
})

test('a wait mis-filed as cook time is moved the same way', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 10, cookTime: 480, restTime: 0 }), { prepTime: 10, cookTime: 0, restTime: 480 })
})

test('an ordinary long active time is left alone', () => {
  // A 3-hour braid or a slow braise is real work time, well under the slip threshold.
  assert.deepEqual(normaliseTimes({ prepTime: 45, cookTime: 180, restTime: 0 }), { prepTime: 45, cookTime: 180, restTime: 0 })
})

test('junk becomes zero, never NaN and never negative', () => {
  assert.deepEqual(normaliseTimes({ prepTime: 'soon', cookTime: -5, restTime: null }), { prepTime: 0, cookTime: 0, restTime: 0 })
  assert.deepEqual(normaliseTimes({}), { prepTime: 0, cookTime: 0, restTime: 0 })
})

test('rest is capped so a unit slip cannot claim a week', () => {
  assert.equal(normaliseTimes({ prepTime: 10, restTime: 99999 }).restTime, 4320)
})

test('the rules name both failure directions seen in the live pool', () => {
  assert.ok(TIME_RULES.includes('NEVER fold a freeze'))
  assert.ok(TIME_RULES.includes('NEVER drop it'))
  // Storage notes were the main false positive when keyword matching was measured against the pool.
  assert.ok(TIME_RULES.includes('storage and reheating notes'))
})

test('the rules forbid a zero for a mandatory step the creator did not time', () => {
  // Measured on the dry run: "bake until golden brown" came back cookTime 0 and "cool and chill
  // before serving" restTime 0, while an optional "or freeze 5 more minutes" correctly came back 0.
  assert.ok(TIME_RULES.includes('MANDATORY step with NO stated duration'))
  assert.ok(TIME_RULES.includes('OPTIONAL one'))
})

// ── ordered phases ─────────────────────────────────────────────────────────────────────────────

test('Lentil Quinoa Flatbread: the overnight soak comes FIRST, where the recipe does it', () => {
  const times = { prepTime: 20, cookTime: 20, restTime: 480 }
  assert.deepEqual(normalisePhases([
    { kind: 'wait', label: 'soak', minutes: 480 },
    { kind: 'prep', label: 'prep', minutes: 20 },
    { kind: 'cook', label: 'cook', minutes: 20 },
  ], times), [
    { kind: 'wait', label: 'soak', minutes: 480 },
    { kind: 'prep', label: 'prep', minutes: 20 },
    { kind: 'cook', label: 'cook', minutes: 20 },
  ])
})

test('a mid-recipe freeze keeps work on both sides of it (Creami: blend, freeze, spin)', () => {
  const p = normalisePhases([
    { kind: 'prep', label: 'prep', minutes: 5 }, { kind: 'wait', label: 'freeze', minutes: 960 }, { kind: 'cook', label: 'spin', minutes: 5 },
  ], { prepTime: 5, cookTime: 5, restTime: 960 })
  assert.deepEqual(p?.map(x => x.label), ['prep', 'freeze', 'spin'])
})

test('phases that tell a DIFFERENT story from the totals are dropped, not trusted', () => {
  // 40 minutes of prep in phases against a stored 20: the detail screen falls back to the totals.
  assert.equal(normalisePhases([{ kind: 'prep', label: 'prep', minutes: 40 }], { prepTime: 20, cookTime: 0, restTime: 0 }), null)
  // A wait in the phases that the totals say does not exist.
  assert.equal(normalisePhases([
    { kind: 'prep', label: 'prep', minutes: 10 }, { kind: 'wait', label: 'chill', minutes: 60 },
  ], { prepTime: 10, cookTime: 0, restTime: 0 }), null)
})

test('rounding slack: within 5 minutes or 10% still agrees', () => {
  assert.ok(normalisePhases([{ kind: 'prep', label: 'prep', minutes: 13 }, { kind: 'wait', label: 'chill', minutes: 110 }],
    { prepTime: 10, cookTime: 0, restTime: 120 }))
})

test('adjacent same phases merge; unknown labels become generic, never invented', () => {
  assert.deepEqual(normalisePhases([
    { kind: 'prep', label: 'chop', minutes: 5 }, { kind: 'prep', label: 'mix', minutes: 5 },
    { kind: 'cook', label: 'sous-vide', minutes: 60 }, { kind: 'wait', label: 'nap', minutes: 30 },
  ], { prepTime: 10, cookTime: 60, restTime: 30 }), [
    { kind: 'prep', label: 'prep', minutes: 10 },
    { kind: 'cook', label: 'cook', minutes: 60 },
    { kind: 'wait', label: 'rest', minutes: 30 },
  ])
})

test('junk is null, never a partial timeline', () => {
  assert.equal(normalisePhases(undefined, { prepTime: 10, cookTime: 0, restTime: 0 }), null)
  assert.equal(normalisePhases('soak then cook', { prepTime: 10, cookTime: 0, restTime: 0 }), null)
  assert.equal(normalisePhases([{ kind: 'eat', minutes: 5 }], { prepTime: 10, cookTime: 0, restTime: 0 }), null)
})

test('the phase rules state the add-up contract the validator enforces', () => {
  assert.match(PHASE_RULES, /MUST add up/)
})

test('the list order IS the cooking order — nothing re-sorts it', () => {
  const p = normalisePhases([
    { kind: 'wait', label: 'soak', minutes: 480 }, { kind: 'prep', label: 'prep', minutes: 20 }, { kind: 'cook', label: 'cook', minutes: 30 },
  ], { prepTime: 20, cookTime: 30, restTime: 480 })
  assert.deepEqual(p?.map(x => x.label), ['soak', 'prep', 'cook'])
})

test('the phase rules pin the Creami order the model once got backwards', () => {
  // McFlurry came back "prep → thaw → spin → freeze".
  assert.match(PHASE_RULES, /frozen BEFORE it is spun/)
})
