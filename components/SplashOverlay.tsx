import { useEffect, useRef } from 'react'
import { View, Text, Animated, StyleSheet, Easing } from 'react-native'

// Branded cold-start splash overlay. Shows immediately on app launch and stays
// visible for a minimum 2 seconds (premium feel + buys buffer time for the home
// screen's meal cache to settle before the user sees it). _layout.tsx controls
// when this gets hidden — typically when BOTH auth resolves AND the min time
// elapsed.
export default function SplashOverlay() {
  const pulse = useRef(new Animated.Value(0.6)).current
  const fadeIn = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Fade the whole overlay in over 200ms so it doesn't snap-cut from the
    // native splash → JS splash.
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start()

    // Subtle pulsing dot animation — signals "we're working" without being a spinner
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]} pointerEvents="none">
      <Text style={styles.wordmark}>Pantry</Text>
      <View style={styles.dotRow}>
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
      </View>
      <Text style={styles.tagline}>Loading your kitchen…</Text>
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
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  dotRow: {
    marginTop: 20,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ADE80',
  },
  tagline: {
    marginTop: 16,
    fontSize: 13,
    color: '#666666',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
})
