import { ReactNode, useCallback } from 'react'
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'

// Snappy, zero-bounce press feel. Higher damping/stiffness + low mass = the tight
// settle premium apps use; the old {damping:10, stiffness:100} wobbles like plastic.
const PRESS_SPRING = { damping: 15, stiffness: 250, mass: 0.7 } as const

// Animate the Pressable itself (not an inner wrapper) so `style` lands on the touch
// target exactly like TouchableOpacity's — flex/width layout is preserved and the
// whole surface scales. Safe here because the sync-UI-props feature flags (which can
// disturb touch on transformed views) are off.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type Props = {
  children: ReactNode
  onPress?: PressableProps['onPress']
  onLongPress?: PressableProps['onLongPress']
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  // How far to scale down on press-in. 0.96 is the sweet spot — under ~0.9 the
  // element looks like it's running away from the finger.
  scaleTo?: number
  // Fire a light impact on commit (onPress), NOT on press-in — reserve haptics for
  // real actions (scan, save, log). Never pass this to plain cards/rows or it becomes noise.
  haptic?: boolean
  hitSlop?: PressableProps['hitSlop']
  accessibilityLabel?: string
  accessibilityRole?: PressableProps['accessibilityRole']
}

// Drop-in replacement for TouchableOpacity on interactive surfaces. withSpring auto-respects
// Reduce Motion via the root ReducedMotionConfig, so no per-instance accessibility handling.
export default function PressableScale({
  children,
  onPress,
  onLongPress,
  style,
  disabled,
  scaleTo = 0.96,
  haptic,
  hitSlop,
  accessibilityLabel,
  accessibilityRole = 'button',
}: Props) {
  const scale = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const handlePress = useCallback<NonNullable<PressableProps['onPress']>>(
    (e) => {
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onPress?.(e)
    },
    [haptic, onPress]
  )

  return (
    <AnimatedPressable
      onPress={handlePress}
      onLongPress={onLongPress}
      onPressIn={() => (scale.value = withSpring(scaleTo, PRESS_SPRING))}
      onPressOut={() => (scale.value = withSpring(1, PRESS_SPRING))}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  )
}
