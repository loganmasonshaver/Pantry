import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView, Easing, Dimensions, AccessibilityInfo } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg'
import { Utensils, X, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import { useMealSuggestions } from '@/lib/useMealSuggestions'
import { Shimmer } from '@/components/Shimmer'
import { MealImage } from '@/components/MealImage'

// Deck geometry — each card is ~78% of the screen so the neighbours peek in at the edges,
// which is what sells the "there's more in the deck" feel as you advance.
const { width: SCREEN_W } = Dimensions.get('window')
const CARD_W = Math.round(SCREEN_W * 0.78)
const CARD_H = Math.round(CARD_W * 1.4)
const SPACING = 16
const INTERVAL = CARD_W + SPACING
const SIDE = (SCREEN_W - CARD_W) / 2 // centers each snapped card
const GLOW_W = Math.round(CARD_W * 1.75)
const GLOW_H = Math.round(CARD_H * 1.15)

// Reveal pacing. Dopamine fires during ANTICIPATION, not delivery — so even when the meals are
// already cached we hold a short build-up floor rather than snapping straight to the payoff.
const MIN_BUILD_MS = 1400       // anticipation floor before the reveal is allowed to open
const HERO_IMG_GRACE_MS = 2600  // extra hold for the hero photo (capped — never stalls)
const DWELL_MS = 3000           // auto-advance dwell when the next photo is ready
const IMG_GRACE_MS = 2000       // extra dwell when the next photo hasn't landed yet

// Animated count-up — the dopamine beat. Rolls 0→value the FIRST time its card becomes active,
// then holds forever — it must NOT re-roll when the user swipes back to a card they've already seen
// (the `rolled` ref is what enforces once-per-card).
// useNativeDriver:false is required (we're animating a JS number into <Text>, not a transform).
function CountUp({ value, active, reduceMotion, style }: { value: number; active: boolean; reduceMotion: boolean; style: any }) {
  const [display, setDisplay] = useState(value)
  const anim = useRef(new Animated.Value(0)).current
  const rolled = useRef(false) // once this card has counted up, never again
  useEffect(() => {
    if (rolled.current || !active) return // wait until this card is the active one, and only the first time
    if (reduceMotion || value <= 0) { setDisplay(value); rolled.current = true; return }
    rolled.current = true
    setDisplay(0)
    anim.setValue(0)
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)))
    Animated.timing(anim, { toValue: value, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
    return () => anim.removeListener(id)
  }, [active, value, reduceMotion])
  return <Text style={style}>{display}</Text>
}

// Post-scan payoff screen: reveals the cook-now meals generated from the just-scanned pantry as a
// card deck. The choreography is built around one engineered PEAK — the hero card landing with a
// glow bloom + success haptic — because that single moment is what the user remembers.
export default function CookReveal() {
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium } = usePremium()
  // enabled=false: we drive the fetch manually (below) instead of via the hook's auto effect, which
  // reads cache-FIRST and could serve a stale today-cache before the scan's prefetch lands. load()
  // awaits the scan's prefetch, so the reveal reuses the exact set the pantry tab serves.
  const { meals, error, errorCode, retry, load } = useMealSuggestions(user?.id, isPremium, 'cookNow', false)
  const triggeredRef = useRef(false)
  const revealed = meals.slice(0, 3)
  const heroImage = revealed[0]?.image

  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {}) }, [])

  useEffect(() => {
    if (triggeredRef.current || !user?.id) return
    triggeredRef.current = true
    // Consume the scan's prefetch (or today's cache) instead of force-generating a SECOND batch.
    // This makes the reveal near-instant AND show the same meals the pantry serves (mismatch fix).
    // Only a genuine miss generates. retry() (force) stays for the error "Try again" button.
    load()
  }, [user?.id])

  // ── Carousel state ──
  const scrollX = useRef(new Animated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const userTookOver = useRef(false) // once the user scrolls/taps, stop auto-advancing
  const prevActive = useRef(0)

  // ── Reveal gate + animations ──
  const [gateOpen, setGateOpen] = useState(false)
  const mountedAtRef = useRef(Date.now())
  const headerAnim = useRef(new Animated.Value(0)).current
  const revealAnim = useRef(new Animated.Value(0)).current
  const glowAnim = useRef(new Animated.Value(0)).current
  const animatedRef = useRef(false)

  // Rising haptic ramp through the build-up (Soft → Light → Medium). This is what makes the
  // Success notification at the peak land as a THUD you felt coming, instead of a lone buzz.
  useEffect(() => {
    const ts = [
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}), 140),
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 540),
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), 960),
    ]
    return () => ts.forEach(clearTimeout)
  }, [])

  // The gate: hold the reveal until (a) the anticipation floor has elapsed AND (b) the hero photo
  // is in hand — so the peak lands on a real image, not a skeleton. The photo wait is capped, so a
  // slow/failed image delays the reveal by at most HERO_IMG_GRACE_MS instead of stalling it.
  useEffect(() => {
    if (gateOpen || revealed.length === 0) return
    const elapsed = Date.now() - mountedAtRef.current
    const floorLeft = Math.max(0, MIN_BUILD_MS - elapsed)
    const wait = heroImage ? floorLeft : Math.max(floorLeft, MIN_BUILD_MS + HERO_IMG_GRACE_MS - elapsed)
    const t = setTimeout(() => setGateOpen(true), wait)
    return () => clearTimeout(t)
  }, [revealed.length, heroImage, gateOpen])

  // THE PEAK — fires once, when the gate opens: success haptic + the deck springing in + a green
  // glow blooming behind the hero card, all on the same beat. One stacked moment, then it settles.
  useEffect(() => {
    if (!gateOpen || animatedRef.current) return
    animatedRef.current = true
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    if (reduceMotion) {
      headerAnim.setValue(1); revealAnim.setValue(1); glowAnim.setValue(0.4)
      return
    }
    Animated.parallel([
      Animated.timing(headerAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(revealAnim, { toValue: 1, damping: 18, stiffness: 220, mass: 1, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.4, duration: 460, useNativeDriver: true }),
      ]),
    ]).start()
  }, [gateOpen, reduceMotion])

  // Auto-advance — IMAGE-AWARE. A card whose photo hasn't landed yet gets extra dwell, so the deck
  // stops out-running the image generation (the old fixed 3s cadence reached the last card before
  // its photo existed). Stops at the last card or the moment the user takes over.
  const cardShownAtRef = useRef(Date.now())
  useEffect(() => { cardShownAtRef.current = Date.now() }, [activeIndex, gateOpen])
  const nextImageReady = !!revealed[activeIndex + 1]?.image
  useEffect(() => {
    if (!gateOpen || revealed.length === 0 || userTookOver.current || reduceMotion) return
    if (activeIndex >= revealed.length - 1) return
    const held = Date.now() - cardShownAtRef.current
    const target = nextImageReady ? DWELL_MS : DWELL_MS + IMG_GRACE_MS
    const t = setTimeout(() => {
      if (userTookOver.current) return
      const next = activeIndex + 1
      scrollRef.current?.scrollTo({ x: next * INTERVAL, animated: true })
      setActiveIndex(next)
    }, Math.max(0, target - held))
    return () => clearTimeout(t)
  }, [activeIndex, revealed.length, reduceMotion, gateOpen, nextImageReady])

  // Light tap as each NEW card lands — deliberately quieter than the peak's Success notification,
  // so the secondary beats don't compete with the moment they're following.
  useEffect(() => {
    if (activeIndex !== prevActive.current) {
      prevActive.current = activeIndex
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }
  }, [activeIndex])

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })
  const onMomentumEnd = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / INTERVAL)
    if (i !== activeIndex) setActiveIndex(i)
  }
  const takeOver = () => { userTookOver.current = true }

  const openMeal = (meal: any) => {
    userTookOver.current = true
    router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Close → back to the pantry screen the scan was launched from */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {error && revealed.length === 0 ? (
        <View style={styles.loaderWrap}>
          {/* Show the real reason (e.g. the daily cap message) instead of a generic line. */}
          <Text style={styles.loaderTitle}>{error}</Text>
          {/* Retry can't help once the daily cap is hit — hide it in that case. */}
          {errorCode !== 'meal_cap_reached' && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { animatedRef.current = false; retry() }}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : !gateOpen ? (
        <View style={styles.centerRegion}>
          {/* The build-up. A populated skeleton + a line that narrates real work reads as
              "working for you"; a bare spinner reads as lag. The haptic ramp runs underneath. */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>FROM YOUR PANTRY</Text>
            <Text style={styles.title}>Plating your meals…</Text>
          </View>
          <ScrollView
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SIDE, alignItems: 'center' }}
            style={styles.deck}
          >
            {[0, 1, 2].map(i => (
              <View key={i} style={[styles.cardWrap, i !== 0 && { opacity: 0.5 }]}>
                {/* Slow sweep — a fast shimmer reads as shuddering, not loading. */}
                <Shimmer style={styles.card} durationMs={1600} />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.body}>
            <Animated.View style={[styles.header, {
              opacity: headerAnim,
              transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            }]}>
              <Text style={styles.eyebrow}>FROM YOUR PANTRY</Text>
              <Text style={styles.title}>{revealed.length} meals you{'\n'}can make right now</Text>
            </Animated.View>

            <View style={styles.deckArea}>
              {/* The peak's visual: a soft green bloom behind the hero card. Chosen over confetti —
                  restraint reads premium, particles read cheap on a black-and-white brand. */}
              <Animated.View pointerEvents="none" style={[styles.glowWrap, { opacity: glowAnim }]}>
                <Svg width={GLOW_W} height={GLOW_H}>
                  <Defs>
                    <RadialGradient id="cookGlow" cx="50%" cy="50%" rx="50%" ry="50%">
                      <Stop offset="0" stopColor="#4ADE80" stopOpacity={0.5} />
                      <Stop offset="1" stopColor="#4ADE80" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect x={0} y={0} width={GLOW_W} height={GLOW_H} fill="url(#cookGlow)" />
                </Svg>
              </Animated.View>

              <Animated.View style={{
                opacity: revealAnim,
                transform: [{ scale: revealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
              }}>
            <Animated.ScrollView
              ref={scrollRef as any}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={INTERVAL}
              decelerationRate="fast"
              contentContainerStyle={{ paddingHorizontal: SIDE, alignItems: 'center' }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onMomentumScrollEnd={onMomentumEnd}
              onScrollBeginDrag={takeOver}
              style={styles.deck}
            >
              {revealed.map((meal, i) => {
                const inputRange = [(i - 1) * INTERVAL, i * INTERVAL, (i + 1) * INTERVAL]
                // Active card sits at full scale + opacity; neighbours shrink and dim so the eye
                // locks onto one meal at a time (and their macros aren't readable while peeking).
                const scale = scrollX.interpolate({ inputRange, outputRange: [0.88, 1, 0.88], extrapolate: 'clamp' })
                const opacity = scrollX.interpolate({ inputRange, outputRange: [0.45, 1, 0.45], extrapolate: 'clamp' })
                const active = activeIndex === i
                return (
                  <Animated.View key={meal.id ?? i} style={[styles.cardWrap, { transform: [{ scale }], opacity }]}>
                    <TouchableOpacity activeOpacity={0.92} onPress={() => openMeal(meal)} style={styles.card}>
                      {meal.image ? (
                        <MealImage uri={meal.image} style={styles.cardImage} recyclingKey={String(meal.id ?? i)} priority="high" />
                      ) : (
                        <Shimmer style={styles.cardImage} durationMs={1600} />
                      )}
                      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.97)']} locations={[0, 0.5, 1]} style={styles.cardGradient} />
                      {!meal.image && (
                        <View style={styles.cardPlaceholderIcon}><Utensils size={30} stroke="#666" strokeWidth={1.4} /></View>
                      )}

                      <View style={styles.cardContent}>
                        <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>

                        {/* Macro pills — same visual language as the in-app meal previews (Discover),
                            side by side inside the image frame. Cal/protein numbers count up once. */}
                        <View style={styles.pillRow}>
                          {meal.prepTime > 0 && (
                            <View style={[styles.pill, styles.pillAmber]}>
                              <Text style={[styles.pillText, styles.pillAmberText]}>{meal.prepTime} min</Text>
                            </View>
                          )}
                          <View style={[styles.pill, styles.pillWhite]}>
                            {/* minWidth reserves the final digit count so the pill doesn't jitter mid-roll */}
                            <CountUp value={meal.calories || 0} active={active} reduceMotion={reduceMotion} style={[styles.pillText, styles.pillWhiteText, { minWidth: String(meal.calories || 0).length * 8 }]} />
                            <Text style={[styles.pillText, styles.pillWhiteText]}>cal</Text>
                          </View>
                          {(meal.protein || 0) > 0 && (
                            <View style={[styles.pill, styles.pillGreen]}>
                              <CountUp value={meal.protein || 0} active={active} reduceMotion={reduceMotion} style={[styles.pillText, styles.pillGreenText, { minWidth: String(meal.protein || 0).length * 8 }]} />
                              <Text style={[styles.pillText, styles.pillGreenText]}>g protein</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.viewRecipe}>
                          <Text style={styles.viewRecipeText}>View recipe</Text>
                          <ChevronRight size={15} stroke="#000000" strokeWidth={2.6} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                )
              })}
            </Animated.ScrollView>
              </Animated.View>
            </View>

            {/* Bottom bar: tappable progress dots + the tap-to-cook hint. No Done button — the
                top-left X is the single dismiss (Done did the exact same thing, a redundant CTA). */}
            <Animated.View style={[styles.bottomBar, { opacity: headerAnim }]}>
            {revealed.length > 1 && (
              <View style={styles.dotsRow}>
                {revealed.map((_, i) => (
                  <TouchableOpacity
                    key={i}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                    onPress={() => { takeOver(); scrollRef.current?.scrollTo({ x: i * INTERVAL, animated: true }); setActiveIndex(i) }}
                  >
                    <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={styles.hint}>Tap a meal to start cooking</Text>
            </Animated.View>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A' },

  // Loader uses centerRegion (a simple vertical center). The loaded screen uses body → deckArea →
  // bottomBar so the title anchors at the top, the card centers in the middle, and the dots/hint
  // sit at the bottom — the empty space is distributed as even margins instead of one dead gap.
  centerRegion: { flex: 1, justifyContent: 'center' },
  body: { flex: 1 },
  deckArea: { flex: 1, justifyContent: 'center' },
  glowWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 18 },
  loaderTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textWhite, textAlign: 'center', letterSpacing: -0.3, lineHeight: 28 },
  retryBtn: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingHorizontal: 28, paddingVertical: 13 },
  retryText: { color: '#000000', fontWeight: '700', fontSize: 15 },

  header: { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 20, alignItems: 'center' },
  eyebrow: { fontSize: 12, fontWeight: '800', color: '#4ADE80', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontSize: 30, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.6, lineHeight: 34, textAlign: 'center' },

  deck: { flexGrow: 0 },
  cardWrap: { width: CARD_W, marginRight: SPACING },
  card: { width: CARD_W, height: CARD_H, borderRadius: 24, overflow: 'hidden', backgroundColor: '#1A1A1A', position: 'relative' },
  cardImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  cardGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },
  cardPlaceholderIcon: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  cardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
  cardName: { fontSize: 24, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.4, lineHeight: 28 },

  // Pills mirror the Discover meal-preview pills (same radius/border/tints): amber=time,
  // white=calories, green=protein — side by side, in the image frame.
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  pillAmber: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.25)' },
  pillAmberText: { color: '#F59E0B' },
  pillWhite: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.18)' },
  pillWhiteText: { color: COLORS.textWhite },
  pillGreen: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.25)' },
  pillGreenText: { color: '#4ADE80' },

  viewRecipe: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 11, marginTop: 16 },
  viewRecipeText: { fontSize: 14, fontWeight: '700', color: '#000000' },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { backgroundColor: '#4ADE80', width: 20 },

  // Dots + tap-to-cook hint, pinned near the bottom. No Done button — the X is the only dismiss.
  bottomBar: { alignItems: 'center', paddingBottom: 16, gap: 12 },
  hint: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center' },
})
