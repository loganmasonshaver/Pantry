import { useState, useRef, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Pressable,
  PanResponder,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { VideoView, useVideoPlayer } from 'expo-video'
import Svg, { Path, Line, Circle as SvgCircle, Text as SvgText } from 'react-native-svg'
import { Check, TrendingDown, Dumbbell, Scale, Zap, ChefHat, Flame, Sparkles, Target, UtensilsCrossed, Clock, Bell, ArrowLeft, Camera, BarChart3, ShieldCheck, User, UserRound, Users, Venus, Mars, Drumstick, Fish, Salad, Sprout, Facebook, Twitter, Instagram, Youtube, Apple, Tv, Music2, Globe } from 'lucide-react-native'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedCircle = Animated.createAnimatedComponent(SvgCircle)
const AnimatedLine = Animated.createAnimatedComponent(Line)
import { ActivityIndicator } from 'react-native'
import { supabase } from '../../lib/supabase'
import { generateMeals } from '../../lib/meals'
import { useAuth } from '../../context/AuthContext'
import { useSuperwall, useSuperwallEvents, useUser } from 'expo-superwall'
import { trackOnboardingStep, trackPaywallViewed, trackSubscriptionPurchased } from '../../lib/analytics'
import { DISLIKE_CHIPS } from '../food-preferences'

const { width, height: H } = Dimensions.get('window')
const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

// Flip to `true` after App Store approval to enable 60% off abandonment paywall.
// Keep `false` for initial submission — Apple has flagged this pattern as review risk.
const ABANDONMENT_PAYWALL_ENABLED = false

// Progress percentages keyed by step number. Keep monotonic — values must increase as step increases.
const PROGRESS: Record<number, number> = {
  2: 5, 3: 10, 4: 15, 5: 20, 6: 25, 7: 30, 8: 35, 9: 42,
  10: 50, 11: 55, 12: 60, 13: 63, 14: 67, 15: 74, 16: 82,
  18: 88, 19: 93, 20: 96, 21: 100,
}

type OnboardingData = {
  goal: string
  calories: string
  protein: string
  ft: string
  inches: string
  weight: string
  meals: string
  prep: string
  dietStyle: string
  diet: string[]
  cookingSkill: string
  foodDislikes: string[]
  foodDislikesText: string
  age: string
  gender: string
  activityLevel: string
  fitnessGoal: string
  attribution: string
  birthday: string
  referralCode: string
  targetWeight: string
  cuisinePreferences: string[]
}

const DEFAULT_DATA: OnboardingData = {
  goal: '', calories: '', protein: '', ft: '5', inches: '9', weight: '180',
  meals: '3', prep: '30 min', dietStyle: 'Classic', diet: [], cookingSkill: '',
  foodDislikes: [], foodDislikesText: '',
  age: '', gender: '', activityLevel: '', fitnessGoal: '',
  attribution: '', birthday: '', referralCode: '', targetWeight: '',
  cuisinePreferences: [],
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${pct}%` }]} />
    </View>
  )
}

function TopBar({ onBack, pct }: { onBack: () => void; pct: number }) {
  return (
    <View style={s.topBarRow}>
      <TouchableOpacity style={s.backArrowBtn} onPress={onBack} activeOpacity={0.7}>
        <ArrowLeft size={18} stroke="#FFFFFF" strokeWidth={2.5} />
      </TouchableOpacity>
      <View style={{ flex: 1, marginRight: 36 }}>
        <ProgressBar pct={pct} />
      </View>
    </View>
  )
}

// ── Reusable iOS-style Wheel Picker ──
const WHEEL_ITEM_HEIGHT = 44
const WHEEL_VISIBLE_COUNT = 5 // must be odd — 2 above, 1 center, 2 below

function WheelPicker({
  data,
  selectedIndex,
  onChange,
  width = 90,
}: {
  data: string[]
  selectedIndex: number
  onChange: (index: number) => void
  width?: number
}) {
  const scrollRef = useRef<ScrollView>(null)
  const initialY = selectedIndex * WHEEL_ITEM_HEIGHT
  const scrollY = useRef(new Animated.Value(initialY)).current
  const containerHeight = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_COUNT
  const paddingVertical = WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_COUNT / 2)

  useEffect(() => {
    // contentOffset is unreliable on Animated.ScrollView before layout;
    // scroll imperatively after mount to guarantee the correct position.
    const y = selectedIndex * WHEEL_ITEM_HEIGHT
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false })
    })
  }, [])

  const handleMomentumEnd = (y: number) => {
    const index = Math.round(y / WHEEL_ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(data.length - 1, index))
    onChange(clamped)
  }

  return (
    <View style={{ width, height: containerHeight, overflow: 'hidden' }}>
      {/* Highlight pill at center row */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: paddingVertical,
          left: 4,
          right: 4,
          height: WHEEL_ITEM_HEIGHT,
          backgroundColor: '#2A2A2A',
          borderRadius: 22,
        }}
      />
      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: initialY }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        onMomentumScrollEnd={(e) => handleMomentumEnd(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingVertical }}
      >
        {data.map((item, i) => {
          const inputRange = [
            (i - 2) * WHEEL_ITEM_HEIGHT,
            (i - 1) * WHEEL_ITEM_HEIGHT,
            i * WHEEL_ITEM_HEIGHT,
            (i + 1) * WHEEL_ITEM_HEIGHT,
            (i + 2) * WHEEL_ITEM_HEIGHT,
          ]
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.15, 0.4, 1, 0.4, 0.15],
            extrapolate: 'clamp',
          })
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.85, 0.92, 1, 0.92, 0.85],
            extrapolate: 'clamp',
          })
          return (
            <Animated.View
              key={i}
              style={{
                height: WHEEL_ITEM_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                opacity,
                transform: [{ scale }],
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '600' }}>{item}</Text>
            </Animated.View>
          )
        })}
      </Animated.ScrollView>
    </View>
  )
}

function PillButton({ label, onPress, variant = 'white', disabled }: { label: string; onPress: () => void; variant?: 'white' | 'dark'; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[s.pill, variant === 'dark' && s.pillDark, disabled && { opacity: 0.4 }]} onPress={onPress} activeOpacity={0.85} disabled={disabled}>
      <Text style={[s.pillText, variant === 'dark' && s.pillTextDark]}>{label}</Text>
    </TouchableOpacity>
  )
}

function S1Welcome({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) {
  // 0 = offscreen below (pre-enter), 1 = at rest (visible), 2 = offscreen above (post-exit)
  const phoneAnim = useRef(new Animated.Value(0)).current
  // Separate zoom animations per meal callout so each can have its own scale + focal point
  const zoom1 = useRef(new Animated.Value(0)).current  // focuses on bottom meal cards (deeper zoom)
  const zoom2 = useRef(new Animated.Value(0)).current  // centered meal card zoom (standard)

  const player = useVideoPlayer(require('../../assets/onboarding-demo.mov'), (p) => {
    p.loop = false
    p.muted = true
    p.playbackRate = 0.9
  })

  useEffect(() => {
    let cancelled = false
    const pending: ReturnType<typeof setTimeout>[] = []

    // Hold-phase zoom moments — timestamps relative to the start of the hold (after enter anim).
    // Aligned to the "Suggested for you" meal cards appearing AFTER the pantry scan animation finishes.
    const ZOOM_AT: number[] = [5800, 8800] // ms into hold
    const ZOOM_ANIMS = [zoom1, zoom2]
    const ZOOM_IN_DURATION = 320
    const ZOOM_HOLD_DURATION = 520
    const ZOOM_OUT_DURATION = 320
    const ZOOM_CYCLE = ZOOM_IN_DURATION + ZOOM_HOLD_DURATION + ZOOM_OUT_DURATION
    // Hold the first frame (video paused at t=0) this long before starting playback on each cycle.
    const START_HOLD_DELAY = 250
    // Hold must cover video length PLUS paused time (zooms + start hold) so every loop finishes cleanly.
    const BASE_HOLD = 13500
    const HOLD_DURATION = BASE_HOLD + START_HOLD_DELAY + ZOOM_AT.length * ZOOM_CYCLE

    const triggerZoom = (anim: Animated.Value) => {
      try { player.pause() } catch {}
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: ZOOM_IN_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(ZOOM_HOLD_DURATION),
        Animated.timing(anim, { toValue: 0, duration: ZOOM_OUT_DURATION, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => {
        if (!cancelled) { try { player.play() } catch {} }
      })
    }

    const runCycle = () => {
      if (cancelled) return
      // Clear any pending zoom timers from previous cycles so they can't fire late and desync the next loop
      pending.forEach(clearTimeout)
      pending.length = 0

      phoneAnim.setValue(0)
      zoom1.setValue(0)
      zoom2.setValue(0)
      try {
        ;(player as any).currentTime = 0
      } catch {}
      // Hold frame 0 until enter animation finishes + START_HOLD_DELAY, then play.
      // Zoom offsets use (1000 + START_HOLD_DELAY + t) so video start must match.
      pending.push(setTimeout(() => {
        if (!cancelled) { try { player.play() } catch {} }
      }, 1000 + START_HOLD_DELAY))

      // Schedule zoom moments during the hold phase (offset by enter animation + start hold delay)
      ZOOM_AT.forEach((t, i) => {
        const anim = ZOOM_ANIMS[i] ?? zoom1
        pending.push(setTimeout(() => triggerZoom(anim), 1000 + START_HOLD_DELAY + t))
      })

      Animated.sequence([
        // Enter: slide up from below + fade in (1s)
        Animated.timing(phoneAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        // Hold: video plays through + time for zoom pauses
        Animated.delay(HOLD_DURATION),
        // Exit: slide up + fade out (1s)
        Animated.timing(phoneAnim, {
          toValue: 2,
          duration: 1000,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) runCycle()
      })
    }

    runCycle()

    return () => {
      cancelled = true
      phoneAnim.stopAnimation()
      zoom1.stopAnimation()
      zoom2.stopAnimation()
      pending.forEach(clearTimeout)
      try { player.pause() } catch {}
    }
  }, [])

  return (
    <SafeAreaView style={s.safe}>
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        {/* Phone mockup with looping video */}
        <View style={w1.phoneWrap}>
          <Animated.View
            style={[
              w1.phoneContainer,
              {
                opacity: phoneAnim.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  { perspective: 1400 },
                  { rotateY: '-4deg' },
                  { rotateX: '1deg' },
                  {
                    // Base slide + zoom 1 pans the phone UP so bottom meal cards fill viewport
                    translateY: Animated.add(
                      phoneAnim.interpolate({
                        inputRange: [0, 1, 2],
                        outputRange: [140, 0, -140],
                      }),
                      zoom1.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -90],
                      })
                    ),
                  },
                  {
                    // Scale = base (phoneAnim) × zoom1 (deep zoom 1.30) × zoom2 (standard zoom 1.15)
                    scale: Animated.multiply(
                      phoneAnim.interpolate({
                        inputRange: [0, 1, 2],
                        outputRange: [0.9, 1, 0.9],
                      }),
                      Animated.multiply(
                        zoom1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.30] }),
                        zoom2.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] })
                      )
                    ),
                  },
                ],
              },
            ]}
          >
            {/* Physical buttons on left edge: action, volume up, volume down */}
            <View style={[w1.sideBtn, w1.btnLeft, { top: '14%', height: 22 }]} />
            <View style={[w1.sideBtn, w1.btnLeft, { top: '19.5%', height: 38 }]} />
            <View style={[w1.sideBtn, w1.btnLeft, { top: '27.5%', height: 38 }]} />
            {/* Physical buttons on right edge: side button, camera control */}
            <View style={[w1.sideBtn, w1.btnRight, { top: '17%', height: 58 }]} />
            <View style={[w1.sideBtn, w1.btnRight, { top: '30%', height: 22 }]} />

            {/* Phone frame with video */}
            <View style={w1.phone}>
              <VideoView
                player={player}
                style={w1.video}
                contentFit="cover"
                nativeControls={false}
                allowsFullscreen={false}
                allowsPictureInPicture={false}
              />
            </View>
          </Animated.View>
        </View>

        {/* Headline */}
        <View style={{ alignItems: 'center', paddingBottom: 12 }}>
          <Text style={w1.headline}>Cook with{'\n'}what you have</Text>
        </View>
      </View>

      <View style={s.bottomActions}>
        <PillButton label="Get Started" onPress={onNext} />
        <TouchableOpacity activeOpacity={0.7} style={s.textLink} onPress={onSignIn}>
          <Text style={s.textLinkText}>Already have an account? <Text style={{ color: '#FFF', fontWeight: '700' }}>Sign In</Text></Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const w1 = StyleSheet.create({
  phoneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
  phoneContainer: {
    width: 280,
    aspectRatio: 9 / 19.5,
    position: 'relative',
  },
  phone: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    borderRadius: 42,
    borderWidth: 3,
    borderColor: '#1A1A1A',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  sideBtn: {
    position: 'absolute',
    width: 3,
    backgroundColor: '#2A2A2A',
    borderRadius: 1.5,
    zIndex: 2,
  },
  btnLeft: {
    left: -2,
  },
  btnRight: {
    right: -2,
  },
  headline: { fontSize: 32, fontWeight: '800', color: '#FFF', textAlign: 'center', letterSpacing: -0.5, lineHeight: 38, marginTop: 8 },
})

const GOALS = [
  { id: 'lose', Icon: TrendingDown, iconColor: '#EF4444', label: 'Lose Weight', sub: 'Burn fat while hitting your protein goals' },
  { id: 'build', Icon: Dumbbell, iconColor: TEAL, label: 'Build Muscle', sub: 'High protein meals to support your gains' },
  { id: 'maintain', Icon: Scale, iconColor: '#60A5FA', label: 'Maintain Weight', sub: 'Balanced meals to keep you on track' },
]

const GENDERS = [
  { id: 'male', Icon: Mars, label: 'Male' },
  { id: 'female', Icon: Venus, label: 'Female' },
  { id: 'other', Icon: Users, label: 'Other' },
]

function S1_5Gender({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[2]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>What's your gender?</Text>
        <Text style={s.subtitle}>This helps us calculate your metabolism accurately</Text>
        <View style={s.cardList}>
          {GENDERS.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[s.selectCard, value === g.id && s.selectCardActive]}
              onPress={() => onChange(g.id)}
              activeOpacity={0.8}
            >
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <g.Icon size={28} stroke={TEAL} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{g.label}</Text>
              </View>
              {value === g.id && (
                <View style={s.checkCircle}>
                  <Check size={12} stroke="#000000" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

// 4 activity tiers; each key matches ACTIVITY_OPTIONS.key so its mult feeds calorie calc.
const ACTIVITY_TIERS = [
  { key: 'sedentary', Icon: User, iconColor: '#60A5FA', label: 'Sedentary', sub: 'Desk job, little to no exercise' },
  { key: 'light', Icon: Zap, iconColor: TEAL, label: 'Lightly Active', sub: 'Light exercise 1-3x/week' },
  { key: 'moderate', Icon: Dumbbell, iconColor: '#F59E0B', label: 'Moderately Active', sub: 'Exercise 3-5x/week' },
  { key: 'very', Icon: Flame, iconColor: '#EF4444', label: 'Very Active', sub: 'Hard exercise 6-7x/week or physical job' },
]

function SActivityLevel({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[3]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>How active are you?</Text>
        <Text style={s.subtitle}>We'll use this to calibrate your daily calories</Text>
        <View style={s.cardList}>
          {ACTIVITY_TIERS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[s.selectCard, value === opt.key && s.selectCardActive]}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.8}
            >
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <opt.Icon size={26} stroke={opt.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{opt.label}</Text>
                <Text style={s.selectCardSub}>{opt.sub}</Text>
              </View>
              {value === opt.key && (
                <View style={s.checkCircle}>
                  <Check size={12} stroke="#000000" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

const ATTRIBUTION_OPTIONS = [
  { id: 'instagram', Icon: Instagram, label: 'Instagram' },
  { id: 'tiktok', Icon: Music2, label: 'TikTok' },
  { id: 'youtube', Icon: Youtube, label: 'YouTube' },
  { id: 'appstore', Icon: Apple, label: 'App Store' },
  { id: 'friend', Icon: Users, label: 'Friend or family' },
  { id: 'facebook', Icon: Facebook, label: 'Facebook' },
  { id: 'twitter', Icon: Twitter, label: 'X (Twitter)' },
  { id: 'tv', Icon: Tv, label: 'TV' },
  { id: 'other', Icon: Globe, label: 'Other' },
]

function S3Attribution({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[4]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Where did you hear about us?</Text>
        <Text style={s.subtitle}>We'd love to know what brought you here</Text>
        <View style={s.cardList}>
          {ATTRIBUTION_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.id}
              style={[s.selectCard, value === opt.id && s.selectCardActive]}
              onPress={() => onChange(opt.id)}
              activeOpacity={0.8}
            >
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A', width: 44, height: 44, borderRadius: 22 }]}>
                <opt.Icon size={22} stroke={TEAL} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{opt.label}</Text>
              </View>
              {value === opt.id && (
                <View style={s.checkCircle}>
                  <Check size={12} stroke="#000000" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

function S4LongTermResults({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const mealDraw = useRef(new Animated.Value(0)).current
  const typicalDraw = useRef(new Animated.Value(0)).current
  const gridDraw = useRef(new Animated.Value(0)).current
  const cardFade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const seq = Animated.sequence([
      // 1. Card fades/slides in — snappy
      Animated.timing(cardFade, { toValue: 1, duration: 250, useNativeDriver: true }),
      // 2. Grid lines + baseline draw left → right — faster scaffolding
      Animated.timing(gridDraw, { toValue: 1, duration: 600, useNativeDriver: false }),
      // 3. Data lines draw left → right — slower for dramatic reveal
      Animated.parallel([
        Animated.timing(typicalDraw, { toValue: 1, duration: 1800, useNativeDriver: false }),
        Animated.timing(mealDraw, { toValue: 1, duration: 1800, useNativeDriver: false }),
      ]),
    ])
    seq.start()
    // Stop all animations on unmount to prevent leaking state updates
    return () => {
      seq.stop()
      cardFade.stopAnimation()
      gridDraw.stopAnimation()
      typicalDraw.stopAnimation()
      mealDraw.stopAnimation()
    }
  }, [])

  // Chart geometry — endpoints end at x=180 to leave room for inline labels
  const CHART_W = 280
  const CHART_H = 180
  // Meal planners: starts high-left, steep steady decline, ends very low
  const MEAL_PATH = 'M 20 32 C 50 40, 130 125, 180 160'
  // Typical diet: initial dip then yo-yo rebound, ends near top
  const TYPICAL_PATH = 'M 20 38 C 60 55, 130 110, 180 40'
  const PATH_LENGTH = 340 // approximate, enough to cover curve length

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[5]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Meal planning works</Text>
        <Text style={s.subtitle}>People who plan meals see real, lasting results</Text>

        <Animated.View
          style={[
            chart.card,
            {
              opacity: cardFade,
              transform: [
                {
                  translateY: cardFade.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={chart.label}>Your weight</Text>

          <View style={{ width: CHART_W, height: CHART_H, position: 'relative' }}>
            <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              {/* Horizontal grid lines — dashed, lighter, draw left→right */}
              {[30, 70, 110].map((y, i) => {
                const animatedX2 = gridDraw.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, CHART_W - 10],
                })
                return (
                  <AnimatedLine
                    key={`grid-${i}`}
                    x1="10"
                    y1={y}
                    y2={y}
                    stroke="#333333"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    x2={animatedX2 as any}
                  />
                )
              })}

              {/* Solid reference line at the bottom (baseline) — draws with grid */}
              <AnimatedLine
                x1="10"
                y1="165"
                y2="165"
                stroke="#555555"
                strokeWidth="1.5"
                x2={gridDraw.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, CHART_W - 10],
                }) as any}
              />

              {/* Typical diet line (red — yo-yo rebound) */}
              <AnimatedPath
                d={TYPICAL_PATH}
                stroke="#EF4444"
                strokeWidth={3.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={PATH_LENGTH}
                strokeDashoffset={typicalDraw.interpolate({
                  inputRange: [0, 1],
                  outputRange: [PATH_LENGTH, 0],
                })}
              />

              {/* Meal planners line (green — steep decline to near baseline) */}
              <AnimatedPath
                d={MEAL_PATH}
                stroke="#4ADE80"
                strokeWidth={3.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={PATH_LENGTH}
                strokeDashoffset={mealDraw.interpolate({
                  inputRange: [0, 1],
                  outputRange: [PATH_LENGTH, 0],
                })}
              />

              {/* End-point dots */}
              <AnimatedCircle cx="180" cy="160" r="5" fill="#4ADE80" opacity={mealDraw} />
              <AnimatedCircle cx="180" cy="40" r="5" fill="#EF4444" opacity={typicalDraw} />

              {/* Start-point dots (slightly muted) */}
              <SvgCircle cx="20" cy="32" r="4" fill="#4ADE80" opacity={0.7} />
              <SvgCircle cx="20" cy="38" r="4" fill="#EF4444" opacity={0.7} />
            </Svg>

            {/* Inline labels positioned next to each endpoint */}
            <Animated.View
              style={[
                chart.inlineLabelGreen,
                { opacity: mealDraw },
              ]}
            >
              <Text style={chart.inlineLabelText}>Meal{'\n'}planners</Text>
            </Animated.View>
            <Animated.View
              style={[
                chart.inlineLabelRed,
                { opacity: typicalDraw },
              ]}
            >
              <Text style={chart.inlineLabelText}>Typical{'\n'}diet</Text>
            </Animated.View>
          </View>

          {/* X-axis labels */}
          <View style={chart.axisRow}>
            <Text style={chart.axisLabel}>Month 1</Text>
            <Text style={chart.axisLabel}>Month 6</Text>
          </View>
        </Animated.View>

        <Text style={chart.stat}>
          People who plan meals lose{' '}
          <Text style={chart.statBold}>1.5 lbs more per month</Text>
          {' '}on average
        </Text>
        <Text style={chart.citation}>Journal of the American Dietetic Association</Text>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" />
      </View>
    </SafeAreaView>
  )
}

const chart = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
    marginTop: 8,
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 280,
    marginTop: 4,
    paddingHorizontal: 6,
  },
  axisLabel: {
    fontSize: 11,
    color: MUTED,
    fontWeight: '500',
  },
  inlineLabelGreen: {
    position: 'absolute',
    left: 190,
    top: 148,
  },
  inlineLabelRed: {
    position: 'absolute',
    left: 190,
    top: 28,
  },
  inlineLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 13,
  },
  stat: {
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 24,
    paddingHorizontal: 8,
  },
  statBold: {
    fontWeight: '800',
    color: TEAL,
  },
  citation: {
    fontSize: 11,
    color: '#555555',
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
})

function S2Goal({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[8]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>What's your main goal?</Text>
        <Text style={s.subtitle}>This helps us tailor your meal suggestions</Text>
        <View style={s.cardList}>
          {GOALS.map(g => (
            <TouchableOpacity key={g.id} style={[s.selectCard, value === g.id && s.selectCardActive]} onPress={() => onChange(g.id)} activeOpacity={0.8}>
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <g.Icon size={28} stroke={g.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{g.label}</Text>
                <Text style={s.selectCardSub}>{g.sub}</Text>
              </View>
              {value === g.id && <View style={s.checkCircle}><Check size={12} stroke="#000000" strokeWidth={3} /></View>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

function STargetWeight({
  goal, weight, ft, inches, targetWeight, onChange, onNext, onBack,
}: {
  goal: string; weight: string; ft: string; inches: string; targetWeight: string
  onChange: (v: string) => void
  onNext: () => void; onBack: () => void
}) {
  const currentLb = parseInt(weight || '180', 10)
  // Default target reflects goal direction so picker starts on a non-zero delta
  const defaultDelta = goal === 'lose' ? -10 : goal === 'build' ? 10 : 0
  const smartDefault = currentLb + defaultDelta
  const initialTarget = targetWeight ? parseInt(targetWeight, 10) : smartDefault
  const targetIdx = Math.max(0, Math.min(LB_OPTIONS.length - 1, initialTarget - 80))

  // Seed the target value so the Plan Reveal always has a real delta to show.
  // Re-seed on mount if the stored value equals current weight for a lose/build goal
  // (signal that the user never actually picked a target on a prior run).
  useEffect(() => {
    const stored = parseInt(targetWeight || '0', 10)
    const needsSeeding = !targetWeight || (stored === currentLb && defaultDelta !== 0)
    if (needsSeeding) onChange(String(smartDefault))
  }, [])

  const target = parseInt(targetWeight || String(currentLb), 10)
  const delta = target - currentLb
  const deltaLabel = delta === 0 ? 'Same as current' : delta > 0 ? `+${delta} lbs` : `${delta} lbs`
  const deltaColor = delta === 0 ? MUTED : (goal === 'lose' && delta < 0) || (goal === 'build' && delta > 0) ? TEAL : '#F59E0B'

  // BMI safety check
  const heightInInches = parseInt(ft || '5') * 12 + parseInt(inches || '9')
  const heightM = heightInInches * 0.0254
  const targetKg = target * 0.453592
  const targetBmi = heightM > 0 ? targetKg / (heightM * heightM) : 0
  const underweight = targetBmi > 0 && targetBmi < 18.5

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[9]} />
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        <Text style={[s.title, { marginTop: 16 }]}>
          {goal === 'lose' ? "What's your goal weight?" : goal === 'build' ? "What's your target weight?" : 'Target weight'}
        </Text>
        <Text style={s.subtitle}>
          {goal === 'lose' ? 'Where are you trying to land?' : goal === 'build' ? 'Where do you want to be?' : 'Your ideal maintenance weight'}
        </Text>

        <View style={{ alignItems: 'center', marginTop: 24 }}>
          <Text style={{ fontSize: 48, fontWeight: '800', color: deltaColor, letterSpacing: -1 }}>{deltaLabel}</Text>
          <Text style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>from {currentLb} lbs</Text>
        </View>

        <View style={{ alignItems: 'center', marginTop: 28 }}>
          <WheelPicker
            data={LB_OPTIONS}
            selectedIndex={targetIdx}
            onChange={(i) => onChange(String(80 + i))}
            width={160}
          />
        </View>

        {underweight && (
          <Text style={{ fontSize: 13, color: '#EF4444', textAlign: 'center', marginTop: 24, fontWeight: '600', paddingHorizontal: 16 }}>
            That's below a healthy weight for your height. Consider a higher target.
          </Text>
        )}
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} disabled={underweight} />
      </View>
    </SafeAreaView>
  )
}


const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary', sub: 'Desk job, little exercise', mult: 1.2 },
  { key: 'light', label: 'Lightly Active', sub: 'Light exercise 1-3x/week', mult: 1.375 },
  { key: 'moderate', label: 'Moderately Active', sub: 'Exercise 3-5x/week', mult: 1.55 },
  { key: 'very', label: 'Very Active', sub: 'Hard exercise 6-7x/week', mult: 1.725 },
  { key: 'athlete', label: 'Athlete', sub: '2x/day or physical job', mult: 1.9 },
]

const FITNESS_GOAL_OPTIONS = [
  { key: 'lose', label: 'Lose Weight', adj: -500 },
  { key: 'maintain', label: 'Maintain', adj: 0 },
  { key: 'gain', label: 'Gain Muscle', adj: 300 },
]

function calculateGoals(age: number, gender: string, heightCm: number, weightKg: number, activityLevel: string, fitnessGoal: string) {
  // Mifflin-St Jeor BMR
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'male' ? 5 : -161)
  const activity = ACTIVITY_OPTIONS.find(a => a.key === activityLevel)
  const tdee = bmr * (activity?.mult ?? 1.55)
  const goalAdj = FITNESS_GOAL_OPTIONS.find(g => g.key === fitnessGoal)?.adj ?? 0
  const calories = Math.round(tdee + goalAdj)
  const weightLbs = weightKg / 0.453592
  const proteinPerLb = fitnessGoal === 'lose' ? 1.2 : fitnessGoal === 'maintain' ? 1.0 : 0.8
  const protein = Math.round(weightLbs * proteinPerLb)
  return { calories, protein }
}

const FT_OPTIONS = ['3 ft', '4 ft', '5 ft', '6 ft', '7 ft']
const IN_OPTIONS = Array.from({ length: 12 }, (_, i) => `${i} in`)
const LB_OPTIONS = Array.from({ length: 321 }, (_, i) => `${80 + i} lb`) // 80 to 400 lbs
// Metric
const CM_MIN = 100
const CM_OPTIONS = Array.from({ length: 121 }, (_, i) => `${CM_MIN + i} cm`) // 100 to 220 cm
const KG_MIN = 35
const KG_OPTIONS = Array.from({ length: 166 }, (_, i) => `${KG_MIN + i} kg`) // 35 to 200 kg

// Conversion helpers
const ftInToCm = (ft: number, inches: number) => Math.round((ft * 12 + inches) * 2.54)
const cmToFtIn = (cm: number) => {
  const totalInches = cm / 2.54
  const ft = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches - ft * 12)
  // Handle rounding overflow (e.g., 11.5in → 12in → carry to next ft)
  if (inches === 12) return { ft: ft + 1, inches: 0 }
  return { ft, inches }
}
const lbToKg = (lb: number) => Math.round(lb * 0.453592)
const kgToLb = (kg: number) => Math.round(kg / 0.453592)

function S4AboutYou({
  ft,
  inches,
  weight,
  onFt,
  onInches,
  onWeight,
  onNext,
  onBack,
}: {
  ft: string
  inches: string
  weight: string
  onFt: (v: string) => void
  onInches: (v: string) => void
  onWeight: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  const [unit, setUnit] = useState<'imperial' | 'metric'>('imperial')

  // Current imperial values (with defaults)
  const currentFt = parseInt(ft || '5', 10)
  const currentIn = parseInt(inches || '9', 10)
  const currentLb = parseInt(weight || '180', 10)

  // Derived metric values for display
  const currentCm = ftInToCm(currentFt, currentIn)
  const currentKg = lbToKg(currentLb)

  // Indices for wheel pickers
  const ftIndex = Math.max(0, Math.min(FT_OPTIONS.length - 1, currentFt - 3))
  const inIndex = Math.max(0, Math.min(11, currentIn))
  const lbIndex = Math.max(0, Math.min(LB_OPTIONS.length - 1, currentLb - 80))
  const cmIndex = Math.max(0, Math.min(CM_OPTIONS.length - 1, currentCm - CM_MIN))
  const kgIndex = Math.max(0, Math.min(KG_OPTIONS.length - 1, currentKg - KG_MIN))

  // When metric changes, convert back to imperial for storage
  const handleCmChange = (i: number) => {
    const newCm = CM_MIN + i
    const { ft: newFt, inches: newIn } = cmToFtIn(newCm)
    onFt(String(newFt))
    onInches(String(newIn))
  }
  const handleKgChange = (i: number) => {
    const newKg = KG_MIN + i
    onWeight(String(kgToLb(newKg)))
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[6]} />
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        <Text style={[s.title, { marginTop: 16 }]}>Height & weight</Text>
        <Text style={s.subtitle}>This will be used to calibrate your custom plan</Text>

        {/* Imperial / Metric toggle */}
        <View style={unitToggle.track}>
          <TouchableOpacity
            style={[unitToggle.tab, unit === 'imperial' && unitToggle.tabActive]}
            onPress={() => setUnit('imperial')}
            activeOpacity={0.8}
          >
            <Text style={[unitToggle.tabText, unit === 'imperial' && unitToggle.tabTextActive]}>Imperial</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[unitToggle.tab, unit === 'metric' && unitToggle.tabActive]}
            onPress={() => setUnit('metric')}
            activeOpacity={0.8}
          >
            <Text style={[unitToggle.tabText, unit === 'metric' && unitToggle.tabTextActive]}>Metric</Text>
          </TouchableOpacity>
        </View>

        {unit === 'imperial' ? (
          <View style={wheel.pickerGroup}>
            <View style={wheel.pickerColumn}>
              <Text style={wheel.pickerLabel}>Height</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <WheelPicker
                  key="ft"
                  data={FT_OPTIONS}
                  selectedIndex={ftIndex}
                  onChange={(i) => onFt(String(i + 3))}
                  width={80}
                />
                <WheelPicker
                  key="in"
                  data={IN_OPTIONS}
                  selectedIndex={inIndex}
                  onChange={(i) => onInches(String(i))}
                  width={80}
                />
              </View>
            </View>
            <View style={wheel.pickerColumn}>
              <Text style={wheel.pickerLabel}>Weight</Text>
              <WheelPicker
                key="lb"
                data={LB_OPTIONS}
                selectedIndex={lbIndex}
                onChange={(i) => onWeight(String(80 + i))}
                width={96}
              />
            </View>
          </View>
        ) : (
          <View style={wheel.pickerGroup}>
            <View style={wheel.pickerColumn}>
              <Text style={wheel.pickerLabel}>Height</Text>
              <WheelPicker
                key="cm"
                data={CM_OPTIONS}
                selectedIndex={cmIndex}
                onChange={handleCmChange}
                width={104}
              />
            </View>
            <View style={wheel.pickerColumn}>
              <Text style={wheel.pickerLabel}>Weight</Text>
              <WheelPicker
                key="kg"
                data={KG_OPTIONS}
                selectedIndex={kgIndex}
                onChange={handleKgChange}
                width={96}
              />
            </View>
          </View>
        )}
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
      </View>
    </SafeAreaView>
  )
}

const unitToggle = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    padding: 4,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 4,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 26,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: MUTED,
  },
  tabTextActive: {
    color: '#000000',
  },
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1))
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 90 }, (_, i) => String(CURRENT_YEAR - 13 - i)) // 13 to 102 years old

function computeAge(birthday: string): number {
  if (!birthday) return 0
  const [y, m, d] = birthday.split('-').map(n => parseInt(n, 10))
  if (!y || !m || !d) return 0
  const today = new Date()
  let age = today.getFullYear() - y
  const hasHadBirthday = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d)
  if (!hasHadBirthday) age -= 1
  return age
}

function S5Birthday({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  // Parse existing value (format YYYY-MM-DD) or default
  const parsed = value ? value.split('-') : []
  const initialYear = parsed[0] || String(CURRENT_YEAR - 25)
  const initialMonth = parsed[1] ? parseInt(parsed[1], 10) - 1 : 0
  const initialDay = parsed[2] ? parseInt(parsed[2], 10) - 1 : 0

  const monthIdx = Math.max(0, Math.min(11, initialMonth))
  const dayIdx = Math.max(0, Math.min(30, initialDay))
  const yearIdx = Math.max(0, YEARS.indexOf(initialYear))

  const update = (m: number, d: number, y: number) => {
    const yearStr = YEARS[y]
    const monthStr = String(m + 1).padStart(2, '0')
    const dayStr = String(d + 1).padStart(2, '0')
    onChange(`${yearStr}-${monthStr}-${dayStr}`)
  }

  const age = computeAge(value)
  const underage = value !== '' && age < 13

  const handleContinue = () => {
    if (underage) {
      Alert.alert(
        'Age restriction',
        'You must be at least 13 years old to use Pantry.',
        [{ text: 'OK' }]
      )
      return
    }
    onNext()
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[7]} />
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        <Text style={[s.title, { marginTop: 16 }]}>When were you born?</Text>
        <Text style={s.subtitle}>Used to calibrate your plan. You must be 13 or older to use Pantry.</Text>

        <View style={[wheel.pickerGroup, { justifyContent: 'center', marginTop: 40 }]}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <WheelPicker
              data={MONTHS}
              selectedIndex={monthIdx}
              onChange={(i) => update(i, dayIdx, yearIdx >= 0 ? yearIdx : 0)}
              width={108}
            />
            <WheelPicker
              data={DAYS}
              selectedIndex={dayIdx}
              onChange={(i) => update(monthIdx, i, yearIdx >= 0 ? yearIdx : 0)}
              width={60}
            />
            <WheelPicker
              data={YEARS}
              selectedIndex={yearIdx >= 0 ? yearIdx : 12} // default ~25 yr old
              onChange={(i) => update(monthIdx, dayIdx, i)}
              width={80}
            />
          </View>
        </View>

        {underage && (
          <Text style={{ fontSize: 14, color: '#EF4444', textAlign: 'center', marginTop: 24, fontWeight: '600' }}>
            You must be at least 13 to continue.
          </Text>
        )}
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={handleContinue} disabled={underage} />
      </View>
    </SafeAreaView>
  )
}

const wheel = StyleSheet.create({
  pickerGroup: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 20,
    marginTop: 20,
  },
  pickerColumn: {
    alignItems: 'center',
    gap: 10,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
})

const MEALS_OPTIONS = ['1', '2', '3', '4', '5', '6']
const PREP_OPTIONS = ['10 min', '20 min', '30 min', '60+ min']
const DIET_STYLES = ['Classic', 'Pescatarian', 'Vegetarian', 'Vegan']
const ALLERGY_OPTIONS = ['Dairy-free', 'Gluten-free', 'Nut-free', 'Shellfish-free']

const SKILL_OPTIONS = [
  { id: 'minimal', Icon: Zap, iconColor: TEAL, label: 'Minimal', sub: 'Quick and easy — microwave & assemble' },
  { id: 'moderate', Icon: ChefHat, iconColor: '#F59E0B', label: 'Moderate', sub: 'I can follow a recipe no problem' },
  { id: 'adventurous', Icon: Flame, iconColor: '#EF4444', label: 'Adventurous', sub: 'I love trying new dishes' },
  { id: 'culinary', Icon: UtensilsCrossed, iconColor: '#A78BFA', label: 'Culinary', sub: 'Multi-step, long cooks, chef moves' },
]

function SCookingSkill({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[10]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>How comfortable are you cooking?</Text>
        <Text style={s.subtitle}>We'll match recipes to your skill level</Text>
        <View style={s.cardList}>
          {SKILL_OPTIONS.map(o => (
            <TouchableOpacity key={o.id} style={[s.selectCard, value === o.id && s.selectCardActive]} onPress={() => onChange(o.id)} activeOpacity={0.8}>
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <o.Icon size={26} stroke={o.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{o.label}</Text>
                <Text style={s.selectCardSub}>{o.sub}</Text>
              </View>
              {value === o.id && <View style={s.checkCircle}><Check size={12} stroke="#000000" strokeWidth={3} /></View>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

function SMealCadence({
  meals, prep, onMeals, onPrep, onNext, onBack,
}: {
  meals: string; prep: string
  onMeals: (v: string) => void; onPrep: (v: string) => void
  onNext: () => void; onBack: () => void
}) {
  const pulse = useRef(new Animated.Value(0)).current
  const rotate = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
        Animated.timing(rotate, { toValue: 1, duration: 8000, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.3] })
  const rotateInterp = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[11]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Your daily rhythm</Text>
        <Text style={s.subtitle}>How many meals, how long to cook</Text>

        <View style={{ alignItems: 'center', marginVertical: 20 }}>
          <Animated.View style={{
            width: 110, height: 110, borderRadius: 55, backgroundColor: '#111',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: 'rgba(74,222,128,0.2)',
            transform: [{ scale }],
            shadowColor: TEAL, shadowOffset: { width: 0, height: 0 }, shadowOpacity: glow as any, shadowRadius: 24,
          }}>
            <Animated.View style={{ transform: [{ rotate: rotateInterp }] }}>
              <Clock size={44} stroke={TEAL} strokeWidth={1.6} />
            </Animated.View>
          </Animated.View>
        </View>

        <Text style={s.prefSection}>Meals per day</Text>
        <View style={s.pillRow}>
          {MEALS_OPTIONS.map(o => (
            <TouchableOpacity key={o} style={[s.prefPill, meals === o && s.prefPillActive]} onPress={() => onMeals(o)} activeOpacity={0.8}>
              <Text style={[s.prefPillText, meals === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.prefSection}>Max prep time per meal</Text>
        <View style={s.pillRow}>
          {PREP_OPTIONS.map(o => (
            <TouchableOpacity key={o} style={[s.prefPill, prep === o && s.prefPillActive]} onPress={() => onPrep(o)} activeOpacity={0.8}>
              <Text style={[s.prefPillText, prep === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
      </View>
    </SafeAreaView>
  )
}

const DIET_STYLE_CARDS = [
  { id: 'Classic', Icon: Drumstick, iconColor: '#F59E0B', bg: 'rgba(245,158,11,0.15)', label: 'Classic', sub: 'Meat, fish, and all foods' },
  { id: 'Pescatarian', Icon: Fish, iconColor: '#60A5FA', bg: 'rgba(96,165,250,0.15)', label: 'Pescatarian', sub: 'Seafood but no meat' },
  { id: 'Vegetarian', Icon: Salad, iconColor: '#4ADE80', bg: 'rgba(74,222,128,0.15)', label: 'Vegetarian', sub: 'No meat or fish' },
  { id: 'Vegan', Icon: Sprout, iconColor: '#00C9A7', bg: 'rgba(0,201,167,0.15)', label: 'Vegan', sub: 'Plant-based only' },
]

function SDietStyle({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[12]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Which diet fits you?</Text>
        <Text style={s.subtitle}>We'll only suggest meals that match</Text>
        <View style={s.cardList}>
          {DIET_STYLE_CARDS.map(o => (
            <TouchableOpacity key={o.id} style={[s.selectCard, value === o.id && s.selectCardActive]} onPress={() => onChange(o.id)} activeOpacity={0.8}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: o.bg, alignItems: 'center', justifyContent: 'center' }}>
                <o.Icon size={28} stroke={o.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{o.label}</Text>
                <Text style={s.selectCardSub}>{o.sub}</Text>
              </View>
              {value === o.id && <View style={s.checkCircle}><Check size={12} stroke="#000000" strokeWidth={3} /></View>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} variant="white" disabled={!value} />
      </View>
    </SafeAreaView>
  )
}

function SAllergies({
  foodDislikes, foodDislikesText,
  onFoodDislikes, onFoodDislikesText,
  onNext, onBack,
}: {
  foodDislikes: string[]; foodDislikesText: string
  onFoodDislikes: (v: string[]) => void; onFoodDislikesText: (v: string) => void
  onNext: () => void; onBack: () => void
}) {
  const shieldPulse = useRef(new Animated.Value(0)).current
  const dislikesInputRef = useRef<any>(null)
  const [inputText, setInputText] = useState('')

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shieldPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(shieldPulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  const scale = shieldPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })
  const ringOpacity = shieldPulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0] })
  const ringScale = shieldPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] })

  // Custom chips typed in the text field — stored as comma-separated in foodDislikesText
  const customChips = foodDislikesText
    ? foodDislikesText.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const toggleDislike = (chip: string) => {
    onFoodDislikes(foodDislikes.includes(chip) ? foodDislikes.filter(c => c !== chip) : [...foodDislikes, chip])
  }

  const addCustomChip = () => {
    const trimmed = inputText.trim()
    if (!trimmed) return
    const updated = [...customChips, trimmed]
    onFoodDislikesText(updated.join(', '))
    setInputText('')
  }

  const removeCustomChip = (chip: string) => {
    const updated = customChips.filter(c => c !== chip)
    onFoodDislikesText(updated.join(', '))
  }

  // Active predefined chips float to top-left; inactive stay below
  const activePredefined = DISLIKE_CHIPS.filter(c => foodDislikes.includes(c))
  const inactivePredefined = DISLIKE_CHIPS.filter(c => !foodDislikes.includes(c))

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[13]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{
                position: 'absolute', width: 84, height: 84, borderRadius: 42,
                borderWidth: 2, borderColor: TEAL,
                transform: [{ scale: ringScale }], opacity: ringOpacity,
              }} />
              <Animated.View style={{
                width: 64, height: 64, borderRadius: 32, backgroundColor: '#111',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: 'rgba(74,222,128,0.3)',
                transform: [{ scale }],
              }}>
                <ShieldCheck size={30} stroke={TEAL} strokeWidth={1.8} />
              </Animated.View>
            </View>
          </View>

          <Text style={[s.title, { textAlign: 'center' }]}>Anything to avoid?</Text>
          <Text style={[s.subtitle, { textAlign: 'center' }]}>Tap anything we should skip in your meals</Text>

          <View style={s.dietGrid}>
            {/* Active predefined chips — float to top-left */}
            {activePredefined.map(chip => (
              <TouchableOpacity key={chip} style={[s.dietPill, s.dietPillActive]} onPress={() => toggleDislike(chip)} activeOpacity={0.8}>
                <Text style={[s.dietPillText, s.dietPillTextActive]}>{chip}</Text>
              </TouchableOpacity>
            ))}
            {/* Custom typed chips — always green, tap to remove */}
            {customChips.map(chip => (
              <TouchableOpacity key={`custom-${chip}`} style={[s.dietPill, s.dietPillActive]} onPress={() => removeCustomChip(chip)} activeOpacity={0.8}>
                <Text style={[s.dietPillText, s.dietPillTextActive]}>{chip} ✕</Text>
              </TouchableOpacity>
            ))}
            {/* Inactive predefined chips below */}
            {inactivePredefined.map(chip => (
              <TouchableOpacity key={chip} style={s.dietPill} onPress={() => toggleDislike(chip)} activeOpacity={0.8}>
                <Text style={s.dietPillText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Pressable style={[s.inputCard, { marginTop: 20 }]} onPress={() => dislikesInputRef.current?.focus()}>
            <Text style={s.inputLabel}>Anything else?</Text>
            <TextInput
              ref={dislikesInputRef}
              style={[s.input, { fontSize: 16, paddingVertical: 10 }]}
              placeholder="e.g. Mushrooms, Cilantro"
              placeholderTextColor="#888888"
              value={inputText}
              onChangeText={setInputText}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={addCustomChip}
            />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
      </View>
    </SafeAreaView>
  )
}


function SReferralCode({
  value, onChange, onNext, onBack,
}: {
  value: string; onChange: (v: string) => void
  onNext: () => void; onBack: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [valid, setValid] = useState(false)

  // Reset validity state if the code changes
  useEffect(() => {
    setValid(false)
    setError(null)
  }, [value])

  const handleContinue = async () => {
    // Empty = skip, allow pass-through
    if (!value.trim()) {
      onChange('')
      onNext()
      return
    }
    if (checking) return
    setChecking(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('validate_referral_code', { p_code: value })
      if (rpcError) throw rpcError
      if (data === true) {
        setValid(true)
        // Brief visual confirmation, then advance
        setTimeout(onNext, 450)
      } else {
        setError("That code isn't valid")
        setValid(false)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Try again.')
    } finally {
      setChecking(false)
    }
  }

  const handleSkip = () => {
    onChange('')
    onNext()
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[14]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 28 }}>
            <View style={{
              width: 84, height: 84, borderRadius: 42, backgroundColor: '#111',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: valid ? TEAL : 'rgba(74,222,128,0.25)',
            }}>
              {valid
                ? <Check size={40} stroke={TEAL} strokeWidth={2.5} />
                : <Sparkles size={36} stroke={TEAL} strokeWidth={1.8} />}
            </View>
          </View>

          <Text style={[s.title, { textAlign: 'center' }]}>Have a referral code?</Text>
          <Text style={[s.subtitle, { textAlign: 'center' }]}>Enter one to unlock a special offer</Text>

          <View style={[s.inputCard, { marginTop: 8, borderWidth: error ? 1 : 0, borderColor: error ? '#EF4444' : 'transparent' }]}>
            <Text style={s.inputLabel}>Referral code</Text>
            <TextInput
              style={[s.input, { fontSize: 20, letterSpacing: 2, fontWeight: '700' }]}
              placeholder="PANTRY20"
              placeholderTextColor="#444444"
              value={value}
              onChangeText={(t) => onChange(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              editable={!checking && !valid}
            />
          </View>

          {error && (
            <Text style={{ fontSize: 13, color: '#EF4444', textAlign: 'center', marginTop: 12, fontWeight: '600' }}>
              {error}
            </Text>
          )}
          {valid && (
            <Text style={{ fontSize: 13, color: TEAL, textAlign: 'center', marginTop: 12, fontWeight: '600' }}>
              Code applied! ✨
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label={checking ? 'Checking…' : valid ? 'Applied' : 'Continue'} onPress={handleContinue} disabled={checking} />
        <TouchableOpacity style={s.textLink} onPress={handleSkip} activeOpacity={0.7} disabled={checking}>
          <Text style={s.textLinkText}>Skip — I don't have a code</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function SGeneratingIntro({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const fadeIn = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.92)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start()
  }, [])

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[15]} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Animated.View style={{ alignItems: 'center', opacity: fadeIn, transform: [{ scale }] }}>
          <View style={{
            width: 140, height: 140, borderRadius: 70, backgroundColor: '#111',
            alignItems: 'center', justifyContent: 'center', marginBottom: 36,
            borderWidth: 2, borderColor: 'rgba(74,222,128,0.2)',
          }}>
            <Sparkles size={56} stroke={TEAL} strokeWidth={1.6} fill={TEAL} fillOpacity={0.15 as any} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={12} stroke="#000" strokeWidth={3} />
            </View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#F59E0B' }}>All done!</Text>
          </View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#FFF', textAlign: 'center', letterSpacing: -0.5, lineHeight: 38 }}>
            Time to generate{'\n'}your custom plan
          </Text>
          <Text style={{ fontSize: 15, color: MUTED, textAlign: 'center', marginTop: 14, lineHeight: 22 }}>
            We'll tailor everything to your goals, diet, and schedule.
          </Text>
        </Animated.View>
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
      </View>
    </SafeAreaView>
  )
}

function SPlanLoading({ data, onDone }: { data: OnboardingData; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current
  const [pct, setPct] = useState(0)
  const [msgIdx, setMsgIdx] = useState(0)

  const messages = [
    'Estimating your metabolic age...',
    'Calculating your daily macros...',
    'Optimizing for your preferences...',
    'Finalizing your custom plan...',
  ]

  useEffect(() => {
    const listener = progress.addListener(({ value }) => setPct(Math.round(value * 100)))
    const anim = Animated.timing(progress, { toValue: 1, duration: 4200, useNativeDriver: false })
    anim.start(({ finished }) => { if (finished) setTimeout(onDone, 300) })

    const msgInterval = setInterval(() => {
      setMsgIdx(i => Math.min(i + 1, messages.length - 1))
    }, 1050)

    // Generate personalized meals silently in the background while the animation plays.
    // The 4.2s animation masks the ~2-4s API call. Result stored in AsyncStorage so
    // SPlanReveal and the home screen both read it immediately on mount.
    ;(async () => {
      try {
        const heightCm = (parseInt(data.ft || '5') * 12 + parseInt(data.inches || '9')) * 2.54
        const weightKg = parseFloat(data.weight || '180') * 0.453592
        const parsedAge = parseInt(data.age) || 25
        const fitness = data.fitnessGoal || (data.goal === 'lose' ? 'lose' : data.goal === 'build' ? 'gain' : 'maintain')
        const goals = calculateGoals(parsedAge, data.gender || 'male', heightCm, weightKg, data.activityLevel || 'moderate', fitness)
        const prepMaxMin = data.prep === '10 min' ? 10 : data.prep === '20 min' ? 20 : data.prep === '60+ min' ? 90 : 30
        const foodDislikes = [
          ...(data.foodDislikes || []),
          ...(data.foodDislikesText || '').split(',').map(s => s.trim()).filter(Boolean),
        ]
        const meals = await generateMeals({
          ingredients: [
            'chicken breast', 'ground beef', 'eggs', 'rice', 'pasta',
            'olive oil', 'butter', 'garlic', 'onion', 'salt', 'black pepper',
            'soy sauce', 'hot sauce', 'lemon', 'lime', 'Italian seasoning',
            'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili flakes',
            'tomato sauce', 'chicken broth', 'parmesan cheese', 'broccoli', 'spinach',
          ],
          calorieGoal: goals.calories,
          proteinGoal: goals.protein,
          mealsPerDay: parseInt(data.meals) || 3,
          cookingSkill: data.cookingSkill || 'moderate',
          maxPrepMinutes: prepMaxMin,
          dietaryRestrictions: data.dietStyle && data.dietStyle !== 'Classic' ? [data.dietStyle] : [],
          foodDislikes,
          mode: 'cookNow',
        })
        const today = new Date().toISOString().slice(0, 10)
        await AsyncStorage.setItem('pantry_daily_meals_cookNow', JSON.stringify({ date: today, meals }))
      } catch {}
    })()

    return () => {
      progress.removeListener(listener)
      anim.stop()
      clearInterval(msgInterval)
    }
  }, [])

  const widthInterp = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })

  return (
    <SafeAreaView style={s.safe}>
      <View style={{ flex: 1, paddingHorizontal: 32, paddingTop: 80 }}>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Text style={{ fontSize: 72, fontWeight: '800', color: '#FFF', letterSpacing: -2 }}>{pct}%</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFF', textAlign: 'center', letterSpacing: -0.5, marginTop: 8, lineHeight: 30 }}>
            We're setting everything{'\n'}up for you
          </Text>
        </View>

        <View style={{ height: 8, backgroundColor: '#1A1A1A', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
          <Animated.View style={{ width: widthInterp, height: '100%', backgroundColor: TEAL, borderRadius: 4 }} />
        </View>

        <Text style={{ fontSize: 15, color: MUTED, textAlign: 'center', marginBottom: 48 }}>
          {messages[msgIdx]}
        </Text>

        <View style={{ marginTop: 24 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF', marginBottom: 16 }}>Daily recommendation for</Text>
          {[
            { label: 'Calories', done: pct > 20 },
            { label: 'Protein', done: pct > 45 },
            { label: 'Carbs', done: pct > 65 },
            { label: 'Fats', done: pct > 80 },
            { label: 'Meal schedule', done: pct > 95 },
          ].map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
              <Text style={{ fontSize: 15, color: item.done ? '#FFF' : MUTED }}>• {item.label}</Text>
              {item.done ? (
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={13} stroke="#000" strokeWidth={3} />
                </View>
              ) : (
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#2A2A2A' }} />
              )}
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

// Recomposition graph for "maintain" goal — fat curves down, muscle curves up, both animate L→R.
function MaintainGraph() {
  const W = 300, H = 140
  const pad = { top: 38, right: 28, bottom: 34, left: 28 }
  const iW = W - pad.left - pad.right
  const iH = H - pad.top - pad.bottom
  const xS = pad.left, xE = pad.left + iW
  const yT = pad.top, yB = pad.top + iH
  const yM = (yT + yB) / 2

  // S-curves: fat goes top-left → bottom-right, muscle goes bottom-left → top-right
  const fatPath    = `M ${xS} ${yT} C ${xS + iW * 0.45} ${yT}, ${xS + iW * 0.55} ${yB}, ${xE} ${yB}`
  const musclePath = `M ${xS} ${yB} C ${xS + iW * 0.45} ${yB}, ${xS + iW * 0.55} ${yT}, ${xE} ${yT}`

  const LEN = 290
  const anim = useRef(new Animated.Value(0)).current
  const [off, setOff] = useState(LEN)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const l = anim.addListener(({ value }) => {
      setOff((1 - value) * LEN)
      if (value >= 0.98 && !done) setDone(true)
    })
    Animated.timing(anim, {
      toValue: 1, duration: 1400, delay: 200,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start()
    return () => anim.removeListener(l)
  }, [])

  const AMBER = '#D4A855'

  return (
    <View style={{ alignItems: 'center', width: '100%' }}>
      <Svg width={W} height={H}>
        {/* Subtle fills */}
        <Path d={`${fatPath} L ${xE} ${yM} L ${xS} ${yM} Z`} fill={AMBER} fillOpacity={0.08} />
        <Path d={`${musclePath} L ${xE} ${yM} L ${xS} ${yM} Z`} fill={TEAL} fillOpacity={0.08} />

        {/* Fat line — amber, top-left → bottom-right */}
        <Path d={fatPath} stroke={AMBER} strokeWidth={2.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${LEN}`} strokeDashoffset={off} />
        {/* Muscle line — teal, bottom-left → top-right */}
        <Path d={musclePath} stroke={TEAL} strokeWidth={2.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${LEN}`} strokeDashoffset={off} />

        {/* Start dots */}
        <SvgCircle cx={xS} cy={yT} r={5} fill="#1A1A1A" stroke={AMBER} strokeWidth={2} />
        <SvgCircle cx={xS} cy={yB} r={5} fill="#1A1A1A" stroke={TEAL} strokeWidth={2} />
        {/* End dots */}
        {done && <SvgCircle cx={xE} cy={yB} r={6} fill={AMBER} />}
        {done && <SvgCircle cx={xE} cy={yT} r={6} fill={TEAL} />}

        {/* Left labels */}
        <SvgText x={xS + 10} y={yT - 16} fill={AMBER} fontSize="9" fontWeight="700" textAnchor="start">FAT</SvgText>
        <SvgText x={xS + 10} y={yB + 20} fill={TEAL}  fontSize="9" fontWeight="700" textAnchor="start">MUSCLE</SvgText>

        {/* Right labels */}
        <SvgText x={xE - 10} y={yT - 16} fill={TEAL}  fontSize="9" fontWeight="700" textAnchor="end">↑ MORE</SvgText>
        <SvgText x={xE - 10} y={yB + 20} fill={AMBER} fontSize="9" fontWeight="700" textAnchor="end">↓ LESS</SvgText>
      </Svg>
    </View>
  )
}

// Ring visual matching home-screen calorie gauge, used on Plan Reveal for cal + protein targets
// Trajectory graph — smooth cubic-bezier curve from current weight to target.
// Animates in left-to-right on mount via strokeDashoffset.
function TrajectoryGraph({
  currentLb, targetLb, startLabel = 'Today', endLabel,
}: {
  currentLb: number; targetLb: number; startLabel?: string; endLabel: string
}) {
  const width = 300
  const height = 130
  const pad = { top: 32, right: 24, bottom: 28, left: 24 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  const isGain = targetLb > currentLb
  const isSame = targetLb === currentLb
  const yStart = isSame ? pad.top + innerH / 2 : isGain ? pad.top + innerH : pad.top
  const yEnd = isSame ? pad.top + innerH / 2 : isGain ? pad.top : pad.top + innerH
  const xStart = pad.left
  const xEnd = pad.left + innerW

  // Smooth cubic bezier — control points create a soft S-curve
  const c1x = xStart + innerW * 0.45
  const c1y = yStart
  const c2x = xStart + innerW * 0.55
  const c2y = yEnd
  const pathD = `M ${xStart} ${yStart} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xEnd} ${yEnd}`

  const LEN = 380 // approximate path length; dashOffset animates from LEN to 0
  const progress = useRef(new Animated.Value(0)).current
  const [dashOff, setDashOff] = useState(LEN)
  const [endReached, setEndReached] = useState(false)

  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      setDashOff((1 - value) * LEN)
      if (value >= 0.98 && !endReached) setEndReached(true)
    })
    Animated.timing(progress, {
      toValue: 1,
      duration: 1400,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
    return () => progress.removeListener(listener)
  }, [])

  return (
    <View style={{ alignItems: 'center', width: '100%' }}>
      <Svg width={width} height={height}>
        {/* Area fill under curve (subtle teal gradient) */}
        <Path
          d={`${pathD} L ${xEnd} ${pad.top + innerH} L ${xStart} ${pad.top + innerH} Z`}
          fill={TEAL}
          fillOpacity={0.08}
        />
        {/* Trajectory line */}
        <Path
          d={pathD}
          stroke={TEAL}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${LEN}`}
          strokeDashoffset={dashOff}
        />
        {/* Start dot */}
        <SvgCircle cx={xStart} cy={yStart} r={6} fill="#1A1A1A" stroke="#888" strokeWidth={2} />
        {/* End dot — only after animation reaches it */}
        {endReached && <SvgCircle cx={xEnd} cy={yEnd} r={7} fill={TEAL} />}

        {/* Labels */}
        <SvgText x={xStart} y={yStart - 14} fill="#888" fontSize="10" fontWeight="700" textAnchor="start">{startLabel.toUpperCase()}</SvgText>
        <SvgText x={xStart} y={yStart + 22} fill="#FFFFFF" fontSize="15" fontWeight="800" textAnchor="start">{currentLb}</SvgText>

        <SvgText x={xEnd} y={yEnd - 14} fill={TEAL} fontSize="10" fontWeight="700" textAnchor="end">{endLabel.toUpperCase()}</SvgText>
        <SvgText x={xEnd} y={yEnd + 22} fill={TEAL} fontSize="15" fontWeight="800" textAnchor="end">{targetLb}</SvgText>
      </Svg>
    </View>
  )
}

function PlanRing({ value, unit, label, color, delay = 0 }: { value: number; unit?: string; label: string; color: string; delay?: number }) {
  const size = 92
  const strokeWidth = 7
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = useRef(new Animated.Value(0)).current
  const [offset, setOffset] = useState(circumference)

  useEffect(() => {
    progress.setValue(0)
    const listener = progress.addListener(({ value: v }) => setOffset(circumference * (1 - v)))
    Animated.timing(progress, {
      toValue: 1,
      duration: 2400,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
    return () => progress.removeListener(listener)
  }, [])

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <SvgCircle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.10)" strokeWidth={strokeWidth} fill="transparent" />
        <SvgCircle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="transparent"
          strokeDasharray={`${circumference}`} strokeDashoffset={offset} strokeLinecap="round"
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6 }}>
          {value.toLocaleString()}{unit ?? ''}
        </Text>
        <Text style={{ fontSize: 9, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 2 }}>
          {label}
        </Text>
      </View>
    </View>
  )
}

function SPlanReveal({ data, onNext, onBack, isPrefetchOnly = false }: { data: OnboardingData; onNext: () => void; onBack: () => void; isPrefetchOnly?: boolean }) {
  // 5 sections reveal top-to-bottom: heading, trajectory card, macro rings, meal card, disclaimer
  const sectionAnims = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current

  const { cals, prot } = useMemo(() => {
    // Use sensible defaults for any missing onboarding field so Plan Reveal always shows useful numbers
    const heightCm = (parseInt(data.ft || '5') * 12 + parseInt(data.inches || '9')) * 2.54
    const weightKg = parseFloat(data.weight || '180') * 0.453592
    const parsedAge = parseInt(data.age) || 25
    const fitness = data.fitnessGoal || (data.goal === 'lose' ? 'lose' : data.goal === 'build' ? 'gain' : 'maintain')
    const result = calculateGoals(parsedAge, data.gender || 'male', heightCm, weightKg, data.activityLevel || 'moderate', fitness)
    return { cals: result.calories, prot: result.protein }
  }, [data.ft, data.inches, data.weight, data.age, data.gender, data.activityLevel, data.fitnessGoal, data.goal])

  const mealsPerDay = parseInt(data.meals) || 3
  const prepMin = data.prep === '10 min' ? 10 : data.prep === '20 min' ? 20 : data.prep === '60+ min' ? 90 : 30
  const goalLabel = data.goal === 'lose' ? 'Lose Weight' : data.goal === 'gain' ? 'Build Muscle' : 'Maintain'

  useEffect(() => {
    if (isPrefetchOnly) return  // hidden prefetch instance — skip animations
    // Slow top-to-bottom page reveal: 500ms between each section.
    // Meal card (index 3) appears at ~1500ms — enough time for cached images to resolve.
    Animated.stagger(500, sectionAnims.map(anim =>
      Animated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.quad) })
    )).start()
  }, [isPrefetchOnly])

  const calPerMeal = Math.round(cals / mealsPerDay)
  const protPerMeal = Math.round(prot / mealsPerDay)

  // Self-healing weight display: fall back to sane defaults if onboarding data is partial.
  // Also apply goal-based default target when user skipped the target wheel or left it at current.
  const currentLb = parseInt(data.weight || '180', 10)
  const rawTarget = parseInt(data.targetWeight || '0', 10)
  const defaultDelta = data.goal === 'lose' ? -10 : data.goal === 'build' ? 10 : 0
  const targetLb = (rawTarget > 0 && rawTarget !== currentLb)
    ? rawTarget
    : currentLb + defaultDelta
  const hasValidTarget = targetLb !== currentLb
  const weightDelta = hasValidTarget ? Math.abs(targetLb - currentLb) : 0
  const isGainDirection = hasValidTarget && targetLb > currentLb
  const weeksToGoal = weightDelta === 0 ? 0 : isGainDirection ? Math.round(weightDelta * 2) : weightDelta
  let timelineStr = ''
  if (weeksToGoal > 0 && weeksToGoal <= 8) timelineStr = `~${weeksToGoal} weeks`
  else if (weeksToGoal > 0 && weeksToGoal <= 52) timelineStr = `~${Math.round(weeksToGoal / 4.33)} months`
  else if (weeksToGoal > 52) {
    const years = Math.round(weeksToGoal / 52)
    timelineStr = `~${years} ${years === 1 ? 'year' : 'years'}`
  }
  const targetDate = new Date()
  targetDate.setDate(targetDate.getDate() + weeksToGoal * 7)
  const targetDateStr = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // Cooking skill lookup (used in meal header + tailored card)
  const skillOpt = SKILL_OPTIONS.find(o => o.id === data.cookingSkill)

  // Collect user's food exclusions early — used by sampleMeals picker AND header subline
  const customDislikes = data.foodDislikesText
    ? data.foodDislikesText.split(',').map(s => s.trim()).filter(Boolean)
    : []
  const allAvoids = [...(data.foodDislikes || []), ...customDislikes]

  // Sample meals — curated bank of 44 meals across 4 diets.
  // Each recipe is tagged with allergens, actual prep time, and skill level.
  // Strict 4-axis filtering: allergens → dislikes → skill → prep time.
  // Every bench has ≥2 allergen-free options and ≥1 that is also ≤15 min + easy,
  // guaranteeing 3 valid meals even for the pickiest user without relaxing filters.
  type Sample = { name: string; slot: string; Icon: any; tint: string; calPct: number; protPct: number; prepMin: number }
  const sampleMeals = useMemo<Sample[]>(() => {
    type Recipe = { name: string; Icon: any; tint: string; contains: string[]; skill: 'easy' | 'medium' | 'hard'; prepMin: number }

    const recipes: Record<string, Record<string, Recipe[]>> = {
      Classic: {
        Breakfast: [
          { name: 'Scrambled Eggs and Avocado Toast', Icon: Drumstick, tint: '#F59E0B', contains: ['Eggs', 'Gluten', 'Dairy'], skill: 'easy', prepMin: 10 },
          { name: 'High-Protein Overnight Oats', Icon: Sprout, tint: '#F59E0B', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Turkey Sausage and Egg Scramble', Icon: Drumstick, tint: '#F59E0B', contains: ['Eggs'], skill: 'easy', prepMin: 15 },
          { name: 'Tropical Protein Smoothie', Icon: Sprout, tint: '#F59E0B', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Greek Yogurt Parfait with Granola', Icon: Sprout, tint: '#F59E0B', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
        ],
        Lunch: [
          { name: 'Grilled Chicken Rice Bowl', Icon: Drumstick, tint: TEAL, contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Turkey and Avocado Lettuce Wraps', Icon: Drumstick, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Chicken Caesar Salad', Icon: Drumstick, tint: TEAL, contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 10 },
          { name: 'Ground Turkey Taco Bowl', Icon: Drumstick, tint: TEAL, contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Beef and Broccoli Rice Bowl', Icon: Drumstick, tint: TEAL, contains: ['Beef', 'Soy'], skill: 'medium', prepMin: 20 },
        ],
        Dinner: [
          { name: 'Pan-Seared Chicken with Roasted Veggies', Icon: Drumstick, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Lemon Garlic Salmon with Asparagus', Icon: Fish, tint: '#60A5FA', contains: ['Fish'], skill: 'easy', prepMin: 20 },
          { name: 'Herb Roasted Chicken Thighs and Potatoes', Icon: Drumstick, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 35 },
          { name: 'Ground Turkey Pasta with Marinara', Icon: Drumstick, tint: '#60A5FA', contains: ['Gluten'], skill: 'easy', prepMin: 25 },
          { name: 'Grilled Sirloin Steak with Broccoli', Icon: Drumstick, tint: '#60A5FA', contains: ['Beef'], skill: 'medium', prepMin: 20 },
        ],
        Snack: [
          { name: 'Greek Yogurt Parfait with Granola', Icon: Sprout, tint: '#A78BFA', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Hard-Boiled Eggs and Fruit', Icon: Sprout, tint: '#A78BFA', contains: ['Eggs'], skill: 'easy', prepMin: 15 },
          { name: 'Tropical Protein Smoothie', Icon: Sprout, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 5 },
        ],
        'Main Meal': [
          { name: 'Grilled Chicken Rice Bowl', Icon: Drumstick, tint: TEAL, contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Pan-Seared Chicken with Roasted Veggies', Icon: Drumstick, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 20 },
        ],
      },
      Pescatarian: {
        Breakfast: [
          { name: 'Smoked Salmon Bagel with Cream Cheese', Icon: Fish, tint: '#60A5FA', contains: ['Fish', 'Gluten', 'Dairy'], skill: 'easy', prepMin: 10 },
          { name: 'Veggie Egg White Scramble', Icon: Sprout, tint: '#60A5FA', contains: ['Eggs'], skill: 'easy', prepMin: 10 },
          { name: 'Greek Yogurt Protein Oats', Icon: Sprout, tint: '#60A5FA', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Tropical Protein Smoothie', Icon: Sprout, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Avocado Toast with Everything Seasoning', Icon: Sprout, tint: '#60A5FA', contains: ['Gluten'], skill: 'easy', prepMin: 5 },
        ],
        Lunch: [
          { name: 'Tuna Poke Bowl', Icon: Fish, tint: TEAL, contains: ['Fish', 'Soy'], skill: 'easy', prepMin: 15 },
          { name: 'Shrimp Taco Bowl with Rice', Icon: Fish, tint: TEAL, contains: ['Shellfish'], skill: 'easy', prepMin: 20 },
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Salmon and Quinoa Power Bowl', Icon: Fish, tint: TEAL, contains: ['Fish'], skill: 'medium', prepMin: 20 },
          { name: 'Lentil Soup with Crusty Bread', Icon: Salad, tint: TEAL, contains: ['Gluten'], skill: 'easy', prepMin: 25 },
        ],
        Dinner: [
          { name: 'Pan-Seared Salmon with Roasted Broccoli', Icon: Fish, tint: '#60A5FA', contains: ['Fish'], skill: 'easy', prepMin: 20 },
          { name: 'Lemon Garlic Shrimp and Rice', Icon: Fish, tint: '#60A5FA', contains: ['Shellfish'], skill: 'easy', prepMin: 20 },
          { name: 'Baked Cod with Roasted Vegetables', Icon: Fish, tint: '#60A5FA', contains: ['Fish'], skill: 'easy', prepMin: 25 },
          { name: 'Chickpea and Spinach Stir-Fry', Icon: Salad, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Teriyaki Salmon Bowl', Icon: Fish, tint: '#60A5FA', contains: ['Fish', 'Soy'], skill: 'easy', prepMin: 20 },
        ],
        Snack: [
          { name: 'Greek Yogurt Protein Oats', Icon: Sprout, tint: '#A78BFA', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Tropical Protein Smoothie', Icon: Sprout, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 5 },
        ],
        'Main Meal': [
          { name: 'Pan-Seared Salmon with Roasted Broccoli', Icon: Fish, tint: '#60A5FA', contains: ['Fish'], skill: 'easy', prepMin: 20 },
          { name: 'Chickpea and Spinach Stir-Fry', Icon: Salad, tint: '#60A5FA', contains: [], skill: 'easy', prepMin: 20 },
        ],
      },
      Vegetarian: {
        Breakfast: [
          { name: 'Avocado Toast with Poached Eggs', Icon: Sprout, tint: '#F59E0B', contains: ['Eggs', 'Gluten'], skill: 'easy', prepMin: 10 },
          { name: 'Greek Yogurt Protein Oats', Icon: Sprout, tint: '#F59E0B', contains: ['Dairy', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Cottage Cheese Berry Power Bowl', Icon: Sprout, tint: '#F59E0B', contains: ['Dairy'], skill: 'easy', prepMin: 5 },
          { name: 'Coconut Chia Pudding', Icon: Sprout, tint: '#F59E0B', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Veggie Egg White Omelette', Icon: Sprout, tint: '#F59E0B', contains: ['Eggs'], skill: 'medium', prepMin: 15 },
        ],
        Lunch: [
          { name: 'Egg Fried Rice with Veggies', Icon: Sprout, tint: TEAL, contains: ['Eggs', 'Soy'], skill: 'easy', prepMin: 15 },
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Caprese Grain Bowl', Icon: Salad, tint: TEAL, contains: ['Dairy'], skill: 'easy', prepMin: 10 },
          { name: 'Black Bean and Rice Burrito Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Veggie Quinoa Bowl with Feta', Icon: Salad, tint: TEAL, contains: ['Dairy'], skill: 'medium', prepMin: 20 },
        ],
        Dinner: [
          { name: 'Lentil Dal with Basmati Rice', Icon: Salad, tint: '#EF4444', contains: [], skill: 'easy', prepMin: 25 },
          { name: 'Black Bean Taco Bowl', Icon: Salad, tint: '#EF4444', contains: [], skill: 'easy', prepMin: 15 },
          { name: 'Paneer Tikka Masala with Rice', Icon: Salad, tint: '#EF4444', contains: ['Dairy'], skill: 'medium', prepMin: 30 },
          { name: 'Chickpea and Spinach Stir-Fry', Icon: Salad, tint: '#EF4444', contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Baked Stuffed Bell Peppers with Rice and Beans', Icon: Salad, tint: '#EF4444', contains: [], skill: 'medium', prepMin: 35 },
        ],
        Snack: [
          { name: 'Cottage Cheese Berry Power Bowl', Icon: Sprout, tint: '#A78BFA', contains: ['Dairy'], skill: 'easy', prepMin: 5 },
          { name: 'Coconut Chia Pudding', Icon: Sprout, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 10 },
        ],
        'Main Meal': [
          { name: 'Lentil Dal with Basmati Rice', Icon: Salad, tint: '#EF4444', contains: [], skill: 'easy', prepMin: 25 },
          { name: 'Black Bean Taco Bowl', Icon: Salad, tint: '#EF4444', contains: [], skill: 'easy', prepMin: 15 },
        ],
      },
      Vegan: {
        Breakfast: [
          { name: 'Coconut Chia Pudding', Icon: Sprout, tint: '#F59E0B', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Peanut Butter Banana Overnight Oats', Icon: Sprout, tint: '#F59E0B', contains: ['Nuts', 'Gluten'], skill: 'easy', prepMin: 5 },
          { name: 'Tofu Veggie Scramble', Icon: Sprout, tint: '#F59E0B', contains: ['Soy'], skill: 'medium', prepMin: 15 },
          { name: 'Acai Smoothie Bowl', Icon: Sprout, tint: '#F59E0B', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Sweet Potato Toast with Peanut Butter', Icon: Sprout, tint: '#F59E0B', contains: ['Nuts'], skill: 'easy', prepMin: 15 },
          { name: 'Mango Berry Smoothie', Icon: Sprout, tint: '#F59E0B', contains: [], skill: 'easy', prepMin: 5 },
        ],
        Lunch: [
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Black Bean and Rice Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Quinoa and Roasted Veggie Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'medium', prepMin: 25 },
          { name: 'Lentil and Vegetable Soup', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 25 },
          { name: 'Spicy Tofu and Broccoli Bowl', Icon: Sprout, tint: TEAL, contains: ['Soy'], skill: 'medium', prepMin: 20 },
        ],
        Dinner: [
          { name: 'Chickpea and Spinach Stir-Fry', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 20 },
          { name: 'Black Bean Taco Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 15 },
          { name: 'Lentil Sweet Potato Curry', Icon: Salad, tint: TEAL, contains: [], skill: 'medium', prepMin: 30 },
          { name: 'Roasted Veggie and Chickpea Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 25 },
          { name: 'Tofu and Broccoli Stir-Fry with Rice', Icon: Sprout, tint: TEAL, contains: ['Soy'], skill: 'medium', prepMin: 20 },
          { name: 'Black Bean and Corn Power Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 15 },
        ],
        Snack: [
          { name: 'Peanut Butter Banana Smoothie', Icon: Sprout, tint: '#A78BFA', contains: ['Nuts'], skill: 'easy', prepMin: 5 },
          { name: 'Apple with Almond Butter', Icon: Sprout, tint: '#A78BFA', contains: ['Nuts'], skill: 'easy', prepMin: 5 },
          { name: 'Mango Protein Smoothie', Icon: Sprout, tint: '#A78BFA', contains: [], skill: 'easy', prepMin: 5 },
          { name: 'Edamame with Sea Salt', Icon: Sprout, tint: '#A78BFA', contains: ['Soy'], skill: 'easy', prepMin: 5 },
          { name: 'Peanut Butter Apple Slices', Icon: Sprout, tint: '#A78BFA', contains: ['Nuts'], skill: 'easy', prepMin: 5 },
        ],
        'Main Meal': [
          { name: 'Chickpea and Avocado Salad Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 10 },
          { name: 'Black Bean Taco Bowl', Icon: Salad, tint: TEAL, contains: [], skill: 'easy', prepMin: 15 },
        ],
      },
    }

    // Strict recipe picker — filters on all 4 axes simultaneously, deduplicates across slots.
    // Also tracks ingredient theme so "chickpea lunch" never pairs with "chickpea dinner".
    const avoidSet = new Set(allAvoids)
    const userSkill = data.cookingSkill || 'moderate'
    const allowedSkills: Record<string, string[]> = {
      minimal:     ['easy'],
      moderate:    ['easy', 'medium'],
      adventurous: ['easy', 'medium', 'hard'],
    }
    const skillAllowed = allowedSkills[userSkill] ?? ['easy', 'medium']
    const pickedNames = new Set<string>()
    const pickedThemes = new Set<string>()

    const getTheme = (name: string): string => {
      const n = name.toLowerCase()
      if (n.includes('chickpea'))    return 'chickpea'
      if (n.includes('black bean'))  return 'blackbean'
      if (n.includes('lentil'))      return 'lentil'
      if (n.includes('tofu'))        return 'tofu'
      if (n.includes('quinoa'))      return 'quinoa'
      if (n.includes('salmon'))      return 'salmon'
      if (n.includes('chicken'))     return 'chicken'
      if (n.includes('turkey'))      return 'turkey'
      if (n.includes('shrimp'))      return 'shrimp'
      if (n.includes('tuna'))        return 'tuna'
      if (n.includes('egg'))         return 'egg'
      if (n.includes('peanut'))      return 'peanut'
      return n // unique fallback
    }

    const pickRecipe = (bench: Recipe[]): Recipe => {
      const passes = (r: Recipe) =>
        !r.contains.some(c => avoidSet.has(c)) &&
        !customDislikes.some(d => d.length > 2 && r.name.toLowerCase().includes(d.toLowerCase())) &&
        skillAllowed.includes(r.skill) &&
        r.prepMin <= prepMin

      // Pass 1: all filters + no name dup + no theme dup
      let chosen = bench.find(r => !pickedNames.has(r.name) && !pickedThemes.has(getTheme(r.name)) && passes(r))
      // Pass 2: relax theme dedup (at least avoid exact name repeat)
      if (!chosen) chosen = bench.find(r => !pickedNames.has(r.name) && passes(r))
      // Pass 3: just allergen + skill (last resort)
      if (!chosen) chosen = bench.find(r => passes(r))
      if (!chosen) chosen = bench[0]

      pickedNames.add(chosen.name)
      pickedThemes.add(getTheme(chosen.name))
      return chosen
    }

    // Per-count distribution — each column sums to 1.00 exactly
    const distributions: Record<number, Record<string, { calPct: number; protPct: number }>> = {
      1: { 'Main Meal': { calPct: 1.00, protPct: 1.00 } },
      2: {
        Lunch: { calPct: 0.45, protPct: 0.45 },
        Dinner: { calPct: 0.55, protPct: 0.55 },
      },
      3: {
        Breakfast: { calPct: 0.28, protPct: 0.30 },
        Lunch:     { calPct: 0.34, protPct: 0.35 },
        Dinner:    { calPct: 0.38, protPct: 0.35 },
      },
      4: {
        Breakfast: { calPct: 0.24, protPct: 0.25 },
        Lunch:     { calPct: 0.31, protPct: 0.31 },
        Dinner:    { calPct: 0.32, protPct: 0.29 },
        Snack:     { calPct: 0.13, protPct: 0.15 },
      },
    }

    const diet = recipes[data.dietStyle] ? data.dietStyle : 'Classic'
    const count = Math.min(Math.max(parseInt(data.meals) || 3, 1), 4)
    const distro = distributions[count]
    return Object.entries(distro).map(([slot, macro]) => {
      const bench = recipes[diet][slot] ?? []
      const chosen = pickRecipe(bench)
      return {
        slot,
        name: chosen?.name ?? '',
        Icon: chosen?.Icon,
        tint: chosen?.tint ?? TEAL,
        calPct: macro.calPct,
        protPct: macro.protPct,
        prepMin: chosen?.prepMin ?? prepMin,
      }
    })
  }, [data.dietStyle, data.meals, data.goal, data.foodDislikes, data.foodDislikesText, data.cookingSkill, prepMin])

  // AI-generated meals — written to AsyncStorage by SPlanLoading in the background.
  // Use these if ready; fall back to curated sampleMeals (also diet-aware) otherwise.
  const [aiMeals, setAiMeals] = useState<any[]>([])
  useEffect(() => {
    AsyncStorage.getItem('pantry_daily_meals_cookNow').then(raw => {
      if (raw) {
        const parsed = JSON.parse(raw)
        const meals: any[] = parsed?.meals ?? []
        if (meals.length > 0) setAiMeals(meals.slice(0, parseInt(data.meals) || 3))
      }
    }).catch(() => {})
  }, [])

  // Prefer AI-generated meals (personalized); fall back to curated sample if not ready
  const mealsForDisplay = aiMeals.length > 0 ? aiMeals : sampleMeals

  // Load AI-generated images for each meal.
  // Checks device AsyncStorage first (instant), falls back to Supabase edge function (network).
  // Both this screen and the home screen share the same local URL cache key so images are
  // never fetched twice across the entire app lifetime.
  const IMAGE_URL_CACHE_KEY = 'pantry_image_urls_v1'
  const [mealImages, setMealImages] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load whatever is already on device and apply immediately (zero-delay render)
      const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
      const localCache: Record<string, string> = raw ? JSON.parse(raw) : {}

      // Show any already-cached images instantly
      const preloaded: Record<string, string> = {}
      for (const m of mealsForDisplay) {
        if (localCache[m.name]) preloaded[m.name] = localCache[m.name]
      }
      if (!cancelled && Object.keys(preloaded).length > 0) setMealImages(preloaded)

      // Fetch missing ones from edge function, fill in as they arrive.
      // Always write to AsyncStorage even if cancelled (user navigated away) — the home
      // screen needs these URLs cached so it doesn't have to re-fetch.
      const updatedCache = { ...localCache }
      await Promise.all(mealsForDisplay.map(async (m) => {
        if (localCache[m.name]) return // already have it
        try {
          const { data: imgData } = await supabase.functions.invoke('generate-meal-image', {
            body: { mealName: m.name, ingredients: [] },
          })
          if (imgData?.image) {
            updatedCache[m.name] = imgData.image
            // Only update React state if still mounted
            if (!cancelled) setMealImages(prev => ({ ...prev, [m.name]: imgData.image }))
            // Always persist — home screen reads this cache
            AsyncStorage.setItem(IMAGE_URL_CACHE_KEY, JSON.stringify(updatedCache))
          }
        } catch {}
      }))
    })()
    return () => { cancelled = true }
  }, [mealsForDisplay])

  return (
    <SafeAreaView style={s.safe}>
      <TopBar onBack={onBack} pct={PROGRESS[18]} />
      <ScrollView contentContainerStyle={[s.scrollBody, { gap: 20 }]} showsVerticalScrollIndicator={false}>
        {/* Section 0 — Badge + heading */}
        <Animated.View style={{ opacity: sectionAnims[0], transform: [{ translateY: sectionAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={13} stroke="#000" strokeWidth={3} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL, letterSpacing: 0.5 }}>YOUR PLAN IS READY</Text>
          </View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6, lineHeight: 36 }}>
            Here's how you'll{'\n'}
            <Text style={{ color: TEAL }}>
              {data.goal === 'lose' ? 'lose weight' : data.goal === 'build' ? 'build muscle' : 'stay on track'}
            </Text>
          </Text>
        </Animated.View>

        {/* Section 1 — Trajectory card */}
        <Animated.View style={{ opacity: sectionAnims[1], transform: [{ translateY: sectionAnims[1].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Target size={20} stroke={TEAL} strokeWidth={2} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
                {weightDelta > 0
                  ? (isGainDirection ? `Gaining ${weightDelta} lbs` : `Losing ${weightDelta} lbs`)
                  : data.goal === 'maintain'
                    ? 'Maintaining your weight'
                    : data.goal === 'build'
                      ? 'Building muscle'
                      : data.goal === 'lose'
                        ? 'Losing weight'
                        : `Your Goal: ${goalLabel}`}
              </Text>
            </View>
            {hasValidTarget ? (
              <>
                <TrajectoryGraph currentLb={currentLb} targetLb={targetLb} endLabel={targetDateStr} />
                {timelineStr !== '' && (
                  <Text style={{ fontSize: 12, fontWeight: '600', color: MUTED, textAlign: 'center', letterSpacing: 0.3 }}>
                    {timelineStr} · by {targetDateStr}
                  </Text>
                )}
              </>
            ) : (
              <>
                <MaintainGraph />
                <Text style={{ fontSize: 12, fontWeight: '600', color: MUTED, textAlign: 'center', letterSpacing: 0.3 }}>
                  Same weight · better body composition
                </Text>
              </>
            )}
          </View>
        </Animated.View>

        {/* Section 2 — Macro rings */}
        <Animated.View style={{ opacity: sectionAnims[2], transform: [{ translateY: sectionAnims[2].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
              <PlanRing value={cals} label="KCAL/DAY" color={TEAL} delay={400} />
              <PlanRing value={prot} unit="g" label="PROTEIN" color="#60A5FA" delay={600} />
            </View>
          </View>
        </Animated.View>

        {/* Section 3 — Meal plan card (images should be ready by now) */}
        <Animated.View style={{ opacity: sectionAnims[3], transform: [{ translateY: sectionAnims[3].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(74,222,128,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={20} stroke={TEAL} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 }}>
                  {aiMeals.length > 0 ? 'Your first day' : 'Meals made for you'}
                </Text>
                <Text style={{ fontSize: 12, color: MUTED, marginTop: 3, fontWeight: '500' }}>
                  {aiMeals.length > 0 ? 'Generated from your goals' : 'Tailored to your goals'}
                </Text>
              </View>
            </View>
            {mealsForDisplay.map((m, i) => {
              const imageUri = mealImages[m.name]
              const isSwipedMeal = 'calories' in m
              const calDisplay = isSwipedMeal ? (m as any).calories : Math.round(cals * (m as any).calPct)
              const protDisplay = isSwipedMeal ? (m as any).protein : Math.round(prot * (m as any).protPct)
              const prepDisplay = isSwipedMeal ? (m as any).prepTime : (m as any).prepMin
              const SlotIcon = !isSwipedMeal ? (m as any).Icon : null
              const slotTint = !isSwipedMeal ? ((m as any).tint ?? TEAL) : TEAL
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 2 }}>
                  {/* 72×72 image — matches dashboard MealCard exactly */}
                  <View style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: '#242424' }}>
                    {imageUri
                      ? <Image source={{ uri: imageUri }} style={{ width: 72, height: 72 }} resizeMode="cover" />
                      : SlotIcon
                        ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: `${slotTint}22` }}>
                            <SlotIcon size={26} stroke={slotTint} strokeWidth={1.8} />
                          </View>
                        : null
                    }
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    {(m as any).slot && (
                      <Text style={{ fontSize: 11, fontWeight: '700', color: TEAL, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                        {(m as any).slot}
                      </Text>
                    )}
                    {/* Name — matches dashboard mealName style */}
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 }}>{m.name}</Text>
                    {/* Clock row — matches dashboard mealMeta */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Clock size={13} stroke={MUTED} strokeWidth={1.8} />
                      <Text style={{ fontSize: 13, color: MUTED }}>{prepDisplay} min prep</Text>
                    </View>
                    {/* Macros — matches dashboard mealMacros */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 13, color: '#999999' }}>
                        <Text style={{ fontWeight: '700', color: '#FFFFFF' }}>{calDisplay} kcal</Text>
                      </Text>
                      <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#555' }} />
                      <Text style={{ fontSize: 13, color: '#999999' }}>
                        <Text style={{ fontWeight: '700', color: '#FFFFFF' }}>{protDisplay}g</Text>{' Protein'}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </Animated.View>

        {/* Section 4 — Disclaimer */}
        <Animated.View style={{ opacity: sectionAnims[4], transform: [{ translateY: sectionAnims[4].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ borderTopWidth: 1, borderTopColor: '#1A1A1A', paddingTop: 16, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <ShieldCheck size={14} stroke={MUTED} strokeWidth={2} style={{ marginTop: 2 }} />
              <Text style={{ fontSize: 12, color: MUTED, flex: 1, lineHeight: 18 }}>
                Macros calculated using the Mifflin-St Jeor equation — the formula used by registered dietitians and referenced in peer-reviewed nutrition research.
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Let's get started" onPress={onNext} />
      </View>
    </SafeAreaView>
  )
}


function STryFree({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const phoneAnim = useRef(new Animated.Value(0)).current
  const { registerPlacement } = useSuperwall()
  const { refresh: refreshSuperwallUser, getEntitlements } = useUser()
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    Animated.timing(phoneAnim, { toValue: 1, duration: 700, delay: 300, useNativeDriver: true }).start()
  }, [])

  const handleRestore = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      await refreshSuperwallUser()
      const entitlements = await getEntitlements()
      if (entitlements?.active && entitlements.active.length > 0) {
        Alert.alert('Purchases Restored', 'Your subscription is active.', [
          { text: 'OK', onPress: onNext },
        ])
      } else {
        await registerPlacement('restore_purchases')
      }
    } catch (e: any) {
      Alert.alert('Restore Failed', e?.message ?? 'Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={f.root}>
        <TopBar onBack={onBack} pct={PROGRESS[18]} />

        <ScrollView contentContainerStyle={[f.scrollContent, { alignItems: 'center' }]} showsVerticalScrollIndicator={false} bounces={false}>
          {/* Badge */}
          <View style={f.badge}>
            <Text style={f.badgeText}>EXCLUSIVE OFFER</Text>
          </View>

          {/* Headline */}
          <Text style={f.heroTitle}>We want you to try</Text>
          <Text style={f.heroTitleGreen}>Pantry for FREE</Text>
          <Text style={f.heroSub}>
            Unlock your personalized meal plan at no cost. Your kitchen. Your goals. Zero risk.
          </Text>

          {/* Product preview — real home screen frame from the onboarding demo video */}
          <Animated.View style={[f.phonePreview, {
            opacity: phoneAnim,
            transform: [{ translateY: phoneAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
          }]}>
            <Image
              source={require('../../assets/home-screenshot.png')}
              style={f.phonePreviewImage}
              resizeMode="cover"
            />
          </Animated.View>

          <View style={{ height: 110 }} />
        </ScrollView>

        {/* Bottom CTA */}
        <View style={f.bottomArea}>
          <Text style={f.noPaymentNow}>✓ No Payment Due Now</Text>
          <TouchableOpacity style={f.ctaWhite} onPress={onNext} activeOpacity={0.9}>
            <Text style={f.ctaWhiteText}>Try Now</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRestore} activeOpacity={0.7} disabled={restoring}>
            <Text style={f.alreadyPurchased}>
              {restoring ? 'Restoring…' : 'Already purchased?'}
            </Text>
          </TouchableOpacity>
          <Text style={f.priceSubtitle}>Just $2.50/month, billed annually</Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

function STrialReminder({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const fadeIn = useRef(new Animated.Value(0)).current
  const bellScale = useRef(new Animated.Value(0.8)).current
  const bellRotate = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start()
    Animated.spring(bellScale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }).start()

    // Ringing bell: sharp tilt left/right then settle, loop every 2.4s
    const ringSequence = () =>
      Animated.sequence([
        Animated.timing(bellRotate, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: -1, duration: 120, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: 0.6, duration: 100, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: -0.4, duration: 90, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: 0, duration: 80, useNativeDriver: true }),
        Animated.delay(1800),
      ])
    const loop = Animated.loop(ringSequence())
    const startDelay = setTimeout(() => loop.start(), 600)
    return () => { clearTimeout(startDelay); loop.stop() }
  }, [])

  const bellRotateInterp = bellRotate.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-18deg', '18deg'],
  })

  return (
    <SafeAreaView style={s.safe}>
      <View style={f.root}>
        <TopBar onBack={onBack} pct={PROGRESS[19] ?? 93} />

        <ScrollView contentContainerStyle={[f.scrollContent, { alignItems: 'center', paddingTop: 8 }]} showsVerticalScrollIndicator={false} bounces={false}>
          {/* Headline */}
          <Text style={f.reminderTitle}>
            We'll remind you{'\n'}before your <Text style={{ color: TEAL }}>trial ends</Text>
          </Text>

          {/* Bell Icon */}
          <Animated.View style={[f.bellContainer, { transform: [{ scale: bellScale }] }]}>
            <Animated.View style={[f.bellInner, { transform: [{ rotate: bellRotateInterp }] }]}>
              <Bell size={48} stroke={TEAL} strokeWidth={1.8} fill={TEAL} />
            </Animated.View>
            <View style={f.bellBadge} />
          </Animated.View>

          {/* Timeline */}
          <Animated.View style={[f.timeline, { opacity: fadeIn }]}>
            {/* Today */}
            <View style={f.timelineRow}>
              <View style={f.timelineDotActive}>
                <Check size={12} stroke="#000" strokeWidth={3} />
              </View>
              <View>
                <Text style={f.timelineLabel}>Today: Trial Starts</Text>
                <Text style={f.timelineSub}>$0.00 due now</Text>
              </View>
            </View>

            {/* Reminder */}
            <View style={f.timelineRow}>
              <View style={f.timelineDotPending}>
                <View style={f.timelineDotInner} />
              </View>
              <View>
                <Text style={f.timelineLabel}>Before it ends: Reminder</Text>
                <Text style={f.timelineSub}>We'll notify you on your phone</Text>
              </View>
            </View>

            {/* Trial ends */}
            <View style={f.timelineRow}>
              <View style={f.timelineDotFuture} />
              <View>
                <Text style={[f.timelineLabel, { color: '#888' }]}>Trial Ends</Text>
                <Text style={f.timelineSub}>Cancel anytime before</Text>
              </View>
            </View>
          </Animated.View>

          {/* Reassurance */}
          <Text style={f.reassureTitle}>Zero risk. Zero commitment.</Text>
          <Text style={f.reassureSub}>Complete control over your subscription.</Text>

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Bottom CTA */}
        <View style={f.bottomArea}>
          <TouchableOpacity style={f.ctaGreen} onPress={onNext} activeOpacity={0.9}>
            <Text style={f.ctaGreenText}>Try for $0.00</Text>
          </TouchableOpacity>
          <Text style={f.cancelNote}>CANCEL ANYTIME IN SETTINGS</Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

const f = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerLabel: { fontSize: 12, fontWeight: '600', color: '#888', letterSpacing: 2 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 16 },

  // Screen 1 - Try Free
  badge: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', color: TEAL, letterSpacing: 2 },
  heroTitle: { fontSize: 36, fontWeight: '800', color: '#FFF', textAlign: 'center', letterSpacing: -0.5 },
  heroTitleGreen: { fontSize: 36, fontWeight: '800', color: TEAL, textAlign: 'center', letterSpacing: -0.5, marginBottom: 14 },
  heroSub: { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24, marginBottom: 32, paddingHorizontal: 12 },

  // Product demo mockup (legacy — retained for reference; replaced by phonePreview)
  phoneMockup: {
    width: '88%', backgroundColor: '#0A0A0A', borderRadius: 28, borderWidth: 1.5,
    borderColor: '#2A2A2A', padding: 16, overflow: 'hidden', marginBottom: 8,
    shadowColor: TEAL, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 24,
  },

  // Real home-screen preview — screenshot pulled from the onboarding demo video
  phonePreview: {
    width: '80%',
    aspectRatio: 9 / 19.5, // iPhone aspect
    backgroundColor: '#0A0A0A',
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
    alignSelf: 'center',
    marginBottom: 8,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  phonePreviewImage: {
    width: '100%',
    height: '100%',
  },
  demoStatusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingHorizontal: 4 },
  demoTime: { fontSize: 13, fontWeight: '700', color: '#888' },
  demoPills: { flexDirection: 'row', gap: 4 },
  demoPill: { height: 4, borderRadius: 2, backgroundColor: '#333' },
  demoGreeting: { fontSize: 14, color: '#888', fontWeight: '500', paddingHorizontal: 4 },
  demoName: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 16, paddingHorizontal: 4 },
  demoMacroCard: { backgroundColor: '#111', borderRadius: 18, padding: 16, marginBottom: 12 },
  demoRingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  demoRingOuter: {
    width: 90, height: 90, borderRadius: 45, borderWidth: 5, borderColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  demoRingInner: { alignItems: 'center' },
  demoCalNum: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  demoCalLabel: { fontSize: 10, color: '#888', fontWeight: '500' },
  demoMacroCol: { flex: 1, gap: 10 },
  demoMacroItem: { gap: 4 },
  demoMacroBar: { height: 5, backgroundColor: '#222', borderRadius: 3 },
  demoMacroFill: { height: '100%', borderRadius: 3 },
  demoMacroLabel: { fontSize: 11, color: '#999', fontWeight: '600' },
  demoMealCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111',
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  demoMealImg: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(74,222,128,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  demoMealName: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  demoMealMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  demoMealBadge: { backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  demoMealBadgeText: { fontSize: 10, fontWeight: '800', color: TEAL },
  demoFade: {
    height: 40, marginTop: -40,
    backgroundColor: 'transparent',
  },

  // Screen 2 - Reminder
  reminderTitle: { fontSize: 32, fontWeight: '800', color: '#FFF', textAlign: 'center', letterSpacing: -0.5, lineHeight: 40, marginBottom: 28 },
  bellContainer: { position: 'relative', marginBottom: 32 },
  bellInner: { width: 100, height: 100, borderRadius: 28, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', shadowColor: TEAL, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 24 },
  bellBadge: { position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', borderWidth: 3, borderColor: '#1A1A1A' },
  timeline: { width: '100%', backgroundColor: '#111', borderRadius: 24, padding: 24, gap: 28, marginBottom: 28 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  timelineDotActive: { width: 24, height: 24, borderRadius: 12, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  timelineDotPending: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: TEAL, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  timelineDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: TEAL },
  timelineDotFuture: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#444', backgroundColor: '#111', marginTop: 2 },
  timelineLabel: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  timelineSub: { fontSize: 13, color: '#888', marginTop: 2 },
  reassureTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', textAlign: 'center', marginBottom: 6 },
  reassureSub: { fontSize: 14, color: '#888', textAlign: 'center' },

  // Shared bottom
  bottomArea: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingBottom: 36, paddingTop: 16, backgroundColor: '#000' },
  ctaWhite: { backgroundColor: '#FFF', borderRadius: 30, paddingVertical: 18, alignItems: 'center', marginBottom: 16 },
  ctaWhiteText: { fontSize: 17, fontWeight: '800', color: '#000' },
  noPaymentNow: { fontSize: 13, fontWeight: '700', color: TEAL, textAlign: 'center', marginBottom: 14, letterSpacing: 0.3 },
  alreadyPurchased: { fontSize: 13, fontWeight: '500', color: MUTED, textAlign: 'center', marginTop: 4 },
  priceSubtitle: { fontSize: 13, fontWeight: '500', color: MUTED, textAlign: 'center', marginTop: 8 },
  ctaGreen: { backgroundColor: TEAL, borderRadius: 30, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  ctaGreenText: { fontSize: 17, fontWeight: '800', color: '#000' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  verifiedText: { fontSize: 13, color: '#888', fontWeight: '500' },
  cancelNote: { fontSize: 10, fontWeight: '700', color: '#555', textAlign: 'center', letterSpacing: 2 },
})

function S7Paywall({ data, onNext, onBack }: { data: OnboardingData; onNext: () => void; onBack: () => void }) {
  const { registerPlacement } = useSuperwall()
  const { update: updateSuperwallUser } = useUser()
  const purchasedRef = useRef(false)

  useSuperwallEvents({
    onSubscriptionStatusChange: (status) => {
      if (status?.status === 'ACTIVE') purchasedRef.current = true
    },
  })

  useEffect(() => {
    trackPaywallViewed('onboarding')
    const run = async () => {
      // Pass user goal as Superwall attribute so paywall template can personalize copy
      // Reference in dashboard as {{ user.goal_label }} e.g. "Start your {{ user.goal_label }} plan"
      const goalLabel = data.goal === 'lose' ? 'fat-loss' : data.goal === 'build' ? 'muscle-building' : 'maintenance'
      const goalCta = data.goal === 'lose' ? 'Lose Weight' : data.goal === 'build' ? 'Build Muscle' : 'Stay on Track'
      try {
        await updateSuperwallUser({
          goal: data.goal,
          goal_label: goalLabel,
          goal_cta: goalCta,
          referral_code: data.referralCode || null,
          has_referral_code: !!data.referralCode,
        })
      } catch {}

      await registerPlacement('onboarding_paywall')
      if (ABANDONMENT_PAYWALL_ENABLED) {
        // Allow subscription status event to propagate before deciding
        await new Promise(r => setTimeout(r, 400))
        if (!purchasedRef.current) {
          // Abandonment offer (configured in Superwall dashboard as 60% off)
          await registerPlacement('onboarding_paywall_abandonment')
        }
      }
      onNext()
    }
    run()
  }, [])

  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[20]} />
      <View style={s.centerFlex}>
        <TouchableOpacity style={s.textLink} onPress={onNext} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Continue with limited free access</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function S8Complete({ onFinish }: { onFinish: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.centerFlex}>
        <View style={s.completionCircle}><Check size={40} stroke="#000000" strokeWidth={3} /></View>
        <Text style={s.completeTitle}>You are all set!</Text>
        <Text style={s.completeSub}>Your pantry is ready.{'\n'}Let us find your first meal.</Text>
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Lets Go" onPress={onFinish} />
      </View>
    </SafeAreaView>
  )
}

const CUISINE_CARDS = [
  { emoji: '🔥', name: 'Spicy', tagline: 'Bold heat, big flavor' },
  { emoji: '🍜', name: 'Asian', tagline: 'Stir-fries, noodles, rice bowls' },
  { emoji: '🌮', name: 'Mexican', tagline: 'Tacos, bowls, bold spices' },
  { emoji: '🍝', name: 'Italian', tagline: 'Pasta, proteins, comfort food' },
  { emoji: '🥙', name: 'Mediterranean', tagline: 'Fresh, light, olive oil everything' },
  { emoji: '🍔', name: 'American', tagline: 'Burgers, grills, comfort classics' },
  { emoji: '🥗', name: 'Clean & Light', tagline: 'Salads, lean proteins, whole foods' },
  { emoji: '🍱', name: 'Meal Prep', tagline: 'Batch-friendly, repeatable, efficient' },
]

function SCuisineSwipe({ onNext, onBack }: { onNext: (liked: string[]) => void; onBack: () => void }) {
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState<string[]>([])

  const card = CUISINE_CARDS[index]
  const total = CUISINE_CARDS.length

  const handleSkip = () => {
    if (index < total - 1) {
      setIndex(i => i + 1)
    } else {
      onNext(liked)
    }
  }

  const handleLike = () => {
    const newLiked = [...liked, card.name]
    if (index < total - 1) {
      setLiked(newLiked)
      setIndex(i => i + 1)
    } else {
      onNext(newLiked)
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <TopBar onBack={onBack} pct={PROGRESS[13] ?? 63} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 6, textAlign: 'center' }}>
          What cuisines do you love?
        </Text>
        <Text style={{ color: MUTED, fontSize: 14, marginBottom: 32, textAlign: 'center' }}>
          Tap ♥ to like or ✕ to skip
        </Text>

        {/* Card */}
        <View style={{
          width: 300, height: 380,
          backgroundColor: CARD,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.4,
          shadowRadius: 16,
        }}>
          <Text style={{ fontSize: 72, marginBottom: 20 }}>{card.emoji}</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 8 }}>{card.name}</Text>
          <Text style={{ color: MUTED, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 }}>{card.tagline}</Text>
        </View>

        {/* Dot progress */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 32 }}>
          {CUISINE_CARDS.map((_, i) => (
            <View key={i} style={{
              width: i === index ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === index ? '#FFFFFF' : '#444444',
            }} />
          ))}
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 0, width: '100%' }}>
          <TouchableOpacity
            onPress={handleSkip}
            activeOpacity={0.75}
            style={{
              flex: 1,
              backgroundColor: CARD,
              borderRadius: 30,
              paddingVertical: 18,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#333333',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleLike}
            activeOpacity={0.75}
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              borderRadius: 30,
              paddingVertical: 18,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#000000', fontSize: 22 }}>♥</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

// ─── Step 14: Meal Swipe ──────────────────────────────────────────────────────
// Ordered: universally loved → more unique/niche. All high-protein, macro-friendly.
const SWIPE_MEALS = [
  { name: 'Smash Burger',        calories: 510, protein: 42, prepTime: 15, imageHints: ['brioche bun', 'smashed beef patty', 'melted american cheese', 'pickles', 'caramelized onions'] },
  { name: 'Chicken Caesar Wrap', calories: 460, protein: 44, prepTime: 15, imageHints: ['flour tortilla wrap', 'grilled chicken slices', 'romaine lettuce', 'parmesan', 'caesar dressing'] },
  { name: 'Beef Tacos',          calories: 460, protein: 38, prepTime: 20, imageHints: ['corn tortillas', 'seasoned ground beef', 'shredded cheese', 'salsa', 'lime'] },
  { name: 'Teriyaki Salmon Bowl',calories: 520, protein: 44, prepTime: 20, imageHints: ['white rice', 'glazed salmon fillet', 'teriyaki sauce', 'sesame seeds', 'green onions', 'edamame'] },
  { name: 'Shrimp Fried Rice',   calories: 480, protein: 32, prepTime: 25, imageHints: ['fried rice', 'shrimp', 'egg', 'green onions', 'soy sauce', 'carrots'] },
  { name: 'Chicken Tikka Masala',calories: 520, protein: 40, prepTime: 30, imageHints: ['chicken pieces', 'creamy tomato curry sauce', 'basmati rice', 'naan bread', 'cilantro'] },
  { name: 'Beef and Broccoli',   calories: 430, protein: 36, prepTime: 20, imageHints: ['sliced beef', 'broccoli florets', 'brown sauce', 'white rice', 'sesame seeds'] },
  { name: 'Korean BBQ Bowl',     calories: 490, protein: 38, prepTime: 25, imageHints: ['rice bowl', 'bulgogi beef', 'kimchi', 'fried egg', 'gochujang sauce', 'sesame'] },
]
const MEAL_SWIPE_THRESHOLD = 80

function SMealSwipe({ onNext, onBack }: { onNext: (liked: string[]) => void; onBack: () => void }) {
  const indexRef = useRef(0)
  const likedRef = useRef<string[]>([])
  const isAnimatingRef = useRef(false)
  const [displayIndex, setDisplayIndex] = useState(0)
  const [images, setImages] = useState<Record<string, string>>({})
  const pan = useRef(new Animated.ValueXY()).current
  const cardOpacity = useRef(new Animated.Value(1)).current
  const nextCardScale = useRef(new Animated.Value(0.95)).current

  const CARD_W = width - 32
  const CARD_H = Math.min(480, H * 0.60)
  const IMG_H  = CARD_H  // image fills the full card; info overlays it

  // Fetch AI-generated images on mount — same edge function + cache as dashboard
  useEffect(() => {
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem('pantry_image_urls_v1')
        const cache: Record<string, string> = raw ? JSON.parse(raw) : {}
        // Show cached images immediately
        const alreadyCached: Record<string, string> = {}
        for (const m of SWIPE_MEALS) {
          if (cache[m.name]) alreadyCached[m.name] = cache[m.name]
        }
        if (Object.keys(alreadyCached).length > 0) setImages(alreadyCached)
        // Fetch missing ones in parallel
        await Promise.all(SWIPE_MEALS.map(async (m) => {
          if (cache[m.name]) return
          try {
            const { data } = await supabase.functions.invoke('generate-meal-image', {
              body: { mealName: m.name, ingredients: m.imageHints ?? [] },
            })
            if (data?.image) {
              cache[m.name] = data.image
              setImages(prev => ({ ...prev, [m.name]: data.image }))
            }
          } catch {}
        }))
        await AsyncStorage.setItem('pantry_image_urls_v1', JSON.stringify(cache))
      } catch {}
    })()
  }, [])

  const cardRotate  = pan.x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-12deg', '0deg', '12deg'] })
  const likeOpacity = pan.x.interpolate({ inputRange: [0, MEAL_SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' })
  const nopeOpacity = pan.x.interpolate({ inputRange: [-MEAL_SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' })
  const greenWash   = pan.x.interpolate({ inputRange: [0, MEAL_SWIPE_THRESHOLD * 1.5], outputRange: [0, 0.3], extrapolate: 'clamp' })
  const redWash     = pan.x.interpolate({ inputRange: [-MEAL_SWIPE_THRESHOLD * 1.5, 0], outputRange: [0.3, 0], extrapolate: 'clamp' })

  // Reset pan + reveal card AFTER React re-renders with the new displayIndex.
  // Also clears the animation lock so the next swipe is accepted.
  useEffect(() => {
    pan.x.setValue(0)
    cardOpacity.setValue(1)
    nextCardScale.setValue(0.95)
    isAnimatingRef.current = false
  }, [displayIndex])

  const doSwipe = (isLike: boolean) => {
    if (isAnimatingRef.current) return
    isAnimatingRef.current = true
    const meal = SWIPE_MEALS[indexRef.current]
    if (isLike) likedRef.current = [...likedRef.current, meal.name]
    const toX = isLike ? 500 : -500
    Animated.parallel([
      Animated.timing(pan.x, { toValue: toX, duration: 380, useNativeDriver: false }),
      Animated.timing(nextCardScale, { toValue: 1, duration: 380, useNativeDriver: false }),
    ]).start(() => {
      cardOpacity.setValue(0)
      indexRef.current++
      setDisplayIndex(indexRef.current)
      if (indexRef.current >= SWIPE_MEALS.length) {
        AsyncStorage.setItem('onboarding_swiped_meals', JSON.stringify(likedRef.current)).catch(() => {})
        onNext(likedRef.current)
      }
    })
  }

  const doSwipeRef = useRef(doSwipe)
  doSwipeRef.current = doSwipe

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5,
      onPanResponderMove: (_, g) => { pan.x.setValue(g.dx) },
      onPanResponderRelease: (_, g) => {
        if (isAnimatingRef.current) return
        if (g.dx > MEAL_SWIPE_THRESHOLD) doSwipeRef.current(true)
        else if (g.dx < -MEAL_SWIPE_THRESHOLD) doSwipeRef.current(false)
        else Animated.spring(pan.x, { toValue: 0, useNativeDriver: false }).start()
      },
    })
  ).current

  if (displayIndex >= SWIPE_MEALS.length) return null

  const meal     = SWIPE_MEALS[displayIndex]
  const nextMeal = SWIPE_MEALS[displayIndex + 1]
  const img      = images[meal.name]
  const nextImg  = nextMeal ? images[nextMeal.name] : null

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <TopBar onBack={onBack} pct={PROGRESS[13] ?? 63} />

      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, justifyContent: 'space-between' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 4, textAlign: 'center' }}>
            Which meals excite you?
          </Text>
          <Text style={{ color: MUTED, fontSize: 14, textAlign: 'center' }}>
            Swipe right to save, left to skip
          </Text>
        </View>

        {/* Card stack */}
        <View style={{ width: CARD_W, height: CARD_H }}>
          {/* Next card peeking behind — scales 0.95→1 as top card flies off */}
          {nextMeal && (
            <Animated.View
              style={{
                position: 'absolute', width: CARD_W, height: CARD_H,
                backgroundColor: CARD, borderRadius: 20, overflow: 'hidden',
                transform: [{ scale: nextCardScale }],
              }}
            >
              {nextImg
                ? <Image source={{ uri: nextImg }} style={{ width: CARD_W, height: IMG_H }} resizeMode="cover" />
                : <View style={{ width: CARD_W, height: IMG_H, backgroundColor: '#242424' }} />
              }
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.93)']}
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 180, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 18 }}
              >
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 10 }}>{nextMeal.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(90,55,10,0.88)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Clock size={11} stroke="#D4A855" strokeWidth={2} />
                    <Text style={{ color: '#D4A855', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{nextMeal.prepTime} MIN</Text>
                  </View>
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{nextMeal.calories} CAL</Text>
                  </View>
                  <View style={{ backgroundColor: 'rgba(74,222,128,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#4ADE80' }}>
                    <Text style={{ color: '#4ADE80', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{nextMeal.protein}P</Text>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Active card */}
          <Animated.View
            style={{
              position: 'absolute', width: CARD_W, height: CARD_H,
              backgroundColor: CARD, borderRadius: 20, overflow: 'hidden',
              shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.5, shadowRadius: 20,
              opacity: cardOpacity,
              transform: [{ translateX: pan.x }, { rotate: cardRotate }],
            }}
            {...panResponder.panHandlers}
          >
            {/* Food image or placeholder */}
            {img
              ? <Image source={{ uri: img }} style={{ width: CARD_W, height: IMG_H }} resizeMode="cover" />
              : <View style={{ width: CARD_W, height: IMG_H, backgroundColor: '#242424' }} />
            }

            {/* Color washes on swipe */}
            <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#4ADE80', opacity: greenWash }} />
            <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#FF4D4D', opacity: redWash }} />

            {/* SAVE / SKIP badges */}
            <Animated.View style={{
              position: 'absolute', top: 20, left: 20,
              borderWidth: 2.5, borderColor: '#4ADE80', borderRadius: 8,
              paddingHorizontal: 14, paddingVertical: 5, opacity: likeOpacity,
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}>
              <Text style={{ color: '#4ADE80', fontSize: 17, fontWeight: '900', letterSpacing: 1 }}>SAVE</Text>
            </Animated.View>
            <Animated.View style={{
              position: 'absolute', top: 20, right: 20,
              borderWidth: 2.5, borderColor: '#FF4D4D', borderRadius: 8,
              paddingHorizontal: 14, paddingVertical: 5, opacity: nopeOpacity,
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}>
              <Text style={{ color: '#FF4D4D', fontSize: 17, fontWeight: '900', letterSpacing: 1 }}>SKIP</Text>
            </Animated.View>

            {/* Info — gradient overlay with name + pills */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.93)']}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 180, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 18 }}
            >
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 10 }}>
                {meal.name}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {/* Prep time — amber pill */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(90,55,10,0.88)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Clock size={11} stroke="#D4A855" strokeWidth={2} />
                  <Text style={{ color: '#D4A855', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{meal.prepTime} MIN</Text>
                </View>
                {/* Calories — neutral pill */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{meal.calories} CAL</Text>
                </View>
                {/* Protein — green pill */}
                <View style={{ backgroundColor: 'rgba(74,222,128,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#4ADE80' }}>
                  <Text style={{ color: '#4ADE80', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{meal.protein}P</Text>
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
        </View>

        {/* Dot progress */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {SWIPE_MEALS.map((_, i) => (
            <View key={i} style={{
              width: i === displayIndex ? 18 : 6, height: 6, borderRadius: 3,
              backgroundColor: i < displayIndex ? TEAL : i === displayIndex ? '#FFFFFF' : '#444444',
            }} />
          ))}
        </View>

        {/* Buttons */}
        <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
          <TouchableOpacity
            onPress={() => doSwipeRef.current(false)} activeOpacity={0.75}
            style={{ flex: 1, backgroundColor: '#1A0000', borderRadius: 30, paddingVertical: 18, alignItems: 'center', borderWidth: 1.5, borderColor: '#FF4D4D' }}
          >
            <Text style={{ color: '#FF4D4D', fontSize: 22, fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => doSwipeRef.current(true)} activeOpacity={0.75}
            style={{ flex: 1, backgroundColor: TEAL, borderRadius: 30, paddingVertical: 18, alignItems: 'center' }}
          >
            <Text style={{ color: '#000000', fontSize: 22, fontWeight: '700' }}>♥</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

export default function Onboarding() {
  const router = useRouter()
  const { user } = useAuth()
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState(1)
  const [stepLoaded, setStepLoaded] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const fadeAnim = useRef(new Animated.Value(1)).current
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA)

  useEffect(() => {
    AsyncStorage.getItem('onboarding_data').then(saved => {
      if (saved) setData(JSON.parse(saved))
    })
  }, [])

  // Resume at saved step. If user was mid-transition (referral / generating intro)
  // after finishing data entry, jump straight to plan loading — they've already
  // entered everything, no need to re-walk the reveal intro.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (stepParam) {
        const p = parseInt(stepParam, 10)
        if (!isNaN(p) && !cancelled) setStep(p)
        if (!cancelled) setStepLoaded(true)
        return
      }
      const saved = await AsyncStorage.getItem('onboarding_step')
      if (cancelled) return
      if (saved) {
        const savedStep = parseInt(saved, 10)
        if (!isNaN(savedStep)) {
          const target = (savedStep === 15 || savedStep === 16) ? 17 : savedStep === 13 ? 14 : savedStep
          setStep(target)
        }
      }
      setStepLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Persist current step so app re-open resumes where the user left off
  useEffect(() => {
    if (stepLoaded) {
      AsyncStorage.setItem('onboarding_step', String(step)).catch(() => {})
    }
  }, [step, stepLoaded])

  const update = (key: keyof OnboardingData) => (val: any) => {
    setData(prev => {
      const next = { ...prev, [key]: val }
      AsyncStorage.setItem('onboarding_data', JSON.stringify(next))
      return next
    })
  }

  const navigate = (newStep: number) => {
    trackOnboardingStep(newStep)
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(newStep)
      // Defer fade-in by one frame so React commits the new screen render
      // BEFORE opacity starts going back up. Without this, the old screen
      // briefly flashes back in because opacity rises before the new screen
      // has been committed to the tree.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
        })
      })
    })
  }

  const next = () => navigate(step === 12 ? 14 : step + 1)  // step 13 (meal swipe) removed
  const back = () => navigate(step === 14 ? 12 : step - 1) // step 13 removed — 14 goes back to 12

  const prepToMinutes = (prep: string) => {
    if (prep === '10 min') return 10
    if (prep === '20 min') return 20
    if (prep === '60+ min') return 90
    return 30
  }

  const finish = async () => {
    try {
      const saved = await AsyncStorage.getItem('onboarding_data')
      const finalData: OnboardingData = saved ? JSON.parse(saved) : data

      if (user) {
        const heightCm = Math.round((parseInt(finalData.ft || '0') * 12 + parseInt(finalData.inches || '0')) * 2.54)
        const weightKg = Math.round(parseFloat(finalData.weight || '0') * 0.453592 * 10) / 10

        const customDislikes = finalData.foodDislikesText
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
        const allDislikes = [...(finalData.foodDislikes || []), ...customDislikes]

        const mergedRestrictions = [
          ...(finalData.dietStyle && finalData.dietStyle !== 'Classic' ? [finalData.dietStyle] : []),
          ...(finalData.diet || []),
        ]

        // Auto-compute macros from the other onboarding data (no manual entry screen)
        let computedCals: number | null = parseInt(finalData.calories) || null
        let computedProt: number | null = parseInt(finalData.protein) || null
        if ((!computedCals || !computedProt) && heightCm && weightKg) {
          const parsedAge = parseInt(finalData.age) || 25
          const fitness = finalData.fitnessGoal || (finalData.goal === 'lose' ? 'lose' : finalData.goal === 'build' ? 'gain' : 'maintain')
          const result = calculateGoals(parsedAge, finalData.gender || 'male', heightCm, weightKg, finalData.activityLevel || 'moderate', fitness)
          computedCals = computedCals ?? result.calories
          computedProt = computedProt ?? result.protein
        }

        // Derive age from birthday (field never set during onboarding)
        const derivedAge = finalData.birthday ? computeAge(finalData.birthday) : parseInt(finalData.age) || null
        // Map main goal (lose/build/maintain) → fitness_goal column ('gain' for 'build')
        const resolvedFitnessGoal = finalData.fitnessGoal
          || (finalData.goal === 'lose' ? 'lose' : finalData.goal === 'build' ? 'gain' : finalData.goal === 'maintain' ? 'maintain' : null)

        const { error } = await supabase.from('profiles').update({
          calorie_goal: computedCals,
          protein_goal: computedProt,
          height_cm: heightCm || null,
          weight_kg: weightKg || null,
          target_weight_kg: finalData.targetWeight ? Math.round(parseFloat(finalData.targetWeight) * 0.453592 * 10) / 10 : null,
          dietary_restrictions: mergedRestrictions,
          meals_per_day: parseInt(finalData.meals),
          cooking_skill: finalData.cookingSkill || null,
          max_prep_minutes: prepToMinutes(finalData.prep),
          last_active: new Date().toISOString().split('T')[0],
          food_dislikes: allDislikes,
          food_prefs_banner_dismissed: true,
          food_intro_popup_dismissed: true,
          age: derivedAge || null,
          gender: finalData.gender || null,
          activity_level: finalData.activityLevel || null,
          fitness_goal: resolvedFitnessGoal,
          referral_code_used: finalData.referralCode ? finalData.referralCode.toUpperCase().trim() : null,
          cuisine_preferences: finalData.cuisinePreferences || [],
        }).eq('id', user.id)

        if (error) {
          Alert.alert('Save Error', error.message)
          return
        }

        // If meals weren't pre-generated during account creation (e.g. email sign-up),
        // generate them now and show a brief loading overlay.
        const existingCache = await AsyncStorage.getItem('pantry_daily_meals_cookNow')
        const todayStr = new Date().toISOString().slice(0, 10)
        const cacheReady = existingCache
          ? (() => { try { const c = JSON.parse(existingCache); return c.date === todayStr && c.meals?.length > 0 } catch { return false } })()
          : false
        if (!cacheReady) {
          setFinishing(true)
          try {
            const meals = await generateMeals({
              ingredients: [
                'chicken breast', 'ground beef', 'eggs', 'rice', 'pasta',
                'olive oil', 'butter', 'garlic', 'onion', 'salt', 'black pepper',
                'soy sauce', 'hot sauce', 'lemon', 'lime', 'Italian seasoning',
                'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili flakes',
                'tomato sauce', 'chicken broth', 'parmesan cheese', 'broccoli', 'spinach',
              ],
              calorieGoal: computedCals ?? 2400,
              proteinGoal: computedProt ?? 150,
              mealsPerDay: parseInt(finalData.meals) || 3,
              cookingSkill: finalData.cookingSkill || 'moderate',
              maxPrepMinutes: prepToMinutes(finalData.prep),
              dietaryRestrictions: mergedRestrictions,
              foodDislikes: allDislikes,
              cuisinePreferences: finalData.cuisinePreferences || [],
              mode: 'cookNow',
            })
            await AsyncStorage.setItem('pantry_daily_meals_cookNow', JSON.stringify({ date: todayStr, meals }))
          } catch {
            // Fail silently — home screen will generate on load
          }
        }
      }

      await AsyncStorage.removeItem('onboarding_data')
      await AsyncStorage.removeItem('onboarding_step')
      await AsyncStorage.setItem('onboarding_complete', 'true')
      router.replace('/(tabs)')
    } catch (error: any) {
      setFinishing(false)
      Alert.alert('Error', error.message)
    }
  }

  const screens: Record<number, React.ReactNode> = {
    1: <S1Welcome onNext={next} onSignIn={() => router.push('/onboarding/signin')} />,
    2: <S1_5Gender value={data.gender} onChange={update('gender')} onNext={next} onBack={back} />,
    3: <SActivityLevel value={data.activityLevel} onChange={update('activityLevel')} onNext={next} onBack={back} />,
    4: <S3Attribution value={data.attribution} onChange={update('attribution')} onNext={next} onBack={back} />,
    5: <S4LongTermResults onNext={next} onBack={back} />,
    6: <S4AboutYou ft={data.ft} inches={data.inches} weight={data.weight} onFt={update('ft')} onInches={update('inches')} onWeight={update('weight')} onNext={next} onBack={back} />,
    7: <S5Birthday value={data.birthday} onChange={update('birthday')} onNext={next} onBack={back} />,
    8: <S2Goal value={data.goal} onChange={update('goal')} onNext={next} onBack={back} />,
    9: <STargetWeight goal={data.goal} weight={data.weight} ft={data.ft} inches={data.inches} targetWeight={data.targetWeight} onChange={update('targetWeight')} onNext={next} onBack={back} />,
    10: <SCookingSkill value={data.cookingSkill} onChange={update('cookingSkill')} onNext={next} onBack={back} />,
    11: <SMealCadence meals={data.meals} prep={data.prep} onMeals={update('meals')} onPrep={update('prep')} onNext={next} onBack={back} />,
    12: <SDietStyle value={data.dietStyle} onChange={update('dietStyle')} onNext={next} onBack={back} />,
    14: <SAllergies foodDislikes={data.foodDislikes} foodDislikesText={data.foodDislikesText} onFoodDislikes={update('foodDislikes')} onFoodDislikesText={update('foodDislikesText')} onNext={next} onBack={back} />,
    15: <SReferralCode value={data.referralCode} onChange={update('referralCode')} onNext={next} onBack={back} />,
    16: <SGeneratingIntro onNext={next} onBack={back} />,
    17: <SPlanLoading data={data} onDone={next} />,
    18: <SPlanReveal data={data} onNext={() => user ? navigate(19) : router.push('/onboarding/createaccount')} onBack={() => navigate(16)} />,
    19: <STryFree onNext={next} onBack={back} />,
    20: <STrialReminder onNext={next} onBack={back} />,
    21: <S7Paywall data={data} onNext={finish} onBack={back} />,
  }

  if (finishing) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', gap: 20 }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>Building your meal plan…</Text>
        <Text style={{ color: '#888888', fontSize: 14 }}>This takes just a few seconds</Text>
      </View>
    )
  }

  return (
    <View style={s.root}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {stepLoaded && screens[step]}
      </Animated.View>
      {/* Pre-mount SPlanReveal during the loading screen so image fetches start 4s early.
          Positioned off-screen — component is mounted + effects run, but user sees nothing. */}
      {stepLoaded && step === 17 && (
        <View style={{ position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, overflow: 'hidden' }}>
          <SPlanReveal data={data} isPrefetchOnly onNext={() => {}} onBack={() => {}} />
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  safe: { flex: 1, backgroundColor: '#000000' },
  progressTrack: { height: 3, backgroundColor: '#1A1A1A', marginHorizontal: 24, marginTop: 12, marginBottom: 4, borderRadius: 2 },
  topBarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  backArrowBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  progressFill: { height: '100%', backgroundColor: TEAL, borderRadius: 2 },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  scrollBody: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16 },
  bottomActions: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 4 },
  pill: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 18, alignItems: 'center' },
  pillDark: { backgroundColor: '#1A1A1A' },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },
  pillTextDark: { color: '#FFFFFF' },
  textLink: { alignItems: 'center', paddingVertical: 10 },
  textLinkText: { fontSize: 14, color: MUTED, fontWeight: '500' },
  wordmark: { fontSize: 52, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2, marginBottom: 16 },
  tagline: { fontSize: 17, color: MUTED, textAlign: 'center', lineHeight: 26 },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: MUTED, marginBottom: 28, lineHeight: 22 },
  cardList: { gap: 12 },
  selectCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: '#2A2A2A', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectCardActive: { borderColor: TEAL },
  selectCardLabel: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', flex: 1 },
  selectCardSub: { fontSize: 13, color: MUTED, marginTop: 3 },
  goalIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  inputCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, gap: 10 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: MUTED },
  input: { flex: 1, fontSize: 20, fontWeight: '700', color: '#FFFFFF', padding: 0 },
  heightRow: { flexDirection: 'row', gap: 16 },
  heightInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heightUnit: { fontSize: 14, color: MUTED, fontWeight: '500' },
  calcLink: { fontSize: 14, color: TEAL, fontWeight: '600', marginTop: 16 },
  prefSection: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginTop: 24, marginBottom: 12 },
  pillRow: { flexDirection: 'row', gap: 10 },
  prefPill: { flex: 1, paddingVertical: 12, borderRadius: 30, backgroundColor: CARD, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  prefPillActive: { backgroundColor: '#FFFFFF' },
  prefPillText: { fontSize: 14, fontWeight: '600', color: MUTED },
  prefPillTextActive: { color: '#000000' },
  dietGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dietPill: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 30, backgroundColor: CARD, borderWidth: 1, borderColor: '#2A2A2A' },
  dietPillActive: { borderColor: TEAL },
  dietPillText: { fontSize: 14, fontWeight: '500', color: MUTED },
  dietPillTextActive: { color: TEAL, fontWeight: '600' },
  paywallTitle: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6, marginBottom: 8 },
  paywallSub: { fontSize: 16, color: MUTED, marginBottom: 28 },
  featureList: { gap: 14, marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  featureText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500', flex: 1 },
  planRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: { flex: 1, backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: '#2A2A2A', padding: 16, gap: 6 },
  planCardActive: { borderColor: TEAL },
  planBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planLabel: { fontSize: 14, fontWeight: '600', color: MUTED },
  planPrice: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  planBadge: { backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { fontSize: 10, fontWeight: '700', color: TEAL },
  paywallActions: { marginTop: 24, gap: 4 },
  trialLimits: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  legal: { fontSize: 11, color: '#444444', textAlign: 'center', marginTop: 4 },
  completionCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  completeTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center', marginBottom: 12 },
  completeSub: { fontSize: 16, color: MUTED, textAlign: 'center', lineHeight: 24 },
})
