import { useEffect, useState } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import type { ValueRotation } from 'react-native-reanimated'

// __DEV__-only readout for the hero tilt. Exists because "I don't see any movement" has three
// completely different causes that look identical on a device — Reduce Motion switched on, the
// rotation sensor reporting unavailable, or the effect running correctly but tuned too small —
// and guessing between them burned several tuning rounds.
//
// Polls at 5Hz from JS rather than driving text from a worklet: this is a debug affordance, it
// never ships, and ReText-style plumbing would be more machinery than the problem deserves.
export function TiltDebugOverlay({
  reduceMotion,
  sensorAvailable,
  roll,
  tx,
  baseline,
}: {
  reduceMotion: boolean
  sensorAvailable: boolean
  roll: SharedValue<ValueRotation>
  tx: SharedValue<number>
  baseline: SharedValue<number>
}) {
  const [snap, setSnap] = useState({ roll: 0, tx: 0, baseline: 0 })

  useEffect(() => {
    if (!__DEV__) return
    const id = setInterval(() => {
      // Shared values are readable from JS; this is a sample, not a subscription.
      setSnap({ roll: roll.value?.roll ?? 0, tx: tx.value, baseline: baseline.value })
    }, 200)
    return () => clearInterval(id)
  }, [])

  if (!__DEV__) return null

  const dead = !sensorAvailable || reduceMotion
  return (
    <View style={s.wrap} pointerEvents="none">
      <Text style={[s.line, dead && s.bad]}>
        {reduceMotion ? 'REDUCE MOTION ON — tilt disabled' : sensorAvailable ? 'sensor ok' : 'SENSOR UNAVAILABLE'}
      </Text>
      <Text style={s.line}>roll {(snap.roll * 57.2958).toFixed(1)}°</Text>
      {/* delta is what actually drives the image — if roll moves but this stays ~0, the baseline
          is chasing the roll instead of holding still, which is what killed the effect before. */}
      <Text style={s.line}>delta {((snap.roll - snap.baseline) * 57.2958).toFixed(1)}°</Text>
      <Text style={s.line}>drift {snap.tx.toFixed(1)}pt</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 70,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 999,
  },
  line: { color: '#4ADE80', fontSize: 11, fontVariant: ['tabular-nums'], fontWeight: '600' },
  bad: { color: '#F0666B' },
})
