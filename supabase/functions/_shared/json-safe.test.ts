import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonSafe } from './json-safe.ts'

test('a lone surrogate becomes U+FFFD, a valid pair is untouched, NUL is removed', () => {
  assert.equal(jsonSafe('\udc68\u200d🍳 HAZIRLANIŞI'), '\ufffd\u200d🍳 HAZIRLANIŞI')
  assert.equal(jsonSafe('x\ud83dy'), 'x\ufffdy')
  assert.equal(jsonSafe('👨‍🍳 ok'), '👨‍🍳 ok')
  assert.equal(jsonSafe('a\u0000b'), 'ab')
})

test('walks arrays and objects and leaves other values alone', () => {
  const funnel = { stored: 12, ok: true, none: null, llm: { droppedDetail: [{ name: 'x', src: ['1 cup rice', '\udc68 heading'] }] } }
  const out = jsonSafe(funnel)
  assert.deepEqual(out, { stored: 12, ok: true, none: null, llm: { droppedDetail: [{ name: 'x', src: ['1 cup rice', '\ufffd heading'] }] } })
  assert.notEqual(out, funnel, 'returns a copy')
  // What the whole thing exists for: the result survives a strict JSON round trip with no lone surrogate left.
  assert.doesNotMatch(JSON.stringify(out), /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i)
})
