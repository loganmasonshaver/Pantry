import { useEffect, useRef, useState } from 'react'
import { Text, Animated, StyleSheet, Easing, AccessibilityInfo, Platform, ActivityIndicator } from 'react-native'

// Branded cold-start splash overlay. _layout.tsx decides when it hides (auth resolved AND the
// minimum hold elapsed) and keeps it mounted until its exit animation reports finished.
//
// WHAT USED TO BE HERE AND WHY IT IS GONE — a 2s progress bar, a cycling tagline and a breathing
// glow. All three animated on the JS THREAD during the busiest 2 seconds of the app's life:
// `width` cannot use the native driver (it needs layout) and neither can `textShadowRadius`, so
// each was writing across the bridge every frame while the bundle evaluated, auth resolved, the
// meal cache was read and Home rendered. That contention is what made the bar stutter, and no
// restyle of the bar would have fixed it.
//
// The bar was also dishonest: it filled over a FIXED timer, not real progress. A device trace has
// Home painting cached meals at 380ms and settled by 640ms, so it was a 2-second animation of
// nothing that also held the user ~1.4s longer than the app needed.
//
// Reference points Logan gave: Cal AI shows a wordmark and nothing else; MyFitnessPal shows a small
// spinner because it genuinely takes ~2s. The rule that reconciles them is that an indicator should
// appear only when there is a real wait — so there is no indicator by default, and a small spinner
// fades in only if we are STILL here after SPINNER_AFTER_MS, which on a normal launch never happens.
const SPLASH_DURATION_MS = 800

// Only shows when the launch is genuinely slow (auth still unresolved). Comfortably past the ~640ms
// a healthy cold start takes, so a normal launch never renders it at all.
const SPINNER_AFTER_MS = 1100

// Long enough to read as a dissolve rather than a blink, short enough not to feel like a second
// wait stacked on the hold.
const SPLASH_EXIT_MS = 320

export default function SplashOverlay({ hiding = false, onHidden }: {
  // `hiding` starts the exit; the parent keeps this mounted until `onHidden` fires, so the fade
  // actually gets to run instead of being unmounted mid-animation.
  hiding?: boolean
  onHidden?: () => void
}) {
  // OPAQUE FROM THE FIRST FRAME. This used to start at 0 and fade in over 200ms, on the stated
  // assumption that it was cross-fading from the NATIVE splash. It was not: expo-splash-screen is
  // not a dependency and nothing calls preventAutoHideAsync, so the native splash is already gone
  // by the time React paints. The fade was therefore cross-fading from the live app — you saw the
  // Home screen for ~200ms, and then the splash appeared over it, which reads as the app loading
  // backwards. Any non-1 starting opacity here reintroduces that, so do not "soften" it.
  const fadeIn = useRef(new Animated.Value(1)).current
  // Content lifts slightly as it dissolves — the same gesture iOS uses when a launch screen hands
  // off to the app. Scales the CONTENT, never the container: the container is the black backdrop
  // and scaling that would pull its edges in and let Home leak round the sides mid-fade.
  const exitScale = useRef(new Animated.Value(1)).current
  const spinnerFade = useRef(new Animated.Value(0)).current
  const [showSpinner, setShowSpinner] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  // Mount the late indicator only if we are still here. Nothing animates before this fires, which
  // is the entire point — the JS thread stays free during boot.
  useEffect(() => {
    const t = setTimeout(() => setShowSpinner(true), SPINNER_AFTER_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!showSpinner) return
    // Native driver: opacity only, so this cannot contend with the JS thread the way the old
    // width and textShadowRadius animations did.
    Animated.timing(spinnerFade, { toValue: 1, duration: 220, useNativeDriver: true }).start()
  }, [showSpinner])

  useEffect(() => {
    if (!hiding) return
    // Opacity is allowed under Reduce Motion (a plain cross-fade is not "motion"); the lift is not,
    // so it is gated. Unmount is driven by the completion callback rather than a matching timeout,
    // which would drift from the animation and cut it off.
    const anims = [
      Animated.timing(fadeIn, { toValue: 0, duration: SPLASH_EXIT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]
    if (!reduceMotion) {
      anims.push(Animated.timing(exitScale, { toValue: 1.06, duration: SPLASH_EXIT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    }
    Animated.parallel(anims).start(({ finished }) => { if (finished) onHidden?.() })
  }, [hiding, reduceMotion])

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]} pointerEvents="none">
      <Animated.View style={[styles.content, { transform: [{ scale: exitScale }] }]}>
        <Text
          style={[
            styles.wordmark,
            // Static glow, not a loop. The brand cue survives; the per-frame bridge write that
            // paid for it does not. iOS only — Android ignores textShadow on Text.
            Platform.OS === 'ios' && !reduceMotion ? styles.wordmarkGlow : null,
          ]}
        >
          Pantry
        </Text>
      </Animated.View>

      {/* Absolutely positioned so its appearance cannot shift the wordmark — a late indicator that
          nudges the logo is worse than no indicator. */}
      {showSpinner && (
        <Animated.View style={[styles.spinner, { opacity: spinnerFade }]}>
          {reduceMotion
            ? <Text style={styles.loadingText}>Loading…</Text>
            : <ActivityIndicator size="small" color="#666666" />}
        </Animated.View>
      )}
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
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 64,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
  },
  wordmarkGlow: {
    textShadowColor: 'rgba(74, 222, 128, 0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  spinner: {
    position: 'absolute',
    bottom: 88,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#666666',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
})
