// Pure maths for the hero tilt-parallax effect. Deliberately dependency-free so it can be tested
// under plain node — importing the hook itself drags in react-native-reanimated and expo-router,
// neither of which resolves outside the app runtime.

// Roll that produces FULL travel, in radians (~17deg). Tuned down from 0.5 (~28deg) after the
// first pass read as invisible: casual handling is a 5-15deg wrist movement, and mapping full
// travel to 28deg meant a typical 10deg roll produced only a third of the drift. This is the
// sensitivity knob — lower means more reaction to the same wrist movement.
export const TILT_RANGE = 0.3
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
  if (Math.abs(clamped) < DEADZONE) return 0
  return -(clamped / TILT_RANGE) * maxTravel
}
