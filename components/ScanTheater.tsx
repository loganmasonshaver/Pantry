import React, { useEffect, useState } from 'react'
import { Dimensions, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, FadeIn } from 'react-native-reanimated'
import { COLORS } from '@/constants/colors'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const GREEN = '#4ADE80'
const SWEEP_MS = 950            // one pass of the scan line (top→bottom or back)
const STEP_MS = 5000            // photo + caption both advance on this shared tick (kept in sync)
// Ordered as a natural read→identify→sort→build arc so the rotation still reads like progress even
// though it cycles. Long list at a calm 3s pace (≈66s for a full loop) so even a slow multi-photo
// scan makes roughly ONE pass instead of looping 3×. Honest to what the scan does; no emoji.
const STATUS = [
  'Reading your shelves',
  'Scanning each shelf',
  'Spotting jars and bottles',
  'Checking the door shelves',
  'Looking behind the front row',
  'Checking the back rows',
  'Decoding labels',
  'Reading the fine print',
  'Identifying each item',
  'Telling similar items apart',
  'Recognizing brands and sizes',
  'Spotting the fresh produce',
  'Catching the condiments',
  'Noting the leftovers',
  'Sorting into categories',
  'Grouping your staples',
  'Cross-checking for doubles',
  'Counting what you’ve got',
  'Matching items to meals',
  'Finding what you can cook',
  'Building your pantry list',
  'Almost done',
]

type Photo = { uri?: string; label?: string }

// Scan-loading theatre. Shows the user's ACTUAL scanned photos with the same clean scan-line +
// bracket treatment as the onboarding trailer: a teal line sweeps up and down a couple of times
// over each photo, then it crossfades to the next in a carousel. (Replaces the earlier "drone"
// animation — the simple sweep reads better and matches the trailer's look.)
export function ScanTheater({ photos, photoDims, showDone, areaLabel }: {
  photos: Photo[]
  photoDims: Record<string, { w: number; h: number }>
  showDone: boolean
  areaLabel?: (idx: number) => string
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)

  const uri = photos[activeIdx]?.uri

  // Fixed frame (not per-photo aspect) so cover-cropped photos carousel cleanly without the box
  // resizing between them. Portrait-ish, since pantry/fridge shots usually are.
  const boxW = SCREEN_W - 44
  const boxH = Math.min(Math.round(boxW * 1.3), Math.round(SCREEN_H * 0.56))

  const sweep = useSharedValue(0)

  // Continuous up/down scan line (independent of the photo/caption cadence).
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(sweep)
  }, [])

  // ONE 5s tick advances the photo AND the caption together, so the line the user reads always
  // matches the photo on screen. Photo only cycles when there's more than one; the caption rotates
  // regardless. Stops once results land (showDone flips the caption to "Scan complete").
  useEffect(() => {
    if (showDone) return
    const t = setInterval(() => {
      setStatusIdx(i => (i + 1) % STATUS.length)
      if (photos.length > 1) setActiveIdx(i => (i + 1) % photos.length)
    }, STEP_MS)
    return () => clearInterval(t)
  }, [showDone, photos.length])

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * boxH }] }))

  const label = areaLabel ? areaLabel(activeIdx) : photos[activeIdx]?.label

  return (
    <View style={styles.wrap}>
      <View style={[styles.photoBox, { width: boxW, height: boxH }]}>
        {uri && (
          // key by uri so a new photo remounts and crossfades in (the carousel transition).
          <Animated.Image
            key={uri}
            entering={FadeIn.duration(420)}
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        <View style={styles.scrim} pointerEvents="none" />

        {/* The sweep — hidden once results are in */}
        {!showDone && <Animated.View pointerEvents="none" style={[styles.scanLine, { width: boxW }, lineStyle]} />}

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
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  scanLine: {
    position: 'absolute', left: 0, top: 0, height: 2.5, backgroundColor: GREEN,
    shadowColor: GREEN, shadowOpacity: 0.9, shadowRadius: 9, shadowOffset: { width: 0, height: 0 },
  },
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
