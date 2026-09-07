import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationKey, isGenerating, beginGeneration, endGeneration, subscribeGeneration,
  __resetGenerationBus,
} from './mealGenerationBus.ts'

const KEY = generationKey('u1', 'cookNow')

test('a second claim on the same key is refused', () => {
  __resetGenerationBus()
  assert.equal(beginGeneration(KEY), true)
  assert.equal(beginGeneration(KEY), false, 'the other screen must not fire a second paid generation')
  endGeneration(KEY, null)
  assert.equal(beginGeneration(KEY), true, 'released once it settles')
})

test('cookNow and mealPlan are separate decks and never block each other', () => {
  __resetGenerationBus()
  assert.equal(beginGeneration(generationKey('u1', 'cookNow')), true)
  assert.equal(beginGeneration(generationKey('u1', 'mealPlan')), true)
})

test('subscribers hear begin and end', () => {
  __resetGenerationBus()
  const seen: string[] = []
  subscribeGeneration(e => seen.push(e.type))
  beginGeneration(KEY)
  endGeneration(KEY, [{ id: '1', name: 'X' } as never])
  assert.deepEqual(seen, ['begin', 'end'])
})

test('the end event carries the meals so the other screen can show them', () => {
  __resetGenerationBus()
  let got: unknown = 'unset'
  subscribeGeneration(e => { if (e.type === 'end') got = e.meals })
  beginGeneration(KEY)
  endGeneration(KEY, [{ id: '1', name: 'Beef Bowl' } as never])
  assert.equal((got as any[])[0].name, 'Beef Bowl')
})

// A failed generation must still release the lock, or every later attempt is refused and the
// screen that started it is stranded.
test('a failure releases the lock and publishes no meals', () => {
  __resetGenerationBus()
  let got: unknown = 'unset'
  subscribeGeneration(e => { if (e.type === 'end') got = e.meals })
  beginGeneration(KEY)
  endGeneration(KEY, null)
  assert.equal(got, null)
  assert.equal(isGenerating(KEY), false)
})

test('one throwing subscriber does not strand the others on a spinner', () => {
  __resetGenerationBus()
  const heard: string[] = []
  subscribeGeneration(() => { throw new Error('boom') })
  subscribeGeneration(e => heard.push(e.type))
  beginGeneration(KEY)
  endGeneration(KEY, null)
  assert.deepEqual(heard, ['begin', 'end'])
})

test('unsubscribing stops delivery', () => {
  __resetGenerationBus()
  const heard: string[] = []
  const off = subscribeGeneration(e => heard.push(e.type))
  beginGeneration(KEY)
  off()
  endGeneration(KEY, null)
  assert.deepEqual(heard, ['begin'])
})
