import { useEffect, useState } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import Animated, {
  FadeInDown,
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, withRepeat,
  Easing, cancelAnimation,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Check, UtensilsCrossed, Clock } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'

// Native, ONE-CONTINUOUS-SHOT onboarding trailer. Not a slideshow of beats (that read as a
// carousel-in-a-carousel) — a single timeline where the fridge is scanned, items surface and
// count up over it, then the whole scene DISSOLVES into one finished meal. Composed from real
// views (never drifts from the app's design, stays crisp, no 8.5MB .mov). Loops by remounting.

const PHONE_W = 250
const PHONE_H = PHONE_W * (19.5 / 9)

// Real items in the bundled fridge photo — keeps the "AI finds everything" phase honest.
const DETECTED = ['Egg whites', 'Greek yogurt', 'Cottage cheese', 'Ground beef', 'Eggs', 'Peanut butter', 'Salsa', 'Oat milk', 'Maple syrup']

// The trailer ends on ONE hero plate (one perfect plate > a cycling carousel). `img` stays null
// until the real photo is dropped in assets/ — then flip the require and it swaps from the glyph.
const HERO = { name: 'Beef & Salsa Rice Bowl', crave: 'Sizzling beef, fresh salsa', mins: 20, kcal: 560, protein: 44, img: null as any } // img: require('../assets/trailer-beef-bowl.jpg')

// Single master timeline (ms). Every element schedules against these — that's what makes it read
// as one continuous shot instead of discrete slides.
const T = {
  detectStart: 1900, // items begin surfacing over the fridge
  scanEnd: 2400,     // scan overlay fades
  detectEnd: 4000,   // items fully found
  morphStart: 4050,  // fridge + items dissolve, meal emerges
  plateIn: 4650,     // overlay text rises on the plated meal
  total: 8800,       // loop point (meal holds ~4s before replay)
}

// ── The continuous scene inside the phone ──────────────────────────────────────
function Scene() {
  const fridgeO = useSharedValue(1)
  const fridgeZ = useSharedValue(1)
  const scanO = useSharedValue(1)
  const sweep = useSharedValue(0)
  const chipsO = useSharedValue(1)
  const mealO = useSharedValue(0)
  const mealZ = useSharedValue(1.08)
  const [count, setCount] = useState(0)

  useEffect(() => {
    // Fridge: slow push-in through scan+detect, then dissolve as the meal takes over.
    fridgeZ.value = withTiming(1.08, { duration: T.morphStart, easing: Easing.linear })
    fridgeO.value = withDelay(T.morphStart, withTiming(0, { duration: 560, easing: Easing.inOut(Easing.quad) }))
    // Scan sweep: two passes, then the whole overlay fades.
    sweep.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), 2, true)
    scanO.value = withDelay(T.scanEnd - 250, withTiming(0, { duration: 320 }))
    // Detected chips cloud fades out into the morph.
    chipsO.value = withDelay(T.detectEnd, withTiming(0, { duration: 420, easing: Easing.inOut(Easing.quad) }))
    // Meal: fades up out of the dissolving fridge, then a settle-in punch + slow Ken Burns hold.
    mealO.value = withDelay(T.morphStart, withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }))
    mealZ.value = withDelay(T.morphStart, withSequence(
      withTiming(1.0, { duration: 520, easing: Easing.out(Easing.quad) }),
      withTiming(1.06, { duration: T.total - T.morphStart, easing: Easing.linear }),
    ))
    // Count climbs as items land (plain JS timers — no worklet→JS hop needed here).
    const timers = DETECTED.map((_, i) => setTimeout(() => setCount(i + 1), T.detectStart + i * 175))
    return () => {
      timers.forEach(clearTimeout)
      ;[fridgeO, fridgeZ, scanO, sweep, chipsO, mealO, mealZ].forEach(cancelAnimation)
    }
  }, [])

  const fridgeStyle = useAnimatedStyle(() => ({ opacity: fridgeO.value, transform: [{ scale: fridgeZ.value }] }))
  const scanStyle = useAnimatedStyle(() => ({ opacity: scanO.value }))
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (PHONE_H * 0.6) }] }))
  const chipsStyle = useAnimatedStyle(() => ({ opacity: chipsO.value }))
  const mealStyle = useAnimatedStyle(() => ({ opacity: mealO.value, transform: [{ scale: mealZ.value }] }))
  const scrimStyle = useAnimatedStyle(() => ({ opacity: mealO.value }))

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Fridge — dissolves into the meal */}
      <Animated.View style={[StyleSheet.absoluteFill, fridgeStyle]}>
        <Image source={require('../assets/onboarding-fridge.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={st.camScrim} />
      </Animated.View>

      {/* Scan overlay — brackets + sweeping line, reads instantly as "camera scanning" */}
      <Animated.View style={[StyleSheet.absoluteFill, scanStyle]} pointerEvents="none">
        <View style={[st.bracket, { top: '15%', left: '9%', borderRightWidth: 0, borderBottomWidth: 0 }]} />
        <View style={[st.bracket, { top: '15%', right: '9%', borderLeftWidth: 0, borderBottomWidth: 0 }]} />
        <View style={[st.bracket, { bottom: '32%', left: '9%', borderRightWidth: 0, borderTopWidth: 0 }]} />
        <View style={[st.bracket, { bottom: '32%', right: '9%', borderLeftWidth: 0, borderTopWidth: 0 }]} />
        <Animated.View style={[st.scanLine, lineStyle]} />
      </Animated.View>

      {/* Detection — count + item chips surface OVER the fridge (same scene, not a new screen) */}
      <Animated.View style={[st.detectWrap, chipsStyle]} pointerEvents="none">
        <View style={st.countPill}>
          <Text style={st.countPillNum}>{count}</Text>
          <Text style={st.countPillLabel}>ITEMS FOUND</Text>
        </View>
        <View style={st.chipWrap}>
          {DETECTED.map((item, i) => (
            <Animated.View key={item} entering={FadeInDown.duration(240).delay(T.detectStart + i * 175)} style={st.chip}>
              <View style={st.chipDot} />
              <Text style={st.chipText}>{item}</Text>
            </Animated.View>
          ))}
        </View>
      </Animated.View>

      {/* The meal — fades up out of the dissolving fridge */}
      {HERO.img ? (
        <Animated.Image source={HERO.img} style={[StyleSheet.absoluteFill, mealStyle]} resizeMode="cover" />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, mealStyle, st.heroFallback]} pointerEvents="none">
          <UtensilsCrossed size={44} stroke="#3A3A3A" strokeWidth={1.4} />
        </Animated.View>
      )}
      <Animated.View style={[st.scrimWrap, scrimStyle]} pointerEvents="none">
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']} locations={[0.35, 0.7, 1]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View entering={FadeInDown.duration(420).delay(T.plateIn)} style={st.heroText}>
        <Text style={st.craveLine} numberOfLines={1}>{HERO.crave}</Text>
        <Text style={st.craveName} numberOfLines={2}>{HERO.name}</Text>
        <View style={st.haveRowBold}>
          <View style={st.haveCheck}><Check size={11} stroke="#000" strokeWidth={3.4} /></View>
          <Text style={st.haveTextBold}>You already have everything</Text>
        </View>
        <View style={st.heroMetaRow}>
          <View style={st.metaItem}><Clock size={11} stroke="rgba(255,255,255,0.75)" strokeWidth={2.2} /><Text style={st.metaText}>{HERO.mins} min</Text></View>
          <Text style={st.metaDot}>·</Text><Text style={st.metaText}>{HERO.kcal} cal</Text>
          <Text style={st.metaDot}>·</Text><Text style={st.metaText}>{HERO.protein}g protein</Text>
        </View>
      </Animated.View>
    </View>
  )
}

// ── Headlines above the phone — crossfade on the same timeline (no hard cuts) ───
function Headlines() {
  const o1 = useSharedValue(1)
  const o2 = useSharedValue(0)
  const o3 = useSharedValue(0)
  useEffect(() => {
    o1.value = withDelay(T.detectStart, withTiming(0, { duration: 300 }))
    o2.value = withSequence(
      withDelay(T.detectStart, withTiming(1, { duration: 320 })),
      withDelay(T.detectEnd - T.detectStart - 320, withTiming(0, { duration: 300 })),
    )
    o3.value = withDelay(T.plateIn - 350, withTiming(1, { duration: 380 }))
    return () => { [o1, o2, o3].forEach(cancelAnimation) }
  }, [])
  const s1 = useAnimatedStyle(() => ({ opacity: o1.value }))
  const s2 = useAnimatedStyle(() => ({ opacity: o2.value }))
  const s3 = useAnimatedStyle(() => ({ opacity: o3.value }))
  return (
    <>
      <Animated.View style={[st.headlineAbs, s1]}><Text style={st.headline}>Point your camera{'\n'}at the shelf</Text></Animated.View>
      <Animated.View style={[st.headlineAbs, s2]}><Text style={st.headline}>AI finds everything{'\n'}you have</Text></Animated.View>
      <Animated.View style={[st.headlineAbs, s3]}><Text style={st.headline}>Cook something{'\n'}great tonight</Text></Animated.View>
    </>
  )
}

export default function OnboardingTrailer() {
  // Loop the whole continuous shot by remounting the timeline every T.total.
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setCycle(c => c + 1), T.total)
    return () => clearTimeout(t)
  }, [cycle])

  // Constant slow hover so the device never feels like a frozen screenshot.
  const float = useSharedValue(0)
  useEffect(() => {
    float.value = withDelay(300, withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true))
    return () => cancelAnimation(float)
  }, [])
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -float.value * 6 }] }))

  return (
    <View style={st.root}>
      <View style={st.headlineSlot}>
        <Headlines key={cycle} />
      </View>
      <Animated.View style={[st.phone, floatStyle]}>
        <View style={st.screen}>
          <Scene key={cycle} />
        </View>
      </Animated.View>
    </View>
  )
}

const st = StyleSheet.create({
  root: { alignItems: 'center', width: '100%' },

  headlineSlot: { height: 84, marginBottom: 18, alignSelf: 'stretch' },
  headlineAbs: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  headline: {
    fontSize: 30, fontWeight: '800', color: COLORS.textWhite,
    textAlign: 'center', lineHeight: 36, letterSpacing: -0.6,
  },

  phone: {
    width: PHONE_W, height: PHONE_H, borderRadius: 40,
    borderWidth: 3, borderColor: '#1A1A1A', backgroundColor: '#000000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.5, shadowRadius: 28,
    overflow: 'hidden',
  },
  screen: { flex: 1, borderRadius: 37, overflow: 'hidden', backgroundColor: '#000000' },

  // Scan phase
  camScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  bracket: {
    position: 'absolute', width: 30, height: 30,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 4,
  },
  scanLine: {
    position: 'absolute', left: 0, right: 0, top: '15%', height: 2,
    backgroundColor: COLORS.accent,
    shadowColor: COLORS.accent, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },

  // Detect phase
  detectWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  countPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 30, paddingVertical: 6, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  countPillNum: { fontSize: 22, fontWeight: '800', color: COLORS.accent, letterSpacing: -0.5 },
  countPillLabel: { fontSize: 9, fontWeight: '700', color: '#FFFFFF', letterSpacing: 1.2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(20,20,20,0.9)', borderRadius: 30,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  chipDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.accent },
  chipText: { fontSize: 10, fontWeight: '600', color: '#E5E5E5' },

  // Meal phase
  heroFallback: { backgroundColor: '#161311', alignItems: 'center', justifyContent: 'center' }, // warm-dark, not a flat void, until the real photo lands
  scrimWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  craveLine: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.78)', marginBottom: 3, letterSpacing: 0.1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  craveName: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4, lineHeight: 24, marginBottom: 9, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  haveRowBold: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  haveCheck: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  haveTextBold: { fontSize: 13, fontWeight: '800', color: COLORS.accent, letterSpacing: -0.1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  metaDot: { fontSize: 10, color: 'rgba(255,255,255,0.5)' },
})
