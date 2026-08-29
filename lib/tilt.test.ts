// Run: node --test lib/tilt.test.ts
// Covers the roll->offset mapping only. The sensor plumbing and the lerp need a device.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TILT_CURVE, TILT_RANGE, tiltOffset } from './tilt.ts'

const MAX = 20
const DEG = (d: number) => (d * Math.PI) / 180

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

test('a full-range roll reaches exactly maxTravel', () => {
  assert.equal(Math.abs(tiltOffset(TILT_RANGE, 0, MAX)), MAX)
  assert.equal(Math.abs(tiltOffset(-TILT_RANGE, 0, MAX)), MAX)
})

test('response is monotonic — more tilt always means more drift', () => {
  let prev = -1
  for (let d = DEG(3); d <= TILT_RANGE; d += 0.01) {
    const v = Math.abs(tiltOffset(d, 0, MAX))
    assert.ok(v >= prev - 1e-9, `drift went backwards at ${d} rad`)
    prev = v
  }
})

test('the curve keeps ordinary handling calm without capping deliberate tilts', () => {
  // The two complaints this shape exists to reconcile: a linear ramp steep enough to satisfy a
  // deliberate 20deg tilt was too lively at 5deg, and one gentle enough at 5deg did nothing at
  // 20deg. Assert BOTH ends, so a future retune cannot quietly reintroduce either.
  const small = Math.abs(tiltOffset(DEG(5), 0, MAX))
  const large = Math.abs(tiltOffset(DEG(20), 0, MAX))
  // 0.25 not 0.2: small-angle calm is now delivered mainly by SMOOTHING (heavy damping), so the
  // curve itself is allowed to be closer to linear here.
  assert.ok(small < MAX * 0.25, `5deg gave ${small.toFixed(1)}pt — too lively while just holding it`)
  assert.ok(large > MAX * 0.85, `20deg gave ${large.toFixed(1)}pt — a deliberate tilt must pay off`)
})

test('the response is sub-linear', () => {
  // The invariant is the SHAPE, not its strength: half a roll must give less than half the
  // travel. How MUCH less is a tuning value that has moved between 1.6 and 1.15, so asserting a
  // specific degree of ease just fails every time the feel is adjusted.
  assert.ok(TILT_CURVE > 1, 'a linear response could not satisfy both ends')
  const half = Math.abs(tiltOffset(TILT_RANGE / 2, 0, MAX))
  assert.ok(half < MAX * 0.5, `half tilt gave ${half.toFixed(1)}pt of ${MAX} — not sub-linear`)
})
