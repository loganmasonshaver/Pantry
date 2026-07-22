import { useEffect, useState } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import Animated, {
  FadeIn, FadeOut, FadeInDown,
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  Easing, cancelAnimation,
} from 'react-native-reanimated'
import { Check, UtensilsCrossed } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'

// Native replacement for the old 25s onboarding-preview.mov. Composing the demo out of real
// views instead of a screen recording means: it never drifts from the app's actual design,
// it stays crisp when we punch in (video pixelates past its native res), there's no
// playbackRate/timeout sync math to desync, and it drops ~8.5MB from the bundle.

const PHONE_W = 250
const PHONE_H = PHONE_W * (19.5 / 9)

// Three beats, ~6.4s — Cal-AI-form: one quick continuous magic moment (scan → find → meals),
// not a slideshow. Dropped the old 4th "Logged" beat: logging is table stakes Cal AI owns;
// OUR hook is scan-pantry → cookable-meals, so we end on the meals payoff and stop. Ordered so
// the magic (detection) leads the setup.
const BEATS = [
  { id: 'scan', headline: 'Point your camera\nat the shelf', ms: 2000 },
  { id: 'detect', headline: 'AI finds everything\nyou have', ms: 2200 },
  { id: 'meals', headline: 'Meals built around\nyour macros', ms: 2600 },
] as const

// Real items visible in the bundled fridge photo — keep these in sync with onboarding-fridge.jpg
// so the "AI finds everything" beat is an honest depiction of a scan of THIS shelf.
const DETECTED = ['Egg whites', 'Greek yogurt', 'Cottage cheese', 'Ground beef', 'Eggs', 'Peanut butter', 'Salsa', 'Oat milk', 'Maple syrup']

// Meals built from the detected items above — this is what the app would actually suggest.
// `img` stays null until real generated photos are dropped in assets/ — then flip on the
// require (one line each) and the thumbnail swaps from the glyph to the real photo.
const MEALS = [
  { name: 'Beef & Salsa Rice Bowl', kcal: 560, protein: 44, img: null as any }, // img: require('../assets/trailer-beef-bowl.jpg')
  { name: 'Egg White Veggie Scramble', kcal: 320, protein: 31, img: null as any }, // img: require('../assets/trailer-egg-scramble.jpg')
  { name: 'PB & Greek Yogurt Bowl', kcal: 400, protein: 28, img: null as any }, // img: require('../assets/trailer-pb-yogurt.jpg')
]

// ── Beat 1: camera viewfinder with a sweeping scan line ────────────────────────
function BeatScan() {
  const sweep = useSharedValue(0)
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(sweep) // infinite animations must be cancelled or they leak
  }, [])
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sweep.value * (PHONE_H * 0.62) }],
  }))

  return (
    <View style={st.beat}>
      <Image source={require('../assets/onboarding-fridge.jpg')} style={st.camImage} resizeMode="cover" />
      <View style={st.camScrim} />
      {/* Framing brackets — reads instantly as "camera", no chrome needed */}
      <View style={[st.bracket, { top: '18%', left: '10%', borderRightWidth: 0, borderBottomWidth: 0 }]} />
      <View style={[st.bracket, { top: '18%', right: '10%', borderLeftWidth: 0, borderBottomWidth: 0 }]} />
      <View style={[st.bracket, { bottom: '26%', left: '10%', borderRightWidth: 0, borderTopWidth: 0 }]} />
      <View style={[st.bracket, { bottom: '26%', right: '10%', borderLeftWidth: 0, borderTopWidth: 0 }]} />
      <Animated.View style={[st.scanLine, lineStyle]} />
    </View>
  )
}

// ── Beat 2: the magic — items resolve one by one and the count climbs ──────────
function BeatDetect() {
  const [n, setN] = useState(0)
  useEffect(() => {
    // Chips land in a quick cascade; the counter tracks them so the number feels *earned*.
    const timers = DETECTED.map((_, i) => setTimeout(() => setN(i + 1), 250 + i * 300))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <View style={[st.beat, st.beatPad]}>
      <Animated.View entering={FadeIn.duration(300)} style={st.countWrap}>
        <Text style={st.countNum}>{n}</Text>
        <Text style={st.countLabel}>ITEMS FOUND</Text>
      </Animated.View>
      <View style={st.chipWrap}>
        {DETECTED.map((item, i) => (
          <Animated.View
            key={item}
            entering={FadeInDown.duration(240).delay(250 + i * 300)}
            style={st.chip}
          >
            <View style={st.chipDot} />
            <Text style={st.chipText}>{item}</Text>
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

// ── Beat 3: the payoff — real meals with real macros ───────────────────────────
function BeatMeals() {
  return (
    <View style={[st.beat, st.beatPad]}>
      <Animated.Text entering={FadeIn.duration(260)} style={st.beatKicker}>TONIGHT</Animated.Text>
      {MEALS.map((m, i) => (
        <Animated.View key={m.name} entering={FadeInDown.duration(300).delay(180 + i * 220)} style={st.mealCard}>
          <View style={st.mealThumb}>
            {m.img
              ? <Image source={m.img} style={st.mealThumbImg} resizeMode="cover" />
              : <UtensilsCrossed size={17} stroke="#4A4A4A" strokeWidth={1.8} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.mealName} numberOfLines={1}>{m.name}</Text>
            <View style={st.macroRow}>
              <View style={st.macroPill}><Text style={st.macroText}>{m.kcal} cal</Text></View>
              <View style={st.macroPill}><Text style={st.macroText}>{m.protein}g protein</Text></View>
            </View>
          </View>
        </Animated.View>
      ))}
      <Animated.View entering={FadeIn.duration(300).delay(700)} style={st.haveRow}>
        <Check size={11} stroke={COLORS.accent} strokeWidth={3} />
        <Text style={st.haveText}>You already have everything</Text>
      </Animated.View>
    </View>
  )
}

// Untyped on purpose — BEATS is `as const`, so beat.id narrows to the literal union and
// indexing this map stays fully type-safe without needing the global JSX namespace.
const BEAT_VIEWS = {
  scan: BeatScan, detect: BeatDetect, meals: BeatMeals,
}

export default function OnboardingTrailer() {
  const [i, setI] = useState(0)
  const beat = BEATS[i]
  const Beat = BEAT_VIEWS[beat.id]

  // Self-rescheduling: each beat sets the timer for the next, so there's no timer chain to
  // desync and cleanup is automatic on every change.
  useEffect(() => {
    const t = setTimeout(() => setI(prev => (prev + 1) % BEATS.length), beat.ms)
    return () => clearTimeout(t)
  }, [i])

  // Constant slow hover so the device never feels like a frozen screenshot.
  const float = useSharedValue(0)
  useEffect(() => {
    float.value = withDelay(300, withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true))
    return () => cancelAnimation(float)
  }, [])
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -float.value * 6 }] }))

  return (
    <View style={st.root}>
      {/* Headline ABOVE the phone and large — the old build buried it in a 92pt slot underneath,
          where a moving screen beat static text for attention every time. */}
      <View style={st.headlineSlot}>
        <Animated.Text
          key={beat.id}
          entering={FadeInDown.duration(340)}
          exiting={FadeOut.duration(160)}
          style={st.headline}
        >
          {beat.headline}
        </Animated.Text>
      </View>

      <Animated.View style={[st.phone, floatStyle]}>
        <View style={st.screen}>
          <Animated.View key={beat.id} entering={FadeIn.duration(340)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
            <Beat />
          </Animated.View>
        </View>
      </Animated.View>

      {/* Beat position — tiny, but it tells the user this is finite and worth watching. */}
      <View style={st.dots}>
        {BEATS.map((b, idx) => (
          <View key={b.id} style={[st.dot, idx === i && st.dotActive]} />
        ))}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  root: { alignItems: 'center', width: '100%' },

  headlineSlot: { height: 84, justifyContent: 'center', paddingHorizontal: 24, marginBottom: 18 },
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
  screen: { flex: 1, borderRadius: 37, overflow: 'hidden', backgroundColor: '#0A0A0A' },

  beat: { flex: 1, backgroundColor: '#0A0A0A' },
  beatPad: { paddingHorizontal: 14, paddingTop: 26 },

  // Beat 1
  camImage: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  camScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  bracket: {
    position: 'absolute', width: 30, height: 30,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 4,
  },
  scanLine: {
    position: 'absolute', left: 0, right: 0, top: '18%', height: 2,
    backgroundColor: COLORS.accent,
    shadowColor: COLORS.accent, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },

  // Beat 2
  countWrap: { alignItems: 'center', marginBottom: 18 },
  countNum: { fontSize: 52, fontWeight: '800', color: COLORS.accent, letterSpacing: -1 },
  countLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.4, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#171717', borderRadius: 30,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  chipDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.accent },
  chipText: { fontSize: 10, fontWeight: '600', color: '#E5E5E5' },

  // Beat 3
  beatKicker: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.4, marginBottom: 10 },
  mealCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#141414', borderRadius: 14, padding: 10, marginBottom: 8,
  },
  mealThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mealThumbImg: { width: 42, height: 42, borderRadius: 10 },
  mealName: { fontSize: 12, fontWeight: '700', color: COLORS.textWhite },
  macroRow: { flexDirection: 'row', gap: 5, marginTop: 5 },
  macroPill: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 30, paddingVertical: 3, paddingHorizontal: 7 },
  macroText: { fontSize: 9, fontWeight: '600', color: '#BBBBBB' },
  haveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  haveText: { fontSize: 10, fontWeight: '600', color: COLORS.accent },

  dots: { flexDirection: 'row', gap: 6, marginTop: 20 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotActive: { backgroundColor: COLORS.accent, width: 16 },
})
