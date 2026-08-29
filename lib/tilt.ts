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
// the fix is to change the SHAPE. 1.6 overcorrected — it flattened the 5-15deg band that is
// where the wrist actually moves, and the effect vanished. 1.15 keeps a slight ease off centre
// without hollowing out the middle; the "too eager" complaint is handled by SMOOTHING instead.
export const TILT_CURVE = 1.15
// Below this the photo does not move at all (~2deg). Widened from 0.02 (~1deg) because at the
// higher sensitivity the frame was creeping during ordinary reading — "too much movement" is as
// much about never being still as about travelling far.
export const DEADZONE = 0.035
// Per-frame approach rate for the one-pole filter. 0.06 at 60fps settles in roughly 250ms.
// HALVED deliberately: "sensitivity is too high" turned out to be about the photo tracking the
// hand too eagerly rather than travelling too far, and heavy damping fixes that without giving
// up the distance that makes the effect visible at all. Lower = weightier, higher = snappier.
export const SMOOTHING = 0.06

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

// How fast the rest orientation chases the phone's actual angle, per frame. Deliberately tiny
// (~8s time constant) so it only absorbs posture changes; a deliberate tilt still deflects fully.
export const BASELINE_FOLLOW = 0.002
