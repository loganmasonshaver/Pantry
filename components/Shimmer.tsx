import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View, ViewStyle, StyleProp } from 'react-native'
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
  highlightColor = '#3A3A3A',
  durationMs = 900,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.linear, // linear keeps the sweep velocity constant — easing makes the highlight feel laggy
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [progress, durationMs])

  // Sweep travels from fully off-screen left to fully off-screen right with a brief
  // dark moment between loops — more visible than a continuous gradient.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width * 2],
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
      {/* Guard against rendering the gradient before onLayout has measured width — would
          give translateX an undefined range and the sweep would stay stuck at 0. */}
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
