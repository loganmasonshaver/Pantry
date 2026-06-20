import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, Animated, ScrollView, Easing, Dimensions, AccessibilityInfo } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { Utensils, X, Sparkles, Flame, Dumbbell, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import { useMealSuggestions } from '@/lib/useMealSuggestions'
import { Shimmer } from '@/components/Shimmer'

// Deck geometry — each card is ~78% of the screen so the neighbours peek in at the edges,
// which is what sells the "there's more in the deck" feel as you advance.
const { width: SCREEN_W } = Dimensions.get('window')
const CARD_W = Math.round(SCREEN_W * 0.78)
const CARD_H = Math.round(CARD_W * 1.3)
const SPACING = 16
const INTERVAL = CARD_W + SPACING
const SIDE = (SCREEN_W - CARD_W) / 2 // centers each snapped card

// Animated count-up — the dopamine beat. Rolls 0→value when its card becomes the active one.
// useNativeDriver:false is required (we're animating a JS number into <Text>, not a transform).
function CountUp({ value, active, reduceMotion, style }: { value: number; active: boolean; reduceMotion: boolean; style: any }) {
  const [display, setDisplay] = useState(value)
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active || reduceMotion || value <= 0) { setDisplay(value); return }
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
  const { meals, error, retry } = useMealSuggestions(user?.id, isPremium, 'cookNow', false)
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
  const spin = useRef(new Animated.Value(0)).current
  const animatedRef = useRef(false)

  // Loader spin while generating
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [])

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
    }, 3200) // long enough to absorb the macros + tap in
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

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
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
        <View style={styles.loaderWrap}>
          <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
            <Sparkles size={56} stroke={'#4ADE80'} strokeWidth={1.4} />
          </Animated.View>
          <Text style={styles.loaderTitle}>Cooking up meals{'\n'}from your pantry…</Text>
          <Text style={styles.loaderSub}>Finding the tastiest things you can make right now</Text>
        </View>
      ) : error && revealed.length === 0 ? (
        <View style={styles.loaderWrap}>
          <Text style={styles.loaderTitle}>Couldn't generate meals</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { animatedRef.current = false; retry() }}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Animated.View style={[styles.header, {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }]}>
            <Text style={styles.eyebrow}>✨ FROM YOUR PANTRY</Text>
            <Text style={styles.title}>{revealed.length} meals you{'\n'}can make right now</Text>
          </Animated.View>

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
                      <Image source={{ uri: meal.image }} style={styles.cardImage} resizeMode="cover" />
                    ) : (
                      <Shimmer style={styles.cardImage} />
                    )}
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.97)']} locations={[0, 0.5, 1]} style={styles.cardGradient} />
                    {!meal.image && (
                      <View style={styles.cardPlaceholderIcon}><Utensils size={30} stroke="#666" strokeWidth={1.4} /></View>
                    )}
                    {meal.prepTime > 0 && (
                      <View style={styles.timePill}><Text style={styles.timePillText}>{meal.prepTime} MIN</Text></View>
                    )}

                    <View style={styles.cardContent}>
                      <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>

                      <View style={styles.statRow}>
                        <View style={styles.stat}>
                          <Flame size={16} stroke="#F59E0B" strokeWidth={2.2} />
                          <CountUp value={meal.calories || 0} active={active} reduceMotion={reduceMotion} style={styles.statNum} />
                          <Text style={styles.statUnit}>cal</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.stat}>
                          <Dumbbell size={16} stroke="#4ADE80" strokeWidth={2.2} />
                          <CountUp value={meal.protein || 0} active={active} reduceMotion={reduceMotion} style={styles.statNum} />
                          <Text style={styles.statUnit}>g protein</Text>
                        </View>
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

          {/* Progress dots — tappable to jump straight to a meal */}
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

          <View style={styles.footer}>
            <Text style={styles.footerHint}>Tap a meal to start cooking</Text>
            <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={() => router.back()}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A' },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 18 },
  loaderTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textWhite, textAlign: 'center', letterSpacing: -0.3, lineHeight: 28 },
  loaderSub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingHorizontal: 28, paddingVertical: 13 },
  retryText: { color: '#000000', fontWeight: '700', fontSize: 15 },

  header: { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 14, alignItems: 'center' },
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

  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  stat: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  statNum: { fontSize: 22, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  statUnit: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  statDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 16 },

  viewRecipe: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 11, marginTop: 16 },
  viewRecipeText: { fontSize: 14, fontWeight: '700', color: '#000000' },

  timePill: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  timePillText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.6 },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 16 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { backgroundColor: '#4ADE80', width: 20 },

  footer: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  footerHint: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginBottom: 12 },
  doneBtn: { backgroundColor: '#1A1A1A', borderRadius: 30, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  doneText: { color: COLORS.textWhite, fontWeight: '700', fontSize: 16 },
})
