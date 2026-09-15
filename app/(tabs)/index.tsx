import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
  Easing,
  Image,
  Modal,
  TextInput,
  Alert,
  AppState,
  RefreshControl,
  Keyboard,
} from 'react-native'
import Reanimated, { FadeIn, FadeOut, LinearTransition, SlideInRight, SlideInLeft, LayoutAnimationConfig, useSharedValue, useAnimatedProps, withSequence, withTiming, Easing as ReEasing } from 'react-native-reanimated'
import { LIST_LAYOUT, ROW_EXIT } from '@/lib/motion'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useScrollToTop } from '@react-navigation/native'
import { Check, Clock, RefreshCw, Utensils, ScanLine, Milk, UtensilsCrossed, Cookie, ChevronDown, ChevronLeft, Pencil, Plus, X, Trash2, ChevronRight, ThumbsUp, ThumbsDown, Camera, Flame, Dumbbell, Apple, Egg, Drumstick, Salad, Carrot, BarChart3 } from 'lucide-react-native'
import { Swipeable, Gesture, GestureDetector } from 'react-native-gesture-handler'
import Svg, { Circle as SvgCircle, Rect as SvgRect, Line as SvgLine, Path as SvgPath, Ellipse as SvgEllipse, G as SvgG } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { formatTimeLine, activeMinutes } from '@/lib/ingredientDisplay'
import { todayStr } from '@/lib/localDate'
import { setSelectedDay } from '@/lib/selectedDay'
import { DEFAULT_SLOT_LABELS, slotId } from '@/lib/mealSlots'
import { pantryProteinCeiling, REALISTIC_MEAL_PROTEIN_MAX } from '@/lib/proteinCeiling'
import { MealImage } from '@/components/MealImage'
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useAIConsent } from '../../context/AIConsentContext'
import { useSuperwall } from 'expo-superwall'
import { trackMealsGenerated, trackDiscoverNudgeTapped } from '../../lib/analytics'
import { trackCookTonightUsed } from '@/lib/engagement'
import { discoverNudge } from '@/lib/discoverNudge'
import { missingIngredients, structuralMissing } from '@/lib/mealReadiness'
import { loadFood } from '@/lib/foodCache'
import { loadOverrideMap } from '@/hooks/useMacroOverrides'
import { dietExcludedStaples } from '@/constants/staples'
import { haptic } from '../../lib/haptics'
import AILogModal from '../../components/AILogModal'
import { Shimmer } from '../../components/Shimmer'
import PressableScale from '../../components/PressableScale'
import FoodSearchModal from '../../components/FoodSearchModal'
import DislikeReasonSheet, { DislikeFeedback } from '../../components/DislikeReasonSheet'
import EditPortionModal from '../../components/EditPortionModal'
import PantryScanModal from '../../components/PantryScanModal'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { useMealSuggestions } from '../../lib/useMealSuggestions'
import { takePantryNames } from '@/lib/pantryPrefetch'
import { perfMark } from '../../lib/perf'
import { GeneratedMeal } from '../../lib/meals'
import { supabase } from '../../lib/supabase'

const { width } = Dimensions.get('window')

// FEATURE FLAGS
// AI photo-to-macros ("Snap & Log") was pulled from v1 per council decision
// 2026-05-15 — competing with Cal AI head-on dilutes Pantry's "cook-focused
// macro app" positioning. The AILogModal component + estimate-meal-macros
// edge function remain intact behind this flag; flip to true post-launch
// once we have demand signal + budget for accuracy iteration.
// Calorie/macro goals mirrored to disk. See the goal state in the component: without this the
// first paint of a cold start shows the placeholder constants, not the user's own targets.
const GOALS_CACHE_KEY = 'pantry_goals_cache'
// Today's rows and the week's totals, mirrored to disk like the goals are. A cold start read both
// from the network, so for the ~1s the two queries took the card said "Nothing logged yet" over a
// day with three meals in it and the week's circles were empty, then everything jumped. The mirror
// paints first; the network result replaces it and rewrites the mirror. User-stamped, so a second
// account on the device never paints the first one's day.
const dayLogsKey = (uid: string, date: string) => `pantry_day_logs:${uid}:${date}`
const weekLogsKey = (uid: string, week: string) => `pantry_week_logs:${uid}:${week}`

const ENABLE_AI_PHOTO_LOG = false

// Height of the resting "Get tonight's meals" card — the failure/empty state of the meals section.
const HERO_COMPACT_H = 172
// One Cook Tonight row: 88pt photo plus 10pt padding each side. The skeleton rows use the same
// number so the three shimmering placeholders are exactly the height of the cards that replace them.
const PANTRY_ROW_H = 108

// Narrates the daily meal generation instead of a static "Finding a meal…". Honest to what the
// backend is actually doing, in order, so the wait reads as work rather than lag.

// Width of the travelling segment in the indeterminate sweep. ~38% of the track: long enough to
// read as a bar rather than a dot, short enough that its motion is obvious across the full width.
const SWEEP_W = (width - 40) * 0.38

const DAILY_STATUS = [
  'Checking what\'s in your pantry…',
  'Matching recipes to your goals…',
  'Plating today\'s picks…',
]

type LogEntry = {
  id: string
  name: string
  time: string
  calories: number
  protein: number
  carbs: number
  fat: number
  Icon: React.ElementType
  food_id: string | null
  serving_id: string | null
  quantity: number
  meal_data: any | null
}

type MealSlot = {
  id: string
  label: string
  entries: LogEntry[]
}

// Fallback only — the real list is profiles.meal_slots. Used before the profile lands and if the
// read fails, so the screen never renders zero slots. Both live in lib/mealSlots.ts so the seeding
// in onboarding, the re-seed in Profile and this screen cannot drift to different names.
const INITIAL_SLOTS: MealSlot[] = DEFAULT_SLOT_LABELS.map(l => ({ id: slotId(l), label: l, entries: [] }))

function iconForSlot(label: string): React.ElementType {
  const l = label.toLowerCase()
  if (l.includes('breakfast') || l.includes('morning')) return Milk
  if (l.includes('lunch') || l.includes('midday')) return Utensils
  if (l.includes('dinner') || l.includes('supper') || l.includes('evening')) return UtensilsCrossed
  if (l.includes('snack')) return Cookie
  return Utensils
}

// Reanimated, so the ring's strokeDashoffset is computed on the UI thread. RN Animated could not
// use its native driver for an SVG attribute and stepped it from the JS thread for 1.8s — right
// while Home is loading.
const AnimatedSvgCircle = Reanimated.createAnimatedComponent(SvgCircle)

function CalorieGaugeInner({ consumed, goal }: { consumed: number; goal: number }) {
  const remaining = goal - consumed
  const isOver = remaining < 0
  const progress = goal > 0 ? Math.min(consumed / goal, 1) : 0
  // 124 -> 84. The ring no longer carries the number, so it only has to read as a progress dial.
  // This is the single biggest line-item in the card's height.
  const size = 84
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // 0 → 1 of the ring drawn. Nothing about this animation touches React: no listener, no state.
  // The old version set a "remaining" count from a listener on nearly every frame for 1.8s — about
  // a hundred renders per Home load or log change — for a number the ring stopped showing.
  const animProgress = useSharedValue(0)

  useEffect(() => {
    // Over goal: the full red ring, no animation.
    if (isOver) { animProgress.value = 1; return }
    // Redraw from empty on every change, as before. withSequence, not two assignments, so the
    // reset is guaranteed to land before the timing starts on the UI thread. Reduce Motion (set
    // globally in _layout) makes this jump straight to the end.
    animProgress.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(progress, { duration: 1800, easing: ReEasing.out(ReEasing.cubic) }),
    )
  }, [consumed, goal])

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animProgress.value),
  }))

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <SvgCircle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.10)" strokeWidth={strokeWidth} fill="transparent" />
        <AnimatedSvgCircle cx={size / 2} cy={size / 2} r={radius} stroke={isOver ? '#EF4444' : '#4ADE80'} strokeWidth={strokeWidth} fill="transparent"
          strokeDasharray={`${circumference}`}
          animatedProps={ringProps}
          strokeLinecap="round" />
      </Svg>
      {/* The percentage, not the number. The kcal figure now lives beside the ring at a size a
          124pt ring could never have given it, and repeating it inside would be the same value
          twice in one row. */}
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: isOver ? '#EF4444' : COLORS.textWhite, letterSpacing: -0.3 }}>
          {goal > 0 ? `${Math.round((consumed / goal) * 100)}%` : '—'}
        </Text>
      </View>
    </View>
  )
}

// One macro as a compact tile. Replaces the stacked full-width MacroBar rows: three of these in a
// row is ~54pt where the old protein bar plus the carbs/fat accordion plus its toggle was ~110pt,
// AND it shows all three without a tap. The accordion is retired with it — a control whose only
// job was hiding two numbers that now fit.
//
// Label ABOVE the number, bar directly UNDER it. The label used to sit between them, so the bar was
// two rows away from the figure it measures and the three tiles read as a stack of unrelated
// lines. Read top-down it is now name -> value -> progress, the order every tracker uses.
function MacroTileInner({ label, consumed, goal, color }: { label: string; consumed: number; goal: number; color: string }) {
  const pct = goal > 0 ? Math.min(consumed / goal, 1) : 0
  return (
    <View style={{ flex: 1, gap: 5 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textWhite }}>{Math.round(consumed)}</Text>
        <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textMuted }}>/{Math.round(goal)}g</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  )
}
const MacroTile = memo(MacroTileInner)

// Memoized: Home re-renders on every state change (macros toggle, meal loads, focus), and this
// subtree is an SVG ring. Its inputs are two numbers, so a shallow compare is exact.
const CalorieGauge = memo(CalorieGaugeInner)


// The resting state of the meal card — what Home shows before you've asked for today's meals.
//
// Deliberately carries NO food photography. The only image sources available on Home are the
// one-shot onboarding `planMeals` and nothing else, and a square Flux photo dropped into a short
// full-width box crops the dish out of frame. So the card earns attention from real data (your
// actual pantry count), the accent language the app already uses for "something good is here"
// (see planReadyCard), and one slow breathing halo — not from borrowed art.
function MealCardResting({ pantryCount, onPress, error, errorCode }: { pantryCount: number; onPress: () => void; error?: string | null; errorCode?: string | null }) {
  const breathe = useRef(new RNAnimated.Value(0)).current
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(breathe, { toValue: 1, duration: 2400, useNativeDriver: true }),
        RNAnimated.timing(breathe, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  // The breathe drives the GRADIENT, not an icon. Ambient light shifting behind the type reads as
  // the card being alive; a glyph sitting on top of a card reads as decoration.
  // Opacity only, so this stays on the native driver and costs no JS frames.
  const washOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })

  return (
    <TouchableOpacity style={styles.restingCard} activeOpacity={0.9} onPress={onPress}>
      {/* Base wash — always present, so the card is never flat even at the bottom of the breath. */}
      <LinearGradient
        colors={['rgba(74,222,128,0.10)', 'rgba(0,201,167,0.04)', '#0B0B0B']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Second wash breathes on top of the first, from a different corner, so the highlight
          appears to drift across the card rather than simply fading in place. */}
      <RNAnimated.View style={[StyleSheet.absoluteFill, { opacity: washOpacity }]}>
        <LinearGradient
          colors={['rgba(0,201,167,0.14)', 'rgba(74,222,128,0.05)', 'transparent']}
          locations={[0, 0.5, 1]}
          start={{ x: 0.95, y: 0.1 }}
          end={{ x: 0.2, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </RNAnimated.View>
      <Text style={styles.restingTitle}>{error ? "Couldn't get tonight's meals" : "Get tonight's meals"}</Text>
      {/* Home was the ONLY surface that dropped the error on the floor — Pantry and cook-reveal
          both render it. Without this a failed generation looks identical to a fresh one: the card
          says "Let's cook", the tap fails silently, and the user taps forever. That is what a
          daily-cap hit looked like on this screen. */}
      <Text style={styles.restingSub}>
        {error
          ? error
          : pantryCount > 0
            ? `Built from the ${pantryCount} things in your pantry`
            : 'Built from what\'s in your pantry'}
      </Text>
      {/* No CTA once the daily cap is hit — the same rule Pantry and cook-reveal already apply,
          since tapping cannot succeed until tomorrow. */}
      {errorCode !== 'meal_cap_reached' && (
        <View style={styles.restingCTA}>
          <Text style={styles.restingCTAText}>{error ? 'Try again' : "Let's cook"}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// One Cook Tonight pick as a row: square photo, name, the pills the detail screen leads with, and
// the readiness line. Three of these stack where one hero used to auto-rotate — the three are
// CANDIDATES for one decision, and choosing needs them side by side. Discover keeps the single big
// photo; that is what makes the two tabs look different.
//
// The photo slot is SQUARE on purpose. Generation renders 512x512, so this is the first place on
// Home that shows the whole image — the old 3:2 hero cropped a third off every one.
// `known` is false until the pantry has loaded. Meals come from the disk cache faster than the
// pantry query answers, so for that beat every ingredient read as missing and all three rows said
// "Better with: <the whole recipe>" before flipping to "Ready to cook". Say nothing until it is known.
function PantryMealRow({ meal, missing, structural, known, onPress }: { meal: GeneratedMeal; missing: string[]; structural: string[]; known: boolean; onPress: () => void }) {
  // Cap the list at three names — the line is one row, and the detail screen has the full list.
  const list = (xs: string[]) => `${xs.slice(0, 3).join(', ')}${xs.length > 3 ? ` +${xs.length - 3}` : ''}`
  return (
    <TouchableOpacity style={styles.pantryRow} activeOpacity={0.75} onPress={onPress}>
      {meal.image && meal.image.startsWith('http') ? (
        <MealImage uri={meal.image} style={styles.pantryRowPhoto} recyclingKey={String(meal.id)} transition={200} />
      ) : (
        <View style={[styles.pantryRowPhoto, styles.pantryRowPhotoEmpty]}>
          {/* Only shimmer while a photo is still COMING. Once fetching has settled with nothing
              (the daily image cap is the usual reason) the animation is a lie — it ran forever and
              read as the app being stuck rather than the dish simply having no picture. */}
          {!meal.imageUnavailable && <Shimmer style={StyleSheet.absoluteFill} durationMs={1600} />}
          <Utensils size={22} stroke="#5A5A5A" strokeWidth={1.4} />
        </View>
      )}
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.pantryRowName} numberOfLines={2}>{meal.name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {/* One time pill. The wait used to get its own, showing a duration nobody acts on — 6 hr
              and 8 hr are the same decision. */}
          {activeMinutes(meal.prepTime, meal.cookTime) > 0 && (
            <View style={[styles.mealPill, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.25)' }]}>
              <Text style={[styles.mealPillText, { color: '#F59E0B' }]}>{formatTimeLine(meal.prepTime, meal.cookTime, meal.restTime).toUpperCase()}</Text>
            </View>
          )}
          <View style={[styles.mealPill, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' }]}>
            <Text style={styles.mealPillText}>{meal.calories} CAL</Text>
          </View>
          {meal.protein > 0 && (
            <View style={[styles.mealPill, { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.25)' }]}>
              <Text style={[styles.mealPillText, { color: '#4ADE80' }]}>{meal.protein}P</Text>
            </View>
          )}
          {/* The CAL and P pills are ONE PORTION — what they will eat and what logging writes. This
              is the only thing saying the recipe cooks more than that, so without it the ingredient
              list on the detail screen reads as double the food the card promised. */}
          {(meal.servings ?? 1) > 1 && (
            <View style={[styles.mealPill, { backgroundColor: 'rgba(0,212,170,0.15)', borderColor: 'rgba(0,212,170,0.25)' }]}>
              <Text style={[styles.mealPillText, { color: COLORS.accent }]}>MAKES {meal.servings}</Text>
            </View>
          )}
        </View>
        {/* Only a STRUCTURAL gap is a trip to the store; a missing garnish is "Better with", not a
            blocker — "Need:" over a dish short only of cilantro made a cookable meal look impossible. */}
        {!known ? (
          <View style={{ height: 14 }} />
        ) : structural.length > 0 ? (
          <Text style={styles.pantryRowNeed} numberOfLines={1}>Need: {list(structural)}</Text>
        ) : missing.length > 0 ? (
          <Text style={styles.pantryRowBetter} numberOfLines={1}>Better with: {list(missing)}</Text>
        ) : (
          <View style={styles.pantryRowReady}>
            <Check size={11} stroke="#4ADE80" strokeWidth={3} />
            <Text style={styles.pantryRowReadyText}>Ready to cook</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function HomeScreen() {
  // Home was the ONLY tab left uninstrumented, which is why the new symptom — a freeze on
  // Pantry for a couple of seconds when switching TO Home — produced no log at all. Its
  // BLUR fires on the outgoing screen and then nothing until Home finishes whatever it is
  // doing. This makes that gap visible.
  useEffect(() => {
    perfMark('Home MOUNT')
    return () => perfMark('Home UNMOUNT')
  }, [])
  useFocusEffect(useCallback(() => {
    perfMark('Home FOCUS')
    return () => perfMark('Home BLUR')
  }, []))

  const { user } = useAuth()
  const router = useRouter()
  // Backdrop-tap-to-close is the SAME gesture as tap-outside-to-dismiss-the-keyboard, so with a
  // keyboard up it silently discarded a half-filled meal form. Keyboard up → the backdrop and ✕
  // just close the keyboard; a second tap closes the modal.
  const keyboardUp = useKeyboardVisible()
  const dismissOr = (close: () => void) => () => { if (keyboardUp) { Keyboard.dismiss(); return } close() }
  const { isPremium, promoActive } = usePremium()
  const { requestConsent } = useAIConsent()
  // Gate AI consent BEFORE opening the scan modal — two native iOS modals can't stack, so a
  // consent prompt fired from inside the scan modal queues behind it and the scan hangs.
  const openScanWithConsent = async () => { if (await requestConsent()) setShowPantryScanFromHome(true) }
  const openAILogWithConsent = async () => { if (await requestConsent()) setShowAILogModal(true) }
  const { registerPlacement } = useSuperwall()
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  const [pantryFetched, setPantryFetched] = useState(false)
  // Staples the user has opted out of assuming, from the profile fetch below. Feeds the readiness
  // line on each row: an excluded staple counts as missing, same as on the meal detail.
  const [excludedStaples, setExcludedStaples] = useState<Set<string>>(new Set())
  // Home shows the three Cook Tonight picks as a stacked list, all visible at once. It was a hero
  // carousel auto-rotating through them one at a time — the wrong container for a choice between
  // three (choosing needs them side by side), and the same visual move Discover opens with, so
  // neither tab had an identity. The 5x page loop, the recentring, Ken Burns and the fit-to-fold
  // measurement all existed to serve that one card and went with it.
  // Generation no longer auto-fires. A cached day still paints on its own (the hook reads disk
  // regardless of `enabled`), so this only gates the ~6s GPT call on a genuine miss — i.e. the
  // first open of a new day. Six seconds you asked for reads completely differently from six
  // seconds the app decided to spend on your behalf.
  // Generates as soon as there is a pantry to generate FROM — no longer behind a tap.
  //
  // The tap gate was added to cut spend and perceived latency, and both arguments weakened. A
  // cached day now paints in ~40ms (measured), so the ~6s call only ever happens on the first open
  // of a new day, narrated. And the cost is small: Gemini text is ~$0.004 a generation and images
  // are GLOBALLY cached, so the 500th user to generate a given dish pays nothing for its photo —
  // about $75/month at 500 DAU, of which the gate saved maybe $30.
  //
  // Against that, one point of trial-to-paid at 500 DAU is worth ~$42/month. The gate had to cost
  // ZERO conversion to break even, on the exact screen where a trial user decides whether the app
  // works. It also violated the project's own rule against redundant CTAs: a button reading "Get
  // tonight's meals" on the screen whose job is tonight's meals is asking for something the user
  // already asked for by opening the app.
  //
  // It was also only ever half-real. Pantry called this same hook with `hasPantryItems` and no tap
  // gate, sharing the 'cookNow' cache — so anyone who opened Pantry first (which is where you add
  // ingredients) got auto-generation anyway. The behaviour depended on which tab you happened to
  // open first, which is an accident, not a decision.
  const { meals, loading, stale, cacheChecked, retry, regenerate, canRegenerate, genUsedToday, genCapPerDay, error: mealsError, errorCode: mealsErrorCode } = useMealSuggestions(user?.id, isPremium, 'cookNow', pantryFetched && pantryNames.size > 0)
  // The section holds its place and shimmers from first paint: the hook cannot report `loading`
  // until the pantry lands, so "we do not know yet" is pending rather than absent — gating on
  // `pantryFetched` alone was 2-3s of blank space before the shimmer.
  // Only while there is NOTHING to show. Once meals exist a photo still on its way shimmers in its
  // own slot, so the skeleton can never come back over cards already on screen, and yesterday's
  // carried-over meals stay up while today's generate underneath.
  const mealsPending = (!pantryFetched || !cacheChecked || loading) && meals.length === 0
  // Drives the pulse dot and the sweep bar: generating with nothing up yet, holding yesterday's,
  // or regenerating over a set already on screen — the redo row hides while this is true, so this
  // is the only sign a redo is running.
  const working = stale || mealsPending || loading

  // Rotating status while today's batch generates — narrating real steps beats a static line,
  // and beats a bare spinner by a mile.
  const [dailyStatusIdx, setDailyStatusIdx] = useState(0)
  useEffect(() => {
    if (!loading) { setDailyStatusIdx(0); return }
    const id = setInterval(() => setDailyStatusIdx(i => {
      // Clamp on the last line rather than cycling. A slow generation used to loop back to
      // "Checking what's in your pantry…" 15s in — false by then, and a repeating list reads as
      // stuck. Holding the final line just reads as "still plating".
      if (i >= DAILY_STATUS.length - 1) { clearInterval(id); return i }
      return i + 1
    }), 2200)
    return () => clearInterval(id)
  }, [loading])

  // Breathing dot beside the carryover status. 1400ms each way on purpose — faster reads as a
  // BLINK, which is the twitchy spinner feeling this exists to avoid. Only runs while yesterday's
  // meals are held up, so nothing animates once today's have landed.
  const livePulse = useRef(new RNAnimated.Value(0.35)).current
  useEffect(() => {
    if (!working) return
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(livePulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        RNAnimated.timing(livePulse, { toValue: 0.35, duration: 1400, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [working, livePulse])

  // Indeterminate sweep under the section header. The 6pt breathing dot was the only signal that
  // work was happening, and at 6pt beside 12pt text it reads as punctuation, not activity — with
  // the photo gate now able to hold yesterday's meals for up to 22s, that is a long time to look
  // at a screen that appears finished. A bar travelling the full width is the one progress idiom
  // nobody has to be taught. Indeterminate on purpose: generation has no measurable percentage,
  // and a fake filling bar that stalls at 90% is worse than an honest loop.
  const sweep = useRef(new RNAnimated.Value(0)).current
  useEffect(() => {
    if (!working) return
    // resetBeforeIteration (default) snaps back to 0 between passes, so the segment re-enters from
    // the left rather than ping-ponging — direction stays constant, which reads as progress.
    const loop = RNAnimated.loop(
      RNAnimated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [working, sweep])

  // Readiness against the LIVE pantry, then ready-to-cook first: a meal you cannot cook tonight
  // should not be the first thing on Home. The sort is stable, so within a tier the server's own
  // order (protein tier, then flavour) still decides. The Pantry tab's time-of-day sort went with
  // that tab — the generator already spreads the three across occasions.
  const pantryMeals = useMemo(() => meals.slice(0, 3).map(meal => ({
    meal,
    missing: missingIngredients(meal.ingredients, pantryNames, excludedStaples),
    structural: structuralMissing(meal, pantryNames, excludedStaples),
  })).sort((a, b) => a.structural.length - b.structural.length), [meals, pantryNames, excludedStaples])

  // Prefetch the three photos so the rows fill together rather than one beat apart.
  useEffect(() => {
    meals.slice(0, 3).forEach(m => {
      if (m.image && m.image.startsWith('http')) Image.prefetch(m.image)
    })
  }, [meals])

  // Kitchen-staples ask moved INTO the scan review flow (a "Also have these?" chip row in
  // PantryScanModal) — the old post-scan "Kitchen basics?" popup interrupted the moment right
  // after a scan, so it was removed. Seasonings (salt/pepper/oil) are now assumed by meal-gen.
  // The macros accordion is GONE — all three macros are tiles in the card now, so there is no
  // collapsed/expanded state, no persisted preference, and no toggle. Its removal also retires a
  // long-running frame problem recorded here: animating the accordion's HEIGHT could never be
  // smooth, because a layout prop has to round-trip through a shadow-tree commit and those do not
  // happen per frame (measured at ~20fps on a 120Hz screen). Nothing animates height any more.
  // The stored 'pantry_macros_expanded' key is simply left behind; reading it would resurrect a
  // control that no longer exists.



  // Fetch pantry names and compute missing staples. Extracted so it can be re-run
  // after a scan adds items — otherwise pantryNames stays empty and Home keeps
  // showing the "Unlock recipes" card instead of flipping to the meal rows.
  const loadPantryNames = useCallback(async () => {
    if (!user) return
    perfMark('pantry fetch start')
    // Take the layout's warm read if it is still unclaimed. It is consumed once, so every LATER
    // call here — the re-run after a scan adds items, above all — queries fresh, which is the
    // whole point of that re-run.
    const warm = takePantryNames(user.id)
    const names = warm
      ? await warm
      : new Set((await supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true).limit(500)) // in-stock pantry never realistically exceeds this; bounds payload on every focus
          .data?.map(i => String(i.name ?? '').toLowerCase()) ?? [])
    perfMark(`pantry fetched (${names.size} items)`)
    setPantryNames(names)
    setPantryFetched(true)
  }, [user])

  useEffect(() => { loadPantryNames() }, [loadPantryNames])

  // Hero "Scan your pantry" card animations. Two loops run together to sell the
  // "actively scanning + identifying items" idea: a horizontal beam sweeps top→bottom
  // (read: "the camera is scanning") and the food icons gently pulse in sequence as
  // the beam passes their position (read: "items being detected"). Only run while
  // the empty-state card is mounted.
  const scanHeroBeam = useRef(new RNAnimated.Value(0)).current
  useEffect(() => {
    if (!pantryFetched || pantryNames.size > 0) return
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(scanHeroBeam, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.linear }),
        RNAnimated.timing(scanHeroBeam, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pantryFetched, pantryNames])

  const [showPrefBanner, setShowPrefBanner] = useState(false)
  const [showPantryScanFromHome, setShowPantryScanFromHome] = useState(false)

  // "Your plan is ready" preview card — set by onboarding finish() once meals are
  // persisted to saved_meals. Shows a horizontal scroll of 3 thumbnails plus a
  // "View all" link to the Saved tab. Persists until user taps the X.
  const [planReadyCount, setPlanReadyCount] = useState<number>(0)
  const [planMeals, setPlanMeals] = useState<{ id: string; name: string; image_url: string | null }[]>([])
  const planFadeOpacity = useRef(new RNAnimated.Value(0)).current
  // Use useFocusEffect so the flag is re-checked every time the Home tab gains focus —
  // not just on initial mount. This lets the debug button on Profile (or any flag set
  // elsewhere) be picked up without a full app reload.
  useFocusEffect(useCallback(() => {
    if (!user) return
    // Already showing in this session — don't re-fetch or re-clear
    if (planMeals.length > 0) return
    let cancelled = false
    ;(async () => {
      const flag = await AsyncStorage.getItem('pantry_onboarding_plan_ready')
      if (!flag) return
      const count = parseInt(flag, 10) || 0
      if (count <= 0) return
      const { data } = await supabase
        .from('saved_meals')
        .select('id, name, image_url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(count)
      if (cancelled) return
      if (data && data.length > 0) {
        setPlanReadyCount(count)
        setPlanMeals(data)
        RNAnimated.timing(planFadeOpacity, {
          toValue: 1, duration: 500, delay: 200, useNativeDriver: true,
        }).start()
        // One-shot: clear the flag immediately on first show so subsequent
        // sign-ins, app launches, or tab focuses don't re-display it.
        // The user can still tap X to dismiss within the current session.
        await AsyncStorage.removeItem('pantry_onboarding_plan_ready')
      }
    })()
    return () => { cancelled = true }
  }, [user, planMeals.length]))
  const dismissPlanReady = async () => {
    await AsyncStorage.removeItem('pantry_onboarding_plan_ready')
    RNAnimated.timing(planFadeOpacity, {
      toValue: 0, duration: 250, useNativeDriver: true,
    }).start(() => {
      setPlanReadyCount(0)
      setPlanMeals([])
    })
  }

  // Last-resort values for a genuinely first-ever launch. They are NOT a sane default to render:
  // the profile fetch below is a network round-trip, so on a cold start the ring used to animate
  // all the way to 2400/180 — a calorie target belonging to nobody — and then re-animate to the
  // user's real numbers when the row arrived. GOALS_CACHE_KEY exists to make that window ~20ms.
  const [calorieGoal, setCalorieGoal] = useState(2400)
  const [proteinGoal, setProteinGoal] = useState(180)
  const [carbsGoal, setCarbsGoal] = useState(250)
  const [fatGoal, setFatGoal] = useState(80)
  // Set once the profile row lands, so a slow AsyncStorage read can never overwrite fresher
  // network data with the previous session's numbers.
  const goalsFromNetworkRef = useRef(false)

  // Hydrate goals from disk on mount. AsyncStorage settles in ~10-30ms against a multi-second
  // cold-start network fetch, so this is what the user actually sees. userId-stamped for the same
  // reason the meal cache is: cached goals must never paint for a different account on one device.
  useEffect(() => {
    if (!user) return
    AsyncStorage.getItem(GOALS_CACHE_KEY).then(raw => {
      if (!raw || goalsFromNetworkRef.current) return
      try {
        const g = JSON.parse(raw)
        if (g.userId && g.userId !== user.id) return
        if (g.calorie_goal) setCalorieGoal(g.calorie_goal)
        if (g.protein_goal) setProteinGoal(g.protein_goal)
        if (g.carbs_goal) setCarbsGoal(g.carbs_goal)
        if (g.fat_goal) setFatGoal(g.fat_goal)
      } catch {}
    }).catch(() => {})
  }, [user?.id])

  // Milestone celebration plumbing: mirror the live goal into a ref (so the logs fetch
  // reads the CURRENT goal, not a stale closure) and track the previous calorie total.
  // Starts null so the first load / a day switch establishes a baseline WITHOUT firing.
  const calorieGoalRef = useRef(calorieGoal)
  calorieGoalRef.current = calorieGoal
  const calorieMilestoneRef = useRef<number | null>(null)

  useEffect(() => {
    if (!loading && meals.length > 0) trackMealsGenerated(meals.length)
  }, [loading])

  // Use useFocusEffect so the profile re-fetches every time Home gains focus —
  // critical for the post-onboarding flow where Home was already mounted as a tab
  // and finish() just updated the user's profile. Without this, Home keeps showing
  // stale state (or hardcoded useState defaults) instead of the values just saved.
  useFocusEffect(useCallback(() => {
    if (!user) return
    let cancelled = false
    perfMark('Home profile fetch START')
    supabase
      .from('profiles')
      .select('food_prefs_banner_dismissed, calorie_goal, protein_goal, carbs_goal, fat_goal, meal_slots, staples_excluded, dietary_restrictions')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        perfMark('Home profile fetch DONE')
        if (cancelled) return
        goalsFromNetworkRef.current = true
        // A ref as well as state: fetchTodayLogs reads the structure while rebuilding the day, and
        // it is a useCallback that must not take a new identity every time the list changes.
        const fetched = Array.isArray(data?.meal_slots) && data.meal_slots.length
          ? (data.meal_slots as string[]) : DEFAULT_SLOT_LABELS
        mealSlotsRef.current = fetched
        setMealSlots(fetched)
        if (!data?.food_prefs_banner_dismissed) setShowPrefBanner(true)
        // Staples the user has opted out of assuming — their "I don't keep this" taps PLUS
        // diet-conflicting basics (butter for vegan, flour for GF). Mirrors the meal detail so an
        // exclusion made there flips the same ingredient into NEED on the Home rows.
        const manual = (data?.staples_excluded ?? []).map((s: string) => s.toLowerCase())
        setExcludedStaples(new Set([...manual, ...dietExcludedStaples(data?.dietary_restrictions ?? [])]))
        if (data?.calorie_goal) setCalorieGoal(data.calorie_goal)
        if (data?.protein_goal) setProteinGoal(data.protein_goal)
        if (data?.carbs_goal) setCarbsGoal(data.carbs_goal)
        if (data?.fat_goal) setFatGoal(data.fat_goal)
        // Fire and forget — next cold start paints these instead of the placeholder constants.
        AsyncStorage.setItem(GOALS_CACHE_KEY, JSON.stringify({
          userId: user.id,
          calorie_goal: data?.calorie_goal, protein_goal: data?.protein_goal,
          carbs_goal: data?.carbs_goal, fat_goal: data?.fat_goal,
        })).catch(() => {})
      })
    return () => { cancelled = true }
  }, [user]))

  const dismissBanner = async () => {
    setShowPrefBanner(false)
    if (!user) return
    await supabase
      .from('profiles')
      .update({ food_prefs_banner_dismissed: true })
      .eq('id', user.id)
  }

  const rateMeal = async (meal: GeneratedMeal, rating: 1 | -1) => {
    if (!user) return
    // Toggle off if same rating tapped again
    const current = ratings[meal.id]
    const next = current === rating ? null : rating
    setRatings(prev => {
      const updated = { ...prev }
      if (next === null) delete updated[meal.id]
      else updated[meal.id] = next
      return updated
    })
    if (next === null) {
      await supabase.from('meal_ratings').delete()
        .eq('user_id', user.id).eq('meal_name', meal.name)
    } else {
      // Written with no reason FIRST, so backing out of the sheet still records the thumbs-down —
      // a reason-less row, which is what every rating stored before the sheet is, and it suppresses.
      await supabase.from('meal_ratings').upsert({
        user_id: user.id,
        meal_name: meal.name,
        rating: next,
        reason: null,
        reason_ingredients: null,
        reason_flavours: null,
      }, { onConflict: 'user_id,meal_name' })
      // Show learning feedback so user sees the AI improving
      if (next === -1) setReasonMeal(meal)
      else showRatingToast("Got it — we'll suggest more like this")
    }
  }

  // The sheet's answer lands on the row rateMeal just wrote. Only two of the five reasons suppress
  // the dish — a wrong photo or a broken recipe is a bug report about a meal the user may still
  // want, and useMealSuggestions reads `reason` to tell them apart.
  const submitDislikeReason = async ({ reason, ingredients, flavours }: DislikeFeedback) => {
    const meal = reasonMeal
    if (!user || !meal) return
    await supabase.from('meal_ratings')
      .update({
        reason,
        reason_ingredients: ingredients.length > 0 ? ingredients : null,
        reason_flavours: flavours.length > 0 ? flavours : null,
      })
      .eq('user_id', user.id).eq('meal_name', meal.name)
    showRatingToast(
      // Say what actually happens: these two leave the dish in rotation, so "we'll skip this"
      // would be a straight lie about what we did with the report.
      reason === 'photo_mismatch' || reason === 'recipe_wrong'
        ? "Thanks — we'll take a look at this one"
        : "Noted — we'll skip this one",
    )
  }

  const showRatingToast = (message: string) => {
    setRatingToastMessage(message)
    setShowRatingToast_(true)
    RNAnimated.sequence([
      RNAnimated.timing(ratingToastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      RNAnimated.delay(1800),
      RNAnimated.timing(ratingToastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowRatingToast_(false))
  }

  const scrollRef = useRef<ScrollView>(null)
  useScrollToTop(scrollRef)

  const [slots, setSlots] = useState<MealSlot[]>(INITIAL_SLOTS)
  const [mealSlots, setMealSlots] = useState<string[]>(DEFAULT_SLOT_LABELS)
  const mealSlotsRef = useRef<string[]>(DEFAULT_SLOT_LABELS)

  // "Light on protein" fires only when all three hold: the deck is short (every meal under 75% of
  // the per-meal target — the SYMPTOM the user is looking at), the goal is one a single meal can
  // carry at all (above ~70g no shelf reaches it, and the shortfall is the goal's), and the pantry's
  // own protein sources cannot reach the target at normal portions (the CAUSE — lib/proteinCeiling).
  // The first version tested the symptom alone and blamed the pantry when the goal was raised to
  // 300g; Logan caught it. A short deck on a shelf that COULD do better is the generator's fault,
  // tracked server-side, and says nothing here. 75% is deliberately looser than the ranker's 85%.
  // Only once the PROFILE has landed: proteinGoal falls back to 180 and the slots to a default list,
  // and judging someone's pantry against numbers that are not theirs is worse than saying nothing.
  const perMealProtein = goalsFromNetworkRef.current && mealSlots.length > 0 ? proteinGoal / mealSlots.length : 0
  const perMealCalories = mealSlots.length > 0 ? calorieGoal / mealSlots.length : 0
  const pantryCeiling = pantryProteinCeiling(pantryNames, perMealCalories)
  const pantryProteinShort = meals.length > 0 && perMealProtein > 0
    && perMealProtein <= REALISTIC_MEAL_PROTEIN_MAX
    && pantryCeiling < perMealProtein
    && meals.every(m => (Number(m.protein) || 0) < 0.75 * perMealProtein)

  // Persist the structure, then rebuild the day from it. Written to the profile rather than held in
  // state, which is the entire bug: a slot that lives only in React state cannot survive the next
  // refetch. Optimistic — the row is a list of strings, and a failed write costs a re-add, not data.
  const saveMealSlots = useCallback(async (next: string[]) => {
    mealSlotsRef.current = next
    setMealSlots(next)
    setSlots(prev => {
      const byLabel = new Map(prev.map(s => [s.label, s]))
      const rebuilt = next.map(l => byLabel.get(l) ?? { id: slotId(l), label: l, entries: [] })
      // Keep any slot that still holds entries even if it is no longer in the list, so removing a
      // slot never makes logged food disappear from the day in front of the user.
      for (const s of prev) if (!next.includes(s.label) && s.entries.length) rebuilt.push(s)
      return rebuilt
    })
    if (!user) return
    const { error } = await supabase.from('profiles').update({ meal_slots: next }).eq('id', user.id)
    // Read the error: supabase-js RETURNS a refused write rather than throwing, so a try/catch here
    // would catch nothing and the slot would silently revert on the next load.
    if (error) console.log('[slots] meal_slots update refused:', error.message)
  }, [user?.id])
  const [selectedDate, setSelectedDate] = useState(() => todayStr())
  // The day the rendered slots BELONG to, set in the same update as the slots. It keys the log
  // section, so another day's data replaces the cards outright instead of animating from the
  // previous day's layout. Keyed on this and not selectedDate, because selectedDate changes a
  // render before that day's rows arrive.
  const [slotsDate, setSlotsDate] = useState(() => todayStr())
  // Sunday-start week containing `anchor`. Noon, not midnight, for the same reason every other date
  // helper in this file uses it: a midnight Date lands on the previous day under some DST offsets.
  const weekOf = (anchor: string): string[] => {
    const start = new Date(anchor + 'T12:00:00')
    start.setDate(start.getDate() - start.getDay())
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return todayStr(d)
    })
  }
  // Which days in the visible week have any log, for the strip's filled circles. Keyed on the WEEK,
  // not on selectedDate, so tapping through days inside one week costs no extra query.
  const [loggedDays, setLoggedDays] = useState<Set<string>>(new Set())
  const visibleWeek = weekOf(selectedDate)
  const weekStart = visibleWeek[0]
  // Per-day totals, not just "has a row". A single logged coffee should not earn the same mark as a
  // tracked day — see dayState below.
  const [weekStats, setWeekStats] = useState<Map<string, { cal: number; slots: Set<string> }>>(new Map())
  // +1 = moved forward in time, -1 = back. Only used to pick which side the new week slides in from.
  const [weekDir, setWeekDir] = useState(1)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let fromNetwork = false
    const apply = (rows: any[]) => {
      const m = new Map<string, { cal: number; slots: Set<string> }>()
      for (const r of rows) {
        const d = String(r.logged_at)
        const e = m.get(d) ?? { cal: 0, slots: new Set<string>() }
        e.cal += Number(r.calories) || 0
        if (r.slot) e.slots.add(String(r.slot))
        m.set(d, e)
      }
      setWeekStats(m)
      setLoggedDays(new Set(m.keys()))
    }
    // The mirror paints first, unless the network has already answered for this week.
    AsyncStorage.getItem(weekLogsKey(user.id, weekStart)).then(raw => {
      if (cancelled || fromNetwork || !raw) return
      try { apply(JSON.parse(raw)) } catch {}
    }).catch(() => {})
    supabase.from('meal_logs').select('logged_at, calories, slot')
      .eq('user_id', user.id).gte('logged_at', weekStart).lte('logged_at', weekOf(weekStart)[6])
      .then(({ data }) => {
        if (cancelled) return
        fromNetwork = true
        apply((data ?? []) as any[])
        AsyncStorage.setItem(weekLogsKey(user.id, weekStart), JSON.stringify(data ?? [])).catch(() => {})
      })
    return () => { cancelled = true }
  }, [user?.id, weekStart])

  // THREE STATES, not two. "Any log at all" was the first cut and it devalues the mark immediately:
  // log one coffee and the day is as green as a fully tracked one, so after a week every circle is
  // green and the row says nothing. Equally, gating the check on HITTING the calorie goal punishes
  // accurate logging on a light day — the mark should reward TRACKING, which the app controls, not
  // the eating, which it does not.
  //   'done'    — 2+ meal slots logged, OR half the calorie goal reached. Green fill + check.
  //   'partial' — something logged, but not enough to call the day tracked. Accent ring, no fill.
  //   'empty'   — nothing.
  // Whichever hits first, so a genuine two-meal day still completes and a 1,400-cal single meal does
  // too. Both thresholds are one number each if this reads as too easy or too strict on device.
  const dayState = (d: string): 'done' | 'partial' | 'empty' => {
    const live = d === selectedDate ? { cal: totalCal, slots: new Set(slots.filter(x => x.entries.length).map(x => x.label)) } : null
    const st = live && (live.cal > 0 || live.slots.size) ? live : weekStats.get(d)
    if (!st || (st.cal === 0 && st.slots.size === 0)) return 'empty'
    if (st.slots.size >= 2 || (calorieGoal > 0 && st.cal >= calorieGoal * 0.5)) return 'done'
    return 'partial'
  }

  // Swipe the strip left/right a week at a time. activeOffsetX means a mostly-vertical drag still
  // scrolls the page — without it the strip would steal the scroll gesture on every touch.
  // failOffsetY keeps it from firing on a diagonal flick that was meant as a scroll.
  const weekSwipe = Gesture.Pan()
    // Callback on the JS thread: it calls setSelectedDate, and RNGH v2 treats gesture callbacks as
    // worklets by default when Reanimated is present.
    .runOnJS(true)
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .onEnd(e => {
      if (Math.abs(e.translationX) < 40) return
      const shift = e.translationX > 0 ? -7 : 7   // drag RIGHT = go back, matching a calendar
      const next = new Date(selectedDate + 'T12:00:00')
      next.setDate(next.getDate() + shift)
      // Never past today: a future week has nothing in it and stranding the user there means
      // every circle is empty with no obvious way back.
      const target = todayStr(next) > todayStr() ? todayStr() : todayStr(next)
      // Direction drives the entering animation below. Set before the state change so the re-render
      // that swaps the week already knows which way it came from.
      setWeekDir(shift > 0 ? 1 : -1)
      setSelectedDate(target)
    })
  useEffect(() => { calorieMilestoneRef.current = null }, [selectedDate]) // new day = fresh baseline, don't celebrate the goal on a day switch
  const isToday = selectedDate === todayStr()
  // Publish the working day so screens WITHOUT a date picker (the meal detail, chiefly) log to the
  // day the user is looking at instead of hardcoding today. See lib/selectedDay.ts for why this is
  // shared state rather than a nav param.
  useEffect(() => { setSelectedDay(selectedDate) }, [selectedDate])

  // Anchor at noon when constructing the Date so DST transitions don't shift the day
  // backward (e.g. midnight + DST fallback = previous day on iOS).
  const goBackDay = () => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    setSelectedDate(todayStr(d))
  }
  const goForwardDay = () => {
    // Recompute today HERE rather than trusting the render-time isToday constant — if the
    // app sat open across midnight, isToday would still reflect yesterday and wrongly block
    // navigating into the real new day. String date compare is safe for YYYY-MM-DD.
    const todayLocal = todayStr()
    if (selectedDate >= todayLocal) return
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    setSelectedDate(todayStr(d))
  }

  // Builds the day from rows — the network's or the disk mirror's. The milestone haptic fires only
  // on a network result: a cold start hydrating a day already past the goal must not tick.
  const applyLogRows = useCallback((data: any[], fromCache: boolean, forDate: string) => {
    const slotMap = new Map<string, LogEntry[]>()
    ;['Breakfast', 'Lunch', 'Dinner'].forEach(s => slotMap.set(s, []))

    for (const row of data) {
      const label = row.slot || 'Other'
      if (!slotMap.has(label)) slotMap.set(label, [])
      const time = new Date(row.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      slotMap.get(label)!.push({
        id: row.id,
        name: row.meal_name,
        time,
        calories: row.calories ?? 0,
        protein: row.protein ?? 0,
        carbs: row.carbs ?? 0,
        fat: row.fat ?? 0,
        Icon: iconForSlot(label),
        food_id: row.food_id ?? null,
        serving_id: row.serving_id ?? null,
        quantity: row.quantity ?? 1,
        meal_data: row.meal_data ?? null,
      })
    }

    // The user's OWN structure leads, in their order, whether or not anything is logged in it —
    // this is what makes an empty custom slot survive a refetch instead of vanishing.
    const result: MealSlot[] = []
    const seen = new Set<string>()
    for (const label of mealSlotsRef.current) {
      result.push({ id: slotId(label), label, entries: slotMap.get(label) ?? [] })
      seen.add(label)
    }
    // Anything logged under a slot the user has since renamed or removed still renders, after their
    // own. Dropping it would hide real history behind a settings change.
    for (const [label, entries] of slotMap) {
      if (!seen.has(label)) result.push({ id: slotId(label), label, entries })
    }
    // Milestone: fire a success tick the moment logging pushes today's calories across the
    // goal. Compare prev→new total so opening the app or switching days (baseline null) never fires.
    const newTotalCal = result.reduce((s, slot) => s + slot.entries.reduce((a, e) => a + e.calories, 0), 0)
    const prevTotalCal = calorieMilestoneRef.current
    calorieMilestoneRef.current = newTotalCal
    const goal = calorieGoalRef.current
    if (!fromCache && prevTotalCal !== null && goal > 0 && prevTotalCal < goal && newTotalCal >= goal) {
      haptic.success()
    }
    setSlots(result)
    setSlotsDate(forDate)
    // Warm what a tap on an entry will need — the food record and the user's corrections — so the
    // edit screen builds synchronously even on the first tap after a cold start. Disk reads for
    // anything logged since the cache existed; one FatSecret call per older entry, once a session.
    for (const row of data) if (row.food_id) loadFood(String(row.food_id)).catch(() => {})
    if (userRef.current) loadOverrideMap(userRef.current).catch(() => {})
  }, [])

  // The day the network last answered for. Hydration from disk is skipped once it has, so a slow
  // disk read can never roll a fresh fetch back.
  const fetchedFor = useRef<string | null>(null)
  const userRef = useRef<string | null>(null)
  userRef.current = user?.id ?? null
  const fetchTodayLogs = useCallback(async () => {
    if (!user) return
    perfMark('Home logs fetch START')
    const { data } = await supabase
      .from('meal_logs')
      .select('id, meal_name, calories, protein, carbs, fat, slot, created_at, food_id, serving_id, quantity, meal_data')
      .eq('user_id', user.id)
      .eq('logged_at', selectedDate)
      .order('created_at', { ascending: true })
    perfMark('Home logs fetch DONE')
    if (!data) return
    fetchedFor.current = selectedDate
    AsyncStorage.setItem(dayLogsKey(user.id, selectedDate), JSON.stringify(data)).catch(() => {})
    applyLogRows(data, false, selectedDate)
  }, [user?.id, selectedDate, applyLogRows])

  useEffect(() => {
    if (!user) return
    const date = selectedDate
    let cancelled = false
    AsyncStorage.getItem(dayLogsKey(user.id, date)).then(raw => {
      if (cancelled || !raw || fetchedFor.current === date) return
      try { applyLogRows(JSON.parse(raw), true, date) } catch {}
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id, selectedDate, applyLogRows])

  // Pull-to-refresh and foreground/focus refetch all hit the same path now that
  // Home is tracking-only — just today's logs. Trending lives on Discover.
  const [refreshing, setRefreshing] = useState(false)
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await fetchTodayLogs() } finally { setRefreshing(false) }
  }, [fetchTodayLogs])

  // AppState 'active' fires on background→foreground resume. Without this, logs
  // added on another device (or just stale state after a long backgrounding) won't
  // refresh until the user manually pulls or switches tabs.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') fetchTodayLogs()
    })
    return () => sub.remove()
  }, [fetchTodayLogs])

  useFocusEffect(useCallback(() => {
    fetchTodayLogs()
  }, [fetchTodayLogs]))

  const deleteEntry = async (slotId: string, entryId: string) => {
    haptic.medium() // stronger than a routine tap — removing a logged meal
    // The row fades and the rows and cards below close the gap: LIST_LAYOUT / ROW_EXIT on their
    // wrappers in the log section. Nothing to configure here.
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, entries: s.entries.filter(e => e.id !== entryId) } : s))
    await supabase.from('meal_logs').delete().eq('id', entryId)
  }

  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({})
  // The meal whose thumbs-down is waiting on a reason. Holds the meal itself, not a flag, because
  // the sheet needs its ingredient list for the taste follow-up.
  const [reasonMeal, setReasonMeal] = useState<GeneratedMeal | null>(null)
  const [showRatingToast_, setShowRatingToast_] = useState(false)
  const [ratingToastMessage, setRatingToastMessage] = useState('')
  const ratingToastOpacity = useRef(new RNAnimated.Value(0)).current
  const [editEntry, setEditEntry] = useState<LogEntry | null>(null)

  const handleEntryUpdated = (logId: string, calories: number, protein: number, carbs?: number, fat?: number) => {
    // Update carbs/fat too when provided (serving edits) so the daily macro bars don't
    // show stale totals until the next refetch. Manual cal/protein edits leave them as-is.
    setSlots(prev => prev.map(s => ({
      ...s,
      entries: s.entries.map(e => e.id === logId
        ? { ...e, calories, protein, ...(carbs !== undefined ? { carbs } : {}), ...(fat !== undefined ? { fat } : {}) }
        : e),
    })))
  }

  const [showAILogModal, setShowAILogModal] = useState(false)
  const [showFoodSearchModal, setShowFoodSearchModal] = useState(false)
  const [foodSearchSlot, setFoodSearchSlot] = useState('Breakfast')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newSlotName, setNewSlotName] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [logName, setLogName] = useState('')
  const [logCals, setLogCals] = useState('')
  const [logProtein, setLogProtein] = useState('')
  const [logCarbs, setLogCarbs] = useState('')
  const [logFat, setLogFat] = useState('')
  const [logSlot, setLogSlot] = useState('Breakfast')
  const [logSaving, setLogSaving] = useState(false)

  const confirmAddSlot = () => {
    const trimmed = newSlotName.trim()
    if (!trimmed) return
    // Case-insensitive: two slots differing only in case would map to the same slotId and to the
    // same `slot` string on every log row, so they could never be told apart again.
    if (mealSlotsRef.current.some(l => l.toLowerCase() === trimmed.toLowerCase())) {
      setNewSlotName(''); setShowAddModal(false); return
    }
    saveMealSlots([...mealSlotsRef.current, trimmed])
    setNewSlotName('')
    setShowAddModal(false)
  }

  const openLogModal = () => {
    setLogName('')
    setLogCals('')
    setLogProtein('')
    setLogCarbs('')
    setLogFat('')
    setLogSlot(slots[0]?.label ?? 'Breakfast')
    setShowLogModal(true)
  }

  const saveManualLog = async () => {
    const name = logName.trim()
    if (!name || !user) return
    setLogSaving(true)
    // `|| 0` covers both NaN (empty input) and parseInt failures — schema requires
    // non-null numerics, so a user logging just "name" gets zeros instead of an error.
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: name,
      calories: parseInt(logCals) || 0,
      protein: parseInt(logProtein) || 0,
      carbs: parseInt(logCarbs) || 0,
      fat: parseInt(logFat) || 0,
      slot: logSlot,
      logged_at: selectedDate,
    })
    setLogSaving(false)
    if (!error) {
      setShowLogModal(false)
      fetchTodayLogs()
    }
  }

  const allEntries = slots.flatMap(s => s.entries)
  const totalCal = allEntries.reduce((s, e) => s + e.calories, 0)
  const totalPro = allEntries.reduce((s, e) => s + e.protein, 0)
  const totalCarbs = allEntries.reduce((s, e) => s + e.carbs, 0)
  const totalFat = allEntries.reduce((s, e) => s + e.fat, 0)

  perfMark('Home RENDER')
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Rating feedback toast ── */}
      {showRatingToast_ && (
        <RNAnimated.View style={[styles.ratingToast, { opacity: ratingToastOpacity }]}>
          <Text style={styles.ratingToastText}>{ratingToastMessage}</Text>
        </RNAnimated.View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor="#4ADE80" colors={['#4ADE80']} />}
      >

        <View style={styles.header}>
          {/* Avatar removed: Profile already has its own tab, so this was a second door to the same
              place taking a full row's height at the top of the screen. Its 40pt plus the header's
              own bottom margin is what lifts the calendar and everything under it. */}
          <View style={styles.headerTopRow}>
            <Text style={styles.brandText}>Pantry</Text>
          </View>
        </View>

        {/* ── "Your plan is ready" — first-run preview after onboarding paywall ── */}
        {planReadyCount > 0 && planMeals.length > 0 && (
          <RNAnimated.View style={[styles.planReadyCard, { opacity: planFadeOpacity }]}>
            <View style={styles.planReadyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planReadyTitle}>Your plan is ready</Text>
                <Text style={styles.planReadySub}>{planReadyCount} meals personalized for you</Text>
              </View>
              <TouchableOpacity
                onPress={dismissPlanReady}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
              >
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}
              style={{ marginTop: 14 }}
            >
              {planMeals.slice(0, 3).map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.planReadyThumb}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/meal/[id]', params: { id: m.id } })}
                >
                  {m.image_url ? (
                    <MealImage uri={m.image_url} style={styles.planReadyImage} transition={0} />
                  ) : (
                    <View style={[styles.planReadyImage, { backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' }]}>
                      <Utensils size={20} stroke="#555" strokeWidth={1.5} />
                    </View>
                  )}
                  <Text style={styles.planReadyThumbName}>{m.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/saved')}
              style={styles.planReadyCTA}
              activeOpacity={0.85}
            >
              <Text style={styles.planReadyCTAText}>View all {planReadyCount} →</Text>
            </TouchableOpacity>
          </RNAnimated.View>
        )}

        {/* ── Food preferences one-time banner ── */}
        {/* Only show once the user has scanned a pantry AND has real meal suggestions
            visible — otherwise the "not loving your suggestions" copy lands before
            there's anything to dislike yet. */}
        {showPrefBanner && pantryNames.size > 0 && meals.length > 0 && (
          <TouchableOpacity
            style={styles.prefBanner}
            activeOpacity={0.85}
            onPress={() => {
              dismissBanner()
              router.push('/food-preferences')
            }}
          >
            <View style={styles.prefBannerText}>
              <Text style={styles.prefBannerTitle}>Not loving your suggestions?</Text>
              <Text style={styles.prefBannerSub}>Tell Pantry what to avoid →</Text>
            </View>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); dismissBanner() }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* ── Day navigation ── */}
        <View style={styles.dayNav}>
          <TouchableOpacity onPress={goBackDay} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
          <PressableScale scaleTo={0.94} haptic onPress={() => setSelectedDate(todayStr())}>
            <Text style={styles.dayNavText}>
              {isToday ? 'Today' : (() => {
                const d = new Date(selectedDate + 'T12:00:00')
                const yesterday = new Date()
                yesterday.setDate(yesterday.getDate() - 1)
                if (selectedDate === todayStr(yesterday)) return 'Yesterday'
                return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              })()}
            </Text>
          </PressableScale>
          <TouchableOpacity onPress={goForwardDay} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronRight size={20} stroke={isToday ? '#333' : COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* ── Week strip (MyFitnessPal / Cal AI pattern) ──
            Replaces the greeting that used to sit above the day nav. The greeting cost two lines to
            say nothing actionable; this costs about the same height and answers "have I logged this
            week", which is the question the screen exists for.

            The day nav ABOVE is kept deliberately rather than folded in: the strip only reaches the
            current week, and the chevrons are the only way further back. MyFitnessPal makes the same
            split — a date label plus a strip.

            Today is a SOLID accent ring, not the dashed one MyFitnessPal uses: RN renders
            `borderStyle: 'dashed'` unreliably on a view with a borderRadius on iOS, and a ring that
            silently draws solid on some builds is worse than one that was never dashed. */}
        {/* Keyed on weekStart so React remounts the row when the week changes — that remount is what
            gives `entering` something to animate. Without it the same element just re-renders with
            new children and the swipe has no visible feedback at all, which is exactly how it
            shipped: only the date at the top changed.
            Sliding in from the side the gesture came from is the whole cue — it says "there is more
            over there" in a way a fade cannot. Reduce Motion is handled globally by
            ReducedMotionConfig in _layout, so this jumps to its end state rather than needing a
            gate here. */}
        <GestureDetector gesture={weekSwipe}>
          <Reanimated.View
            key={weekStart}
            entering={(weekDir > 0 ? SlideInRight : SlideInLeft).duration(220)}
            style={styles.weekStrip}
          >
            {visibleWeek.map(d => {
              const isSel = d === selectedDate
              const isTodayCell = d === todayStr()
              const future = d > todayStr()
              const state = dayState(d)
              return (
                <TouchableOpacity
                  key={d}
                  disabled={future}
                  activeOpacity={0.7}
                  onPress={() => setSelectedDate(d)}
                  style={styles.weekCell}
                >
                  <Text style={[styles.weekLetter, isSel && styles.weekLetterSel, future && styles.weekDim]}>
                    {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}
                  </Text>
                  <View style={[
                    styles.weekDot,
                    future && styles.weekDotFuture,
                    // Today reads as "in progress", not as a miss — it is still being earned.
                    isTodayCell && state !== 'done' && styles.weekDotToday,
                    state === 'partial' && styles.weekDotPartial,
                    state === 'done' && styles.weekDotLogged,
                    isSel && styles.weekDotSelected,
                  ]}>
                    {state === 'done' && <Check size={15} stroke="#000" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>
              )
            })}
          </Reanimated.View>
        </GestureDetector>

        {/* ── Hero Dashboard Card ── */}
        {/* The card's own height changes with the rows, so it needs its own layout animation —
            otherwise its dark background snaps to the new size while the contents animate. */}
        <Reanimated.View layout={LinearTransition.duration(420)} style={styles.heroCard}>
          {/* NUMBER LEFT, RING RIGHT. Was a 124pt centred ring with the number inside, then a
              "consumed" line, then a full-width protein bar, then an accordion toggle — four stacked
              rows for four numbers, ~250pt. This is two rows, ~150pt, and it shows MORE: carbs and
              fat are visible without a tap.

              Nothing below is fit to the fold any more: the three meal rows are fixed height and
              the page stacks naturally, so a point trimmed here is a point of the meal log that
              rises into view — no reserve to keep in step. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kcalBig}>
                {(calorieGoal - totalCal) < 0 ? `-${Math.abs(calorieGoal - totalCal).toLocaleString()}` : (calorieGoal - totalCal).toLocaleString()}
              </Text>
              <Text style={styles.kcalLabel}>{(calorieGoal - totalCal) < 0 ? 'KCAL OVER' : 'KCAL LEFT'}</Text>
              {/* "consumed" folded onto its own tight line rather than a separate centred row with
                  its own icon and margins. Same information, a third of the height. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                <Flame size={12} stroke="#4ADE80" strokeWidth={2} fill="rgba(74,222,128,0.25)" />
                <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textMuted }}>
                  {/* "Keep logging!" at 0 implied you had started. Same words as the empty slots below. */}
                  {totalCal > 0 ? `${totalCal.toLocaleString()} consumed of ${calorieGoal.toLocaleString()}` : 'Nothing logged yet'}
                </Text>
              </View>
            </View>
            <CalorieGauge consumed={totalCal} goal={calorieGoal} />
          </View>

          <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
            <MacroTile label="Protein" consumed={totalPro} goal={proteinGoal} color={COLORS.macroProtein} />
            <MacroTile label="Carbs" consumed={totalCarbs} goal={carbsGoal} color={COLORS.macroCarbs} />
            <MacroTile label="Fat" consumed={totalFat} goal={fatGoal} color={COLORS.macroFat} />
          </View>
        </Reanimated.View>

        {/* ── Snap & Log hero — AI photo-to-macros entry. CUT FROM v1 (see
            ENABLE_AI_PHOTO_LOG at top). Will return in v2 once accuracy is
            tuned and positioning supports it. ── */}
        {ENABLE_AI_PHOTO_LOG && pantryFetched && pantryNames.size > 0 && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: '#0A0A0A', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18,
            marginHorizontal: 20, marginBottom: 20,
            borderWidth: 1.5, borderColor: 'rgba(74,222,128,0.4)',
            shadowColor: '#4ADE80', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 14,
          }}
          activeOpacity={0.85}
          onPress={openAILogWithConsent}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{
              width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(74,222,128,0.14)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Camera size={20} stroke="#4ADE80" strokeWidth={2.5} />
            </View>
            <View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Snap & Log with AI</Text>
              <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Point your camera at any food</Text>
            </View>
          </View>
          <View style={{
            width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(74,222,128,0.15)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <ScanLine size={16} stroke="#4ADE80" strokeWidth={2} />
          </View>
        </TouchableOpacity>
        )}

        {/* ── Hero scan-your-pantry card — sits high on screen as the unmissable first action ── */}
        {pantryFetched && pantryNames.size === 0 && (
          <PressableScale
            style={styles.scanHero}
            scaleTo={0.98}
            haptic
            onPress={openScanWithConsent}
          >
            {/* Pantry-cabinet illustration in SVG: 3 shelves with visible depth,
                9 varied items (jar / can / cereal box / oil bottle / tuna tin /
                egg carton / milk carton / jam jar / pasta box). A scan beam sweeps
                top→bottom over the scene. Camera-viewfinder corners frame the view. */}
            <View style={styles.scanHeroVisual}>
              <Svg width={240} height={150} viewBox="0 0 240 150">
                {/* ──── Shelves: 3px-tall fill + a sharper edge line below.
                    The pair reads as a shelf cross-section, not a stray line. ──── */}
                {[50, 95, 140].map(y => (
                  <SvgG key={y}>
                    <SvgRect x={10} y={y - 2} width={220} height={3} fill="rgba(74,222,128,0.18)" />
                    <SvgLine x1={10} y1={y + 1} x2={230} y2={y + 1} stroke="#4ADE80" strokeWidth={1.4} opacity={0.55} />
                  </SvgG>
                ))}

                {/* ──── SHELF 1 ──── */}

                {/* Peanut butter jar */}
                <SvgG>
                  <SvgRect x={30} y={15} width={22} height={4} rx={1} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.15)" />
                  <SvgRect x={32} y={19} width={18} height={29} rx={2} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgRect x={33} y={29} width={16} height={10} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Soup can */}
                <SvgG>
                  <SvgRect x={108} y={22} width={22} height={2.5} rx={0.5} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.2)" />
                  <SvgRect x={108} y={24.5} width={22} height={23.5} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgRect x={108} y={31} width={22} height={10} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Cereal box */}
                <SvgG>
                  <SvgRect x={180} y={17} width={28} height={31} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgLine x1={182} y1={22} x2={206} y2={22} stroke="#4ADE80" strokeWidth={1} opacity={0.5} />
                  <SvgRect x={183} y={30} width={22} height={4} fill="rgba(0,201,167,0.30)" />
                  <SvgRect x={184} y={37} width={20} height={6} fill="rgba(74,222,128,0.20)" />
                </SvgG>

                {/* ──── SHELF 2 ──── */}

                {/* Olive oil bottle */}
                <SvgG>
                  <SvgRect x={39} y={59} width={6} height={3} fill="#4ADE80" />
                  <SvgRect x={40} y={62} width={4} height={5} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.15)" />
                  <SvgPath d="M 36 70 L 40 67 L 44 67 L 48 70 L 48 93 L 36 93 Z" stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.06)" />
                  <SvgRect x={37} y={78} width={10} height={9} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Tuna tin */}
                <SvgG>
                  <SvgRect x={100} y={73} width={36} height={2} rx={0.5} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.2)" />
                  <SvgRect x={100} y={75} width={36} height={18} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgRect x={100} y={80} width={36} height={8} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Egg carton */}
                <SvgG>
                  <SvgRect x={170} y={82} width={42} height={11} rx={2} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.10)" />
                  {[178, 188, 198, 208].map(cx => (
                    <SvgEllipse key={cx} cx={cx} cy={82} rx={3} ry={3.5} stroke="#4ADE80" strokeWidth={1.2} fill="rgba(74,222,128,0.15)" />
                  ))}
                </SvgG>

                {/* ──── SHELF 3 ──── */}

                {/* Milk carton with peaked top */}
                <SvgG>
                  <SvgRect x={30} y={110} width={24} height={28} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgPath d="M 30 110 L 30 105 L 42 100 L 54 105 L 54 110 Z" stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.10)" />
                  <SvgRect x={31} y={120} width={22} height={9} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Squat jam jar */}
                <SvgG>
                  <SvgRect x={102} y={110} width={26} height={4} rx={1} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.2)" />
                  <SvgRect x={104} y={114} width={22} height={24} rx={3} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgRect x={104} y={122} width={22} height={12} fill="rgba(0,201,167,0.30)" />
                </SvgG>

                {/* Pasta box */}
                <SvgG>
                  <SvgRect x={168} y={118} width={48} height={20} stroke="#4ADE80" strokeWidth={1.4} fill="rgba(74,222,128,0.05)" />
                  <SvgRect x={168} y={126} width={48} height={6} fill="rgba(0,201,167,0.30)" />
                  <SvgLine x1={216} y1={118} x2={216} y2={138} stroke="#4ADE80" strokeWidth={1} opacity={0.3} />
                </SvgG>
              </Svg>

              {/* Camera-style corner brackets (overlay) */}
              <View style={[styles.scanCorner, styles.scanCornerTL]} />
              <View style={[styles.scanCorner, styles.scanCornerTR]} />
              <View style={[styles.scanCorner, styles.scanCornerBL]} />
              <View style={[styles.scanCorner, styles.scanCornerBR]} />

              {/* Sweeping scan beam — sweeps over the whole pantry scene */}
              <RNAnimated.View
                pointerEvents="none"
                style={[
                  styles.scanBeam,
                  {
                    transform: [{
                      translateY: scanHeroBeam.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 140],
                      }),
                    }],
                  },
                ]}
              />
            </View>
            <Text style={styles.scanHeroTitle}>
              {planReadyCount > 0
                ? 'Cook tonight without a store run.'
                : 'Unlock recipes built around what you already have.'}
            </Text>

            <View style={styles.scanHeroBtn}>
              <Text style={styles.scanHeroBtnText}>Scan Now</Text>
            </View>
          </PressableScale>
        )}

        {/* ── Cook from your pantry — three picks, all visible, ready-to-cook first ── */}
        {(!pantryFetched || pantryNames.size > 0) && (
          <View style={{ marginBottom: 14 }}>
            <View style={{ marginHorizontal: 20, marginBottom: 12 }}>
              <Text style={styles.sectionTitle}>Cook from your pantry</Text>

              {/* Says what these are, so holding yesterday's meals up is honest rather than a stale
                  cache pretending to be fresh. The DOT and the rotating line are the point: a static
                  sentence over yesterday's meals read as finished. DAILY_STATUS is the same narration
                  the skeleton path uses, so the two states say the same thing. */}
              {working && (
                <View style={styles.carryoverRow}>
                  {stale && (
                    <>
                      <Text style={styles.carryoverNote}>Yesterday&rsquo;s picks</Text>
                      <View style={styles.carryoverSep} />
                    </>
                  )}
                  <RNAnimated.View style={[styles.livePulse, { opacity: livePulse }]} />
                  <Text style={styles.carryoverStatus} numberOfLines={1}>{DAILY_STATUS[dailyStatusIdx]}</Text>
                </View>
              )}
              {/* Indeterminate on purpose: generation has no measurable percentage, and a fake filling
                  bar that stalls at 90% is worse than an honest loop. */}
              {working && (
                <View style={styles.sweepTrack}>
                  <RNAnimated.View style={[styles.sweepFill, {
                    transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP_W, width - 40] }) }],
                  }]} />
                </View>
              )}
              {/* EVERY option short on protein means the PANTRY is the ceiling, not the generator.
                  Measured across 10 pantries: a shelf of peanut butter, milk, sliced cheese and
                  canned beans tops out near 33g a meal against a 38g floor, and no prompt reaches it
                  without a dish nobody would cook. The app used to show the best it could and say
                  nothing, so a shortfall read as the app being bad at its job. */}
              {pantryProteinShort && (
                <View style={styles.carryoverRow}>
                  <Text style={styles.pantryLimitNote} numberOfLines={2}>
                    Your pantry can&rsquo;t reach {Math.round(perMealProtein)}g of protein a meal — add a protein source.
                  </Text>
                </View>
              )}
            </View>

            {mealsPending ? (
              // Three row-shaped placeholders, the exact height of the cards that replace them, so
              // the page does not jump when the meals land. The status line above narrates the ~6s
              // of generation as work on the user's behalf; a bare spinner reads as stuck.
              <View style={{ marginHorizontal: 20, gap: 8 }}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={[styles.pantryRow, { height: PANTRY_ROW_H, overflow: 'hidden' }]}>
                    <Shimmer style={StyleSheet.absoluteFill} durationMs={1600} />
                  </View>
                ))}
              </View>
            ) : pantryMeals.length > 0 ? (
              <View style={{ marginHorizontal: 20, gap: 8 }}>
                {pantryMeals.map(({ meal, missing, structural }) => (
                  <PantryMealRow
                    key={meal.id || meal.name}
                    meal={meal}
                    missing={missing}
                    structural={structural}
                    known={pantryFetched}
                    onPress={() => {
                      // Opening a pick IS the feature being used — this counter feeds Loops.
                      if (user) trackCookTonightUsed(user.id)
                      // Guard against a missing id (the model sometimes omits it) so the URL is
                      // well-formed; mealData carries the whole meal either way.
                      const safeId = meal.id || `gen-${Date.now()}`
                      router.push({ pathname: '/meal/[id]', params: { id: safeId, mealData: JSON.stringify(meal) } })
                    }}
                  />
                ))}
                {/* The redo lives UNDER the three, not in the header: the decision to redo comes
                    after reading them, and a row can say what the cap is ("4 left today") where the
                    greyed ↻ icon said nothing. Quiet text, not a button — the cards are the content.
                    At the cap, Discover (free to serve) is the one action left and becomes the
                    SECONDARY pill, not the white primary, which would outshout food the user can
                    cook tonight. Hidden while a generation runs; the status row above carries that. */}
                {!loading && (() => {
                  const nudge = discoverNudge(genUsedToday, genCapPerDay)
                  // navigate, NOT push — pushing a tab route stacks a second copy of the tab
                  // navigator on top of itself and renders a black screen.
                  const goDiscover = () => { trackDiscoverNudgeTapped(nudge === 'capped' ? 'capped' : 'redo', genUsedToday ?? 0); router.navigate({ pathname: '/(tabs)/discover' }) }
                  if (nudge === 'capped' || !canRegenerate) {
                    return (
                      <View style={styles.discoverCapWrap}>
                        <Text style={styles.discoverNudgeText}>That&rsquo;s today&rsquo;s new picks.</Text>
                        <TouchableOpacity onPress={goDiscover} activeOpacity={0.8} style={styles.discoverCapButton}>
                          <Text style={styles.discoverCapButtonText}>Browse Discover</Text>
                        </TouchableOpacity>
                      </View>
                    )
                  }
                  const left = genUsedToday === null ? null : Math.max(0, genCapPerDay - genUsedToday)
                  return (
                    <Text style={[styles.discoverNudgeText, styles.discoverNudge]}>
                      Not feeling these?{' '}
                      <Text style={styles.discoverNudgeLink} onPress={regenerate}>New picks</Text>
                      {left !== null ? ` · ${left} left today` : ''}
                      {nudge === 'redo' ? <> · <Text style={styles.discoverNudgeLink} onPress={goDiscover}>Browse Discover</Text></> : null}
                    </Text>
                  )
                })()}
              </View>
            ) : cacheChecked ? (
              // The FAILURE state, not the opening state: the cache was checked, no meals exist and
              // nothing is loading — a generation that failed or was capped. Tapping retries. The
              // empty-pantry case never gets here; its own block above is gated on size === 0.
              <MealCardResting pantryCount={pantryNames.size} onPress={retry} error={mealsError} errorCode={mealsErrorCode} />
            ) : null}
          </View>
        )}

        {/* The old persistent "Missing kitchen basics?" home card was removed —
            it now fires once as a modal right after a pantry scan completes
            (see the PantryScanModal onItemsAdded handler below). Dismissal is
            persisted to AsyncStorage so it never nags again. */}

        {/* ── Daily Meal Log — Cards ── */}
        <View style={styles.logSection}>
          <Text style={styles.logTitle}>Daily meal log</Text>

          {/* Gap-close motion lives on the wrappers below: a row or card that leaves fades
              (ROW_EXIT), and every card and row whose own box moves glides (LIST_LAYOUT) — Reanimated
              layout animations are per component, so each moving box carries its own. Keyed on the
              day the slots belong to, with entering and exiting skipped, so a different day's data
              REPLACES the cards instead of animating out of the last day's layout. */}
          <LayoutAnimationConfig key={slotsDate} skipEntering skipExiting>
          <View style={{ marginTop: 10, gap: 8 }}>
            {slots.map((slot) => {
              const hasEntries = slot.entries.length > 0
              const slotCal = slot.entries.reduce((s, e) => s + e.calories, 0)
              const slotPro = slot.entries.reduce((s, e) => s + e.protein, 0)
              const SlotIcon = iconForSlot(slot.label)
              const openLog = () => { setFoodSearchSlot(slot.label); setShowFoodSearchModal(true) }
              const openEntry = (entry: LogEntry) => {
                if (entry.food_id) {
                  setEditEntry(entry)
                } else if (entry.meal_data) {
                  router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify(entry.meal_data) }})
                } else {
                  router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify({
                    name: entry.name, calories: entry.calories, protein: entry.protein,
                    carbs: entry.carbs, fat: entry.fat, ingredients: [], steps: [], image: null,
                  })}})
                }
              }
              return (
                // An EMPTY slot is one tap target — the whole card, header only: the `+` is the
                // affordance and three cards each saying "Nothing logged yet" was noise (the macro
                // card already says it at 0). `disabled` once it has entries, so the rows keep
                // their own taps and swipes.
                // The card's background is on the animated shell, not the touchable: when a row
                // leaves, the shell's height glides, and a background on an inner view would snap
                // to the new height while the card around it was still moving.
                <Reanimated.View key={slot.id} layout={LIST_LAYOUT} exiting={ROW_EXIT} style={styles.mealSlotShell}>
                <TouchableOpacity style={[styles.mealSlotCard, !hasEntries && styles.mealSlotCardEmpty]} activeOpacity={0.7} disabled={hasEntries} onPress={openLog}>
                  {/* flex-start, not center: the icon belongs beside the header, and on a four-entry
                      card it used to float beside the second row. */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                    <View style={styles.mealSlotIcon}>
                      <SlotIcon size={18} stroke={hasEntries ? '#4ADE80' : COLORS.textMuted} strokeWidth={1.8} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.mealSlotHeader}>
                        <Text style={styles.mealSlotLabel}>{slot.label}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          {/* The slot's total — "how big was breakfast" without adding up rows. */}
                          {hasEntries && <Text style={styles.mealSlotTotals}>{slotCal.toLocaleString()} kcal · {Math.round(slotPro)}P</Text>}
                          {/* One `+`, in the same place on every card; green once the slot has entries. */}
                          {hasEntries ? (
                            <TouchableOpacity onPress={openLog} activeOpacity={0.7} hitSlop={10}>
                              <Plus size={18} stroke="#4ADE80" strokeWidth={2.2} />
                            </TouchableOpacity>
                          ) : (
                            <Plus size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                          )}
                        </View>
                      </View>
                      {/* Rows carry protein — a protein-first app's log showed only calories, so you
                          could not see which entry did the work. Delete is swipe-left, the iOS idiom
                          the Pantry rows already use; the per-row ✕ was the third way to delete
                          (the edit screen has one too) and four of them crowded the food. */}
                      {slot.entries.map((entry, idx) => (
                        <Reanimated.View key={entry.id} layout={LIST_LAYOUT} exiting={ROW_EXIT}>
                        <Swipeable
                          renderRightActions={() => (
                            <TouchableOpacity style={styles.entryDelete} onPress={() => deleteEntry(slot.id, entry.id)} activeOpacity={0.85}>
                              <Text style={styles.entryDeleteText}>Delete</Text>
                            </TouchableOpacity>
                          )}
                          friction={2}
                          overshootRight={false}
                        >
                          <TouchableOpacity onPress={() => openEntry(entry)} activeOpacity={0.7} style={[styles.entryRow, idx > 0 && styles.entryRowDivider]}>
                            <Text style={styles.entryName} numberOfLines={1}>{entry.name}</Text>
                            <Text style={styles.entryNums}>{entry.calories} · <Text style={{ color: '#4ADE80' }}>{Math.round(entry.protein)}P</Text></Text>
                          </TouchableOpacity>
                        </Swipeable>
                        </Reanimated.View>
                      ))}
                    </View>
                  </View>
                </TouchableOpacity>
                </Reanimated.View>
              )
            })}
          </View>

          {/* Moves with the cards above it, or it would jump while they glide. */}
          <Reanimated.View layout={LIST_LAYOUT}>
          <TouchableOpacity style={styles.addSlotBtn} activeOpacity={0.6} onPress={() => setShowAddModal(true)}>
            <Plus size={15} stroke="#4ADE80" strokeWidth={2} />
            <Text style={styles.addSlotText}>Add meal</Text>
          </TouchableOpacity>
          </Reanimated.View>
          </LayoutAnimationConfig>

        </View>

      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={dismissOr(() => setShowAddModal(false))}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Meal Slot</Text>
              <TouchableOpacity onPress={dismissOr(() => setShowAddModal(false))} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Pre-Workout, Evening Snack"
              placeholderTextColor={COLORS.textMuted}
              value={newSlotName}
              onChangeText={setNewSlotName}
              autoFocus
              onSubmitEditing={confirmAddSlot}
            />
            <TouchableOpacity style={styles.modalConfirm} activeOpacity={0.8} onPress={confirmAddSlot}>
              <Text style={styles.modalConfirmText}>Add Slot</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Manual Log Modal ── */}
      <Modal visible={showLogModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={dismissOr(() => setShowLogModal(false))}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log a Meal</Text>
              <TouchableOpacity onPress={dismissOr(() => setShowLogModal(false))} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Meal name"
              placeholderTextColor={COLORS.textMuted}
              value={logName}
              onChangeText={setLogName}
              autoFocus
            />

            <View style={styles.logModalRow}>
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Calories"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logCals}
                onChangeText={setLogCals}
              />
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Protein (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logProtein}
                onChangeText={setLogProtein}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Carbs (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logCarbs}
                onChangeText={setLogCarbs}
              />
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Fat (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logFat}
                onChangeText={setLogFat}
              />
            </View>

            <View style={styles.logSlotRow}>
              {slots.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.logSlotChip, logSlot === s.label && styles.logSlotChipActive]}
                  onPress={() => setLogSlot(s.label)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.logSlotChipText, logSlot === s.label && styles.logSlotChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.modalConfirm, (!logName.trim() || logSaving) && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={saveManualLog}
              disabled={!logName.trim() || logSaving}
            >
              <Text style={styles.modalConfirmText}>{logSaving ? 'Saving...' : 'Log Meal'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── AI Log Modal — gated behind ENABLE_AI_PHOTO_LOG (cut from v1) ── */}
      {ENABLE_AI_PHOTO_LOG && (
        <AILogModal
          visible={showAILogModal}
          slots={slots.map(s => s.label)}
          defaultSlot={slots[0]?.label ?? 'Breakfast'}
          onClose={() => setShowAILogModal(false)}
          onLogged={fetchTodayLogs}
        />
      )}

      {/* ── Food Search Modal (FatSecret) ── */}
      {/* slots = the user's own structure (meal_slots), not the rendered sections — those include
          one-off labels only an old entry still uses. goals + dayTotals feed "TODAY AFTER THIS". */}
      <FoodSearchModal
        visible={showFoodSearchModal}
        slots={mealSlots}
        defaultSlot={foodSearchSlot}
        onClose={() => setShowFoodSearchModal(false)}
        onLogged={fetchTodayLogs}
        logDate={selectedDate}
        goals={{ calories: calorieGoal, protein: proteinGoal }}
        dayTotals={{ calories: totalCal, protein: totalPro }}
      />

      {/* ── Edit portion — reuse FoodSearchModal in edit mode ── */}
      {editEntry && editEntry.food_id && (
        <FoodSearchModal
          visible={!!editEntry}
          slots={mealSlots}
          // The entry's own slot. This was the entry's NAME, harmless only because initialSlot won.
          defaultSlot={slots.find(s => s.entries.some(e => e.id === editEntry.id))?.label ?? mealSlots[0]}
          onClose={() => { setEditEntry(null); fetchTodayLogs() }}
          onLogged={() => { setEditEntry(null); fetchTodayLogs() }}
          logDate={selectedDate}
          goals={{ calories: calorieGoal, protein: proteinGoal }}
          dayTotals={{ calories: totalCal, protein: totalPro }}
          editLogId={editEntry.id}
          initialFoodId={editEntry.food_id ?? undefined}
          initialServingId={editEntry.serving_id ?? undefined}
          initialQuantity={editEntry.quantity}
          initialSlot={slots.find(s => s.entries.some(e => e.id === editEntry.id))?.label}
          editOriginal={{ calories: editEntry.calories, protein: editEntry.protein }}
          onDelete={() => {
            const owner = slots.find(s => s.entries.some(e => e.id === editEntry.id))
            if (owner) deleteEntry(owner.id, editEntry.id)
            setEditEntry(null)
          }}
        />
      )}
      {/* Fallback for AI-logged entries (no food_id) */}
      {editEntry && !editEntry.food_id && (
        <EditPortionModal
          visible={!!editEntry}
          onClose={() => setEditEntry(null)}
          logId={editEntry.id}
          logName={editEntry.name}
          foodId={null}
          initialServingId={null}
          initialQuantity={editEntry.quantity}
          currentCalories={editEntry.calories}
          currentProtein={editEntry.protein}
          onUpdated={handleEntryUpdated}
        />
      )}

      {/* ── Pantry scan from home CTA ── */}
      <PantryScanModal
        visible={showPantryScanFromHome}
        onClose={() => setShowPantryScanFromHome(false)}
        onItemsAdded={async () => {
          setShowPantryScanFromHome(false)
          // Refresh pantry so Home flips from the "Unlock recipes" card to the meal
          // rows now that the scan added items — the initial fetch only runs on load.
          // (The staples ask now lives inside the scan review flow, not a post-scan popup.)
          await loadPantryNames()
        }}
      />

      <DislikeReasonSheet
        visible={reasonMeal !== null}
        mealName={reasonMeal?.name ?? ''}
        ingredients={(reasonMeal?.ingredients ?? []).map(i => i.name).filter(Boolean)}
        onClose={() => setReasonMeal(null)}
        onSubmit={submitDislikeReason}
        // Offered, never written. food_dislikes goes into the meal prompt as an allergen-strength
        // hard exclusion and also filters Discover, so one tap on a bad recipe must not put a food
        // there on the user's behalf.
        onIngredientsNamed={names => router.push({ pathname: '/food-preferences', params: { suggest: names.join('|') } })}
      />

    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, backgroundColor: COLORS.background },
  // 40, not 100. An earlier pass raised this believing the 80pt tab bar floated over the scroll
  // view — it doesn't, it's laid out normally, so the viewport already excludes it and the extra
  // 60 was pure dead space under "+ Add Meal".
  scrollContent: { paddingBottom: 40 },
  // paddingBottom 12 -> 8: part of ~34pt trimmed above the meal hero so the whole card clears
  // the tab bar at rest. It used to sit ~20pt below the fold, so you had to scroll to see it.
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 4 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  brandText: { fontSize: 18, fontWeight: '800', color: '#4ADE80', letterSpacing: -0.3 },
  prefBanner: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: 'rgba(0,201,167,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.3)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  planReadyCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#0F0F0F',
    borderRadius: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  planReadyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
  },
  planReadyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  planReadySub: {
    fontSize: 12,
    color: '#4ADE80',
    fontWeight: '600',
    marginTop: 2,
  },
  planReadyThumb: {
    width: 110,
  },
  planReadyImage: {
    width: 110,
    height: 110,
    borderRadius: 12,
  },
  planReadyThumbName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textWhite,
    marginTop: 6,
    lineHeight: 15,
  },
  planReadyCTA: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderRadius: 12,
  },
  planReadyCTAText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: 0.1,
  },
  prefBannerText: { flex: 1, gap: 2 },
  prefBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.1,
  },
  prefBannerSub: {
    fontSize: 13,
    color: '#00C9A7',
    fontWeight: '500',
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.trackDark },
  avatarInitial: { fontSize: 14, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  macroCard: { marginHorizontal: 20, marginBottom: 32, borderRadius: 16, borderWidth: 1, borderColor: COLORS.trackDark, backgroundColor: COLORS.cardElevated, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  macroSectionLabel: { fontSize: 10, fontWeight: '700', color: '#4ADE80', textTransform: 'uppercase', letterSpacing: 2 },
  macroCalorieText: { fontSize: 32, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  macroRingsRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 20, marginTop: 4 },
  macroBarTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 2, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: 2 },
  macroChevronRow: { alignItems: 'center', marginTop: 10 },
  macroExpandedBlock: { marginTop: 14, gap: 0 },
  macroExpandedDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 8 },
  macroExpandedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  macroExpandedLabel: { width: 62, fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  macroExpandedBarTrack: { flex: 1, height: 5, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 3, overflow: 'hidden' },
  macroExpandedValue: { width: 100, fontSize: 12, color: COLORS.textMuted, textAlign: 'right' },
  macroExpandedBold: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  macroExpandedUnit: { fontSize: 12, fontWeight: '400', color: COLORS.textMuted },
  panel: { backgroundColor: 'transparent', marginHorizontal: 20, paddingTop: 12, paddingHorizontal: 0, paddingBottom: 16 },
  panelCollapsed: { paddingTop: 0, paddingBottom: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, marginBottom: 0 },
  sectionHeaderExpanded: { paddingBottom: 0, marginBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Horizontal margin now comes from the shared header wrapper. The old style set none while the
  // header row set 20, which is why "Yesterday's picks" hugged the screen edge out of line with
  // the title directly above it.
  carryoverRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  carryoverNote: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  // Muted, matching the carryover line: this is context, not an alarm. Green would read as good news
  // and red as an error, and it is neither — the pantry is simply the limit today.
  pantryLimitNote: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600', flex: 1, lineHeight: 16 },
  carryoverSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: COLORS.textMuted, opacity: 0.5, marginHorizontal: 7 },
  // A live indicator, not a spinner — the language of a recording light. Slow enough to read as
  // breathing rather than blinking.
  livePulse: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4ADE80', marginRight: 7 },
  sweepTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(74,222,128,0.12)', overflow: 'hidden', marginTop: 8 },
  sweepFill: { width: SWEEP_W, height: '100%', borderRadius: 2, backgroundColor: '#4ADE80' },
  carryoverStatus: { fontSize: 13, color: '#4ADE80', fontWeight: '700', flexShrink: 1 },
  // Promoted from a 12px uppercase muted eyebrow. This is the app's core feature and it was
  // styled like a caption — quieter than the greeting that used to sit above it.
  // Sentence case at heading scale puts it in the same typographic system as "Good evening, Logan".
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3 },
  mealsCollapsedSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealList: { gap: 14, marginBottom: 28 },
  ratingToast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 100,
  },
  ratingToastText: { color: '#4ADE80', fontSize: 14, fontWeight: '600' },
  staplesCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  staplesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  staplesTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite },
  staplesSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  stapleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  stapleName: { fontSize: 14, fontWeight: '500', color: COLORS.textWhite, textTransform: 'capitalize' },
  stapleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stapleHaveIt: { fontSize: 12, fontWeight: '600', color: '#4ADE80' },
  stapleGrocery: { fontSize: 12, fontWeight: '600', color: '#00C9A7' },
  logSection: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 10 },
  logHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  aiEstimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#4ADE80',
    borderRadius: 30,
    paddingVertical: 14,
    marginBottom: 16,
  },
  aiEstimateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4ADE80',
  },
  // Matches sectionTitle ("Cook from your pantry") exactly. It was a 12pt muted uppercase caption,
  // which put the two headers of the same screen in two different typographic systems — the eye read
  // one as a section and the other as a label on the card below it.
  logTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3 },
  logPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  logPillBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textWhite },
  slotCard: { backgroundColor: COLORS.cardElevated, borderRadius: 14, borderWidth: 1, borderColor: COLORS.trackDark, overflow: 'hidden' },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  slotLabel: { fontSize: 10, fontWeight: '700', color: '#4ADE80', textTransform: 'uppercase', letterSpacing: 1.5 },
  slotHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotCal: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  slotDeleteRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  slotRemoveText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  slotCancelText: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted },
  slotEntries: { paddingHorizontal: 12, paddingBottom: 12 },
  slotDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 4 },
  slotEmpty: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotEmptyText: { fontSize: 12, color: COLORS.textMuted },
  slotLogBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(74,222,128,0.1)', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  slotLogBtnText: { fontSize: 12, fontWeight: '600', color: '#4ADE80' },
  deleteAction: { width: 80, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  logCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 0, gap: 10, backgroundColor: COLORS.cardElevated },
  logIconCircle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  logInfo: { flex: 1, gap: 2 },
  logName: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.1 },
  logTime: { fontSize: 11, color: COLORS.textMuted },
  logMacros: { alignItems: 'flex-end', gap: 2 },
  logCal: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  logPro: { fontSize: 11, color: COLORS.textMuted },
  addSlotBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 6 },
  addSlotText: { fontSize: 14, color: '#4ADE80', fontWeight: '600' },
  logTotal: { fontSize: 12, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: COLORS.cardElevated, borderRadius: 20, padding: 20, gap: 16, borderWidth: 1, borderColor: COLORS.trackDark },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite },
  modalInput: { backgroundColor: '#2A2A2A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textWhite },
  modalConfirm: { backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 14, alignItems: 'center' },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  logModalRow: { flexDirection: 'row', gap: 10 },
  logSlotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  logSlotChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#2A2A2A' },
  logSlotChipActive: { backgroundColor: 'rgba(74,222,128,0.15)' },
  logSlotChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  logSlotChipTextActive: { color: '#4ADE80' },

  // Hero dashboard card
  weekStrip: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  weekCell: { flex: 1, alignItems: 'center', gap: 8 },
  weekLetter: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.5 },
  weekLetterSel: { color: COLORS.textWhite },
  weekDim: { color: '#3A3A3A' },
  weekDot: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1.5, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  weekDotFuture: { borderColor: '#191919' },
  weekDotToday: { borderColor: COLORS.accent },
  // Something logged, not enough to count as tracked. Dimmer than today's ring so a partial past
  // day is visibly less than a done one without reading as a failure.
  weekDotPartial: { borderColor: COLORS.accentDim, borderWidth: 2 },
  weekDotLogged: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  // Last in the style array so it wins the BORDER on a logged day while the green fill survives —
  // a logged + selected day has to read as both.
  weekDotSelected: { borderColor: COLORS.textWhite, borderWidth: 2 },

  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    // paddingVertical 8 -> 5 -> 3: trims up here reach the meal log below.
    paddingVertical: 3,
    marginHorizontal: 20,
    marginBottom: 0,
  },
  dayNavText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textWhite,
    minWidth: 100,
    textAlign: 'center',
  },
  kcalBig: { fontSize: 40, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -1.5, lineHeight: 44 },
  kcalLabel: { fontSize: 10.5, fontWeight: '700', color: '#4ADE80', textTransform: 'uppercase', letterSpacing: 1.2 },

  heroCard: {
    marginHorizontal: 20,
    // 24 -> 14, so the meal rows below start 10pt sooner.
    marginBottom: 12,
    backgroundColor: '#0F0F0F',
    borderRadius: 24,
    paddingHorizontal: 20,
    // 20 -> 16 top and bottom: 8pt more toward fitting the meal hero above the fold. The gauge
    // itself is untouched — it's the padding around it that was doing the least work.
    paddingTop: 14,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.08)',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
  },

  // Cook Tonight rows. The photo is an 88pt SQUARE: generation renders square, so `cover` here
  // crops nothing — the old 3:2 hero lost a third of every image.
  pantryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.trackDark,
  },
  pantryRowPhoto: { width: 88, height: 88, borderRadius: 12 },
  pantryRowPhotoEmpty: { backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pantryRowName: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.1, lineHeight: 19 },
  // Green check + text, no pill: the pill row above already carries up to four chips and a fifth
  // reads as noise. Amber for a store trip; muted for a garnish, which is not a blocker.
  pantryRowReady: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pantryRowReadyText: { fontSize: 11, color: '#4ADE80', fontWeight: '700' },
  pantryRowNeed: { fontSize: 11, color: '#F59E0B', fontWeight: '600' },
  pantryRowBetter: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  discoverNudge: { marginTop: 4, alignSelf: 'center' },
  discoverNudgeText: { fontSize: 13, color: '#888888', textAlign: 'center' },
  discoverNudgeLink: { color: '#4ADE80', fontWeight: '700' },
  discoverCapWrap: { marginTop: 6, alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  // Mirrors saveButton on the meal detail screen — the app's established SECONDARY pill.
  discoverCapButton: {
    alignSelf: 'stretch', backgroundColor: COLORS.cardElevated, borderRadius: 30, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.trackDark, marginTop: 4,
  },
  discoverCapButtonText: { color: COLORS.textWhite, fontSize: 15, fontWeight: '700' },
  // Every use sets its own colours, so the base carries only the shape.
  mealPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  restingCard: {
    marginHorizontal: 20,
    height: HERO_COMPACT_H,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // Same accent border + glow as planReadyCard. Reusing that language means the card reads as
    // the app's existing "something good is waiting" signal rather than a new invention.
    borderColor: 'rgba(74,222,128,0.22)',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  restingTitle: { fontSize: 19, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3 },
  restingSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 5, textAlign: 'center', paddingHorizontal: 24 },
  // White on black at radius 30 — the app's primary-action convention. The old card was tappable
  // but nothing in it looked tappable, which is most of why it read as dead space.
  restingCTA: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 30,
  },
  restingCTAText: { fontSize: 14, fontWeight: '700', color: '#000000', letterSpacing: -0.1 },
  mealPillText: {
    // 11, not 9 — Discover's rail cards run 10 at less than half this width.
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textWhite,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Meal slot cards (MyFitnessPal style)
  mealSlotShell: { backgroundColor: COLORS.cardElevated, borderRadius: 16 },
  mealSlotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mealSlotIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealSlotLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  mealSlotCardEmpty: { paddingVertical: 10 },
  mealSlotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 },
  mealSlotTotals: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  // Opaque, so the red action stays hidden behind the row until it is swiped open.
  entryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, backgroundColor: COLORS.cardElevated },
  entryRowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  entryName: { flex: 1, fontSize: 13, fontWeight: '500', color: COLORS.textWhite, marginRight: 8 },
  entryNums: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  entryDelete: { backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginLeft: 8, borderRadius: 10 },
  entryDeleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },


  // Timeline dots
  timelineDotFilled: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    marginTop: 4,
  },
  timelineDotEmpty: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    backgroundColor: COLORS.background,
    marginTop: 4,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 4,
  },

  // Hero pantry-scan card — first-action moment for new users
  scanHero: {
    marginHorizontal: 20,
    marginBottom: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(74,222,128,0.06)',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.35)',
    alignItems: 'center',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  scanHeroVisual: {
    width: 240,
    height: 150,
    marginBottom: 18,
    position: 'relative',
    overflow: 'hidden',
  },
  // Camera-viewfinder corners: each is a 22×22 square with two thick green borders
  // creating an L shape. Together the four read as a viewfinder framing the items.
  scanCorner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: '#4ADE80',
  },
  scanCornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5 },
  scanCornerTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5 },
  scanCornerBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5 },
  scanCornerBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5 },
  // Horizontal beam — semi-transparent green line that sweeps top→bottom on a loop
  scanBeam: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 2,
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  scanHeroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 22,
    paddingHorizontal: 12,
  },
  scanHeroSub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  scanHeroBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  scanHeroBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
})
