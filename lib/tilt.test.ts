// Run: node --test lib/tilt.test.ts
// Covers the roll->offset mapping only. The sensor plumbing and the lerp need a device.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tiltOffset } from './tilt.ts'

const MAX = 20

test('resting at the baseline produces no drift', () => {
  assert.equal(tiltOffset(0.4, 0.4, MAX), 0)
})

test('hand tremor inside the deadzone produces no drift', () => {
  assert.equal(tiltOffset(0.41, 0.4, MAX), 0)   // 0.01 rad, under the 0.02 deadzone
  assert.equal(tiltOffset(0.39, 0.4, MAX), 0)
})

test('drift opposes the tilt and is symmetric', () => {
  const right = tiltOffset(0.4 + 0.25, 0.4, MAX)
  const left = tiltOffset(0.4 - 0.25, 0.4, MAX)
  assert.ok(right < 0, `rolling right should push the photo left, got ${right}`)
  assert.ok(left > 0, `rolling left should push the photo right, got ${left}`)
  assert.ok(Math.abs(right + left) < 1e-9, 'must be symmetric about the baseline')
})

test('drift never exceeds maxTravel, however far the phone is turned', () => {
  for (const roll of [1, 5, -5, Math.PI, -Math.PI, 100, -100]) {
    const v = tiltOffset(roll, 0, MAX)
    assert.ok(Math.abs(v) <= MAX + 1e-9, `roll ${roll} gave ${v}, over the ${MAX}pt limit`)
  }
  // Past the comfortable range it should be pinned exactly at the limit, not creeping.
  assert.equal(Math.round(tiltOffset(0.5, 0, MAX)), -20)
  assert.equal(Math.round(tiltOffset(0.9, 0, MAX)), -20)
})

test('the baseline is genuinely relative, not absolute', () => {
  // Same 0.2 rad wrist movement from three very different holding angles must feel identical —
  // this is what stops the photo parking against one edge for someone reading in bed.
  const a = tiltOffset(0.2, 0.0, MAX)
  const b = tiltOffset(1.2, 1.0, MAX)
  const c = tiltOffset(-0.8, -1.0, MAX)
  assert.ok(Math.abs(a - b) < 1e-9 && Math.abs(b - c) < 1e-9, `${a} ${b} ${c}`)
})

test('response is linear across the range', () => {
  const half = tiltOffset(0.25, 0, MAX)
  const full = tiltOffset(0.5, 0, MAX)
  assert.ok(Math.abs(full - 2 * half) < 1e-9, 'half the tilt should give half the drift')
})
