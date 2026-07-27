import { useEffect, useRef } from 'react'
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

const GREEN = '#4ADE80'

// Detected items must match the diet the user just chose — showing "Chicken" being found in a
// vegan's fridge, on the screen right before the paywall, reads as "this app wasn't listening".
const DIET_ITEMS: Record<string, string[]> = {
  Vegan: ['Tofu', 'Black Beans', 'Rice', 'Spinach'],
  Vegetarian: ['Eggs', 'Greek Yogurt', 'Rice', 'Spinach'],
  Pescatarian: ['Eggs', 'Salmon', 'Rice', 'Spinach'],
  Classic: ['Eggs', 'Chicken', 'Rice', 'Spinach'],
}

// Shows the scan INSTEAD of describing it. The plan reveal used to list sample meals, which read as
// a generic meal-planner and buried the one thing the app is actually for.
//
// Uses the real fridge PHOTO, not vector art: the first attempt reused the pantry tab's SVG fridge,
// which is drawn for a 160x70 thumbnail and degrades into crude boxes at full width. A photo with a
// scan overlay is also the pattern the teardown research flags as most transferable for scan-based
// apps (PictureThis) — and unlike a real scan during onboarding it costs no vision call, can't fail,
// and is plainly a demo rather than a claim about the user's own kitchen.
export function ScanTeaser({ diet }: { diet?: string }) {
  const items = DIET_ITEMS[diet ?? 'Classic'] ?? DIET_ITEMS.Classic
  const beam = useRef(new Animated.Value(0)).current
  const chips = useRef(items.map(() => new Animated.Value(0))).current

  useEffect(() => {
    // Two passes, then it rests on the finished state. An indefinite loop stops reading as delight
    // and becomes noise beside a screen the user is trying to read — so the reset happens at the
    // START of each cycle, letting the last one end with the items still on screen.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(beam, { toValue: 0, duration: 0, useNativeDriver: true }),
          ...chips.map(a => Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true })),
        ]),
        Animated.parallel([
          Animated.timing(beam, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }),
          // Chips land while the beam is still travelling — that's what sells "it's finding things".
          Animated.stagger(400, chips.map(a =>
            Animated.spring(a, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true })
          )),
        ]),
        Animated.delay(1400),
      ]),
      { iterations: 2 },
    )
    loop.start()
    return () => loop.stop()
  }, [])

  return (
    <View>
      <View style={styles.frame}>
        <Image source={require('../assets/onboarding-fridge.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {/* Scrim keeps the green beam and brackets legible over a bright fridge interior */}
        <View style={styles.scrim} pointerEvents="none" />

        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />

        <Animated.View
          pointerEvents="none"
          style={[styles.beamWrap, {
            transform: [{ translateY: beam.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME_H - 2] }) }],
          }]}
        >
          {/* Soft leading glow above the line so the sweep reads as light, not a divider */}
          <LinearGradient colors={['rgba(74,222,128,0)', 'rgba(74,222,128,0.22)']} style={styles.beamGlow} />
          <View style={styles.beamLine} />
        </Animated.View>
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

const FRAME_H = 168

const styles = StyleSheet.create({
  frame: { height: FRAME_H, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0D0D0D', marginTop: 4 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },

  beamWrap: { position: 'absolute', left: 0, right: 0, top: 0 },
  beamGlow: { height: 26, width: '100%' },
  beamLine: {
    height: 2, width: '100%', backgroundColor: GREEN,
    shadowColor: GREEN, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },

  corner: { position: 'absolute', width: 18, height: 18, borderColor: GREEN },
  cTL: { top: 8, left: 8, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 4 },
  cTR: { top: 8, right: 8, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 4 },
  cBL: { bottom: 8, left: 8, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 4 },
  cBR: { bottom: 8, right: 8, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(74,222,128,0.12)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
  },
  chipText: { fontSize: 12, fontWeight: '700', color: GREEN },
})
