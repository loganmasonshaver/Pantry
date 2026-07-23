import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView, Easing, Dimensions, AccessibilityInfo } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
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

// Post-scan payoff screen: generates fresh cook-now meals from the just-updated pantry and
// reveals them as a slow, satisfying card deck — the "look what you can make right now" moment.
export default function CookReveal() {
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium } = usePremium()
  // enabled=false skips the hook's auto cache-load so we never flash yesterday's meals;
  // retry() force-generates a fresh batch and BYPASSES the 1/day regen cap (a scan earns it).
  const { meals, error, errorCode, retry } = useMealSuggestions(user?.id, isPremium, 'cookNow', false)
  const triggeredRef = useRef(false)
  const revealed = meals.slice(0, 3)

  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {}) }, [])

  useEffect(() => {
    if (triggeredRef.current || !user?.id) return
    triggeredRef.current = true
    retry() // force a fresh generation from the freshly-scanned pantry
  }, [user?.id])

  // ── Carousel state ──
  const scrollX = useRef(new Animated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const userTookOver = useRef(false) // once the user scrolls/taps, stop auto-advancing
  const prevActive = useRef(0)

  // ── Reveal animations ──
  const headerAnim = useRef(new Animated.Value(0)).current
  const animatedRef = useRef(false)

  // Fire the header reveal + success haptic exactly once, when the meals first land.
  useEffect(() => {
    if (revealed.length === 0 || animatedRef.current) return
    animatedRef.current = true
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    Animated.timing(headerAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start()
  }, [revealed.length])

  // Auto-advance through the deck — the "shifting to the next meal" beat. Stops at the last card
  // or as soon as the user takes over (so we never yank the deck while they're reading). Disabled
  // under reduce-motion; the user drives manually instead.
  useEffect(() => {
    if (revealed.length === 0 || userTookOver.current || reduceMotion) return
    if (activeIndex >= revealed.length - 1) return
    const t = setTimeout(() => {
      if (userTookOver.current) return
      const next = activeIndex + 1
      scrollRef.current?.scrollTo({ x: next * INTERVAL, animated: true })
      setActiveIndex(next)
    }, 3000) // auto-advance cadence; stops for good the moment the user swipes/taps (userTookOver)
    return () => clearTimeout(t)
  }, [activeIndex, revealed.length, reduceMotion])

  // Medium haptic each time a NEW card lands (the first card's beat is the success haptic above).
  useEffect(() => {
    if (activeIndex !== prevActive.current) {
      prevActive.current = activeIndex
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
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

  const showLoader = revealed.length === 0 && !error

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Close → back to the pantry screen the scan was launched from */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {showLoader ? (
        <View style={styles.centerRegion}>
          {/* Populated skeleton instead of an empty spinner — reads as "almost ready", not
              "still nothing". With the scan-time prefetch this is usually skipped entirely. */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>FROM YOUR PANTRY</Text>
            <Text style={styles.title}>Cooking up meals{'\n'}from your pantry…</Text>
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
                <Shimmer style={styles.card} />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : error && revealed.length === 0 ? (
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
                        <Shimmer style={styles.cardImage} />
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
            </View>

            {/* Bottom bar: tappable progress dots + the tap-to-cook hint. No Done button — the
                top-left X is the single dismiss (Done did the exact same thing, a redundant CTA). */}
            <View style={styles.bottomBar}>
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
            </View>
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
