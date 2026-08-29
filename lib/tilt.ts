// Pure maths for the hero tilt-parallax effect. Deliberately dependency-free so it can be tested
// under plain node — importing the hook itself drags in react-native-reanimated and expo-router,
// neither of which resolves outside the app runtime.

// Comfortable wrist roll in radians (~28deg). Past this the image is pinned at its limit.
export const TILT_RANGE = 0.5
// Ignore sub-degree noise so a resting hand doesn't shimmer the frame.
export const DEADZONE = 0.02
// Per-frame approach rate for the one-pole filter. ~0.09 at 60fps settles in roughly 150ms —
// slow enough to feel like weight, fast enough not to lag the wrist.
export const SMOOTHING = 0.09

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
