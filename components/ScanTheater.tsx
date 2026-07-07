import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, Line, Polygon, RadialGradient, Stop } from 'react-native-svg'
import { COLORS } from '@/constants/colors'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const GREEN = '#4ADE80'
const DWELL_MS = 3400          // pause + scan at each spot; + ~1.6s curved travel ≈ 5s per position
const HOPS_PER_PHOTO = 3       // spots visited before drifting to the next photo
const STATUS = ['Locking on', 'Reading the top shelf', 'Sweeping the door shelves', 'Repositioning', 'Checking the drawers', 'Decoding labels']

// drone container geometry — the orb sits at (OX, OY); the scan cone fans DOWN from it.
const CW = 170, CH = 224, OX = 85, OY = 60

type Photo = { uri?: string; label?: string }

// A random spot inside the photo (kept off the edges, and leaving cone room below the orb). Always
// >0.32 away from `prev` so the drone actually travels a meaningful curve, never twitches in place.
function rndPoint(prev?: { x: number; y: number }) {
  for (let i = 0; i < 12; i++) {
    const x = 0.2 + Math.random() * 0.6
    const y = 0.14 + Math.random() * 0.52
    if (!prev || Math.hypot(x - prev.x, y - prev.y) > 0.32) return { x, y }
  }
  return { x: 0.5, y: 0.4 }
}

export function ScanTheater({ photos, photoDims, showDone, areaLabel }: {
  photos: Photo[]
  photoDims: Record<string, { w: number; h: number }>
  showDone: boolean
  areaLabel?: (idx: number) => string
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)
  const [target, setTarget] = useState(() => rndPoint())
  const [ghosts, setGhosts] = useState<{ x: number; y: number }[]>([])
  const [natAspect, setNatAspect] = useState<Record<string, number>>({})
  const hopCount = useRef(0)
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showDoneRef = useRef(showDone); showDoneRef.current = showDone

  const uri = photos[activeIdx]?.uri
  const aspect = (uri && natAspect[uri]) || (uri && photoDims[uri] ? photoDims[uri].h / photoDims[uri].w : 4 / 3)
  const maxW = SCREEN_W - 44
  const maxH = SCREEN_H * 0.56
  const natH = maxW * aspect
  const photoH = natH > maxH ? maxH : natH
  const photoW = natH > maxH ? maxH / aspect : maxW

  // Drone motion. Curved travel = X and Y eased on DIFFERENT durations/curves, so the path bows
  // instead of running straight. A slow hover-bob + halo spin run continuously so it's never still.
  const dx = useSharedValue(photoW * 0.5)
  const dy = useSharedValue(photoH * 0.35)
  const bob = useSharedValue(-5)
  const spin = useSharedValue(0)

  useEffect(() => {
    bob.value = withRepeat(withTiming(5, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true)
    spin.value = withRepeat(withTiming(360, { duration: 7000, easing: Easing.linear }), -1, false)
    const s = setInterval(() => setStatusIdx(i => (i + 1) % STATUS.length), 2600)
    return () => { cancelAnimation(bob); cancelAnimation(spin); clearInterval(s) }
  }, [])

  const advance = () => {
    if (showDoneRef.current) return
    dwell.current = setTimeout(() => {
      setGhosts(g => [target, ...g].slice(0, 2)) // faint breadcrumb of the last couple of spots
      hopCount.current += 1
      if (hopCount.current % HOPS_PER_PHOTO === 0 && photos.length > 1) setActiveIdx(i => (i + 1) % photos.length)
      setTarget(t => rndPoint(t))
    }, DWELL_MS)
  }

  useEffect(() => {
    if (showDone) return
    const px = target.x * photoW, py = target.y * photoH
    dx.value = withTiming(px, { duration: 1450, easing: Easing.inOut(Easing.cubic) })
    dy.value = withTiming(py, { duration: 1850, easing: Easing.inOut(Easing.quad) }, (fin) => {
      'worklet'; if (fin) runOnJS(advance)()
    })
    return () => { if (dwell.current) clearTimeout(dwell.current) }
  }, [target, photoW, photoH])

  // Results in → glide to centre and settle (the parent shows View Results).
  useEffect(() => {
    if (!showDone) return
    if (dwell.current) clearTimeout(dwell.current)
    dx.value = withTiming(photoW * 0.5, { duration: 700, easing: Easing.out(Easing.cubic) })
    dy.value = withTiming(photoH * 0.42, { duration: 700, easing: Easing.out(Easing.cubic) })
  }, [showDone])

  const droneStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value - OX }, { translateY: dy.value + bob.value - OY }] }))
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotateZ: `${spin.value}deg` }] }))

  const label = areaLabel ? areaLabel(activeIdx) : photos[activeIdx]?.label

  return (
    <View style={styles.wrap}>
      <View style={[styles.photoBox, { width: photoW, height: photoH }]}>
        {uri && (
          <Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
            resizeMode="cover"
            onLoad={e => { const s = e.nativeEvent?.source; if (s?.width && s?.height && uri) setNatAspect(m => (m[uri] ? m : { ...m, [uri]: s.height / s.width })) }}
          />
        )}

        {/* Faint breadcrumb of where the drone just was */}
        {ghosts.map((g, i) => (
          <View key={i} style={{ position: 'absolute', left: g.x * photoW - 5, top: g.y * photoH - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN, opacity: 0.16 - i * 0.06 }} />
        ))}

        {/* The drone — glow + scan cone, spinning halo, body + eye */}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: CW, height: CH }, droneStyle]}>
          <Svg width={CW} height={CH} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="dGlow" cx="50%" cy={`${(OY / CH) * 100}%`} r="46%">
                <Stop offset="0" stopColor={GREEN} stopOpacity={0.85} />
                <Stop offset="1" stopColor={GREEN} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="dCone" cx="50%" cy={`${(OY / CH) * 100}%`} r="90%">
                <Stop offset="0" stopColor={GREEN} stopOpacity={0.42} />
                <Stop offset="1" stopColor={GREEN} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {/* scan cone fanning down onto the photo */}
            <Polygon points={`${OX},${OY} 20,${CH} ${CW - 20},${CH}`} fill="url(#dCone)" />
            <Line x1={OX} y1={OY} x2={28} y2={CH} stroke={GREEN} strokeWidth={1.1} opacity={0.7} />
            <Line x1={OX} y1={OY} x2={OX} y2={CH} stroke={GREEN} strokeWidth={1.1} opacity={0.7} />
            <Line x1={OX} y1={OY} x2={CW - 28} y2={CH} stroke={GREEN} strokeWidth={1.1} opacity={0.7} />
            {/* soft glow around the orb */}
            <Circle cx={OX} cy={OY} r={50} fill="url(#dGlow)" />
          </Svg>
          {/* spinning halo ring */}
          <Animated.View style={[{ position: 'absolute', left: OX - 34, top: OY - 34, width: 68, height: 68, alignItems: 'center', justifyContent: 'center' }, ringStyle]}>
            <Svg width={68} height={68}>
              <Ellipse cx={34} cy={34} rx={30} ry={11} stroke={GREEN} strokeWidth={1.6} fill="none" opacity={0.8} />
            </Svg>
          </Animated.View>
          {/* body + eye + spark (own Defs — gradients are scoped per-Svg) */}
          <Svg width={CW} height={CH} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="dBody" cx="40%" cy="34%" r="72%">
                <Stop offset="0" stopColor="#bff7d4" />
                <Stop offset="0.5" stopColor="#2fae67" />
                <Stop offset="1" stopColor="#0c3a24" />
              </RadialGradient>
            </Defs>
            <Circle cx={OX} cy={OY} r={17} fill="url(#dBody)" />
            <Circle cx={OX} cy={OY} r={17} stroke="#7dffb0" strokeWidth={1} fill="none" opacity={0.55} />
            <Circle cx={OX} cy={OY} r={7.5} fill="#eafff2" />
            <Circle cx={OX} cy={OY} r={3.4} fill="#22c55e" />
            <Circle cx={OX + 27} cy={OY - 8} r={2.4} fill="#8affbe" />
          </Svg>
        </Animated.View>

        {/* Viewfinder corners */}
        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />
      </View>

      <Text style={styles.section}>{showDone ? 'Scan complete' : STATUS[statusIdx]}</Text>
      {!!label && <Text style={styles.area}>{label}{photos.length > 1 ? `  ·  ${activeIdx + 1}/${photos.length}` : ''}</Text>}
      {photos.length > 1 && (
        <View style={styles.dots}>{photos.map((_, i) => <View key={i} style={[styles.dot, i === activeIdx && styles.dotActive]} />)}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  photoBox: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#0A0A0A' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: GREEN },
  cTL: { top: 8, left: 8, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  cTR: { top: 8, right: 8, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 6 },
  cBL: { bottom: 8, left: 8, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 6 },
  cBR: { bottom: 8, right: 8, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 6 },
  section: { marginTop: 26, fontSize: 17, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  area: { marginTop: 6, fontSize: 13, fontWeight: '600', color: COLORS.textMuted, textTransform: 'capitalize' },
  dots: { flexDirection: 'row', gap: 6, marginTop: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#333' },
  dotActive: { backgroundColor: GREEN, width: 20 },
})
