import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  Easing,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { X, ScanLine, Check, Plus, Zap, ImageIcon, HelpCircle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Maximize2, Refrigerator, Snowflake, Package, Utensils, Container, Lightbulb } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { ScanTheater } from './ScanTheater'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { usePremium } from '@/context/SuperwallContext'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import { trackUpgradePromptShown } from '@/lib/analytics'
import { trackAIError } from '@/lib/analytics'
import { categorizeItem } from '@/lib/categories'
import { addPantryItemsDeduped } from '@/lib/pantryInsert'
import { prefetchCookNowMeals, warmMealImages } from '@/lib/mealPrefetch'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// ── Types ──────────────────────────────────────────────────────────────

type PhotoEntry = {
  id: string
  label: string
  uri?: string
  base64?: string
}

type DetectedItem = {
  id: string
  name: string
  category: string
  checked: boolean
  zone: string
  photo?: number | null // which source photo the AI saw this in (for the per-photo review). null = unknown.
  box?: [number, number, number, number] | null // [x,y,w,h] normalized 0-1 in that photo (top-left origin). Drives the tap-to-locate overlay.
  confidence?: number // AI's self-reported certainty 0-100. Server applies the floor; kept here as telemetry, not shown in the review UI.
}

type ZoneGroup = {
  zone: string
  items: DetectedItem[]
}

// Normalize a name for TRUE-duplicate matching across photos (e.g. an indoor + outdoor fridge that
// both hold milk, or the AI labeling "Egg" in one shot and "Eggs" in another). Lowercase, collapse
// whitespace, and strip a trailing plural 's' from each word. Deliberately conservative — it only
// collapses genuine same-item cases; distinct products keep their own words ("oat milk" vs
// "almond milk" vs "milk" all stay separate).
const dedupeKey = (name: string) =>
  name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/s\b/g, '')

// Merge cross-photo duplicates, keeping the FIRST occurrence (preserves its photo/zone/box). The
// per-photo review used to show every raw detection, so two fridges inflated the count with visible
// dupes ("Egg" + "Eggs"); this makes the count and the pantry write honest.
function dedupeDetected(items: DetectedItem[]): DetectedItem[] {
  const seen = new Map<string, DetectedItem>()
  for (const it of items) {
    const key = dedupeKey(it.name)
    if (!seen.has(key)) seen.set(key, it)
  }
  return Array.from(seen.values())
}

// ── Mock detected ingredients ──────────────────────────────────────────

const MOCK_DETECTED: DetectedItem[] = [
  { id: 'd1',  name: 'Chicken breast',   category: 'Protein',        checked: true },
  { id: 'd2',  name: 'Eggs',             category: 'Protein',        checked: true },
  { id: 'd3',  name: 'Greek yogurt',     category: 'Protein',        checked: true },
  { id: 'd4',  name: 'White rice',       category: 'Carbs',          checked: true },
  { id: 'd5',  name: 'Oats',             category: 'Carbs',          checked: true },
  { id: 'd6',  name: 'Whole wheat bread',category: 'Carbs',          checked: true },
  { id: 'd7',  name: 'Spinach',          category: 'Produce',        checked: true },
  { id: 'd8',  name: 'Broccoli',         category: 'Produce',        checked: true },
  { id: 'd9',  name: 'Lemon',            category: 'Produce',        checked: true },
  { id: 'd10', name: 'Garlic',           category: 'Produce',        checked: true },
  { id: 'd11', name: 'Olive oil',        category: 'Condiments',     checked: true },
  { id: 'd12', name: 'Soy sauce',        category: 'Condiments',     checked: true },
  { id: 'd13', name: 'Hot sauce',        category: 'Condiments',     checked: true },
  { id: 'd14', name: 'Milk',             category: 'Dairy',          checked: true },
  { id: 'd15', name: 'Cheddar cheese',   category: 'Dairy',          checked: true },
  { id: 'd16', name: 'Butter',           category: 'Dairy',          checked: true },
  { id: 'd17', name: 'Canned beans',     category: 'Pantry Staples', checked: true },
  { id: 'd18', name: 'Chicken stock',    category: 'Pantry Staples', checked: true },
]

const RESULT_CATEGORIES = [
  'Protein', 'Carbs', 'Produce', 'Condiments', 'Dairy', 'Pantry Staples',
]

// Real, meal-changing staples offered as one-tap chips on the review screen — NOT seasonings
// (salt/pepper/oil are assumed by meal-gen, so asking about them would be redundant). These
// genuinely vary kitchen to kitchen and unlock more cook-now meals, so we surface them in the
// flow the user is already in (curating the scan) instead of a separate post-scan popup.
const COMMON_STAPLES = ['Eggs', 'Milk', 'Butter', 'Cheese', 'Rice', 'Bread', 'Onion', 'Garlic', 'Lemon', 'Soy Sauce', 'Flour', 'Sugar']

// Context-aware quick-add suggestions, keyed by the container type the scan classifies each photo as.
// A fridge photo suggests fridge basics, a pantry photo suggests dry goods, etc. Unknown → COMMON_STAPLES.
// Maps a scan-classified container type → the display label shown for that photo's review page.
const CONTAINER_LABEL: Record<string, string> = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry', counter: 'Counter' }

const STAPLES_BY_CONTAINER: Record<string, string[]> = {
  fridge: ['Eggs', 'Milk', 'Butter', 'Cheese', 'Yogurt', 'Mayonnaise', 'Ketchup', 'Mustard', 'Orange Juice', 'Sour Cream'],
  freezer: ['Frozen Vegetables', 'Frozen Berries', 'Ice Cream', 'Frozen Chicken', 'Frozen Fish', 'Frozen Peas', 'Frozen Fruit', 'Frozen Pizza'],
  pantry: ['Rice', 'Pasta', 'Flour', 'Sugar', 'Olive Oil', 'Canned Beans', 'Canned Tomatoes', 'Cereal', 'Peanut Butter', 'Oats'],
  counter: ['Onion', 'Garlic', 'Potatoes', 'Bananas', 'Bread', 'Tomatoes', 'Apples', 'Avocado'],
}

// Max photos per scan — bounds the per-call GPT-4o vision cost. Mirrored server-side in
// scan-pantry/index.ts (which truncates) so a modified client can't exceed it. A full
// fridge + pantry fits comfortably in this many.
const MAX_PHOTOS_PER_SCAN = 8

// Time-anchored loading stages — each maps to a real server-side step in
// supabase/functions/scan-pantry/index.ts. Picked by elapsed-ms so the message
// the user sees roughly matches what the AI is actually doing right now,
// instead of random rotation that repeats mid-scan and shows misleading copy
// (e.g. "second pass" before the first pass even returns).
// Status lines shown while scanning. PROCESS-based on purpose — they describe what the AI is
// doing, never what it's finding, so they're true whether the user scanned a fridge, a pantry,
// or a single cabinet (no false "behind the milk" / "checking the door" claims). They CYCLE on
// a fixed interval and loop, so even a fast ~10s scan still feels alive instead of stalling on
// one line.
const SCAN_STATUS_LINES = [
  'Reading your shelves 🔍',
  'Decoding labels & packaging 🏷️',
  'Scanning shelf by shelf 📲',
  'Checking the back rows 👀',
  'Catching the small stuff 🔦',
  'Reading every label 📋',
  'Looking for anything hidden 🔎',
  'Inspecting each container 🫙',
  'Sorting by category 🗂️',
  'Cross-checking each item ✔️',
  'Double-checking for misses ✅',
  'Building your pantry list 🧺',
  'Almost done ✨',
]

// Hard ceiling. If the scan hasn't responded by this point something is wrong
// (OpenAI hang, network drop, mobile data flake) — abort and surface a retry
// path instead of leaving the user staring at a spinner forever.
const SCAN_HARD_TIMEOUT_MS = 180000 // 3 minutes

// Shown one-at-a-time under the camera, rotating to the next on each photo taken.
// Replaces the old standalone pre-scan tips screen — same guidance, less friction.
const CAMERA_TIPS = [
  'Pull items forward so nothing hides behind taller things',
  'Light it up — open the door fully or use flash in dim spots',
  'Stand 3-4 ft back to fit the whole shelf and keep labels sharp',
  'Tap the screen to focus before you shoot',
  'One photo per zone — pantry, fridge, and freezer separately',
]

const EXTRA_OPTIONS: { id: string; label: string; icon: any }[] = [
  { id: 'fridge',  label: 'Fridge',        icon: Refrigerator },
  { id: 'freezer', label: 'Freezer',       icon: Snowflake },
  { id: 'pantry',  label: 'Pantry',        icon: Package },
  { id: 'counter', label: 'Counter',       icon: Utensils },
  { id: 'fridge2', label: 'Second Fridge', icon: Container },
  { id: 'custom',  label: 'Custom',        icon: Plus },
]

// ── Sub-components ─────────────────────────────────────────────────────

function ProgressDots({ total, active }: { total: number; active: number }) {
  return (
    <View style={styles.progressDots}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i === active && styles.dotActive]} />
      ))}
    </View>
  )
}

// Do/don't photo pair — the hero of the prep screen. A dense shelf with buried back rows
// (✗) vs the same shelf front-faced and fully visible (✓). This is the only treatment that
// SHOWS the feature's core failure mode (hidden items in a packed pantry) instead of
// describing it, so it sets honest expectations before the user shoots.
function PrepCompare() {
  return (
    <View style={styles.prepCompareRow}>
      <View style={styles.prepCompareCard}>
        <Image source={require('../assets/scan-prep/dont.jpg')} style={[styles.prepCompareImg, styles.prepCompareImgBad]} resizeMode="cover" />
        <View style={[styles.prepBadge, styles.prepBadgeBad]}><Text style={styles.prepBadgeText}>✕</Text></View>
        <Text style={[styles.prepCompareTag, styles.prepCompareTagBad]}>Buried = missed</Text>
      </View>
      <View style={styles.prepCompareCard}>
        <Image source={require('../assets/scan-prep/do.jpg')} style={[styles.prepCompareImg, styles.prepCompareImgGood]} resizeMode="cover" />
        <View style={[styles.prepBadge, styles.prepBadgeGood]}><Text style={styles.prepBadgeText}>✓</Text></View>
        <Text style={[styles.prepCompareTag, styles.prepCompareTagGood]}>Front-faced = found</Text>
      </View>
    </View>
  )
}

// One row of the prep / "how scanning works" screen. Each row fades + rises in on a
// staggered delay (driven by `index`) so the list animates to life instead of landing flat.
function PrepTip({ emoji, bold, rest, index }: { emoji: string; bold: string; rest: string; index: number }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 340,
      delay: 140 + index * 90, // each row trails the one above it
      useNativeDriver: true,
    }).start()
  }, [])
  return (
    <Animated.View
      style={[
        styles.prepTipRow,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      <View style={styles.prepTipChip}>
        <Text style={styles.prepTipEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.prepTipText}>
        <Text style={styles.prepTipBold}>{bold}</Text>{rest}
      </Text>
    </Animated.View>
  )
}

function PhotoThumbnail({ label, uri }: { label: string; uri?: string }) {
  return (
    <View style={styles.thumbnail}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbnailImg} resizeMode="cover" />
      ) : (
        <View style={styles.thumbnailImg}>
          <ScanLine size={16} stroke="#4ADE80" strokeWidth={1.5} />
        </View>
      )}
      <View style={styles.thumbnailCheck}>
        <Check size={8} stroke="#000" strokeWidth={3} />
      </View>
      <Text style={styles.thumbnailLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────

type Props = {
  visible: boolean
  onClose: () => void
  onItemsAdded?: () => void
  // When provided, a saved scan offers the cook-reveal payoff. First scan auto-reveals
  // (the magic moment); later scans get a "See meals / Maybe later" choice. Omit it (e.g.
  // the Home entry) to keep the old close-immediately behavior and run a different flow.
  onSeeMeals?: () => void
}

const COOK_REVEAL_SEEN_KEY = 'cook_reveal_seen_v1'

export default function PantryScanModal({ visible, onClose, onItemsAdded, onSeeMeals }: Props) {
  const { user } = useAuth()
  const { requestConsent } = useAIConsent()
  const { isPremium, triggerUpgrade } = usePremium()
  const { registerPlacement } = useSuperwall()
  const insets = useSafeAreaInsets()
  // Tracks a subscription that happens DURING the in-scan paywall, so a user who pays at the
  // gate continues into the scan they just unlocked instead of being dropped back to pantry.
  // isPremium in the scan closure is stale (captured false), so we read this ref instead.
  const purchasedRef = useRef(false)
  useSuperwallEvents({
    onSubscriptionStatusChange: (status) => { if (status?.status === 'ACTIVE') purchasedRef.current = true },
  })
  // Flow starts on the camera (step 1) — tips now live inline near the shutter
  // instead of a separate pre-scan screen.
  const [step, setStep] = useState(1)
  // Bumped to force a re-run of the scan effect when the user taps "Retry"
  // after a scan failure — keeps the captured photos intact.
  const [retryNonce, setRetryNonce] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [pendingLabel, setPendingLabel] = useState<string | null>(null) // area label queued when "add area" is tapped from the hub
  const [showDone, setShowDone] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])

  // Prefetch cook-now meals the moment a scan produces items and we're heading toward the
  // cook-reveal (onSeeMeals wired) — NOT the Home-entry path. Runs during the user's review
  // window so the reveal is instant instead of a second loading screen. Text only; fires once
  // per modal-open (reset below) so a review re-render doesn't re-trigger it.
  const prefetchFiredRef = useRef(false)
  useEffect(() => { if (visible) prefetchFiredRef.current = false }, [visible])
  useEffect(() => {
    if (prefetchFiredRef.current || !user || !onSeeMeals) return
    const names = detectedItems.filter(i => i.checked).map(i => i.name)
    if (names.length === 0) return
    prefetchFiredRef.current = true
    prefetchCookNowMeals(user.id, names)
  }, [detectedItems, user, onSeeMeals, visible])
  // Per-photo container type from the scan (fridge/freezer/pantry/counter) → context-aware quick-adds.
  const [photoContainers, setPhotoContainers] = useState<string[]>([])
  // Friendly area name per photo from its classified container ("Fridge"/"Freezer"/…). Lifted to
  // component scope so both the loading theatre and the review carousel use the same labels.
  // Caption label chain: prefer the AI-detected container (only set post-scan), otherwise the label
  // the photo was captured under (Fridge/Freezer/Pantry/Counter…) so the scan animation shows the
  // real area instead of a generic "Photo N". The numeric fallback is now effectively unreachable.
  const areaLabel = (idx: number) => CONTAINER_LABEL[(photoContainers[idx] || '').toLowerCase()] ?? photos[idx]?.label ?? `Photo ${idx + 1}`
  const [zones, setZones] = useState<ZoneGroup[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // synchronous in-flight guard so a double-tap / close race can't double-insert
  const [showPrep, setShowPrep] = useState(false) // first-run "how scanning works" overlay (sets expectations + coaches better photos)
  // Per-photo review carousel state
  const [currentPhoto, setCurrentPhoto] = useState(0)
  // Natural pixel dims per photo uri (from Image onLoad) → render the review photo at its TRUE
  // aspect ratio instead of a cropped fixed height, so the normalized detection boxes map on 1:1.
  const [photoDims, setPhotoDims] = useState<Record<string, { w: number; h: number }>>({})
  // Which detected item's box is highlighted on the photo (tap a chip to locate it; tap again clears).
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null)
  const photoScrollRef = useRef<ScrollView>(null) // current page's vertical pan — scroll-to-box on chip tap
  const pagerRef = useRef<ScrollView>(null)
  const nudgedRef = useRef(false) // one-time "it swipes" nudge guard
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0)
  const [missedInput, setMissedInput] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null) // which detected chip is being renamed inline
  const [editingText, setEditingText] = useState('')
  const [addingMissed, setAddingMissed] = useState(false)
  // Post-save success step (returning scanners only) — offers the cook-reveal vs "maybe later".
  const [showSaved, setShowSaved] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  // Tapped review photo → fullscreen pinch-to-zoom overlay (in-tree, not a nested Modal).
  const [zoomUri, setZoomUri] = useState<string | null>(null)
  // Live-feel item counter: ramps up WHILE scanning (simulated — GPT returns all
  // items at once, so there's nothing real to stream), then settles to the true
  // total when results land. countRef mirrors it so the effects can read the latest
  // value without re-subscribing on every tick.
  const [spottedCount, setSpottedCount] = useState(0)
  const spottedCountRef = useRef(0)
  useEffect(() => { spottedCountRef.current = spottedCount }, [spottedCount])

  // Camera
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [flashOn, setFlashOn] = useState(false)

  // Drives the scanning beam that sweeps top→bottom over the viewfinder — same motif as the
  // home "Scan your pantry" hero card, so the loading screen reads as the same scan action.
  const beamAnim = useRef(new Animated.Value(0)).current

  // Loading animation + actual AI scan. retryNonce is in the dep list so the
  // user's "Retry" tap on the error screen re-fires this effect without
  // needing them to re-take photos.
  useEffect(() => {
    if (step !== 5) return
    setScanError(null)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamAnim, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(beamAnim, { toValue: 0, duration: 0, useNativeDriver: true }), // snap back to sweep again
      ])
    )
    loop.start()

    const scanPhotos = async () => {
      const base64Images = photos.filter(p => p.base64).map(p => p.base64!)
      if (base64Images.length === 0) {
        setShowDone(true)
        return
      }
      // Premium-only model: non-subscribers hit paywall on every gated action,
      // never get a "free preview" allotment. Single check, no counters.
      if (!isPremium) {
        trackUpgradePromptShown('scan_limit')
        await triggerUpgrade('pantry_scan_limit') // Superwall placement — blocks until paywall dismissed
        // If they subscribed at the gate, fall through and run the scan they just paid for —
        // don't dump them back to the pantry screen. Short settle delay lets the subscription-
        // status event land so purchasedRef is accurate (mirrors the onboarding paywall pattern).
        await new Promise(r => setTimeout(r, 400))
        if (!purchasedRef.current) { handleClose(); return } // dismissed without subscribing → close
        // subscribed → continue into the consent + scan + review flow below
      }
      try {
        // Race the ENTIRE remaining flow (consent gate + invoke) against one hard
        // timeout — not just the invoke. The consent prompt is a separate root-level
        // modal that can't render over this scan modal; if it fails to resolve the user
        // would hang forever, because the old timeout sat AFTER `await requestConsent()`
        // and never even armed while consent was pending. Racing the whole flow
        // guarantees a recoverable error+retry instead of an infinite spinner.
        const scanResult = await Promise.race([
          (async () => {
            // First-run consent gate — discloses that pantry photos are sent to OpenAI Vision
            const ok = await requestConsent()
            if (!ok) return { declined: true as const }
            const { data, error } = await supabase.functions.invoke('scan-pantry', { body: { images: base64Images } })
            if (error) throw error
            return { data }
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Scan is taking too long. Tap retry to try again.')), SCAN_HARD_TIMEOUT_MS)
          ),
        ])
        if ('declined' in scanResult) { onClose(); return }
        const result = scanResult.data as { layout: string; photoContainers?: string[]; zones: { zone: string; items: { name: string; category: string; photo?: number }[] }[] }
        let itemIndex = 0
        const allItems: DetectedItem[] = []
        const zoneGroups: ZoneGroup[] = []

        for (const zoneData of (result.zones || [])) {
          const zoneItems: DetectedItem[] = zoneData.items.map((item: any) => {
            const detected: DetectedItem = {
              id: `d${itemIndex++}`,
              name: item.name,
              category: RESULT_CATEGORIES.includes(item.category) ? item.category : 'Other',
              checked: true,
              zone: zoneData.zone,
              // Which source photo the AI attributed this item to — kept for the per-photo
              // review. Defaults to null when the model omits it (falls back to a "More" page).
              photo: typeof item.photo === 'number' ? item.photo : null,
              // AI-estimated location of the item in its photo, normalized [x,y,w,h] 0-1 (top-left
              // origin). Null when the model omits/malforms it — chip just isn't tap-to-locate then.
              box: Array.isArray(item.box) && item.box.length === 4 && item.box.every((n: any) => typeof n === 'number')
                ? item.box as [number, number, number, number] : null,
              // Numeric 0-100 now (was 'high'/'low'). Server already floor-drops the noise; this
              // is passthrough telemetry. Tolerate the old string form so an in-flight/older
              // response never lands NaN in state.
              confidence: typeof item.confidence === 'number' ? item.confidence
                : item.confidence === 'low' ? 30 : 90,
            }
            return detected
          })
          allItems.push(...zoneItems)
          zoneGroups.push({ zone: zoneData.zone, items: zoneItems })
        }

        // Dedupe across photos before anything reads the list — so the count, the review list, and
        // the pantry write all agree on ONE honest number (no more "27 found" / "Add all 49").
        setDetectedItems(dedupeDetected(allItems))
        setZones(zoneGroups)
        // Per-photo container type drives the context-aware quick-add rail in the review.
        setPhotoContainers(Array.isArray(result.photoContainers) ? result.photoContainers.map((c: any) => String(c || '').toLowerCase()) : [])
        setShowDone(true)
      } catch (e: any) {
        // Surface the error inline (loading screen flips to error state with a
        // Retry button) instead of bouncing to the empty review screen. Photos
        // stay in state so the retry doesn't re-charge the user for re-shooting.
        // supabase functions.invoke puts a generic message on e.message and the
        // real server body ({ error, code }) on e.context (a Response) — unwrap it
        // so the user sees the actual reason (daily cap, OpenAI timeout, etc.).
        let msg = e?.message || 'Something went wrong analyzing your photos.'
        if (e?.context && typeof e.context.json === 'function') {
          try { const body = await e.context.json(); if (body?.error) msg = body.error } catch { /* keep generic */ }
        }
        trackAIError('scan-pantry', e, { shown: msg })
        setScanError(msg)
      }
    }
    scanPhotos()

    return () => { loop.stop() }
  }, [step, retryNonce])

  // Advance the status copy every 3s. 13 lines × 3s ≈ 39s of unique copy, so a typical scan
  // finishes before it ever loops; the modulo is just a safety net for unusually long scans.
  // The line itself animates in (see msgAnim effect) so each change reads as fresh, not stale.
  useEffect(() => {
    if (step !== 5 || showDone) return
    setLoadingMessageIdx(0)
    const interval = setInterval(() => {
      setLoadingMessageIdx(i => (i + 1) % SCAN_STATUS_LINES.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [step, showDone])

  // Fade + lift each new status line in so a 3s hold never feels static.
  const msgAnim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (step !== 5 || showDone) return
    msgAnim.setValue(0)
    Animated.timing(msgAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
  }, [loadingMessageIdx, step, showDone])

  // NO fake live count while scanning. A fabricated ramp can only feel wrong — it overshot on long
  // scans (counted to 90, dropped to 52) and crawled on short ones (ticked to 8 once every couple
  // seconds, then jumped to 27). Both read as broken. Instead: keep it at 0 during the wait — the
  // sweeping beam + rotating status lines carry "it's working" — and reveal the REAL total with a
  // fast count-up the instant results land (Phase 2). Reset to 0 whenever a scan (re)starts.
  useEffect(() => {
    if (step === 5 && !showDone) { setSpottedCount(0); spottedCountRef.current = 0 }
  }, [step, showDone, retryNonce])

  // Phase 2 — the reveal. Count 0 → real total with a FAST, fixed-duration ramp (~0.6s no matter
  // the item count) the moment results land, so it's always snappy AND accurate — never a slow tick,
  // never a mismatch. Light haptics tick along for a satisfying "brrrt".
  useEffect(() => {
    const target = detectedItems.length
    if (!showDone || target === 0) return
    const inc = Math.max(1, Math.ceil(target / 16)) // ~16 frames to the total, whatever it is
    let current = 0
    setSpottedCount(0)
    spottedCountRef.current = 0
    let lastHaptic = 0
    const id = setInterval(() => {
      current = Math.min(target, current + inc)
      spottedCountRef.current = current
      setSpottedCount(current)
      const now = Date.now()
      if (now - lastHaptic > 50) { lastHaptic = now; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}) }
      if (current >= target) {
        clearInterval(id)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) // the "done!" thud that lands the count
      }
    }, 36)
    return () => clearInterval(id)
  }, [showDone, detectedItems.length])

  // Tap a chip → pan the photo so its detection box is in view (the box highlights via activeBoxId).
  // Uses the item's own photo dims; no-op until that photo's dims have loaded.
  useEffect(() => {
    if (!activeBoxId) return
    const it = detectedItems.find(d => d.id === activeBoxId)
    if (!it?.box) return
    const uri = photos[it.photo ?? 0]?.uri
    const d = uri ? photoDims[uri] : undefined
    if (!d) return
    const imgH = SCREEN_W * (d.h / d.w)
    const targetY = Math.max(0, it.box[1] * imgH - 48) // a little headroom above the box
    photoScrollRef.current?.scrollTo({ y: targetY, animated: true })
  }, [activeBoxId])

  // Auto-pan each review photo to WHERE THE FOOD IS on open/swipe. Portrait shots (phone held
  // vertical) are taller than the frame, and the inner scroll defaults to the TOP — which is the
  // ceiling / cabinet tops / empty shelf ABOVE the food. That reads as "it photographed the wrong
  // thing." We scroll to the median vertical position of THIS photo's detected boxes so the actual
  // items are centered in frame the moment the page opens. Falls back to photo-center when a photo
  // has no boxes. Re-runs when photoDims load (dims arrive async after the image renders).
  useEffect(() => {
    if (step !== 55) return
    const uri = photos[currentPhoto]?.uri
    const d = uri ? photoDims[uri] : undefined
    if (!d) return
    const imgH = SCREEN_W * (d.h / d.w)
    const frameH = Math.min(imgH, Math.round(SCREEN_H * 0.15)) // keep in sync with the render frame
    if (imgH <= frameH + 1) return // whole photo already fits the frame — nothing to pan
    const centers = detectedItems
      .filter(it => (it.photo ?? 0) === currentPhoto && it.box)
      .map(it => it.box![1] + it.box![3] / 2)
      .sort((a, b) => a - b)
    const centerFrac = centers.length ? centers[Math.floor(centers.length / 2)] : 0.5 // median, else center
    const targetY = Math.max(0, Math.min(centerFrac * imgH - frameH / 2, imgH - frameH))
    // Small delay so the pager settles on the new page and its inner ScrollView re-attaches the ref.
    const t = setTimeout(() => photoScrollRef.current?.scrollTo({ y: targetY, animated: true }), 120)
    return () => clearTimeout(t)
  }, [step, currentPhoto, photoDims, detectedItems])

  // Request camera permission when modal opens
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission()
    }
  }, [visible])

  // Show the "how scanning works" prep screen on the user's FIRST scan only (re-openable via
  // the ? on the camera). Sets the expectation that hidden items aren't seen + coaches the
  // photo behaviors that actually move vision accuracy.
  const SCAN_PREP_SEEN_KEY = 'scan_prep_seen_v1'
  useEffect(() => {
    if (!visible) return
    AsyncStorage.getItem(SCAN_PREP_SEEN_KEY).then(v => { if (!v) setShowPrep(true) })
  }, [visible])
  const dismissPrep = () => {
    setShowPrep(false)
    AsyncStorage.setItem(SCAN_PREP_SEEN_KEY, '1').catch(() => {})
  }

  // One-time "it swipes" nudge when the multi-photo review first opens — the pager twitches
  // toward the next photo and springs back, the strongest reliable swipe-affordance signal.
  useEffect(() => {
    if (step !== 55 || nudgedRef.current || photos.length <= 1) return
    nudgedRef.current = true
    const t1 = setTimeout(() => pagerRef.current?.scrollTo({ x: 48, animated: true }), 550)
    const t2 = setTimeout(() => pagerRef.current?.scrollTo({ x: 0, animated: true }), 1000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [step, photos.length])

  const handleClose = () => {
    if (savingRef.current) return // don't close mid-save — a racing close could orphan a partial insert
    onClose()
    // Defer the reset until after the slide-out animation (~300ms) so the current
    // screen — e.g. the results view — collapses straight down instead of flashing
    // the camera/first step on the way out. State is fresh by the next open.
    setTimeout(() => {
      setStep(1)
      setPhotos([])
      setPendingLabel(null)
      setShowDone(false)
      setCustomLabel('')
      setShowCustomInput(false)
      setDetectedItems([])
      setZones([])
      setFlashOn(false)
      setMissedInput('')
      setAddingMissed(false)
      setShowSaved(false)
      setZoomUri(null)
      setCurrentPhoto(0)
      nudgedRef.current = false
      setScanError(null)
      setRetryNonce(0)
    }, 350)
  }

  // Parse comma- or newline-separated names, categorize each via the LLM-backed
  // helper, append to the detected list under a "Added manually" zone.
  // One-tap add for a common staple chip — same path as a manually-typed missed item, so it
  // saves with the scan and rides the cook-reveal. Dedupes against what's already detected.
  const addStapleChip = async (name: string) => {
    if (detectedItems.some(d => d.name.toLowerCase() === name.toLowerCase())) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    const item: DetectedItem = {
      id: `staple-${Date.now()}-${name}`,
      name,
      category: await categorizeItem(name),
      checked: true,
      zone: 'Added manually',
      photo: photos.length > 0 ? Math.min(currentPhoto, photos.length - 1) : null,
    }
    setDetectedItems(prev => [...prev, item])
  }

  const addMissedItems = async () => {
    const names = missedInput
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (names.length === 0) return
    // Same dedup key as the pantry insert (lib/pantryInsert.ts): lowercased+trimmed name. Drops
    // anything already in the list AND repeats within this batch, so you can't type an item the
    // scan already found. The list is filtered by this same text, so the existing row is visible
    // right above the input — the duplicate is prevented and explained at once.
    const seen = new Set(detectedItems.map(d => d.name.toLowerCase().trim()))
    const fresh = names.filter(n => {
      const key = n.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (fresh.length === 0) { setMissedInput(''); return }
    setAddingMissed(true)
    try {
      const newItems: DetectedItem[] = await Promise.all(
        fresh.map(async (name, i) => ({
          id: `manual-${Date.now()}-${i}`,
          name,
          category: await categorizeItem(name),
          checked: true,
          zone: 'Added manually',
          // Tag manually-added items to the photo currently on screen so they appear on its page.
          photo: photos.length > 0 ? Math.min(currentPhoto, photos.length - 1) : null,
        }))
      )
      setDetectedItems(prev => [...prev, ...newItems])
      setZones(prev => {
        const manualZone = prev.find(z => z.zone === 'Added manually')
        if (manualZone) {
          return prev.map(z =>
            z.zone === 'Added manually'
              ? { ...z, items: [...z.items, ...newItems] }
              : z
          )
        }
        return [...prev, { zone: 'Added manually', items: newItems }]
      })
      setMissedInput('')
    } finally {
      setAddingMissed(false)
    }
  }

  // Full-res iPhone photos are multi-MB as base64 and stall the upload before the
  // scan can start. GPT-4o high-detail vision caps input at ~2048px long edge /
  // 768px short edge internally, so 2048px is the exact ceiling the model uses —
  // resizing to it loses ZERO model-visible detail while cutting the payload ~3-4x.
  // Quality 0.95 keeps re-compression near-lossless so small label text stays crisp.
  const downscaleToBase64 = async (uri: string): Promise<string | undefined> => {
    const out = await manipulateAsync(uri, [{ resize: { width: 2048 } }], {
      compress: 0.95, format: SaveFormat.JPEG, base64: true,
    })
    return out.base64 ?? undefined
  }

  // Commit an inline chip rename. Empty → keep the old name. Idempotent (onSubmit + onBlur both fire).
  const commitRename = (id: string, name: string) => {
    const trimmed = name.trim()
    setDetectedItems(prev => prev.map(d => d.id === id ? { ...d, name: trimmed || d.name } : d))
    setEditingId(null)
    setEditingText('')
  }

  const capturePhoto = async (label: string, next: number) => {
    if (!cameraRef.current) return
    if (photos.length >= MAX_PHOTOS_PER_SCAN) {
      Alert.alert('Photo limit', `You can include up to ${MAX_PHOTOS_PER_SCAN} photos per scan.`)
      return
    }
    try {
      // Capture near-lossless (quality 1, no base64), then do the single resize +
      // re-encode in downscaleToBase64 — avoids the old double-compression that
      // destroyed label readability while still keeping the upload small.
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 })
      if (photo) {
        const base64 = await downscaleToBase64(photo.uri)
        setPhotos(prev => [...prev, {
          id: String(Date.now()),
          label,
          uri: photo.uri,
          base64,
        }])
      }
    } catch (e) {
      Alert.alert('Capture failed', 'Could not take photo.')
    }
    setPendingLabel(null) // consumed the queued "add this area" label (if any)
    setStep(next)
  }

  const launchGallery = async (label: string, next: number) => {
    if (photos.length >= MAX_PHOTOS_PER_SCAN) {
      Alert.alert('Photo limit', `You can include up to ${MAX_PHOTOS_PER_SCAN} photos per scan.`)
      return
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photo access needed', 'Please allow photo library access in Settings.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      const base64 = await downscaleToBase64(result.assets[0].uri)
      setPhotos(prev => [...prev, {
        id: String(Date.now()),
        label,
        uri: result.assets[0].uri,
        base64,
      }])
      setPendingLabel(null) // consumed the queued "add this area" label (if any)
      setStep(next)
    }
  }

  const addExtraPhoto = async (label: string) => {
    if (photos.length >= MAX_PHOTOS_PER_SCAN) {
      Alert.alert('Photo limit', `You can include up to ${MAX_PHOTOS_PER_SCAN} photos per scan.`)
      return
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') return
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      const base64 = await downscaleToBase64(result.assets[0].uri)
      setPhotos(prev => [...prev, {
        id: String(Date.now()),
        label,
        uri: result.assets[0].uri,
        base64,
      }])
    }
  }

  const toggleItem = (id: string) => {
    setDetectedItems(prev =>
      prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i)
    )
  }

  const checkedCount = detectedItems.filter(i => i.checked).length

  const grouped = RESULT_CATEGORIES.map(cat => ({
    category: cat,
    items: detectedItems.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0)

  // The modal's SafeAreaView intentionally excludes 'top' so the camera steps
  // can be full-bleed. Every NON-camera step must compensate manually or the
  // top-left close button renders behind the status bar / Dynamic Island.
  // Use this style on every non-camera step container.
  const stepWithSafeTop = [styles.step, { paddingTop: insets.top + 8 }]

  // The review screen's photo grid is ~400px tall — with the keyboard up there isn't room for it
  // AND the list AND the input, so the input ended up underneath the keyboard. Collapse the grid
  // while typing: you're searching the list at that point, not looking at thumbnails.
  const [keyboardUp, setKeyboardUp] = useState(false)
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const s = Keyboard.addListener(showEvt, () => setKeyboardUp(true))
    const h = Keyboard.addListener(hideEvt, () => setKeyboardUp(false))
    return () => { s.remove(); h.remove() }
  }, [])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['bottom']}>

        {/* ── Prep / "how scanning works" overlay (first run + ? button) ── */}
        {showPrep && (
          <View style={[styles.prepOverlay, { paddingTop: insets.top + 16 }]}>
            <ScrollView contentContainerStyle={styles.prepScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.prepTitle}>A quick prep = a better scan</Text>
              <Text style={styles.prepIntro}>Pantry reads what the camera can see. Items tucked behind others are its blind spot — pull them forward so nothing gets missed.</Text>
              <PrepCompare />
              <View style={styles.prepTips}>
                <PrepTip index={0} emoji="🔍" bold="One shelf per photo" rest=" — get up close" />
                <PrepTip index={1} emoji="🏷️" bold="Labels facing out" rest=" — separates lookalikes" />
                <PrepTip index={2} emoji="🍽️" bold="Packed? Lay it flat" rest=" — one layer on the counter" />
              </View>
              <Text style={styles.prepFootnote}>You'll review every photo and fix misses after.</Text>
            </ScrollView>
            <View style={styles.prepActions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={dismissPrep} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Got it — start scanning</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Post-save success step — returning scanners choose the cook-reveal or skip ── */}
        {showSaved && (
          <View style={[styles.savedOverlay, { paddingTop: insets.top + 16 }]}>
            <View style={styles.savedBody}>
              <View style={styles.savedCheck}><Check size={40} stroke="#000000" strokeWidth={3} /></View>
              <Text style={styles.savedTitle}>{savedCount} item{savedCount !== 1 ? 's' : ''} added</Text>
              <Text style={styles.savedSub}>Now the good part — we've lined up meals you can cook right now with what you have. No shopping.</Text>
            </View>
            <View style={styles.savedActions}>
              <TouchableOpacity style={[styles.primaryBtn, { flexDirection: 'row', gap: 6, justifyContent: 'center' }]} activeOpacity={0.85} onPress={() => { handleClose(); onSeeMeals?.() }}>
                <Text style={styles.primaryBtnText}>See what you can cook</Text>
                <ChevronRight size={18} stroke="#000000" strokeWidth={2.6} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.savedLater} activeOpacity={0.7} onPress={() => handleClose()}>
                <Text style={styles.savedLaterText}>Maybe later</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Steps 1-3: Camera steps ── */}
        {(step === 1 || step === 2 || step === 3) && (() => {
          const stepConfig = {
            // Single-photo-first: the first capture lands straight on the review/scan hub (step 4) —
            // no forced pantry→fridge→counter march. Extra areas are added optionally from the hub.
            1: { dotIndex: 0, label: 'Kitchen', title: 'Scan your kitchen', subtitle: 'Snap your fridge, pantry, or freezer to start', next: 4 },
            2: { dotIndex: 1, label: 'Fridge', title: 'Now photograph your fridge', subtitle: 'Open it up and capture the full interior', next: 4 },
            3: { dotIndex: 2, label: 'Counter', title: 'Anything on your counter?', subtitle: 'Fruits, oils, or anything sitting out', next: 4 },
          }[step]!
          // Adding a specific area from the hub captures it with the SAME in-app camera as the first
          // photo — pendingLabel carries the chosen area's name so the photo is labeled correctly.
          const captureLabel = pendingLabel ?? stepConfig.label
          const captureTitle = pendingLabel ? `Photograph your ${pendingLabel.toLowerCase()}` : stepConfig.title
          return (
            <View style={styles.cameraScreen}>
              {/* Full-bleed camera — fills the screen edge to edge, controls overlay on top */}
              {permission?.granted ? (
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  enableTorch={flashOn}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.cameraPermFallback]}>
                  <Text style={{ color: COLORS.textMuted }}>Camera permission required</Text>
                </View>
              )}

              {/* Corner brackets */}
              <View style={[styles.bracket, styles.bracketTL]} />
              <View style={[styles.bracket, styles.bracketTR]} />
              <View style={[styles.bracket, styles.bracketBL]} />
              <View style={[styles.bracket, styles.bracketBR]} />

              {/* Top scrim keeps the X / help / count legible over a bright frame */}
              <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={styles.cameraTopScrim} pointerEvents="none" />
              <View style={[styles.cameraTopBar, { top: insets.top + 12 }]}>
                <TouchableOpacity style={styles.cameraCloseBtn} onPress={handleClose}>
                  <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                </TouchableOpacity>
                <View style={styles.cameraTopCenter}>
                  {photos.length > 0 && <Text style={styles.cameraCountText}>{photos.length} photo{photos.length !== 1 ? 's' : ''}</Text>}
                </View>
                <TouchableOpacity style={styles.cameraCloseBtn} onPress={() => setShowPrep(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <HelpCircle size={20} stroke="#FFFFFF" strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Captured thumbnails — top-left under the bar, out of the shutter's way */}
              {photos.length > 0 && (
                <View style={[styles.cameraPhotoRow, { top: insets.top + 60 }]}>
                  {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} uri={p.uri} />)}
                </View>
              )}

              {/* Bottom scrim carries the copy + shutter so text is always readable over the camera */}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']} style={[styles.cameraBottomOverlay, { paddingBottom: insets.bottom + 14 }]}>
                <View style={styles.stepTextCompact}>
                  <Text style={styles.cameraTitle}>{captureTitle}</Text>
                  <Text style={styles.cameraSubtitle}>{stepConfig.subtitle}</Text>
                  <View style={styles.cameraTipRow}>
                    <Lightbulb size={13} stroke="rgba(255,255,255,0.75)" strokeWidth={2} />
                    <Text style={styles.cameraTip}>{CAMERA_TIPS[photos.length % CAMERA_TIPS.length]}</Text>
                  </View>
                </View>

                <View style={styles.shutterRow}>
                  <TouchableOpacity style={styles.flashBtn} onPress={() => setFlashOn(f => !f)} activeOpacity={0.7}>
                    <Zap size={20} stroke={flashOn ? '#FFD700' : '#FFFFFF'} strokeWidth={2} fill={flashOn ? '#FFD700' : 'none'} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shutterBtn} onPress={() => capturePhoto(captureLabel, 4)} activeOpacity={0.85}>
                    <View style={styles.shutterInner} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.flashBtn} onPress={() => launchGallery(captureLabel, 4)} activeOpacity={0.7}>
                    <ImageIcon size={20} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                {/* Only offer "done" once there's a photo — first capture required; after that one is enough. */}
                {photos.length > 0 && (
                  <TouchableOpacity onPress={() => setStep(4)} activeOpacity={0.7}>
                    <Text style={styles.cameraDoneText}>Done — review {photos.length} photo{photos.length !== 1 ? 's' : ''} →</Text>
                  </TouchableOpacity>
                )}
              </LinearGradient>
            </View>
          )
        })()}

        {/* ── Step 4: Add More ── */}
        {step === 4 && (
          <View style={stepWithSafeTop}>
            <View style={styles.topBar}>
              {/* X first, flex spacer after — keeps the close affordance in the
                  same top-left position across every step of the modal. */}
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.addMoreScroll}>
              <Text style={styles.hubTitle}>More areas, <Text style={styles.hubTitleAccent}>better meals</Text></Text>
              <Text style={styles.hubSubtitle}>One photo's plenty — scan now, or add more below.</Text>

              {/* Captured so far — tangible progress, so the screen reads as a collection you're building. */}
              {photos.length > 0 && (
                <View style={styles.capturedSection}>
                  <Text style={styles.sectionEyebrow}>CAPTURED · {photos.length}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.capturedRow}>
                    {photos.map(p => (
                      <View key={p.id} style={styles.capturedCard}>
                        {/* Tap the thumbnail to check the shot full-screen before scanning — the ✕ /
                            check badges sit above it (absolute), so they still take their own taps. */}
                        <TouchableOpacity
                          activeOpacity={0.85}
                          disabled={!p.uri}
                          onPress={() => p.uri && setZoomUri(p.uri)}
                          style={styles.capturedImg}
                        >
                          {p.uri
                            ? <Image source={{ uri: p.uri }} style={styles.capturedImg} resizeMode="cover" />
                            : <View style={[styles.capturedImg, styles.capturedImgEmpty]}><ScanLine size={18} stroke="#4ADE80" strokeWidth={1.5} /></View>}
                        </TouchableOpacity>
                        <View style={styles.capturedCheck}><Check size={11} stroke="#000" strokeWidth={3} /></View>
                        {/* Tap ✕ to drop this photo; removing the last one bounces back to the camera
                            (can't scan zero). Silent, no confirm — matches the app's UX convention. */}
                        <TouchableOpacity
                          style={styles.capturedRemove}
                          onPress={() => {
                            const next = photos.filter(x => x.id !== p.id)
                            setPhotos(next)
                            if (next.length === 0) setStep(1)
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <X size={12} stroke="#FFFFFF" strokeWidth={2.5} />
                        </TouchableOpacity>
                        <View style={styles.capturedLabelWrap}><Text style={styles.capturedLabel} numberOfLines={1}>{p.label}</Text></View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              <Text style={[styles.sectionEyebrow, { marginTop: 26 }]}>ADD AN AREA</Text>
              <View style={styles.areaGrid}>
                {EXTRA_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  if (opt.id === 'custom') {
                    return (
                      <View key={opt.id} style={styles.areaCardWrap}>
                        {showCustomInput ? (
                          <View style={styles.customCard}>
                            <TextInput
                              style={styles.customInput}
                              placeholder="Label..."
                              placeholderTextColor={COLORS.textMuted}
                              value={customLabel}
                              onChangeText={setCustomLabel}
                              autoFocus
                            />
                            <TouchableOpacity
                              style={[styles.customAddBtn, !customLabel.trim() && { opacity: 0.4 }]}
                              onPress={() => {
                                if (!customLabel.trim()) return
                                setPendingLabel(customLabel.trim())
                                setCustomLabel('')
                                setShowCustomInput(false)
                                setStep(1)
                              }}
                              disabled={!customLabel.trim()}
                            >
                              <Text style={styles.customAddBtnText}>Add</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={styles.areaCard} onPress={() => setShowCustomInput(true)} activeOpacity={0.85}>
                            <View style={styles.areaIconWrap}><Plus size={22} stroke="#4ADE80" strokeWidth={2} /></View>
                            <Text style={styles.areaCardText}>Custom</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  }
                  return (
                    <View key={opt.id} style={styles.areaCardWrap}>
                      <TouchableOpacity
                        style={styles.areaCard}
                        onPress={() => { setPendingLabel(opt.label); setStep(1) }}
                        activeOpacity={0.85}
                      >
                        <View style={styles.areaIconWrap}>
                          <Icon size={22} stroke="#4ADE80" strokeWidth={1.8} />
                        </View>
                        <Text style={styles.areaCardText}>{opt.label}</Text>
                      </TouchableOpacity>
                    </View>
                  )
                })}
              </View>
            </ScrollView>
            <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              <TouchableOpacity style={[styles.primaryBtn, { flexDirection: 'row', gap: 8, justifyContent: 'center' }]} onPress={() => setStep(5)} activeOpacity={0.85}>
                <ScanLine size={18} stroke="#000000" strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>Scan {photos.length} Photo{photos.length !== 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 5: Loading ── */}
        {step === 5 && (
          <View style={stepWithSafeTop}>
            {/* closeBtnAbs uses absolute positioning; override right→left and
                push down by the safe-area inset so X lands below the status
                bar at top-LEFT, matching the convention used by every other
                step. */}
            <TouchableOpacity
              style={[styles.closeBtn, styles.closeBtnAbs, { top: insets.top + 8, left: 8, right: undefined }]}
              onPress={handleClose}
            >
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>

            {/* Loading body — LIVE DETECTION THEATRE while scanning (the user's own photos scanned
                section-by-section, boxes popping as the sweep passes), or an error card on failure. */}
            {scanError ? (
              <View style={styles.loadingBody}>
                <View style={styles.scanFrame}>
                  <View style={[styles.scanCorner, styles.scanCornerTL]} />
                  <View style={[styles.scanCorner, styles.scanCornerTR]} />
                  <View style={[styles.scanCorner, styles.scanCornerBL]} />
                  <View style={[styles.scanCorner, styles.scanCornerBR]} />
                  <ScanLine size={40} stroke="#F87171" strokeWidth={1.5} />
                </View>
                <Text style={[styles.title, { textAlign: 'center', marginTop: 36 }]}>Scan failed</Text>
                <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8, paddingHorizontal: 12 }]}>{scanError}</Text>
              </View>
            ) : (
              <ScanTheater photos={photos} photoDims={photoDims} showDone={showDone} areaLabel={areaLabel} itemCount={spottedCount} />
            )}

            {/* Footer button — state-aware: View Results / Retry / nothing (still scanning) */}
            {showDone && !scanError && (
              <View style={styles.loadingFooter}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { width: '100%' }]}
                  // 55 is a half-step between step 5 and 6 for the processing animation
                  onPress={() => setStep(55)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>View Results</Text>
                </TouchableOpacity>
              </View>
            )}
            {scanError && (
              <View style={styles.loadingFooter}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { width: '100%' }]}
                  // Bump retryNonce — photos stay in state, the scan effect re-fires.
                  // No re-shoot, no re-charge against the user's lifetime scan count.
                  onPress={() => setRetryNonce(n => n + 1)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>Retry scan</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Step 5.5: unified review — one deduped list + a thumbnail strip of the scans ── */}
        {step === 55 && (() => {
          // Photo grid: 2 across for a typical scan (≤4 shots) so each preview is big; 3 across for
          // 5+ so a lot of photos don't get too tall. Tiles are uniform and the grid hugs its content
          // (no floating black space), wrapping to rows and centering any odd last tile.
          const CONTENT_W = SCREEN_W - 48 // step horizontal padding (24 × 2)
          const nPhotos = photos.length
          const cols = nPhotos <= 2 ? Math.max(1, nPhotos) : nPhotos <= 4 ? 2 : 3
          const tile = Math.round(Math.min((CONTENT_W - (cols - 1) * 8) / cols, 200))
          // The add-input doubles as a SEARCH box: typing filters the list live, so checking
          // "did it catch my eggs?" doesn't mean scrolling 50 rows. If nothing matches, the same
          // input adds it — search and add are the same gesture.
          const query = missedInput.trim().toLowerCase()
          const visibleItems = query
            ? detectedItems.filter(d => d.name.toLowerCase().includes(query))
            : detectedItems
          const exactExists = !!query && detectedItems.some(d => d.name.toLowerCase().trim() === query)
          return (
            <KeyboardAvoidingView
              style={stepWithSafeTop}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              {/* Tapping anywhere outside the field (photos, header, empty list space) closes the
                  keyboard. Rows/✕ keep working — they handle their own touches first. */}
              <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()} accessible={false}>
                <View style={{ flex: 1 }}>
              {(() => {
                // ONE unified, de-duplicated list — no per-photo split, no shelf grouping. Where an
                // item sat (top shelf / drawer) is noise for a quick confirm; the user just wants to
                // scan the list, remove the odd wrong one, and tap Add. The photo strip above is a
                // visual reference only (tap to zoom); it no longer drives what's listed.
                const renderRow = (item: DetectedItem) => {
                  const editing = editingId === item.id
                  return (
                    <View key={item.id} style={styles.reviewRow}>
                      {editing ? (
                        <TextInput
                          style={styles.reviewRowInput}
                          value={editingText}
                          onChangeText={setEditingText}
                          selectionColor={COLORS.accent} // caret is invisible on the dark row without this
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          blurOnSubmit
                          onSubmitEditing={() => commitRename(item.id, editingText)}
                          onBlur={() => commitRename(item.id, editingText)}
                        />
                      ) : (
                        // Tap the name to rename it — the AI mislabels ("Whole Milk" → "2% Milk"). ✕ removes.
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => { setEditingId(item.id); setEditingText(item.name) }}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Text style={styles.reviewRowText}>{item.name}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => setDetectedItems(prev => prev.filter(d => d.id !== item.id))}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                  )
                }
                return (
                  <>
                    {/* Close on its own row so the thumbnails below get the FULL width to fill. */}
                    <View style={styles.reviewCloseRow}>
                      {/* With the keyboard up, ✕ closes the KEYBOARD, not the scan. It's the nearest
                          "get me out of this" target when the keyboard covers the screen, and hitting
                          it used to discard every detected item — unrecoverable (the vision call is
                          already spent). A second tap, keyboard down, closes the scan as normal. */}
                      <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={() => { if (keyboardUp) { Keyboard.dismiss(); return } handleClose() }}
                      >
                        <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                    {/* Scan thumbnails as a centered, content-hugging grid (2 across for ≤4 photos,
                        3 across beyond). Uniform tiles, odd last tile centered. Tap any to zoom. */}
                    {photos.length > 0 && !keyboardUp && (
                      <View style={styles.photoGrid}>
                        {photos.map((p, idx) => (
                          <TouchableOpacity key={idx} activeOpacity={0.85} onPress={() => p.uri && setZoomUri(p.uri)} style={[styles.photoThumb, { width: tile, height: tile }]}>
                            <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {/* Header — the COUNT is the hero (it continues the count-up reveal and is what
                        people actually read), with the action instruction right under it. The generic
                        "Review your scan" is gone; eyes glossed over it. Photo/area context sits right. */}
                    <View style={styles.reviewHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewCountHero}>
                          {detectedItems.length === 0 ? 'Nothing found' : `${detectedItems.length} item${detectedItems.length === 1 ? '' : 's'} found`}
                        </Text>
                        <Text style={styles.reviewInstruction}>
                          {query
                            ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'} for "${missedInput.trim()}"`
                            : 'Tap a name to fix it  ·  ✕ to remove'}
                        </Text>
                      </View>
                    </View>

                    {/* One flat, ungrouped list of everything found (deduped across photos). Uniform
                        rows scan far better than a cloud of ragged-width pills at 20+ items. */}
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.reviewItemsScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                      {visibleItems.map(renderRow)}
                      {/* Searching for something that isn't there IS the answer — say so, and the
                          + button below adds it. */}
                      {query.length > 0 && visibleItems.length === 0 && (
                        <Text style={styles.reviewNoMatch}>Not in the list — tap + to add it</Text>
                      )}
                    </ScrollView>
                  </>
                )
              })()}
                </View>
              </TouchableWithoutFeedback>

              {/* The old "Also have these? Tap to add" staples dropdown was removed — it was the
                  legacy way of nagging users to add basics, now superseded by assuming staples for
                  meal generation and surfacing them in the recipe's "we assumed" tier. */}

              {/* Add-missing — contextual to the photo currently on screen */}
              <View style={styles.missedBar}>
                <TextInput
                  style={styles.missedBarInput}
                  placeholder="Search or add an item"
                  placeholderTextColor={COLORS.textMuted}
                  // Caret + selection are invisible against the dark field without this.
                  selectionColor={COLORS.accent}
                  value={missedInput}
                  onChangeText={setMissedInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={addMissedItems}
                />
                <TouchableOpacity
                  // Disabled when the typed name is already in the list — the matching row is
                  // showing right above, so a duplicate can't be added by accident.
                  style={[styles.missedBarBtn, (!missedInput.trim() || addingMissed || exactExists) && { opacity: 0.5 }]}
                  onPress={addMissedItems}
                  disabled={!missedInput.trim() || addingMissed || exactExists}
                  activeOpacity={0.7}
                >
                  {addingMissed
                    ? <ActivityIndicator color="#000" size="small" />
                    : exactExists
                      ? <Check size={20} stroke="#000" strokeWidth={2.5} />
                      : <Plus size={20} stroke="#000" strokeWidth={2.5} />}
                </TouchableOpacity>
              </View>

              <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                <TouchableOpacity
                  style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                  disabled={saving}
                  activeOpacity={0.85}
                  onPress={async () => {
                    if (!user) return
                    if (savingRef.current) return // synchronous guard — disabled prop updates async
                    const selected = detectedItems.filter(i => i.checked)
                    if (selected.length === 0) { handleClose(); return }
                    savingRef.current = true
                    setSaving(true)
                    // Deduped insert — skips items already in the pantry so a re-scan can't
                    // create a duplicate row; re-stocks any that were previously out.
                    const { error } = await addPantryItemsDeduped(user.id, selected.map(item => ({ name: item.name, category: item.category })))
                    setSaving(false)
                    savingRef.current = false
                    if (error) {
                      Alert.alert('Save failed', error.message)
                      return
                    }
                    onItemsAdded?.()
                    // No cook-reveal flow wired (e.g. Home entry) → close as before.
                    if (!onSeeMeals) { handleClose(); return }
                    // Committed to the reveal → warm the remaining meal images now, a few seconds
                    // before it mounts, so the deck doesn't out-run them. (The hero was warmed
                    // during review; these resolve from cache there.) Fire-and-forget.
                    warmMealImages(user.id, 'cookNow', 3)
                    // First scan ever: auto-reveal the magic (no choice). After that, returning
                    // scanners get the success step with a "Maybe later" off-ramp, so we don't
                    // force a meal generation on every restock.
                    const seen = await AsyncStorage.getItem(COOK_REVEAL_SEEN_KEY)
                    if (!seen) {
                      await AsyncStorage.setItem(COOK_REVEAL_SEEN_KEY, '1')
                      handleClose()
                      onSeeMeals()
                      return
                    }
                    setSavedCount(selected.length)
                    setShowSaved(true)
                  }}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.primaryBtnText}>Add all {detectedItems.length} to Pantry</Text>
                  }
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          )
        })()}

        {/* ── Step 6: Results ── */}
        {step === 6 && (
          <View style={stepWithSafeTop}>
            <View style={styles.topBar}>
              {/* X on LEFT, spacer takes remaining width — consistent with every other step. */}
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
            </View>
            <Text style={styles.title}>Found {detectedItems.length} ingredients</Text>
            <Text style={[styles.subtitle, { marginBottom: 20, marginTop: 6 }]}>
              Review and confirm what to add
            </Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {grouped.map(group => (
                <View key={group.category} style={styles.resultGroup}>
                  <Text style={styles.resultGroupLabel}>{group.category}</Text>
                  <View style={styles.resultCard}>
                    {group.items.map((item, i) => (
                      <View key={item.id}>
                        {i > 0 && <View style={styles.resultDivider} />}
                        <TouchableOpacity style={styles.resultRow} onPress={() => toggleItem(item.id)} activeOpacity={0.7}>
                          <Text style={styles.resultName}>{item.name}</Text>
                          <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
                            {item.checked && <Check size={11} stroke="#000" strokeWidth={2.5} />}
                          </View>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>
            <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                disabled={saving}
                activeOpacity={0.85}
                onPress={async () => {
                  if (!user) { handleClose(); return }
                  if (savingRef.current) return // synchronous guard against double-tap
                  const selected = detectedItems.filter(i => i.checked)
                  if (selected.length === 0) { handleClose(); return }
                  savingRef.current = true
                  setSaving(true)
                  // Deduped insert — see addPantryItemsDeduped; prevents duplicate rows on re-scan.
                  const { error } = await addPantryItemsDeduped(user.id, selected.map(item => ({ name: item.name, category: item.category })))
                  setSaving(false)
                  savingRef.current = false
                  // Surface insert failures instead of silently dropping the scanned items
                  // (the user would otherwise think their whole scan saved when nothing did).
                  if (error) { Alert.alert('Could not save items', 'Please try again.'); return }
                  onItemsAdded?.()
                  handleClose()
                }}
              >
                {saving
                  ? <ActivityIndicator color="#000000" />
                  : <Text style={styles.primaryBtnText}>Add {checkedCount} Ingredient{checkedCount !== 1 ? 's' : ''}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Fullscreen pinch-to-zoom for a tapped review photo. In-tree absolute overlay (not a
            nested Modal) so it layers over the scan modal on iOS. */}
        {zoomUri && (
          <View style={styles.zoomOverlay}>
            <ScrollView
              style={StyleSheet.absoluteFill}
              contentContainerStyle={styles.zoomScrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
              <Image source={{ uri: zoomUri }} style={styles.zoomImage} resizeMode="contain" />
            </ScrollView>
            <TouchableOpacity style={[styles.closeBtn, { position: 'absolute', top: insets.top + 8, left: 12, zIndex: 101 }]} onPress={() => setZoomUri(null)}>
              <X size={20} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        )}

      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  // ── Prep / "how scanning works" overlay ──
  prepOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 50, paddingHorizontal: 24 },
  prepScroll: { paddingBottom: 24, flexGrow: 1, justifyContent: 'center', paddingTop: 8 },
  prepCompareRow: { flexDirection: 'row', gap: 12, marginTop: 18, marginBottom: 24 },
  prepCompareCard: { flex: 1 },
  prepCompareImg: { width: '100%', height: 184, borderRadius: 14, backgroundColor: '#1A1A1A' },
  prepCompareImgBad: { borderWidth: 2, borderColor: 'rgba(239,68,68,0.6)' },
  prepCompareImgGood: { borderWidth: 2, borderColor: 'rgba(74,222,128,0.6)' },
  prepBadge: { position: 'absolute', top: 8, left: 8, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  prepBadgeBad: { backgroundColor: '#EF4444' },
  prepBadgeGood: { backgroundColor: '#16A34A' },
  prepBadgeText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', lineHeight: 18 },
  prepCompareTag: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  prepCompareTagBad: { color: '#FF6B6B' },
  prepCompareTagGood: { color: '#4ADE80' },
  prepTitle: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 10, lineHeight: 33, textAlign: 'center' },
  prepIntro: { fontSize: 15, color: '#999999', lineHeight: 21, marginBottom: 30, textAlign: 'center' },
  prepTips: { gap: 14 },
  prepTipRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  prepTipChip: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(74,222,128,0.12)', alignItems: 'center', justifyContent: 'center' },
  prepTipEmoji: { fontSize: 20 },
  prepTipText: { flex: 1, fontSize: 15, color: '#999999', lineHeight: 20 },
  prepTipBold: { color: '#FFFFFF', fontWeight: '700' },
  prepFootnote: { fontSize: 13, color: '#777777', textAlign: 'center', marginTop: 28, lineHeight: 19 },
  prepActions: { paddingBottom: 8, paddingTop: 8 },
  savedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 60, paddingHorizontal: 24 },
  savedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  savedCheck: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4ADE80', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  savedTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  savedSub: { fontSize: 15, color: '#999999', textAlign: 'center', lineHeight: 21, paddingHorizontal: 12 },
  savedActions: { paddingBottom: 8, paddingTop: 8 },
  savedLater: { paddingVertical: 14, alignItems: 'center' },
  savedLaterText: { fontSize: 15, color: '#888888', fontWeight: '600' },

  // ── Per-photo review carousel ──
  pagerCtrl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 4 },
  pagerLabel: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 },
  dotsRow: { flexDirection: 'row', gap: 6, marginTop: 7, alignItems: 'center' },
  pagerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  pagerDotActive: { backgroundColor: '#4ADE80', width: 18 },
  // Carousel dots centered along the bottom of the photo strip (photo indicator, not list).
  photoDotsOverlay: { position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  // Photo strip pinned to the very top, full-bleed (breaks out of the step's 24px side padding).
  reviewPhotoTop: { marginHorizontal: -24, position: 'relative' },
  reviewPhoto: { width: SCREEN_W, height: 264, backgroundColor: '#0A0A0A', overflow: 'hidden' },
  reviewPhotoImg: { width: SCREEN_W, height: 264 },
  // Tap-to-locate detection boxes drawn over the review photo.
  detBox: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(74,222,128,0.45)', borderRadius: 5 },
  detBoxActive: { borderColor: '#4ADE80', borderWidth: 2.5, backgroundColor: 'rgba(74,222,128,0.16)' },
  detBoxLabel: { position: 'absolute', top: -21, left: -1.5, backgroundColor: '#4ADE80', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, maxWidth: SCREEN_W * 0.5 },
  detBoxLabelText: { color: '#000000', fontSize: 11, fontWeight: '700' },
  zoneChipActive: { borderColor: '#4ADE80', borderWidth: 1 },
  // Confidence-triage "double-check" section — amber so the eye goes there, not to the sure items.
  doubleCheckGroup: { marginBottom: 12, backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  doubleCheckHeader: { fontSize: 12, fontWeight: '700', color: '#F59E0B', marginBottom: 8, letterSpacing: 0.2 },
  zoneChipLow: { borderColor: 'rgba(245,158,11,0.55)', backgroundColor: 'rgba(245,158,11,0.08)' },
  reviewCloseOverlay: { position: 'absolute', left: 12, zIndex: 10 },
  // Title row directly below the photo (within the step's normal 24px padding).
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 4 },
  // Close on its own row; the thumbnail strip below gets the full width. flexGrow+center makes the
  // strip CENTER its photos when they fit (few/big shots) and left-align + scroll when they don't.
  reviewCloseRow: { paddingBottom: 12 },
  // Content-hugging wrap grid — centers each row (and any odd last tile). No flexGrow / vertical
  // centering, so it can't balloon into empty black space the way the old scroll strip did.
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingBottom: 4 },
  photoThumb: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1A1A1A' }, // width/height set inline (responsive)
  reviewHeaderRight: { alignItems: 'flex-end', gap: 4 },
  // Fullscreen tap-to-zoom overlay.
  zoomOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 100 },
  zoomScrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  zoomImage: { width: SCREEN_W, height: SCREEN_H },
  zoomHint: { position: 'absolute', bottom: 8, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 13 },
  zoomHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  zoneGroup: { marginBottom: 2 },
  zoneHeader: { fontSize: 12, fontWeight: '700', color: '#4ADE80', marginTop: 14, marginBottom: 8, letterSpacing: 0.3 },
  reviewPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  reviewPhotoPhText: { color: '#888888', fontSize: 13 },
  // No fixed width: the list lives inside the step's 24px horizontal padding, so forcing width
  // SCREEN_W made the content 48px wider than its viewport → sideways scroll + left-clipped chips.
  reviewItemsScroll: { paddingTop: 8, paddingBottom: 20 },
  reviewCountHero: { fontSize: 27, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  reviewInstruction: { fontSize: 13, color: '#888888', marginTop: 3, fontWeight: '600' },
  // Uniform full-width row per detected item — scans cleanly at 20+ items where ragged pills didn't.
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  reviewRowText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  reviewRowInput: { flex: 1, fontSize: 15, fontWeight: '600', color: '#FFFFFF', padding: 0, borderBottomWidth: 1, borderBottomColor: '#4ADE80' },
  staplesBar: { paddingTop: 6, paddingBottom: 2 },
  staplesLabel: { fontSize: 12, color: '#888888', fontWeight: '600', paddingHorizontal: 20, marginBottom: 8 },
  staplesToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 6 },
  zoneChipInput: { fontSize: 12.5, fontWeight: '500', color: '#FFFFFF', minWidth: 64, padding: 0, marginVertical: -1 },
  zoneChipEditing: { borderColor: '#4ADE80' },
  staplesChips: { paddingHorizontal: 20, gap: 8 },
  staplesChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  stapleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(74,222,128,0.1)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)', borderRadius: 30, paddingVertical: 7, paddingLeft: 10, paddingRight: 13 },
  stapleChipText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  reviewNoMatch: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 22 },
  missedBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  missedBarInput: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#FFFFFF', fontSize: 14 },
  missedBarBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#4ADE80', alignItems: 'center', justifyContent: 'center' },

  step: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreScroll: {
    paddingBottom: 20,
  },

  // ── Step-4 "add more" hub (redesigned) ──
  hubTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 6 },
  hubTitleAccent: { color: '#4ADE80' },
  hubSubtitle: { fontSize: 14, color: '#888888', lineHeight: 20, marginBottom: 24 },
  sectionEyebrow: { fontSize: 11, fontWeight: '700', color: '#666666', letterSpacing: 1.2, marginBottom: 12 },
  capturedSection: { marginBottom: 4 },
  capturedRow: { gap: 12, paddingRight: 24 },
  capturedCard: { width: 96, height: 112, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)' },
  capturedImg: { width: '100%', height: '100%' },
  capturedImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  capturedCheck: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#4ADE80', alignItems: 'center', justifyContent: 'center' },
  capturedRemove: { position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  capturedLabelWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 4, paddingHorizontal: 6 },
  capturedLabel: { fontSize: 10, fontWeight: '600', color: '#FFFFFF', textAlign: 'center' },
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  areaCardWrap: { width: '48%' },
  areaCard: { backgroundColor: '#141414', borderRadius: 16, minHeight: 120, paddingVertical: 16, paddingHorizontal: 14, alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  areaCardTaken: { borderColor: 'rgba(74,222,128,0.4)', backgroundColor: 'rgba(74,222,128,0.06)' },
  areaIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(74,222,128,0.10)', alignItems: 'center', justifyContent: 'center' },
  areaIconWrapTaken: { backgroundColor: 'rgba(74,222,128,0.14)' },
  areaCardText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  areaCheck: { position: 'absolute', top: 12, right: 12, width: 20, height: 20, borderRadius: 10, backgroundColor: '#4ADE80', alignItems: 'center', justifyContent: 'center', zIndex: 2 },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnAbs: {
    position: 'absolute',
    top: 0,
    right: 0,
  },

  // Progress dots
  progressDots: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2A2A2A',
  },
  dotActive: {
    width: 24,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
  },

  // Inline camera
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  // Full-bleed camera screen (steps 1–3)
  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  cameraPermFallback: { backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  cameraTopScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  cameraBottomOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 44, paddingHorizontal: 24, gap: 14, alignItems: 'center' },
  cameraTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  cameraSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 20, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
  cameraDoneText: { fontSize: 14, color: '#4ADE80', fontWeight: '700' },
  cameraTopBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  cameraTopCenter: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  cameraCountText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cameraCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPhotoRow: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    gap: 8,
  },
  bracket: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(255,255,255,0.6)',
    borderWidth: 3,
  },
  bracketTL: { top: '24%', left: '10%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  bracketTR: { top: '24%', right: '10%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  // Bottom brackets sit well above the copy/shutter scrim (was 20% → collided with the title).
  bracketBL: { bottom: '34%', left: '10%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  bracketBR: { bottom: '34%', right: '10%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  cameraBottom: {
    paddingTop: 12,
    paddingBottom: 4,
    gap: 12,
    alignItems: 'center',
  },
  stepTextCompact: { gap: 4, alignItems: 'center' },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  flashBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },

  // Text blocks
  stepText: { gap: 8, marginBottom: 24 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },

  // Actions
  actions: { gap: 12, alignItems: 'center' },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 18,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  skipText: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },

  // Photo thumbnails
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  thumbnail: { alignItems: 'center', gap: 4 },
  thumbnailImg: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailCheck: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailLabel: {
    fontSize: 10,
    color: '#888888',
    fontWeight: '500',
    maxWidth: 56,
    textAlign: 'center',
  },

  // Extra grid (step 4)
  extraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  extraCardWrap: { width: '47%' },
  extraCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  extraCardTaken: {
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  extraCardText: {
    fontSize: 13,
    color: '#AAAAAA',
    fontWeight: '600',
    textAlign: 'center',
  },
  extraCheckBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  customInput: {
    fontSize: 14,
    color: '#FFFFFF',
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingBottom: 8,
  },
  customAddBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  customAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },

  // Loading layout
  loadingBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 20,
  },
  loadingFooter: {
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  // Hero live-count number on the scan loading screen.
  scanCount: {
    fontSize: 56,
    fontWeight: '800',
    color: COLORS.accent,
    textAlign: 'center',
    marginTop: 28,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'], // fixed-width digits so the number doesn't jitter as it ticks
  },

  // Loading pulse
  // Scanning viewfinder — mirrors the home "Scan your pantry" hero: camera-corner brackets
  // framing the icon, with a glowing green beam sweeping top→bottom (see beamAnim).
  scanFrame: { width: 180, height: 160, position: 'relative', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scanCorner: { position: 'absolute', width: 26, height: 26, borderColor: '#4ADE80' },
  scanCornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  scanCornerTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 6 },
  scanCornerBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 6 },
  scanCornerBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 6 },
  scanBeam: { position: 'absolute', left: 6, right: 6, height: 2, backgroundColor: '#4ADE80', shadowColor: '#4ADE80', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8 },

  // Results (step 6)
  resultGroup: { marginBottom: 20 },
  resultGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666666',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  resultCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  resultDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: 16,
  },
  resultName: {
    flex: 1,
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '400',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#4ADE80',
    borderColor: '#4ADE80',
  },

  // Zone-based visual review
  zoneImageWrap: {
    height: 500,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  zoneImage: {
    width: '100%',
    height: '100%',
  },
  zoneSection: {
    marginBottom: 18,
  },
  zoneLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  zoneChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    // Fill the (already width-constrained) list column so chips wrap cleanly. Was hardcoded to
    // SCREEN_W-40 from when this lived in the full-bleed photo pager; that overflowed the padded step.
    width: '100%',
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    // flexShrink:0 so chips keep their natural width and WRAP to the next line instead of
    // being squeezed/clipped — default flexShrink let Yoga overflow the last chip per row.
    flexShrink: 0,
    maxWidth: SCREEN_W - 40, // a single very long chip still can't exceed the row width
  },
  zoneChipText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: COLORS.textWhite,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    flex: 1,
  },

  // Camera capture hint
  cameraTipRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, paddingHorizontal: 12 },
  cameraTip: {
    flexShrink: 1,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 5,
  },

  // Missed-something input (zone review screen)
  missedSection: {
    marginTop: 6,
    marginBottom: 12,
  },
  missedInput: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  missedAddBtn: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  missedAddBtnText: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '700',
  },
})
