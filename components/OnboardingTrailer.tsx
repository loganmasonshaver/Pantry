import { useEffect, useState } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import Animated, {
  FadeIn, FadeOut, FadeInDown,
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, withSequence,
  Easing, cancelAnimation,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Check, UtensilsCrossed, Clock } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'

// Native replacement for the old 25s onboarding-preview.mov. Composing the demo out of real
// views instead of a screen recording means: it never drifts from the app's actual design,
// it stays crisp when we punch in (video pixelates past its native res), there's no
// playbackRate/timeout sync math to desync, and it drops ~8.5MB from the bundle.

const PHONE_W = 250
const PHONE_H = PHONE_W * (19.5 / 9)

// Real items visible in the bundled fridge photo — keep these in sync with onboarding-fridge.jpg
// so the "AI finds everything" beat is an honest depiction of a scan of THIS shelf.
const DETECTED = ['Egg whites', 'Greek yogurt', 'Cottage cheese', 'Ground beef', 'Eggs', 'Peanut butter', 'Salsa', 'Oat milk', 'Maple syrup']

// Meals built from the detected items above — this is what the app would actually suggest.
// `img` stays null until real generated photos are dropped in assets/ — then flip on the
// require (one line each) and the full-bleed hero swaps from the glyph to the real photo.
// `crave` is the sensory line that leads each hero — appetite is triggered by senses, not a
// macro label, so the numbers ride below as fine print.
const MEALS = [
  { name: 'Beef & Salsa Rice Bowl', crave: 'Sizzling beef, fresh salsa', mins: 20, kcal: 560, protein: 44, img: null as any }, // img: require('../assets/trailer-beef-bowl.jpg')
  { name: 'Egg White Veggie Scramble', crave: 'Fluffy eggs, crisp veg', mins: 10, kcal: 320, protein: 31, img: null as any }, // img: require('../assets/trailer-egg-scramble.jpg')
  { name: 'PB & Greek Yogurt Bowl', crave: 'Creamy, sweet, high-protein', mins: 5, kcal: 400, protein: 28, img: null as any }, // img: require('../assets/trailer-pb-yogurt.jpg')
]

// Per-meal dwell on the full-bleed showcase — slow enough to actually crave the plate.
const MEAL_MS = 2000
// Layout builders defined at module scope (perf: avoids rebuilding on every render).
const HERO_ENTER = FadeIn.duration(420)
const HERO_EXIT = FadeOut.duration(300)

// Three beats — Cal-AI-form: one quick magic moment (scan → find → meals), not a slideshow.
// Dropped the old 4th "Logged" beat: logging is table stakes Cal AI owns; OUR hook is
// scan-pantry → cookable-meals, so we end on the meals payoff. Ordered so the magic leads.
const BEATS = [
  { id: 'scan', headline: 'Point your camera\nat the shelf', ms: 2800 },
  // detect must outlast the chip cascade: 9 items land at 250 + 8*300 = 2650ms, so anything
  // under ~3s cut off mid-animation and read as rushed. 3800 lets all items settle + register.
  { id: 'detect', headline: 'AI finds everything\nyou have', ms: 3800 },
  // meals runs a full-bleed showcase that auto-cycles the meals (MEAL_MS each) — give it room
  // for one full pass so every plate gets its moment. Headline carries appetite/aspiration;
  // the in-phone overlay owns the attainability punch (no dupe).
  { id: 'meals', headline: 'Cook something\ngreat tonight', ms: MEALS.length * MEAL_MS + 300 },
] as const

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

// Stories-style progress segment. The active one fills over MEAL_MS; past = full, future = empty.
function SegBar({ state, durationMs }: { state: 'done' | 'active' | 'todo'; durationMs: number }) {
  const w = useSharedValue(state === 'done' ? 1 : 0)
  useEffect(() => {
    if (state === 'active') w.value = withTiming(1, { duration: durationMs, easing: Easing.linear })
    else w.value = state === 'done' ? 1 : 0
  }, [state])
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }))
  return (
    <View style={st.segTrack}>
      <Animated.View style={[st.segFill, fill]} />
    </View>
  )
}

// One full-bleed meal plate. Reveal = a quick settle-in punch (1.08 → 1.0) then a slow Ken
// Burns drift (1.0 → 1.06) over the dwell, so the food never sits static. Text rides a bottom
// scrim: crave line + BOLD attainability punch, macros as fine print.
function MealHero({ meal, dwellMs }: { meal: typeof MEALS[number]; dwellMs: number }) {
  const z = useSharedValue(1.08)
  useEffect(() => {
    z.value = withSequence(
      withTiming(1.0, { duration: 460, easing: Easing.out(Easing.quad) }),
      withTiming(1.06, { duration: dwellMs, easing: Easing.linear }),
    )
    return () => cancelAnimation(z)
  }, [])
  const zoom = useAnimatedStyle(() => ({ transform: [{ scale: z.value }] }))

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Photo layer (or a warm-dark placeholder + glyph until the real photo lands) */}
      {meal.img ? (
        <Animated.Image source={meal.img} style={[StyleSheet.absoluteFill, zoom]} resizeMode="cover" />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, zoom, st.heroFallback]}>
          <UtensilsCrossed size={44} stroke="#3A3A3A" strokeWidth={1.4} />
        </Animated.View>
      )}
      {/* Bottom scrim so overlaid text stays legible over any photo */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
        locations={[0.35, 0.7, 1]}
        style={st.heroScrim}
      />
      {/* Text rises in just after the photo lands — a beat of "the plate, THEN what it is". */}
      <Animated.View entering={FadeInDown.duration(360).delay(140)} style={st.heroText}>
        <Text style={st.craveLine} numberOfLines={1}>{meal.crave}</Text>
        <Text style={st.craveName} numberOfLines={2}>{meal.name}</Text>
        <View style={st.haveRowBold}>
          <View style={st.haveCheck}><Check size={11} stroke="#000" strokeWidth={3.4} /></View>
          <Text style={st.haveTextBold}>You already have everything</Text>
        </View>
        <View style={st.heroMetaRow}>
          <View style={st.metaItem}><Clock size={11} stroke="rgba(255,255,255,0.75)" strokeWidth={2.2} /><Text style={st.metaText}>{meal.mins} min</Text></View>
          <Text style={st.metaDot}>·</Text>
          <Text style={st.metaText}>{meal.kcal} cal</Text>
          <Text style={st.metaDot}>·</Text>
          <Text style={st.metaText}>{meal.protein}g protein</Text>
        </View>
      </Animated.View>
    </View>
  )
}

// ── Beat 3: the payoff — a full-bleed meal showcase ────────────────────────────
// For a FOOD app the appetite appeal IS the conversion. So the food breaks out of the little
// card and fills the whole screen, one plate at a time, auto-advancing like a stories reel —
// big + bold, and every meal gets its proud moment. Attainability ("you already have
// everything") is the bold overlay; macros are demoted to fine print.
function BeatMeals() {
  const [idx, setIdx] = useState(0)
  // Self-rescheduling per-meal advance; wraps so a long-enough beat could show >1 pass.
  useEffect(() => {
    const t = setTimeout(() => setIdx(i => (i + 1) % MEALS.length), MEAL_MS)
    return () => clearTimeout(t)
  }, [idx])

  return (
    <View style={st.showBeat}>
      {/* Full-bleed plate, keyed so each meal re-enters with its own reveal. collapsable=false
          so the crossfade exit isn't dropped when React removes the previous plate. */}
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <Animated.View key={idx} entering={HERO_ENTER} exiting={HERO_EXIT} style={StyleSheet.absoluteFill}>
          <MealHero meal={MEALS[idx]} dwellMs={MEAL_MS} />
        </Animated.View>
      </View>
      {/* Stories progress sits over the photo, top edge */}
      <View style={st.segRow}>
        {MEALS.map((_, i) => (
          <SegBar key={i} state={i < idx ? 'done' : i === idx ? 'active' : 'todo'} durationMs={MEAL_MS} />
        ))}
      </View>
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

  // Beat 3 — full-bleed meal showcase
  showBeat: { flex: 1, backgroundColor: '#000000' },
  segRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 4 },
  segTrack: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  segFill: { height: '100%', borderRadius: 2, backgroundColor: '#FFFFFF' },
  heroFallback: { backgroundColor: '#161311', alignItems: 'center', justifyContent: 'center' }, // warm-dark, not a flat void, until the real photo lands
  heroScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 18 },
  // Soft shadow on the overlay text so it stays readable even over a bright/busy photo.
  craveLine: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.78)', marginBottom: 3, letterSpacing: 0.1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  craveName: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4, lineHeight: 24, marginBottom: 9, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  haveRowBold: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  haveCheck: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  haveTextBold: { fontSize: 13, fontWeight: '800', color: COLORS.accent, letterSpacing: -0.1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  metaDot: { fontSize: 10, color: 'rgba(255,255,255,0.5)' },

  dots: { flexDirection: 'row', gap: 6, marginTop: 20 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  dotActive: { backgroundColor: COLORS.accent, width: 16 },
})
