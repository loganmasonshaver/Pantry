import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'

// __DEV__ readout for the macros accordion. Exists because open-vs-close choppiness has several
// causes that look identical on a device, and three rounds of reasoning about it were wrong.
//
// The two numbers that matter:
//   RENDERS  — how many times Home re-rendered during the last toggle. Should be 1-2. If it is
//              ~17 (one per animation frame) the animation is feeding a setState loop, almost
//              certainly the accordion's onLayout re-reporting a height that changes every frame.
//   WORST    — longest gap between UI-thread frames during the toggle, in ms. 16.7 is 60fps.
//              Anything over ~33 is a visibly dropped frame. If RENDERS is low but WORST is high,
//              the JS thread is fine and the cost is layout/compositing.
export function ToggleProbe({ renderCount, layoutCount }: { renderCount: number; layoutCount: number }) {
  const [snapshot, setSnapshot] = useState({ renders: 0, layouts: 0, worst: 0 })
  const baseRenders = useRef(renderCount)
  const baseLayouts = useRef(layoutCount)
  // SHARED values, not refs. The callback below is a worklet running on the UI runtime, which has
  // no access to React refs — mutating them there silently did nothing and reported WORST 0ms.
  const lastFrame = useSharedValue(0)
  const worstFrame = useSharedValue(0)

  // Frame deltas come from the UI thread, so a stall shows up here even when JS is blocked.
  useFrameCallback((info) => {
    'worklet'
    const t = info.timeSinceFirstFrame
    if (lastFrame.value > 0) {
      const d = t - lastFrame.value
      if (d > worstFrame.value) worstFrame.value = d
    }
    lastFrame.value = t
  }, true)

  // A toggle bumps renderCount; sample ~600ms later, comfortably past the 280ms animation.
  useEffect(() => {
    worstFrame.value = 0
    const id = setTimeout(() => {
      setSnapshot({
        renders: renderCount - baseRenders.current,
        layouts: layoutCount - baseLayouts.current,
        worst: Math.round(worstFrame.value), // shared values are readable from JS
      })
      baseRenders.current = renderCount
      baseLayouts.current = layoutCount
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderCount])

  if (!__DEV__) return null
  const bad = snapshot.renders > 4 || snapshot.worst > 33
  return (
    <View style={s.wrap} pointerEvents="none">
      <Text style={[s.line, bad && s.bad]}>RENDERS {snapshot.renders}</Text>
      <Text style={[s.line, bad && s.bad]}>LAYOUTS {snapshot.layouts}</Text>
      <Text style={[s.line, snapshot.worst > 33 && s.bad]}>WORST {snapshot.worst}ms</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 60, right: 8, zIndex: 999,
    backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
  },
  line: { color: '#4ADE80', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bad: { color: '#F0666B' },
})
