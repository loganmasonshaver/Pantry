import {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated'
import { BASELINE_FOLLOW, SMOOTHING, tiltOffset } from '@/lib/tilt'

// Letterboxd-style tilt parallax for a hero image: the photo drifts horizontally as the phone
// rolls, so it reads as sitting behind the screen rather than printed on it.
//
// Runs entirely on the UI thread — Reanimated's own sensor API delivers rotation to a worklet, so
// nothing crosses the JS bridge per frame and the drift can't be stalled by JS work.
//
// HORIZONTAL ONLY, deliberately. A square meal photo laid into the 440x500 hero with
// contentFit="cover" already renders ~500pt wide inside a 440pt box, so there are ~30pt of
// overflow per side being clipped away today. Riding that costs no extra upscaling. Vertical
// travel has no such slack and would mean scaling the image up further — which the 512px library
// cannot currently afford (see the square_hd discussion).

/**
 * @param maxTravel peak drift in points, each direction. 20 is a Letterboxd-ish subtlety.
 * @param enabled   pass false to hold the image still (e.g. a branch that owns its own transform).
 */
export function useTiltParallax(maxTravel = 20, enabled = true) {
  const reduceMotion = useReducedMotion()
  const active = enabled && !reduceMotion

  const rotation = useAnimatedSensor(SensorType.ROTATION, {
    interval: 16,
    // Keeps roll meaning "roll" if the interface ever rotates, rather than swapping axes.
    adjustToInterfaceOrientation: true,
  })

  // Offset is measured from however the phone is being held, not from absolute level — otherwise
  // someone reading at an angle gets the image parked against one edge for the whole visit.
  //
  // The baseline is seeded ONCE from inside the reaction and then only ever eased. It used to be a
  // nullable value reset by a useFocusEffect, which is what made the effect dead: every reset made
  // the next tick re-capture the current roll as the new baseline, so the delta was permanently
  // ~0 and tx never left 0. Nothing outside this worklet touches it now.
  const baseline = useSharedValue(0)
  const hasBaseline = useSharedValue(false)
  const tx = useSharedValue(0)

  useAnimatedReaction(
    () => (active && rotation.isAvailable ? rotation.sensor.value.roll : null),
    (roll) => {
      if (roll === null) { tx.value = 0; return }
      if (!hasBaseline.value) { baseline.value = roll; hasBaseline.value = true; return }

      // Very slow follower so a change of posture re-centres over seconds instead of pinning the
      // photo at a limit, while a deliberate tilt still reads as a full deflection.
      baseline.value += (roll - baseline.value) * BASELINE_FOLLOW
      const target = tiltOffset(roll, baseline.value, maxTravel)
      // Plain lerp rather than withTiming: the sensor already fires every frame, so a one-pole
      // filter is both cheaper and smoother than restarting an animation 60 times a second.
      tx.value += (target - tx.value) * SMOOTHING
    },
    [active, maxTravel],
  )

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }))

  return {
    style,
    isActive: active && rotation.isAvailable,
    // Surfaced for the __DEV__ overlay only. Three very different faults — reduce-motion enabled,
    // the sensor reporting unavailable, and a correctly-running-but-too-small effect — are
    // indistinguishable on a device, which cost several rounds of blind tuning.
    debug: { reduceMotion, sensorAvailable: rotation.isAvailable, roll: rotation.sensor, tx, baseline },
  }
}
