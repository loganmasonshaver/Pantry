import { useEffect, useRef, useState } from 'react'
import { View, Text, Animated, StyleSheet, Easing, AccessibilityInfo, Platform } from 'react-native'

// Branded cold-start splash overlay. Shows immediately on app launch and stays
// visible for a minimum 2 seconds (premium feel + buys buffer time for the home
// screen's meal cache to settle before the user sees it). _layout.tsx controls
// when this gets hidden — typically when BOTH auth resolves AND the min time
// elapsed.
//
// Design direction (per ui-ux-pro-max audit):
// - Exaggerated minimalism statement wordmark (64pt weight 900) with subtle
//   green text-shadow glow — OLED dark-mode aesthetic
// - 2-second progress bar that fills exactly during the min splash window —
//   feels intentional, not arbitrary (Linear / Notion pattern)
// - Cycling tagline for personality vs. static "Loading…" (3 messages, 700ms each)
// - Respects Settings → Accessibility → Reduce Motion (skips animations)

const SPLASH_DURATION_MS = 2000

const TAGLINES = [
  'Stocking the shelves…',
  'Sharpening the knives…',
  'Loading your kitchen…',
]

const TAGLINE_CYCLE_MS = 700

export default function SplashOverlay() {
  // OPAQUE FROM THE FIRST FRAME. This used to start at 0 and fade in over 200ms, on the stated
  // assumption that it was cross-fading from the NATIVE splash. It was not: expo-splash-screen is
  // not a dependency and nothing calls preventAutoHideAsync, so the native splash is already gone
  // by the time React paints. The fade was therefore cross-fading from the live app — you saw the
  // Home screen for ~200ms, and then the splash appeared over it, which reads as the app loading
  // backwards. Any non-1 starting opacity here reintroduces that, so do not "soften" it.
  const fadeIn = useRef(new Animated.Value(1)).current
  const progressWidth = useRef(new Animated.Value(0)).current
  const glow = useRef(new Animated.Value(0.4)).current
  const [taglineIdx, setTaglineIdx] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)
  // Don't run motion until we KNOW the user's preference — reduceMotion starts false,
  // so without this gate a Reduce-Motion user sees a flash of the prohibited animation
  // before isReduceMotionEnabled() resolves.
  const [motionReady, setMotionReady] = useState(false)

  // Check accessibility reduce-motion preference. If on, we skip the animated
  // progress bar + glow pulse and show a static "Loading…" instead.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(v => { setReduceMotion(v); setMotionReady(true) })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!motionReady || reduceMotion) return

    // Progress bar fills exactly during the splash window — feels purposeful
    Animated.timing(progressWidth, {
      toValue: 1,
      duration: SPLASH_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width animations require layout (not transform)
    }).start()

    // Subtle text-shadow glow breathing — adds OLED-style life to the wordmark
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    )
    glowLoop.start()

    // Cycle taglines every 700ms — adds personality, signals progress
    const taglineInterval = setInterval(() => {
      setTaglineIdx(i => (i + 1) % TAGLINES.length)
    }, TAGLINE_CYCLE_MS)

    return () => {
      glowLoop.stop()
      clearInterval(taglineInterval)
    }
  }, [reduceMotion, motionReady])

  // Interpolate glow value to a shadow radius (4-12px) for subtle pulsing
  const shadowRadius = glow.interpolate({
    inputRange: [0.4, 1],
    outputRange: [4, 12],
  })

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]} pointerEvents="none">
      <Animated.Text
        style={[
          styles.wordmark,
          // iOS supports textShadow via style; Android falls back to plain text
          Platform.OS === 'ios' && !reduceMotion
            ? { textShadowColor: 'rgba(74, 222, 128, 0.45)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: shadowRadius as any }
            : null,
        ]}
      >
        Pantry
      </Animated.Text>

      {/* Progress bar — exactly maps to the 2s splash duration */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            reduceMotion
              ? { width: '100%' }
              : {
                  width: progressWidth.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
          ]}
        />
      </View>

      <Text style={styles.tagline}>
        {reduceMotion ? 'Loading…' : TAGLINES[taglineIdx]}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000, // Float above the Stack so it covers any partial render
  },
  wordmark: {
    fontSize: 64,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
  },
  // Progress bar — width matches typical wordmark visual span; fills over splash window
  progressTrack: {
    width: 200,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 32,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4ADE80',
    borderRadius: 1,
  },
  tagline: {
    marginTop: 20,
    fontSize: 13,
    color: '#666666',
    fontWeight: '500',
    letterSpacing: 0.3,
    minHeight: 16, // Reserve vertical space so cycling text doesn't jitter layout
  },
})
