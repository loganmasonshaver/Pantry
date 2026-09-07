import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationKey, isGenerating, beginGeneration, endGeneration, publishGenerated, publishMealImage, publishMealImageFailed,
  subscribeGeneration, __resetGenerationBus,
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

// The regression that shipped with the first version of this bus: it published ONCE, at the end of
// the generation, and photos arrive long after that. The other screen got the hero image at best
// and sat on two shimmering cards forever.
test('a photo landing after the deck is published still reaches every screen', () => {
  __resetGenerationBus()
  const seen: Array<{ id: string; image: string }> = []
  subscribeGeneration(e => { if (e.type === 'image') seen.push({ id: e.mealId, image: e.image }) })
  beginGeneration(KEY)
  endGeneration(KEY, [{ id: '1', name: 'A' } as never, { id: '2', name: 'B' } as never])
  publishMealImage(KEY, '2', 'https://img/2.jpg')
  publishMealImage(KEY, '1', 'https://img/1.jpg')
  assert.deepEqual(seen, [{ id: '2', image: 'https://img/2.jpg' }, { id: '1', image: 'https://img/1.jpg' }])
})

test('photos are scoped to their key, so mealPlan photos never land on cookNow cards', () => {
  __resetGenerationBus()
  const seen: string[] = []
  subscribeGeneration(e => { if (e.type === 'image') seen.push(e.key) })
  publishMealImage(generationKey('u1', 'mealPlan'), '1', 'x')
  assert.deepEqual(seen, [generationKey('u1', 'mealPlan')])
})

// A forced regeneration running alongside an in-flight one never claims the lock. Its meals still
// have to reach the other screen, and it must not release a lock it does not hold.
test('publishGenerated delivers meals without touching the lock', () => {
  __resetGenerationBus()
  beginGeneration(KEY)
  let got: unknown = 'unset'
  subscribeGeneration(e => { if (e.type === 'end') got = e.meals })
  publishGenerated(KEY, [{ id: '9', name: 'Forced' } as never])
  assert.equal((got as any[])[0].name, 'Forced')
  assert.equal(isGenerating(KEY), true, 'the other generation still holds it')
})

// A photo that will NEVER arrive has to travel too, or the other screen shimmers forever on a
// meal this one has already given up on — which is what a user sees the moment they hit the
// daily image cap.
test('a failed photo is broadcast like a successful one', () => {
  __resetGenerationBus()
  const seen: string[] = []
  subscribeGeneration(e => { if (e.type === 'imageFailed') seen.push(e.mealId) })
  beginGeneration(KEY)
  endGeneration(KEY, [{ id: '1', name: 'A' } as never])
  publishMealImageFailed(KEY, '1')
  assert.deepEqual(seen, ['1'])
})
