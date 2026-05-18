import { useEffect, useRef, useState } from 'react'
import { Animated, LayoutChangeEvent, StyleSheet, View, ViewStyle, StyleProp } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

type Props = {
  style?: StyleProp<ViewStyle>
  baseColor?: string
  highlightColor?: string
  durationMs?: number
}

export function Shimmer({
  style,
  baseColor = '#1A1A1A',
  highlightColor = '#2A2A2A',
  durationMs = 1200,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [progress, durationMs])

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  })

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    if (w !== width) setWidth(w)
  }

  return (
    <View
      style={[{ overflow: 'hidden', backgroundColor: baseColor }, style]}
      onLayout={handleLayout}
    >
      {width > 0 && (
        <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ translateX }] }]}>
          <LinearGradient
            colors={['transparent', highlightColor, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      )}
    </View>
  )
}
