import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { COLORS } from '@/constants/colors'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const GREEN = '#4ADE80'
const SWEEP_MS = 13000 // one full section-by-section pass per photo (a food-dense shot ≈ 13s to scan)
const SECTIONS = ['Reading the top shelf', 'Scanning the middle', 'Checking the lower shelf', 'Door & drawers']

// Decorative "detected item" boxes. We DON'T know the real items mid-scan, so these are plausible
// positions that light up as the sweep passes — the thrill of "it's finding stuff" with zero risk of
// a wrong label. Deterministic per photo (a tiny LCG) so they don't reshuffle every render.
function genBoxes(seed: number) {
  let s = (seed + 3) * 9301 + 49297
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  return Array.from({ length: 7 }, () => {
    const w = 0.12 + rand() * 0.13
    const h = 0.07 + rand() * 0.08
    const x = 0.06 + rand() * (0.9 - w)
    const y = 0.04 + rand() * (0.86 - h)
    return { x, y, w, h }
  })
}

type Photo = { uri?: string; label?: string }

export function ScanTheater({
  photos,
  photoDims,
  showDone,
  areaLabel,
}: {
  photos: Photo[]
  photoDims: Record<string, { w: number; h: number }>
  showDone: boolean
  areaLabel?: (idx: number) => string
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [sectionIdx, setSectionIdx] = useState(0)
  // photoDims is populated by the REVIEW screen's onLoad, which hasn't fired yet during loading — so
  // capture each photo's true aspect here on first load, else the tall fridge shot renders at 4/3 and
  // crops. Falls back to any dims we were handed, then 4/3.
  const [natAspect, setNatAspect] = useState<Record<string, number>>({})
  const line = useRef(new Animated.Value(0)).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)
  const showDoneRef = useRef(showDone)
  showDoneRef.current = showDone

  const boxesByPhoto = useMemo(() => photos.map((_, i) => genBoxes(i)), [photos.length])

  // Fit the current photo into a large centred box (contain), so the WHOLE fridge scans top-to-bottom.
  const uri = photos[activeIdx]?.uri
  const dims = uri ? photoDims[uri] : undefined
  const aspect = (uri && natAspect[uri]) || (dims ? dims.h / dims.w : 4 / 3)
  const maxW = SCREEN_W - 44
  const maxH = SCREEN_H * 0.58
  const natH = maxW * aspect
  const photoH = natH > maxH ? maxH : natH
  const photoW = natH > maxH ? maxH / aspect : maxW

  // Per-photo sweep loop. When the sweep finishes, advance to the next photo (looping) unless the
  // real scan already came back — then we hold on the fully-lit "complete" state.
  useEffect(() => {
    if (showDone) return
    line.setValue(0)
    const anim = Animated.timing(line, { toValue: 1, duration: SWEEP_MS, easing: Easing.linear, useNativeDriver: false })
    animRef.current = anim
    anim.start(({ finished }) => {
      if (finished && !showDoneRef.current) setActiveIdx(i => (i + 1) % Math.max(1, photos.length))
    })
    const id = line.addListener(({ value }) => {
      setSectionIdx(Math.min(SECTIONS.length - 1, Math.floor(value * SECTIONS.length)))
    })
    return () => { anim.stop(); line.removeListener(id) }
  }, [activeIdx, photos.length, showDone])

  // Results landed → stop mid-sweep and fast-complete to fully-scanned so the payoff isn't gated on
  // the 13s animation finishing.
  useEffect(() => {
    if (!showDone) return
    animRef.current?.stop()
    Animated.timing(line, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: false }).start()
  }, [showDone])

  const lineY = line.interpolate({ inputRange: [0, 1], outputRange: [0, photoH] })
  const revealH = line.interpolate({ inputRange: [0, 1], outputRange: [0, photoH] })
  const label = areaLabel ? areaLabel(activeIdx) : photos[activeIdx]?.label

  return (
    <View style={styles.wrap}>
      <View style={[styles.photoBox, { width: photoW, height: photoH }]}>
        {/* Dim base — the "unscanned" state. Captures true aspect on first load. */}
        {uri && (
          <Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, { opacity: 0.22 }]}
            resizeMode="cover"
            onLoad={e => {
              const s = e.nativeEvent?.source
              if (s?.width && s?.height && uri) setNatAspect(m => (m[uri] ? m : { ...m, [uri]: s.height / s.width }))
            }}
          />
        )}
        {/* Bright reveal — clipped to the swept region, growing top-down as the line descends */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: photoW, height: revealH, overflow: 'hidden' }}>
          {uri && <Image source={{ uri }} style={{ width: photoW, height: photoH }} resizeMode="cover" />}
          {/* faint green wash over the scanned area for the "processed" look */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(74,222,128,0.06)' }]} />
        </Animated.View>

        {/* Detection boxes — fade+scale in as the line passes each one's centre */}
        {boxesByPhoto[activeIdx]?.map((b, i) => {
          const cy = b.y + b.h / 2
          const op = line.interpolate({ inputRange: [Math.max(0, cy - 0.03), Math.min(1, cy + 0.005)], outputRange: [0, 1], extrapolate: 'clamp' })
          const sc = line.interpolate({ inputRange: [Math.max(0, cy - 0.03), Math.min(1, cy + 0.02)], outputRange: [0.8, 1], extrapolate: 'clamp' })
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: b.x * photoW, top: b.y * photoH, width: b.w * photoW, height: b.h * photoH,
                borderWidth: 1.5, borderColor: GREEN, borderRadius: 5,
                backgroundColor: 'rgba(74,222,128,0.08)',
                opacity: op, transform: [{ scale: sc }],
              }}
            />
          )
        })}

        {/* The scan-line + soft glow */}
        <Animated.View pointerEvents="none" style={[styles.glow, { top: lineY }]} />
        <Animated.View pointerEvents="none" style={[styles.scanline, { top: lineY }]} />

        {/* Viewfinder corner brackets */}
        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />
      </View>

      {/* Status — the section being read + which photo */}
      <Text style={styles.section}>{showDone ? 'Scan complete' : SECTIONS[sectionIdx]}</Text>
      {!!label && <Text style={styles.area}>{label}{photos.length > 1 ? `  ·  ${activeIdx + 1}/${photos.length}` : ''}</Text>}

      {/* Progress: a dot per photo + a thin within-photo bar */}
      {photos.length > 1 && (
        <View style={styles.dots}>
          {photos.map((_, i) => <View key={i} style={[styles.dot, i === activeIdx && styles.dotActive]} />)}
        </View>
      )}
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { width: line.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] }) }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  photoBox: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#0A0A0A' },
  scanline: { position: 'absolute', left: 0, right: 0, height: 2.5, backgroundColor: GREEN },
  glow: { position: 'absolute', left: 0, right: 0, height: 22, marginTop: -10, backgroundColor: 'rgba(74,222,128,0.16)' },
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
  barTrack: { marginTop: 16, width: 200, height: 3, borderRadius: 3, backgroundColor: '#222', overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 3, backgroundColor: GREEN },
})
