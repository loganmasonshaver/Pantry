import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated, Easing } from 'react-native'
import Svg, { G as SvgG, Rect as SvgRect, Line as SvgLine, Path as SvgPath } from 'react-native-svg'

const GREEN = '#4ADE80'

// Shows the scan INSTEAD of describing it. The onboarding plan reveal used to list sample meals,
// which read as a generic meal-planner and buried the one thing the app is actually for. A demo
// scan is the pattern the teardown research flags as most transferable for scan-based apps
// (PictureThis) — and unlike a real scan during onboarding, it costs no vision call and can't fail.
//
// Vector fridge, not a photo: it reads as an illustration, so nobody mistakes it for a faked
// screenshot of their own kitchen. Geometry adapted from the pantry tab's scan card so the two
// surfaces share a visual language.
export function ScanTeaser({ items = ['Eggs', 'Chicken', 'Rice', 'Spinach'] }: { items?: string[] }) {
  const beam = useRef(new Animated.Value(0)).current
  const chips = useRef(items.map(() => new Animated.Value(0))).current

  useEffect(() => {
    // Sweep and detect together, hold so the result is readable, then reset and loop. The chips
    // land while the beam is still travelling, which is what sells "it's finding things".
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(beam, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }),
          Animated.stagger(400, chips.map(a =>
            Animated.spring(a, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true })
          )),
        ]),
        Animated.delay(1200),
        Animated.parallel([
          Animated.timing(beam, { toValue: 0, duration: 0, useNativeDriver: true }),
          ...chips.map(a => Animated.timing(a, { toValue: 0, duration: 240, useNativeDriver: true })),
        ]),
        Animated.delay(200),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  return (
    <View>
      <View style={styles.visual}>
        <Svg width="100%" height="100%" viewBox="0 0 160 70">
          {/* Shelves */}
          {[24, 56].map(y => (
            <SvgG key={y}>
              <SvgRect x={6} y={y - 1.5} width={148} height={2} fill="rgba(74,222,128,0.18)" />
              <SvgLine x1={6} y1={y + 0.5} x2={154} y2={y + 0.5} stroke={GREEN} strokeWidth={1} opacity={0.55} />
            </SvgG>
          ))}
          {/* Top shelf — carton, tub, block */}
          <SvgG>
            <SvgRect x={16} y={6} width={14} height={2.5} rx={0.5} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.15)" />
            <SvgRect x={17} y={8.5} width={12} height={15} rx={1.5} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgRect x={18} y={14} width={10} height={6} fill="rgba(0,201,167,0.30)" />
          </SvgG>
          <SvgG>
            <SvgRect x={72} y={6} width={18} height={17} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgLine x1={74} y1={10} x2={88} y2={10} stroke={GREEN} strokeWidth={0.8} opacity={0.5} />
            <SvgRect x={74} y={14} width={14} height={3} fill="rgba(0,201,167,0.30)" />
          </SvgG>
          <SvgG>
            <SvgRect x={120} y={8} width={20} height={1.5} rx={0.3} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.2)" />
            <SvgRect x={120} y={9.5} width={20} height={14} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgRect x={120} y={14} width={20} height={5} fill="rgba(0,201,167,0.30)" />
          </SvgG>
          {/* Bottom shelf — jar, bottle, tray */}
          <SvgG>
            <SvgRect x={16} y={38} width={16} height={2.5} rx={0.5} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.2)" />
            <SvgRect x={17} y={40.5} width={14} height={15} rx={1.5} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgRect x={17} y={46} width={14} height={7} fill="rgba(0,201,167,0.30)" />
          </SvgG>
          <SvgG>
            <SvgPath d="M 72 56 L 72 41 L 81 38 L 90 41 L 90 56 Z" stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgRect x={73} y={48} width={16} height={6} fill="rgba(0,201,167,0.30)" />
          </SvgG>
          <SvgG>
            <SvgRect x={118} y={42} width={24} height={14} stroke={GREEN} strokeWidth={1} fill="rgba(74,222,128,0.05)" />
            <SvgRect x={118} y={47} width={24} height={4} fill="rgba(0,201,167,0.30)" />
          </SvgG>
        </Svg>

        {/* Viewfinder corners — the same framing language as the real camera step */}
        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />

        <Animated.View
          pointerEvents="none"
          style={[styles.beam, {
            transform: [{ translateY: beam.interpolate({ inputRange: [0, 1], outputRange: [4, 116] }) }],
          }]}
        />
      </View>

      {/* Detected items land one by one as the beam passes — the proof that it's reading the shelf */}
      <View style={styles.chipRow}>
        {items.map((item, i) => (
          <Animated.View
            key={item}
            style={[styles.chip, {
              opacity: chips[i],
              transform: [{ scale: chips[i].interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
            }]}
          >
            <Text style={styles.chipText}>{item}</Text>
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  visual: { height: 124, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0D0D0D', marginTop: 4 },
  beam: {
    position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: GREEN,
    shadowColor: GREEN, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  corner: { position: 'absolute', width: 16, height: 16, borderColor: GREEN },
  cTL: { top: 6, left: 6, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 4 },
  cTR: { top: 6, right: 6, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 4 },
  cBL: { bottom: 6, left: 6, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 4 },
  cBR: { bottom: 6, right: 6, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(74,222,128,0.12)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
  },
  chipText: { fontSize: 12, fontWeight: '700', color: GREEN },
})
