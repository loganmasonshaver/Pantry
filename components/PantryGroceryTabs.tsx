import { useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, withRepeat, Easing,
} from 'react-native-reanimated'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { COLORS } from '@/constants/colors'

// Sub-tab toggle shared by the Pantry and Grocery screens. Phase 4 of the IA refactor
// merged Grocery into Pantry conceptually (kitchen = "what I have" + "what to buy")
// while keeping each as its own route under the hood — router.replace swaps without
// adding to back stack, so the system-back gesture exits the kitchen surface
// rather than ping-ponging between sub-tabs.
type Props = { active: 'pantry' | 'grocery' }

// Fires once, ever — first time a user lands on the Pantry screen we pulse the Grocery
// pill so they discover the switch exists (it routes to a whole other screen, easy to miss).
const HINT_KEY = 'pantry_grocery_toggle_hinted'

export default function PantryGroceryTabs({ active }: Props) {
  const go = (target: 'pantry' | 'grocery') => {
    if (target === active) return
    router.replace(target === 'pantry' ? '/(tabs)/pantry' : '/(tabs)/grocery')
  }

  // One-time "peek": a couple of gentle glow+scale pulses on the Grocery pill to reveal it.
  // Only on the Pantry side (that's the default landing surface); never on the Grocery side.
  const hint = useSharedValue(0)
  useEffect(() => {
    if (active !== 'pantry') return
    let cancelled = false
    AsyncStorage.getItem(HINT_KEY).then(seen => {
      if (seen || cancelled) return
      hint.value = withDelay(700, withRepeat(
        withSequence(
          withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ),
        2, // two pulses — enough to catch the eye, not naggy
        false,
      ))
      AsyncStorage.setItem(HINT_KEY, '1') // set immediately so a fast re-mount can't double-fire
    })
    return () => { cancelled = true }
  }, [active])

  const glowStyle = useAnimatedStyle(() => ({ opacity: hint.value * 0.3 })) // subtle teal wash, not a full fill
  const pillHintStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + hint.value * 0.06 }] }))

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.pill, active === 'pantry' && styles.pillActive]}
        activeOpacity={0.7}
        onPress={() => go('pantry')}
      >
        <Text style={[styles.label, active === 'pantry' && styles.labelActive]}>My Pantry</Text>
      </TouchableOpacity>
      <Animated.View style={pillHintStyle}>
        {/* Teal glow behind the label, driven by `hint` — the discovery cue. pointerEvents
            none so it never intercepts the tap. */}
        <Animated.View pointerEvents="none" style={[styles.hintGlow, glowStyle]} />
        <TouchableOpacity
          style={[styles.pill, active === 'grocery' && styles.pillActive]}
          activeOpacity={0.7}
          onPress={() => go('grocery')}
        >
          <Text style={[styles.label, active === 'grocery' && styles.labelActive]}>Grocery</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderRadius: 22,
    padding: 3,
    gap: 2,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillActive: {
    backgroundColor: COLORS.textWhite,
  },
  hintGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    backgroundColor: COLORS.accent,
    opacity: 0, // animated 0→1→0 during the peek
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: -0.1,
  },
  labelActive: {
    color: '#000000',
  },
})
