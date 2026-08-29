// Pure maths for the hero tilt-parallax effect. Deliberately dependency-free so it can be tested
// under plain node — importing the hook itself drags in react-native-reanimated and expo-router,
// neither of which resolves outside the app runtime.

// Roll that produces FULL travel, in radians (~20deg).
export const TILT_RANGE = 0.35

// Response curve exponent. 1 is linear; higher makes small tilts calmer while still reaching full
// travel on a deliberate one.
//
// This exists because LINEAR TUNING COULD NOT SATISFY BOTH COMPLAINTS. A gentle linear slope read
// as "too subtle" on a deliberate tilt; a steep one read as "too sensitive" while simply holding
// the phone. Those are opposite ends of the same straight line, so no single slope fixes both —
// the fix is to change the SHAPE. At 1.6 the photo is nearly still through the 3-10deg range of
// ordinary handling and still travels the full 20pt when the wrist actually turns.
export const TILT_CURVE = 1.6
// Below this the photo does not move at all (~2deg). Widened from 0.02 (~1deg) because at the
// higher sensitivity the frame was creeping during ordinary reading — "too much movement" is as
// much about never being still as about travelling far.
export const DEADZONE = 0.035
// Per-frame approach rate for the one-pole filter. 0.12 at 60fps settles in roughly 100ms. Raised
// alongside TILT_RANGE — with a slower filter the bigger travel lagged the wrist and read as
// drift rather than response.
export const SMOOTHING = 0.12

/**
 * Roll (radians) -> horizontal drift (points), measured from a baseline captured when the screen
 * appeared. Relative rather than absolute: without it, someone reading at an angle would get the
 * photo parked against one edge for the whole visit.
 *
 * Negative for positive roll — the photo slides AGAINST the tilt, the way a background does when
 * you lean past a window frame. Flip the sign here to invert the whole effect.
 */
export function tiltOffset(roll: number, baseline: number, maxTravel: number): number {
  'worklet'
  const delta = roll - baseline
  const clamped = Math.max(-TILT_RANGE, Math.min(TILT_RANGE, delta))
  const magnitude = Math.abs(clamped)
  if (magnitude < DEADZONE) return 0
  // Curve the magnitude, then re-apply the sign — raising a negative to a fractional power is NaN.
  const eased = Math.pow(magnitude / TILT_RANGE, TILT_CURVE)
  return -Math.sign(clamped) * eased * maxTravel
}
