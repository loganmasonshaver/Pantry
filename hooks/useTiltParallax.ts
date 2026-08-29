import { useCallback } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated'
import { SMOOTHING, tiltOffset } from '@/lib/tilt'

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

  // Offset is measured from however the phone was being held when the screen appeared. Without a
  // baseline, someone reading in bed gets the image parked against one edge for the whole visit.
  const baseline = useSharedValue<number | null>(null)
  const tx = useSharedValue(0)

  // Re-centre on every visit — the phone is rarely at the same angle twice.
  useFocusEffect(
    useCallback(() => {
      baseline.value = null
      return () => { baseline.value = null }
    }, []),
  )

  useAnimatedReaction(
    () => (active && rotation.isAvailable ? rotation.sensor.value.roll : null),
    (roll) => {
      if (roll === null) { tx.value = 0; return }
      if (baseline.value === null) { baseline.value = roll; return }

      const target = tiltOffset(roll, baseline.value, maxTravel)
      // Plain lerp rather than withTiming: the sensor already fires every frame, so a one-pole
      // filter is both cheaper and smoother than restarting an animation 60 times a second.
      tx.value += (target - tx.value) * SMOOTHING
    },
    [active, maxTravel],
  )

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }))

  return { style, isActive: active && rotation.isAvailable }
}
