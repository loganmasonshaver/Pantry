// Run: node --test lib/tilt.test.ts
// Covers the roll->offset mapping only. The sensor plumbing and the lerp need a device.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TILT_RANGE, tiltOffset } from './tilt.ts'

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
  assert.equal(Math.round(tiltOffset(TILT_RANGE, 0, MAX)), -MAX)
  assert.equal(Math.round(tiltOffset(TILT_RANGE * 3, 0, MAX)), -MAX)
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
  // Derived from TILT_RANGE, not hardcoded — retuning sensitivity must not break this.
  const half = tiltOffset(TILT_RANGE / 2, 0, MAX)
  const full = tiltOffset(TILT_RANGE, 0, MAX)
  assert.ok(Math.abs(full - 2 * half) < 1e-9, 'half the tilt should give half the drift')
  assert.ok(Math.abs(full) === MAX, 'a full-range roll should reach exactly maxTravel')
})

test('a casual 10deg roll produces most of the effect', () => {
  // The regression that prompted the retune: at TILT_RANGE 0.5 a normal 10deg wrist movement
  // yielded 7pt of drift and read as no effect at all. Guard the sensitivity, not just the cap.
  const tenDeg = 10 * Math.PI / 180
  const at10 = Math.abs(tiltOffset(tenDeg, 0, MAX))
  assert.ok(at10 > MAX * 0.4, `10deg gave only ${at10.toFixed(1)}pt of ${MAX} — too subtle`)
})
