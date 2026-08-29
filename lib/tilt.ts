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
// the fix is to change the SHAPE. 1.6 overcorrected — it flattened the 5-15deg band where the
// wrist actually moves. Now barely above linear: the earlier "too sensitive" reading was taken
// against the broken baseline and carries no information, so there is nothing left to suppress.
export const TILT_CURVE = 1.05
// Below this the photo does not move at all (~1deg). Back down from 0.035: that widening was a
// response to creep observed while the effect was broken, so it was suppressing nothing real.
export const DEADZONE = 0.02
// Per-frame approach rate for the one-pole filter. 0.08 at 60fps is a ~208ms time constant.
//
// SPEED, not distance, is what the effect is judged on here. At an identical 30pt of travel,
// 0.06 (~278ms) read as too subtle while 0.10 (~167ms) and 0.15 (~111ms) both read as too much
// movement — so displacement was never the variable and bisecting it was wasted effort. The
// usable band is narrow and sits just above 0.06. Tune THIS first.
// Lower = weightier and calmer, higher = snappier and more present.
export const SMOOTHING = 0.08

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
