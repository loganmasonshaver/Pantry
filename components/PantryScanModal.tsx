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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { X, ScanLine, Check, Plus, Zap, ImageIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Maximize2, Refrigerator, Lightbulb, Tag, EyeOff } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { PlatingStory, ScanTheater } from './ScanTheater'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { usePremium } from '@/context/SuperwallContext'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import { trackUpgradePromptShown } from '@/lib/analytics'
import { trackAIError } from '@/lib/analytics'
import { categorizeItem } from '@/lib/categories'
import { normalizeCategory, PANTRY_ORDER } from '@/lib/categoryMatch'
import { addPantryItemsDeduped } from '@/lib/pantryInsert'
import { commitCookNowPrefetch, isRevealReady, prefetchCookNowMeals, takeRevealReady, warmMealImages } from '@/lib/mealPrefetch'
import { scanPerfEnd, scanPerfMark, scanPerfStart, secsSince } from '@/lib/scanPerf'
import { fetchMealGenUsedToday, MEAL_GEN_CAP_PER_DAY } from '@/lib/useMealSuggestions'
import { MIN_PANTRY_FOR_COOK_NOW, thinPantryMessage } from '../supabase/functions/_shared/pantry-check.ts'
import { buildPlatingStory, buildScanStory, type StoryProfile } from '@/lib/scanStory'
import { CookRevealView } from '@/components/CookRevealView'

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

const STAPLES_BY_CONTAINER: Record<string, string[]> = {
  fridge: ['Eggs', 'Milk', 'Butter', 'Cheese', 'Yogurt', 'Mayonnaise', 'Ketchup', 'Mustard', 'Orange Juice', 'Sour Cream'],
  freezer: ['Frozen Vegetables', 'Frozen Berries', 'Ice Cream', 'Frozen Chicken', 'Frozen Fish', 'Frozen Peas', 'Frozen Fruit', 'Frozen Pizza'],
  pantry: ['Rice', 'Pasta', 'Flour', 'Sugar', 'Olive Oil', 'Canned Beans', 'Canned Tomatoes', 'Cereal', 'Peanut Butter', 'Oats'],
  counter: ['Onion', 'Garlic', 'Potatoes', 'Bananas', 'Bread', 'Tomatoes', 'Apples', 'Avocado'],
}

// Max photos per scan — bounds the per-call vision cost. MUST be kept in step with the constant
// of the same name in scan-pantry/index.ts, which silently slice()s anything above it: if the two
// ever drift, the extra photos are dropped server-side and the user is told nothing.
//
// Was 8, on the assumption that "a full fridge + pantry fits comfortably". A real pass through a
// five-person household — several counters, each drawer, multiple storage areas — came to 14, so
// the old ceiling would have blocked a legitimate first scan two photos from the end.
const MAX_PHOTOS_PER_SCAN = 16

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
// Short on purpose — these sit inline next to "More tips ›" on the camera, and a full sentence
// truncated mid-word reads like a bug. The reasoning behind each one lives in the prep guide the
// pill opens ("A quick prep = a better scan"), so nothing is lost by keeping these punchy.
const CAMERA_TIPS = [
  'Pull items to the front',
  'Open the door all the way',
  'Stand back 3–4 feet',
  'Tap the screen to focus',
  // Was 'One photo per area'. That was written for the old flow, where the shutter kicked you to
  // the areas hub after every shot — and it's the opposite of the truth: recall scales with
  // coverage, so a deep drawer or a wide counter wants several shots, not one.
  'Several shots per area is fine',
  'Drawers and shelves separately',
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
// The ✕/✓ badges were typographic glyphs in a <Text>, which renders at the system font's weight
// and metrics rather than the icon set's — visibly inconsistent beside every other control here.
// Lucide X and Check were already imported in this file.
function PrepCompare() {
  return (
    <View style={styles.prepCompareRow}>
      <View style={styles.prepCompareCard}>
        <Image source={require('../assets/scan-prep/dont.jpg')} style={[styles.prepCompareImg, styles.prepCompareImgBad]} resizeMode="cover" />
        <View style={[styles.prepBadge, styles.prepBadgeBad]}><X size={16} stroke="#FFFFFF" strokeWidth={3} /></View>
        <Text style={[styles.prepCompareTag, styles.prepCompareTagBad]}>Buried = missed</Text>
      </View>
      <View style={styles.prepCompareCard}>
        <Image source={require('../assets/scan-prep/do.jpg')} style={[styles.prepCompareImg, styles.prepCompareImgGood]} resizeMode="cover" />
        <View style={[styles.prepBadge, styles.prepBadgeGood]}><Check size={16} stroke="#FFFFFF" strokeWidth={3} /></View>
        <Text style={[styles.prepCompareTag, styles.prepCompareTagGood]}>Front-faced = found</Text>
      </View>
    </View>
  )
}

// One row of the prep / "how scanning works" screen. Each row fades + rises in on a
// staggered delay (driven by `index`) so the list animates to life instead of landing flat.
// Takes an ICON, not an emoji. Emoji as UI iconography is the single loudest "assembled from a
// template" tell — it renders at a different weight to every other glyph in the app, shifts with
// the OS emoji font, and cannot take the accent colour. Lucide is already the icon set everywhere
// else in this file.
function PrepTip({ icon, bold, rest, index }: { icon: React.ReactNode; bold: string; rest: string; index: number }) {
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
      <View style={styles.prepTipChip}>{icon}</View>
      <Text style={styles.prepTipText}>
        <Text style={styles.prepTipBold}>{bold}</Text>{rest}
      </Text>
    </Animated.View>
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
  // This host shows the cook reveal after a save (the Pantry tab does; Home does not). The reveal is
  // rendered INSIDE this modal as its last step — see CookRevealView for why it is not a route.
  showReveal?: boolean
  // Opening a meal from the reveal: the modal closes, then the host navigates.
  onOpenMeal?: (meal: any) => void
  // Where "Add items by hand" goes when the week's scans are used up. The modal closes first; the
  // host screen opens its own add field. Absent → the button just closes.
  onAddByHand?: () => void
}

const COOK_REVEAL_SEEN_KEY = 'cook_reveal_seen_v1'

export default function PantryScanModal({ visible, onClose, onItemsAdded, showReveal, onOpenMeal, onAddByHand }: Props) {
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
  const [showDone, setShowDone] = useState(false)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])

  // Prefetch cook-now meals the moment a scan produces items and we're heading toward the
  // cook reveal (showReveal) — NOT the Home-entry path. Runs during the user's review
  // window so the reveal is instant instead of a second loading screen. Text only; fires once
  // per modal-open (reset below) so a review re-render doesn't re-trigger it.
  const prefetchFiredRef = useRef(false)
  // How this open's prefetch ended. 'failed' is what the Add-all handler checks against the meal cap:
  // past it, the reveal would have nothing new to show. The token drops a result from an earlier open.
  const prefetchOutcomeRef = useRef<'none' | 'pending' | 'ok' | 'failed'>('none')
  const prefetchTokenRef = useRef(0)
  useEffect(() => { if (visible) { prefetchFiredRef.current = false; prefetchOutcomeRef.current = 'none'; prefetchTokenRef.current += 1 } }, [visible])
  useEffect(() => {
    if (prefetchFiredRef.current || !user || !showReveal) return
    const names = detectedItems.filter(i => i.checked).map(i => i.name)
    if (names.length === 0) return
    prefetchFiredRef.current = true
    prefetchOutcomeRef.current = 'pending'
    const token = prefetchTokenRef.current
    scanPerfMark(`review: prefetch fired, ${names.length} checked items`)
    prefetchCookNowMeals(user.id, names).then(m => {
      if (prefetchTokenRef.current === token) prefetchOutcomeRef.current = m ? 'ok' : 'failed'
    })
  }, [detectedItems, user, showReveal, visible])
  // Per-photo container type from the scan (fridge/freezer/pantry/counter) → context-aware quick-adds.
  const [photoContainers, setPhotoContainers] = useState<string[]>([])
  const [zones, setZones] = useState<ZoneGroup[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // synchronous in-flight guard so a double-tap / close race can't double-insert
  // A gallery import is in flight. Set BEFORE the picker opens, so the moment the system sheet
  // dismisses there is already something on screen saying the photos are being prepared: iOS hands
  // the whole selection back in one go, only after it has copied every photo out of the library, so
  // the filmstrip has nothing to show for seconds and the tap looked ignored.
  const [importing, setImporting] = useState(false)
  const [showPrep, setShowPrep] = useState(false) // first-run "how scanning works" overlay (sets expectations + coaches better photos)

  // The capture instruction opens BIG in the middle of the frame so it can't be missed, holds, then
  // settles into its spot above the shutter. 0 = hero (centered/large), 1 = settled (bottom/small).
  // Purely a cross-fade of two copies — the hero is pointerEvents:none, so the shutter is live the
  // whole time and an impatient user can shoot immediately.
  const HERO_HOLD_MS = 5000
  const titleAnim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    // photos.length, not just step: the hero is FIRST-SHOT copy. Re-entering the camera from the
    // scan or review screen's back arrow re-runs this, and without the photo check it replayed "Start with your fridge"
    // over a scan already three photos deep. Settling to 1 also retires the hero the instant the
    // first shot lands, instead of leaving it up for the rest of HERO_HOLD_MS.
    if (step !== 1 || photos.length > 0) { titleAnim.setValue(1); return }
    titleAnim.setValue(0)
    const t = setTimeout(() => {
      Animated.timing(titleAnim, { toValue: 1, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
    }, HERO_HOLD_MS)
    return () => clearTimeout(t)
  }, [step, photos.length])
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
  // Success step with no reveal, and why: today's meal picks are used up, or the pantry is still too
  // thin for the generator to build from. null = the normal step with See what you can cook.
  const [savedReason, setSavedReason] = useState<null | 'capped' | { thin: number }>(null)
  const [savedCount, setSavedCount] = useState(0)
  // Tapped review photo → fullscreen pinch-to-zoom overlay (in-tree, not a nested Modal).
  const [zoomUri, setZoomUri] = useState<string | null>(null)
  // The filmstrip appends, so without this the newest photo lands off-screen the moment the strip
  // is longer than the viewport — which at a 16-photo ceiling is most of a real first scan.
  const filmstripRef = useRef<ScrollView>(null)
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

  // Which photo set the results in state were computed from. A scan is a paid call (one of seven
  // a week), so backing out of the review to the camera keeps both the photos and the results;
  // pressing Scan on the SAME photos reopens the review with no second call, while a changed set
  // (a shot added or removed) is a genuinely new scan. Without this, results were never cleared
  // short of closing the modal, so a photo added after backing out was silently never scanned.
  const scannedFpRef = useRef<string | null>(null)
  const photoFp = (ps: PhotoEntry[]) => ps.map(p => p.id).join('|')
  const resultsForThesePhotos = showDone && !scanError && scannedFpRef.current === photoFp(photos)
  // The scan call currently in flight, and a counter that supersedes it. ‹ on the scanning screen
  // goes back to the camera WHILE the call runs; pressing Scan again on the same photos must re-show
  // that run, not pay for a second one. A changed photo set or a close bumps the counter, and a
  // superseded run's results are dropped instead of overwriting the newer state.
  const scanRunRef = useRef<{ fp: string; id: number } | null>(null)
  const scanRunIdRef = useRef(0)
  // The same fact as STATE, for rendering. Reading the ref during render made the camera button
  // flip words on its own: a refused scan rendered while the ref was still set ("View results"),
  // the ref then cleared without a render, and the next unrelated render said "Scan 4 photos".
  const [scanRunningFp, setScanRunningFp] = useState<string | null>(null)
  const scanRunningForThesePhotos = scanRunningFp !== null && scanRunningFp === photoFp(photos)

  // Drives the scanning beam that sweeps top→bottom over the viewfinder — same motif as the
  // home "Scan your pantry" hero card, so the loading screen reads as the same scan action.
  const beamAnim = useRef(new Animated.Value(0)).current

  // Loading animation + actual AI scan. retryNonce is in the dep list so the
  // user's "Retry" tap on the error screen re-fires this effect without
  // needing them to re-take photos.
  useEffect(() => {
    if (step !== 5) return
    // Results that belong to THESE photos are only re-shown, never re-run. A retry after an error
    // still works: showDone is false on that path. Results for a different photo set are stale:
    // clear them so the theatre counts from zero and the review cannot show the old list.
    if (resultsForThesePhotos) return
    if (scanRunningForThesePhotos) return // the running call lands the results; do not pay twice
    if (showDone) { setShowDone(false); setDetectedItems([]); setZones([]) }
    setScanError(null)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamAnim, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(beamAnim, { toValue: 0, duration: 0, useNativeDriver: true }), // snap back to sweep again
      ])
    )
    loop.start()

    const runId = ++scanRunIdRef.current
    scanRunRef.current = { fp: photoFp(photos), id: runId }
    setScanRunningFp(scanRunRef.current.fp)
    const current = () => scanRunIdRef.current === runId

    const scanPhotos = async () => {
      const base64Images = photos.filter(p => p.base64).map(p => p.base64!)
      scanPerfStart(`scan: start, ${base64Images.length} photos`)
      let sentAt = 0
      if (base64Images.length === 0) {
        if (!current()) return
        scannedFpRef.current = photoFp(photos)
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
            // The JSON body carries the base64 TEXT, so its length is the upload size — a third more
            // than the JPEG bytes. The upload half of the wait scales with this number.
            scanPerfMark(`scan: request sent, ${(base64Images.reduce((n, b) => n + b.length, 0) / 1e6).toFixed(1)} MB upload`)
            sentAt = Date.now()
            const { data, error } = await supabase.functions.invoke('scan-pantry', { body: { images: base64Images } })
            if (error) throw error
            return { data }
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Scan is taking too long. Tap retry to try again.')), SCAN_HARD_TIMEOUT_MS)
          ),
        ])
        if (!current()) return // superseded while the call ran — a newer photo set, or the scan was closed
        if ('declined' in scanResult) { onClose(); return }
        // Where a scan's time goes, readable in the Metro log: the edge function reports the vision
        // call's duration, which provider answered (and why the primary did not), and the tokens.
        const meta = (scanResult.data as any)?._meta
        // Phone round trip minus the server's vision time = upload + download + edge overhead.
        if (sentAt) scanPerfMark(`scan: response in ${secsSince(sentAt)}s on the phone${meta?.ms ? `, vision ${(meta.ms / 1000).toFixed(1)}s, so ${((Date.now() - sentAt - meta.ms) / 1000).toFixed(1)}s upload + edge` : ''}`)
        if (__DEV__ && meta) console.log(`[perf] scan-pantry: vision ${meta.ms}ms via ${meta.provider}${meta.primaryError ? ` (gpt-5.4 failed: ${meta.primaryError})` : ''}, ${photos.length} photos, tokens in ${meta.usage?.prompt_tokens ?? '?'} / out ${meta.usage?.completion_tokens ?? '?'} (reasoning ${meta.usage?.completion_tokens_details?.reasoning_tokens ?? '?'})`)
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
        const deduped = dedupeDetected(allItems)
        setDetectedItems(deduped)
        scanPerfMark(`review: shown, ${deduped.length} items`)
        // Phantom check (PRELAUNCH §3): every item with the model's own confidence, so a scan labelled at
        // Add all — unchecked = not really there — can be scored by confidence band. Dev-only.
        if (__DEV__) console.log(`[scan-items] ${JSON.stringify({ at: new Date().toISOString(), photos: photos.length, items: deduped.map(d => [d.name, d.category, d.confidence ?? null, d.photo]) })}`)
        setZones(zoneGroups)
        // Per-photo container type drives the context-aware quick-add rail in the review.
        setPhotoContainers(Array.isArray(result.photoContainers) ? result.photoContainers.map((c: any) => String(c || '').toLowerCase()) : [])
        scannedFpRef.current = photoFp(photos) // `photos` here is the set that was uploaded
        setShowDone(true)
      } catch (e: any) {
        // Surface the error inline (loading screen flips to error state with a
        // Retry button) instead of bouncing to the empty review screen. Photos
        // stay in state so the retry doesn't re-charge the user for re-shooting.
        // supabase functions.invoke puts a generic message on e.message and the
        // real server body ({ error, code }) on e.context (a Response) — unwrap it
        // so the user sees the actual reason (daily cap, OpenAI timeout, etc.).
        let msg = e?.message || 'Something went wrong analyzing your photos.'
        let code: string | null = null
        if (e?.context && typeof e.context.json === 'function') {
          try { const body = await e.context.json(); if (body?.error) msg = body.error; if (body?.code) code = body.code } catch { /* keep generic */ }
        }
        trackAIError('scan-pantry', e, { shown: msg })
        scanPerfEnd(`scan: failed — ${msg.slice(0, 60)}`)
        if (!current()) return
        // "Retry scan" cannot work for days. The capped screen replaces the error, with the one
        // action that does work.
        if (code === 'scan_cap_reached') { setWeekCapped(true); return }
        setScanError(msg)
      }
    }
    scanPhotos().finally(() => {
      if (scanRunRef.current?.id !== runId) return
      scanRunRef.current = null
      setScanRunningFp(null)
    })

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
  // ONCE per result set. The effect re-runs whenever the list's length changes, and the review
  // changes it: adding an item by hand replayed the whole count-up — 16 light taps and a Success —
  // under the thumb that typed it (Logan: "buzzes 5-10x in a row"). Removing one did the same.
  const countedForRef = useRef<string | null>(null)
  useEffect(() => {
    const target = detectedItems.length
    if (!showDone) { countedForRef.current = null; return }
    if (target === 0) return
    if (countedForRef.current === scannedFpRef.current) { setSpottedCount(target); spottedCountRef.current = target; return }
    countedForRef.current = scannedFpRef.current
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
  // The week's scans are used up. Asked when the scanner opens, so the user is told BEFORE taking
  // photos that could never be scanned (Logan took a full set and only then hit the limit), and set
  // again if a scan is refused for the same reason. Unknown fails open: the real call still decides.
  const [weekCapped, setWeekCapped] = useState(false)
  // The scan wait's big-type story is built from these onboarding answers (lib/scanStory). Read once
  // per open; until it lands the theatre shows its generic captions.
  const [storyProfile, setStoryProfile] = useState<StoryProfile | null>(null)
  useEffect(() => {
    if (!visible || !user) return
    let cancelled = false
    supabase.from('profiles')
      .select('calorie_goal, protein_goal, meals_per_day, fitness_goal, diet_type, dietary_restrictions, food_dislikes, cooking_skill, max_prep_minutes')
      .eq('id', user.id).single()
      .then(({ data }) => { if (!cancelled && data) setStoryProfile(data as StoryProfile) }, () => {})
    return () => { cancelled = true }
  }, [visible, user?.id])
  useEffect(() => {
    if (!visible || !user) return
    let cancelled = false
    supabase.functions.invoke('scan-pantry', { body: { checkOnly: true } })
      .then(({ data }) => { if (!cancelled && data && data.allowed === false) setWeekCapped(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [visible, user?.id])

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

  // What ✕ and the modal's own dismiss go through. Photos taken but not yet scanned are real work —
  // you were stood in front of the shelf — and closing threw them away silently (the live edge noted
  // on the ✕ below). So it asks, but ONLY when there is something to lose: with no photos yet, or
  // once the scan has produced results, ✕ closes straight away. The app's usual rule is no
  // confirmation for reversible actions; this one cannot be undone.
  const requestClose = () => {
    if (savingRef.current) return
    const unscanned = photos.length
    if (unscanned === 0 || step >= 5) { handleClose(); return }
    // Back on the camera from the review or mid-scan, the photos ARE scanned (or being scanned) —
    // what ✕ would throw away is the paid result, so the question names that instead.
    const scanKept = resultsForThesePhotos || scanRunningForThesePhotos
    Alert.alert(
      scanKept ? 'Discard this scan?' : `Discard ${unscanned} photo${unscanned === 1 ? '' : 's'}?`,
      resultsForThesePhotos
        ? `${detectedItems.length} item${detectedItems.length === 1 ? ' was' : 's were'} found but not added to your pantry yet.`
        : scanKept
          ? 'Your photos are still being scanned. Nothing has been added to your pantry yet.'
          : `You haven't scanned ${unscanned === 1 ? 'it' : 'them'} yet. Closing loses ${unscanned === 1 ? 'it' : 'them'}.`,
      [
        { text: scanKept ? 'Keep' : 'Keep taking photos', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
            handleClose()
          },
        },
      ],
    )
  }

  const handleClose = () => {
    if (savingRef.current) return // don't close mid-save — a racing close could orphan a partial insert
    scanPerfEnd('closed') // no-op after the reveal opened, which already ended the timeline
    // A close from the plating screen: goToReveal is still awaiting, and would otherwise leave the
    // plating screen up for the next open until its wait ran out.
    platingRef.current = false
    setPlating(false)
    // Drop a scan still in flight. Its results used to land in the closed modal, where the meal
    // prefetch effect could fire a paid generation for items nobody would ever see.
    scanRunIdRef.current += 1
    scanRunRef.current = null
    setScanRunningFp(null)
    onClose()
    // Defer the reset until after the slide-out animation (~300ms) so the current
    // screen — e.g. the results view — collapses straight down instead of flashing
    // the camera/first step on the way out. State is fresh by the next open.
    setTimeout(() => {
      setStep(1)
      setPhotos([])
      setShowDone(false)
      setDetectedItems([])
      setZones([])
      setFlashOn(false)
      setMissedInput('')
      setAddingMissed(false)
      setShowSaved(false)
      setSavedReason(null)
      setWeekCapped(false)
      setZoomUri(null)
      setCurrentPhoto(0)
      nudgedRef.current = false
      scannedFpRef.current = null
      setScanError(null)
      setRetryNonce(0)
      setSaving(false) // kept true through the reveal hand-off; savingRef was cleared before the close
    }, 350)
  }

  // Hand-off to the cook reveal: a STEP of this modal, not a navigation. Pushed as a route it waited
  // for the modal to finish dismissing — measured: the push landed 1.2 s after the close — and the
  // Pantry tab showed through that gap at the payoff. In place, nothing can show between the two.
  //
  // And only once the reveal can open COMPLETE. The meals and their photos are prepared during the
  // review; a user who taps before that finishes waits here, on the button they pressed, with words
  // saying what is happening — not on the reveal staring at an empty deck. Capped, so a stuck photo
  // delays the reveal rather than holding the user; the reveal's own gate covers anything left.
  const REVEAL_STEP = 7
  const REVEAL_READY_MAX_MS = 25000
  const [plating, setPlating] = useState(false)
  const platingRef = useRef(false)
  const goToReveal = async () => {
    if (platingRef.current) return
    const ready = user ? takeRevealReady(user.id, 'cookNow') : null
    // Ready already: straight to the reveal. Awaiting a settled promise would still flash the plating
    // screen for a frame.
    if (ready && user && !isRevealReady(user.id, 'cookNow')) {
      platingRef.current = true
      setPlating(true)
      const token = scanRunIdRef.current // a close while waiting bumps this
      const platingAt = Date.now()
      scanPerfMark('plating: start')
      const outcome = await Promise.race([ready.then(() => 'ready'), new Promise(r => setTimeout(() => r('hit the 25s cap'), REVEAL_READY_MAX_MS))])
      scanPerfMark(`plating: ${outcome} after ${secsSince(platingAt)}s`)
      platingRef.current = false
      setPlating(false)
      if (scanRunIdRef.current !== token) return // closed while plating: never open the reveal on a hidden modal
    }
    savingRef.current = false
    setSaving(false)
    setShowSaved(false)
    scanPerfMark('reveal: step shown')
    setStep(REVEAL_STEP)
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
  // Returns the manipulated URI as well as the base64, and callers must store BOTH. The output
  // has EXIF rotation baked into its pixels; the input does not. Displaying the input while
  // sending the output meant the review photo could sit sideways — and worse, the detection
  // boxes are normalized against what the MODEL saw, so they were being mapped onto an image at
  // a different orientation than the one they were computed from.
  const downscaleToBase64 = async (uri: string): Promise<{ uri: string; base64: string | undefined }> => {
    const out = await manipulateAsync(uri, [{ resize: { width: 2048 } }], {
      compress: 0.95, format: SaveFormat.JPEG, base64: true,
    })
    return { uri: out.uri, base64: out.base64 ?? undefined }
  }

  // Commit an inline chip rename. Empty → keep the old name. Idempotent (onSubmit + onBlur both fire).
  const commitRename = (id: string, name: string) => {
    const trimmed = name.trim()
    setDetectedItems(prev => prev.map(d => d.id === id ? { ...d, name: trimmed || d.name } : d))
    setEditingId(null)
    setEditingText('')
  }

  // True while any captured photo is still being downscaled/encoded. scanPhotos() builds its
  // upload with photos.filter(p => p.base64), so scanning early would silently drop whichever
  // photos hadn't finished — the user would pay for a scan of fewer photos than they took.
  const encoding = photos.some(p => !p.base64)

  // Scanning is an INTENT, not a disabled button. `encoding` flips true on every shutter press and
  // back a moment later, so driving the CTA's label off it made the primary action flash
  // "Preparing photos…" and a spinner after every single photo — at a moment when nobody is trying
  // to press it. The busy state is only informative if the user actually asked to scan, so the
  // label now stays "Scan N photos" and a press made too early is REMEMBERED and fires itself once
  // the work lands. (It cannot just navigate: scanPhotos() reads `photos` from its step-5 effect
  // closure, so anything unencoded at that instant is silently dropped from the upload.)
  const [pendingScan, setPendingScan] = useState(false)
  // Same photos already scanned → straight to the review, skipping the theatre and the call.
  const goScan = () => setStep(resultsForThesePhotos ? 55 : 5)
  const requestScan = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    if (encoding) { setPendingScan(true); return }
    goScan()
  }
  useEffect(() => {
    if (!pendingScan) return
    if (photos.length === 0) { setPendingScan(false); return } // every capture failed out from under it
    if (encoding) return
    setPendingScan(false)
    goScan()
  }, [pendingScan, encoding, photos.length])

  // Ride the photo count rather than the capture call, so gallery imports scroll too.
  useEffect(() => {
    if (photos.length === 0) return
    const t = setTimeout(() => filmstripRef.current?.scrollToEnd({ animated: true }), 60) // let layout settle first
    return () => clearTimeout(t)
  }, [photos.length])

  const capturePhoto = async (label: string, next: number) => {
    if (!cameraRef.current) return
    if (photos.length >= MAX_PHOTOS_PER_SCAN) {
      Alert.alert('Photo limit', `You can include up to ${MAX_PHOTOS_PER_SCAN} photos per scan.`)
      return
    }
    // The row is inserted BEFORE the capture resolves. takePictureAsync at quality 1 is a
    // full-resolution capture plus a disk write — hundreds of ms — and the filmstrip stayed empty
    // for every one of them. That gap IS the lag. The strip already renders a placeholder tile for
    // a row with no uri, so the slot now appears on the shutter press and the image drops into it.
    // It also closes a real hole: with no row in `photos` during the capture, `encoding` was false,
    // so pressing Scan right after the shutter sent the user to step 5 while scanPhotos() read a
    // photos array that did not contain the shot they had just taken. It was dropped silently.
    const id = String(Date.now())
    setPhotos(prev => [...prev, { id, label, uri: undefined, base64: undefined }])
    let captured: string
    try {
      // Capture near-lossless (quality 1, no base64), then do the single resize +
      // re-encode in downscaleToBase64 — avoids the old double-compression that
      // destroyed label readability while still keeping the upload small.
      // NOT using skipProcessing: it discards `quality` outright and returns an image whose
      // rotation is EXIF-only, which is the exact bug fixed in a37bd03. Speed is not worth it.
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 })
      if (!photo) throw new Error('no photo returned')
      captured = photo.uri
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, uri: captured } : p))
    } catch (e) {
      setPhotos(prev => prev.filter(p => p.id !== id))
      Alert.alert('Capture failed', 'Could not take photo.')
      return
    }
    try {
      const out = await downscaleToBase64(captured)
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, uri: out.uri, base64: out.base64 } : p))
    } catch {
      // The old code swallowed this and left base64 undefined forever, which pinned `encoding`
      // true and wedged the Scan button with no way out. Dropping the row is the honest outcome:
      // the photo cannot be uploaded, so say so and let them retake it.
      setPhotos(prev => prev.filter(p => p.id !== id))
      Alert.alert('Photo not usable', 'That photo could not be prepared. Take it again.')
    }
    // next === 0 means "stay on the camera". The shutter used to hand you back to the areas hub
    // after EVERY photo, so four shots cost eight screen transitions and four camera remounts —
    // all of it while you're stood at an open fridge that's warming up.
    if (next !== 0) setStep(next)
  }

  const launchGallery = async (label: string, next: number) => {
    if (importing) return // one import at a time; the button is disabled too, this covers a fast double-tap
    if (photos.length >= MAX_PHOTOS_PER_SCAN) {
      Alert.alert('Photo limit', `You can include up to ${MAX_PHOTOS_PER_SCAN} photos per scan.`)
      return
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photo access needed', 'Please allow photo library access in Settings.')
      return
    }
    // Multi-select: one trip to the gallery for a whole shelf, instead of reopening the picker per
    // photo. selectionLimit is what is LEFT of the scan's cap, so the system picker stops the user
    // at the limit rather than this code rejecting photos after they chose them.
    const remaining = MAX_PHOTOS_PER_SCAN - photos.length
    // quality 1 is not "best quality" here, it is SPEED: expo-image-picker only takes its fast path —
    // copy the original file — at quality >= 1. Lower it and every photo is decoded and re-encoded
    // one by one, which makes this slower, not faster.
    setImporting(true)
    let result: ImagePicker.ImagePickerResult
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      })
    } catch (e) {
      setImporting(false)
      Alert.alert('Could not open your library', 'Please try again.')
      return
    }
    setImporting(false) // the rows below land in the same beat, so the spinner hands straight over to tiles
    if (!result.canceled && result.assets.length > 0) {
      // Belt and braces: selectionLimit is iOS 14+ and ignored on older pickers, so trim here too.
      const picked = result.assets.slice(0, remaining)
      // Rows first, encode second — same reason as capturePhoto. The picker hands back usable uris
      // immediately, so these show the real images rather than placeholder tiles.
      const stamp = Date.now()
      const rows = picked.map((asset, i) => ({ id: `${stamp}-${i}`, label, uri: asset.uri, base64: undefined }))
      setPhotos(prev => [...prev, ...rows])
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}) // they landed — the tiles arrive on this beat
      // SEQUENTIALLY, not Promise.all: each downscale decodes a full-size photo, and sixteen at once
      // is a memory spike on a device that already logs pressure. The tiles fill in one by one.
      let failed = 0
      for (const r of rows) {
        try {
          const out = await downscaleToBase64(r.uri)
          setPhotos(prev => prev.map(p => p.id === r.id ? { ...p, uri: out.uri, base64: out.base64 } : p))
        } catch {
          failed += 1
          setPhotos(prev => prev.filter(p => p.id !== r.id))
        }
      }
      // One alert for the batch, naming how many dropped — an alert per photo would stack modals.
      if (failed > 0) {
        Alert.alert(
          failed === picked.length ? 'Photos not usable' : `${failed} photo${failed === 1 ? '' : 's'} skipped`,
          failed === picked.length
            ? 'Those photos could not be prepared. Try different ones.'
            : 'The rest were added. The skipped ones could not be prepared.',
        )
      }
      if (next !== 0) setStep(next)
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
      const id = String(Date.now())
      const picked = result.assets[0].uri
      setPhotos(prev => [...prev, { id, label, uri: picked, base64: undefined }])
      try {
        const out = await downscaleToBase64(picked)
        setPhotos(prev => prev.map(p => p.id === id ? { ...p, uri: out.uri, base64: out.base64 } : p))
      } catch {
        setPhotos(prev => prev.filter(p => p.id !== id))
        Alert.alert('Photo not usable', 'That photo could not be prepared. Try another.')
      }
    }
  }

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

  // onRequestClose is the system dismiss (hardware/gesture): same question as ✕, same answer.
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      {/* A React Native <Modal> is its own WINDOW, and react-native-safe-area-context cannot read
          that window's insets from the app root — so inside here every useSafeAreaInsets() returned
          0 and every <SafeAreaView> applied no padding. This is the documented remedy: a provider
          scoped to the modal.
          It is why "More tips" was untappable — `insets.top + 4` resolved to y=4, putting the
          CENTRED pill under the Dynamic Island while the left-hugging ✕ stayed clear — and the same
          zero silently reached every other inset use in this file. The non-camera steps
          (stepWithSafeTop) and both overlays were all compensating with 0, which is exactly the
          case the comment on stepWithSafeTop warns about. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['bottom']}>

        {/* ── Prep / "how scanning works" overlay (first run + ? button) ── */}
        {showPrep && (
          <View style={[styles.prepOverlay, { paddingTop: insets.top + 16 }]}>
            <ScrollView contentContainerStyle={styles.prepScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.prepTitle}>A quick prep = a better scan</Text>
              <Text style={styles.prepIntro}>Pantry reads what the camera can see. Items tucked behind others are its blind spot — pull them forward so nothing gets missed.</Text>
              <PrepCompare />
              {/* Audited against scan-pantry's OWN documented failure modes rather than intuition.
                  Two removed:
                    "One shelf per photo" contradicted this file's corrected CAMERA_TIPS, whose
                    comment already records that it is "the opposite of the truth: recall scales
                    with coverage" — and contradicted the camera's own "capture the whole inside".
                    "Packed? Lay it flat" asked the user to unpack a pantry onto a counter. High
                    friction, and it appears nowhere in the model's miss list.
                  What replaced them is named in the scan prompt: door shelves, egg trays and
                  drawers are scanned separately and are called out as common misses, and an
                  unnameable item is SKIPPED by design ("NEVER invent placeholder entries like
                  'leftovers'") — which is the expectation most worth setting before the first scan,
                  because it pre-empts "why did it miss the covered dish?". */}
              <View style={styles.prepTips}>
                <PrepTip index={0} bold="Labels facing out" rest=" — it reads them to tell lookalikes apart"
                  icon={<Tag size={19} stroke="#4ADE80" strokeWidth={2} />} />
                <PrepTip index={1} bold="Shoot drawers and the door" rest=" — condiments and eggs hide there"
                  icon={<Refrigerator size={19} stroke="#4ADE80" strokeWidth={2} />} />
                <PrepTip index={2} bold="Covered or unlabeled is skipped" rest=" — it won't guess what's inside"
                  icon={<EyeOff size={19} stroke="#4ADE80" strokeWidth={2} />} />
              </View>
              <Text style={styles.prepFootnote}>You'll review every photo and fix misses after.</Text>
            </ScrollView>
            {/* Explicit bottom clearance rather than relying on the overlay inheriting it: this is
                an absoluteFill child, and an absolutely-positioned child does not pick up the
                parent SafeAreaView's padding. Math.max keeps it honest on a home-button device
                where insets.bottom is 0. */}
            <View style={[styles.prepActions, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={dismissPrep}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Got it, start scanning"
              >
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
              {/* Capped: no time is promised. The quota resets at UTC midnight while the meal cache
                  turns over at LOCAL midnight, so "tomorrow" would be wrong for part of the day. */}
              <Text style={styles.savedSub}>
                {savedReason === 'capped'
                  ? "You've used today's meal picks. Your next ones will use everything you just added."
                  : savedReason
                    ? thinPantryMessage(savedReason.thin)
                    : "Now the good part — we've lined up meals you can cook right now with what you have. No shopping."}
              </Text>
            </View>
            <View style={styles.savedActions}>
              {savedReason ? (
                // One action. "See what you can cook" would open the deck from before the scan, or
                // an error card saying the pantry is thin — neither is a payoff.
                <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85} onPress={() => handleClose()}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={[styles.primaryBtn, { flexDirection: 'row', gap: 6, justifyContent: 'center' }]} activeOpacity={0.85} onPress={goToReveal} disabled={plating}>
                    <Text style={styles.primaryBtnText}>See what you can cook</Text>
                    <ChevronRight size={18} stroke="#000000" strokeWidth={2.6} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.savedLater} activeOpacity={0.7} onPress={() => handleClose()}>
                    <Text style={styles.savedLaterText}>Maybe later</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* The plating wait, in the scan story's big type. Over the review or the saved step, whichever
            the user committed from; goToReveal clears it in the same render that opens the reveal. */}
        {plating && <PlatingStory lines={buildPlatingStory(storyProfile, savedCount)} onLater={showSaved ? () => handleClose() : undefined} />}

        {/* Week's scans used up. One action — add by hand — and ✕ as the only exit: the camera behind
            it is a dead end, and closing already returns to wherever the scan started. */}
        {weekCapped && (
          <View style={[styles.savedOverlay, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => handleClose()} accessibilityLabel="Close scanner">
              <X size={20} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.savedBody}>
              <View style={[styles.savedCheck, { backgroundColor: '#1A1A1A' }]}><ScanLine size={34} stroke="#4ADE80" strokeWidth={1.8} /></View>
              <Text style={[styles.savedTitle, { textAlign: 'center' }]}>You've used this week's scans</Text>
              <Text style={styles.savedSub}>Your scans refresh in a few days. Until then, you can add what you have by hand.</Text>
            </View>
            <View style={[styles.savedActions, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.85}
                onPress={() => { handleClose(); onAddByHand?.() }}
              >
                <Text style={styles.primaryBtnText}>Add items by hand</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Steps 1-3: Camera steps ── */}
        {(step === 1 || step === 2 || step === 3) && (() => {
          const stepConfig = {
            // ONE clear first action. "Snap your fridge, pantry, or freezer" offered three choices at
            // the moment the user just needs to point and shoot — so name the shot: the fridge. More
            // areas are just more shots from the same camera; there is no separate areas screen.
            1: { dotIndex: 0, label: 'Fridge', title: 'Start with your fridge', subtitle: 'Open it up and capture the whole inside' },
            2: { dotIndex: 1, label: 'Fridge', title: 'Now photograph your fridge', subtitle: 'Open it up and capture the full interior' },
            3: { dotIndex: 2, label: 'Counter', title: 'Anything on your counter?', subtitle: 'Fruits, oils, or anything sitting out' },
          }[step]!
          const captureLabel = stepConfig.label
          const captureTitle = stepConfig.title
          return (
            <View style={styles.cameraScreen}>
              {/* Full-bleed camera — fills the screen edge to edge, controls overlay on top */}
              {permission?.granted ? (
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  enableTorch={flashOn}
                  // The app is portrait-locked, so without this every capture is tagged portrait
                  // whatever way the phone is held: a wide shot of a shelf came out as a portrait
                  // image with the shelf on its side — in the review, in the zoom, and to the
                  // model. This reads the accelerometer at shutter time instead (what the iOS
                  // Camera does with rotation lock on); the viewfinder itself stays put.
                  responsiveOrientationWhenOrientationLocked
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
              {/* Top chrome sits in a SafeAreaView in NORMAL FLOW — an absolutely-positioned
                  child escapes a SafeAreaView's padding, which is why neither row is absolute.
                  This only works because of the SafeAreaProvider added at the modal root; without
                  it the inset here is 0 and this chrome lands back inside the status bar. */}
              <SafeAreaView edges={['top']} style={styles.cameraTopSafe} pointerEvents="box-none">
              <View style={styles.cameraTopBar}>
                {/* ✕ always, photos or not — Logan's call. This briefly swapped to a Back chevron
                    once a photo existed (to the areas hub); one control with one meaning beats a
                    control that changes what it does under you. The live edge that used to sit here
                    — ✕ discarding photos silently — is gone: requestClose asks first, and only when
                    there are unscanned photos to lose. */}
                <TouchableOpacity style={styles.cameraCloseBtn} onPress={requestClose} accessibilityLabel="Close scanner">
                  <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                </TouchableOpacity>
                {/* The photo count lived here. It duplicated the filmstrip below — which shows the
                    same number as actual pictures — so the tips pill gets the slot instead. The
                    pill IS this slot now, rather than a second absolutely-positioned row laid over
                    the same line: overlapping two absolute rows is what buried it under the
                    Dynamic Island in the first place. */}
                <View style={styles.cameraTopCenter} pointerEvents="box-none">
                  <TouchableOpacity
                    style={styles.cameraTipRow}
                    onPress={() => setShowPrep(true)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Lightbulb size={13} stroke="#4ADE80" strokeWidth={2} />
                    <Text style={styles.cameraTip} numberOfLines={1}>{CAMERA_TIPS[photos.length % CAMERA_TIPS.length]}</Text>
                    <View style={styles.cameraTipDivider} />
                    <Text style={styles.cameraTipMore}>More tips</Text>
                    <ChevronRight size={13} stroke="#4ADE80" strokeWidth={2.5} style={{ marginLeft: -2 }} />
                  </TouchableOpacity>
                </View>
                {/* The "?" lived here and opened the same guide as the tips pill above the shutter —
                    two controls, one destination. Removed; the pill is the single, visible entry.
                    Invisible spacer (NOT cameraCloseBtn, whose background rendered as a grey blob)
                    keeps the photo count centered between it and the ✕. */}
                <View style={{ width: 36 }} />
              </View>

              </SafeAreaView>

              {/* Hero beat: the instruction opens large and centered, then settles above the shutter.
                  Gated on photos.length like the bottom copy it cross-fades into — the two are the
                  same sentence and must appear and disappear together. */}
              {photos.length === 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.cameraHeroWrap, {
                    opacity: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                    transform: [{ scale: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) }],
                  }]}
                >
                  <Text style={styles.cameraHeroTitle}>{captureTitle}</Text>
                </Animated.View>
              )}

              {/* Bottom scrim carries the copy + shutter so text is always readable over the camera */}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']} style={[styles.cameraBottomOverlay, { paddingBottom: insets.bottom + 14 }]}>
                <View style={styles.stepTextCompact}>
                  {/* Fades in as the centered hero fades out — same words, one continuous beat.
                      Both title and subtitle are FIRST-SHOT instruction. Once a photo exists they
                      stop being true ("Start with your fridge" while you hold four fridge photos)
                      and they're just eating viewfinder, so the whole block goes. */}
                  {photos.length === 0 && (
                    <>
                      <Animated.Text style={[styles.cameraTitle, { opacity: titleAnim }]}>{captureTitle}</Animated.Text>
                      <Text style={styles.cameraSubtitle}>{stepConfig.subtitle}</Text>
                    </>
                  )}
                </View>

                {/* Captured filmstrip. Sits ABOVE the shutter, not beside it: the row carries the
                    only destructive control on this screen, and the shutter is where a thumb rests.
                    Tap the image to check the shot full-screen; ✕ drops it. Removal is silent —
                    a mis-tap here is cheap in a way it usually isn't,
                    because you're stood in front of the thing with the camera already open. */}
                {/* Shown from the instant the picker's sheet closes until the photos arrive. iOS copies
                    the whole selection out of the library one photo at a time and returns them
                    together, so without this the screen looks unchanged for seconds and the tap
                    reads as ignored. It sits where the tiles will land, so nothing jumps. */}
                {importing && (
                  <View style={styles.importingRow}>
                    <ActivityIndicator size="small" color="#4ADE80" />
                    <Text style={styles.importingText}>Preparing photos…</Text>
                  </View>
                )}

                {photos.length > 0 && (
                  <ScrollView
                    ref={filmstripRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filmstrip}
                    contentContainerStyle={styles.filmstripContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    {photos.map(p => (
                      <View key={p.id} style={styles.filmItem}>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          disabled={!p.uri}
                          onPress={() => p.uri && setZoomUri(p.uri)}
                          accessibilityLabel={`Review ${p.label} photo`}
                        >
                          {p.uri
                            ? <Image source={{ uri: p.uri }} style={styles.filmImg} resizeMode="cover" />
                            : <View style={[styles.filmImg, styles.filmImgEmpty]}><ScanLine size={16} stroke="#4ADE80" strokeWidth={1.5} /></View>}
                        </TouchableOpacity>
                        {/* Offset OUTSIDE the image corner and given hitSlop, so the destructive
                            target and the tap-to-review target aren't the same 56pt square. */}
                        <TouchableOpacity
                          style={styles.filmRemove}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() => {
                            setPhotos(prev => prev.filter(x => x.id !== p.id))
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                          }}
                          accessibilityLabel={`Remove ${p.label} photo`}
                        >
                          <X size={11} stroke="#FFFFFF" strokeWidth={3} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                <View style={styles.shutterRow}>
                  <TouchableOpacity style={styles.flashBtn} onPress={() => setFlashOn(f => !f)} activeOpacity={0.7}>
                    <Zap size={20} stroke={flashOn ? '#FFD700' : '#FFFFFF'} strokeWidth={2} fill={flashOn ? '#FFD700' : 'none'} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shutterBtn} onPress={() => capturePhoto(captureLabel, 0)} activeOpacity={0.85}>
                    <View style={styles.shutterInner} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.flashBtn, importing && { opacity: 0.4 }]}
                    onPress={() => launchGallery(captureLabel, 0)}
                    disabled={importing}
                    activeOpacity={0.7}
                    accessibilityLabel="Choose photos from your library"
                  >
                    <ImageIcon size={20} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                {/* Full-width, and the only action down here. The camera is the whole capture flow:
                    the "More ingredients" areas hub it used to lead to is gone, and more areas are
                    just more shots. Disabled until every photo has finished encoding, because the
                    upload silently drops photos that haven't. */}
                {photos.length > 0 && (
                  <TouchableOpacity
                    style={[styles.cameraScanBtn, (pendingScan || importing) && styles.cameraScanBtnBusy]}
                    onPress={requestScan}
                    // Also while a gallery import is in flight: the count on this button is about to
                    // change, and a scan started now would leave the incoming photos out.
                    disabled={pendingScan || importing}
                    activeOpacity={0.85}
                  >
                    {pendingScan || importing
                      ? <ActivityIndicator size="small" color="#000000" />
                      : <ScanLine size={17} stroke="#000000" strokeWidth={2.2} />}
                    <Text style={styles.cameraScanBtnText}>
                      {pendingScan || importing ? 'Preparing photos…'
                        // Three states, three words. "View results" only when results exist; a scan still
                        // running is something to go back to, not results to view.
                        : resultsForThesePhotos ? 'View results'
                        : scanRunningForThesePhotos ? 'Back to scan'
                        : `Scan ${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </LinearGradient>
            </View>
          )
        })()}

        {/* ── Step 5: Loading ── */}
        {step === 5 && (
          <View style={stepWithSafeTop}>
            {/* closeBtnAbs uses absolute positioning; override right→left and
                push down by the safe-area inset so X lands below the status
                bar at top-LEFT, matching the convention used by every other
                step. */}
            {/* Back to the CAMERA, photos still in the filmstrip (Logan). It went to the "More
                ingredients" areas hub, a second screen of the same photos between the scan and the
                camera. Safe mid-scan: the running call keeps going and Scan re-shows it. */}
            <TouchableOpacity
              style={[styles.closeBtn, styles.closeBtnAbs, { top: insets.top + 8, left: 8, right: undefined }]}
              onPress={() => setStep(1)}
            >
              <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
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
              <ScanTheater photos={photos} photoDims={photoDims} showDone={showDone} itemCount={spottedCount} story={storyProfile ? buildScanStory(storyProfile, photos.length) : undefined} />
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

        {/* ── Step 7: the cook reveal, in place ── */}
        {step === REVEAL_STEP && (
          <View style={StyleSheet.absoluteFill}>
            <CookRevealView
              edges={['top']} // this modal's own SafeAreaView already pads the bottom
              imagesWaitMs={0} // plating already waited for the photos; never a second, blank wait
              onClose={() => handleClose()}
              onOpenMeal={meal => { handleClose(); onOpenMeal?.(meal) }}
            />
          </View>
        )}

        {/* ── Step 5.5: unified review — one deduped list + a thumbnail strip of the scans ── */}
        {step === 55 && (() => {
          // Photos are ONE row, never a grid. A wrapping grid grew with the photo count — at 14
          // shots it was five rows tall, which pushed the header under the search bar and left the
          // list's flex:1 ScrollView with no height at all (nothing to scroll, nothing to read).
          // Tiles size to fit when few (capped at 120) and settle at 80 and scroll sideways beyond
          // four, so the photo chrome is at most 120pt for 1 photo or 16.
          const CONTENT_W = SCREEN_W - 48 // step horizontal padding (24 × 2)
          const nPhotos = photos.length
          const tile = Math.max(80, Math.min(120, Math.floor((CONTENT_W - (nPhotos - 1) * 8) / Math.max(1, nPhotos))))
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
                const renderRow = (item: DetectedItem, index: number) => {
                  const editing = editingId === item.id
                  return (
                    <View key={item.id} style={styles.reviewRow}>
                      {/* Inset hairline between rows, the Pantry tab's iOS grouped-list divider. */}
                      {index > 0 && <View style={styles.reviewRowHairline} pointerEvents="none" />}
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
                      {/* While THIS row is being renamed, its ✕ sits a thumb-width from the caret, so
                          the first tap just ends the edit (the rename is already committed on blur)
                          instead of silently deleting the row. Not guarded on other rows — filtering
                          and then removing a wrong item is a real, intentional flow. */}
                      <TouchableOpacity
                        onPress={() => {
                          if (editing) { Keyboard.dismiss(); return }
                          setDetectedItems(prev => prev.filter(d => d.id !== item.id))
                        }}
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
                      {/* With the keyboard up, ‹ closes the KEYBOARD, not the review. It's the nearest
                          "get me out of this" target when the keyboard covers the screen, and hitting
                          it used to discard every detected item — unrecoverable (the vision call is
                          already spent). Keyboard down, it goes back to the CAMERA — not the theatre,
                          which had nothing left to show — with the photos still in the strip and these
                          results kept: Scan on the same photos lands back here without a second call. */}
                      <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={() => { if (keyboardUp) { Keyboard.dismiss(); return } setStep(1) }}
                      >
                        <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                    {/* Scan thumbnails in one horizontal strip — centered when they fit, scrolling
                        when they don't. Bleeds to the screen edges like the camera filmstrip so a
                        cut-off tile reads as "more this way". Tap any to zoom. */}
                    {photos.length > 0 && !keyboardUp && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={[styles.reviewStrip, { height: tile }]}
                        contentContainerStyle={styles.reviewStripContent}
                        keyboardShouldPersistTaps="handled"
                      >
                        {photos.map((p, idx) => (
                          <TouchableOpacity key={idx} activeOpacity={0.85} onPress={() => p.uri && setZoomUri(p.uri)} style={[styles.photoThumb, { width: tile, height: tile }]}>
                            <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}

                    {/* Header — the hero names the JOB with the count in it ("N items found" alone
                        read as a result, not as something to act on), and the line under it lists
                        the three moves: fix, remove, add. */}
                    <View style={styles.reviewHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewCountHero}>
                          {detectedItems.length === 0 ? 'Nothing found' : detectedItems.length === 1 ? 'Check this item' : `Check these ${detectedItems.length} items`}
                        </Text>
                        <Text style={styles.reviewInstruction}>
                          {query
                            ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'} for "${missedInput.trim()}"`
                            : 'Tap a name to fix it  ·  ✕ to remove  ·  type below to add'}
                        </Text>
                      </View>
                    </View>

                    {/* Grouped by aisle in the Pantry tab's own order and categories (Logan), so the
                        review reads like the pantry it is about to join. normalizeCategory is the
                        mapping the pantry insert applies, so an item sits under the same heading
                        here and there. Uniform rows within each group. */}
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.reviewItemsScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                      {(() => {
                        const byAisle = new Map<string, DetectedItem[]>()
                        for (const item of visibleItems) {
                          const aisle = normalizeCategory(item.category, item.name)
                          if (!byAisle.has(aisle)) byAisle.set(aisle, [])
                          byAisle.get(aisle)!.push(item)
                        }
                        const aisles = [...PANTRY_ORDER.filter(a => byAisle.has(a)), ...[...byAisle.keys()].filter(a => !PANTRY_ORDER.includes(a))]
                        return aisles.map(aisle => (
                          <View key={aisle}>
                            <View style={styles.reviewAisleHeader}>
                              <Text style={styles.reviewAisleTitle}>{aisle.toUpperCase()}</Text>
                              <Text style={styles.reviewAisleCount}>{byAisle.get(aisle)!.length}</Text>
                            </View>
                            {/* Each aisle is a card, exactly as the Pantry tab draws it: the card edge is
                                what makes a section read as one, not the small heading above it. */}
                            <View style={styles.reviewAisleCard}>{byAisle.get(aisle)!.map(renderRow)}</View>
                          </View>
                        ))
                      })()}
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
                    // The phantom check's labels: what the user unchecked, and what they typed in as missed.
                    if (__DEV__) console.log(`[scan-labels] ${JSON.stringify({ at: new Date().toISOString(), shown: detectedItems.length, unchecked: detectedItems.filter(i => !i.checked).map(i => [i.name, i.category, i.confidence ?? null]), addedByHand: detectedItems.filter(i => i.zone === 'Added manually').map(i => i.name) })}`)
                    if (selected.length === 0) { handleClose(); return }
                    savingRef.current = true
                    setSaving(true)
                    const addAt = Date.now()
                    scanPerfMark(`add all: tapped, ${selected.length} items, meals ${prefetchOutcomeRef.current}`)
                    // Deduped insert — skips items already in the pantry so a re-scan can't
                    // create a duplicate row; re-stocks any that were previously out.
                    const { error } = await addPantryItemsDeduped(user.id, selected.map(item => ({ name: item.name, category: item.category })))
                    scanPerfMark(`add all: pantry saved in ${secsSince(addAt)}s${error ? ' (FAILED)' : ''}`)
                    if (error) {
                      setSaving(false)
                      savingRef.current = false
                      Alert.alert('Save failed', error.message)
                      return
                    }
                    onItemsAdded?.()
                    // Saved: this scan's meals now replace the deck on Home and Pantry, whether or not
                    // the user opens the reveal (Maybe later still leads to them).
                    if (showReveal) commitCookNowPrefetch(user.id)
                    // The items are in. With no reveal to follow, this is the flow's end: success.
                    // With the cook reveal next, only a light tick — the reveal has its own success
                    // peak a moment later, and two in a row would blur into one buzz.
                    if (!showReveal) { setSaving(false); savingRef.current = false; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); handleClose(); return }
                    // Past today's meal cap the prefetch was refused, and the reveal could only show
                    // the deck from before the scan. Checked only when the prefetch FAILED: 'ok' means
                    // new meals exist, and 'pending' may be the very generation that used the last
                    // slot (the reveal awaits it and shows the server's own message if it is refused).
                    // An unreadable count counts as not capped — the server still decides.
                    if (prefetchOutcomeRef.current === 'failed' || prefetchOutcomeRef.current === 'none') {
                      const used = await fetchMealGenUsedToday(user.id)
                      // A pantry under the floor is the other reason the prefetch is refused. Read the
                      // count the server would read (in-stock rows, the just-saved ones included).
                      const { count } = await supabase.from('pantry_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('in_stock', true)
                      const thin = typeof count === 'number' && count < MIN_PANTRY_FOR_COOK_NOW ? count : null
                      if ((used !== null && used >= MEAL_GEN_CAP_PER_DAY) || thin !== null) {
                        setSaving(false)
                        savingRef.current = false
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) // the flow ends here
                        // COOK_REVEAL_SEEN_KEY is deliberately NOT set: a first scanner who hits this
                        // still gets the auto-reveal on their next scan.
                        setSavedCount(selected.length)
                        setSavedReason(thin !== null ? { thin } : 'capped')
                        setShowSaved(true)
                        return
                      }
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
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
                      setSavedCount(selected.length) // the plating story's item count on this path too
                      goToReveal()
                      return
                    }
                    setSaving(false)
                    savingRef.current = false
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

        {/* Fullscreen pinch-to-zoom for a tapped review photo. In-tree absolute overlay (not a
            nested Modal) so it layers over the scan modal on iOS. */}
        {zoomUri && (
          <View style={styles.zoomOverlay}>
            <ScrollView
              style={StyleSheet.absoluteFill}
              contentContainerStyle={styles.zoomScrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              // Nothing here centres anything: the content box IS the viewport and `contain` centres
              // the photo inside it. `centerContent` plus a flex-centred container used to be here,
              // and centerContent takes (viewport − contentSize)/2 as an inset at layout time — which
              // is half a screen while the image's own layout is still 0. UIScrollView keeps that
              // inset once the image lands, so the photo opened off the bottom-right corner and
              // snapped back there on every zoom-out. Fast decodes beat the race, which is why it
              // only appeared once the photos got big. The two auto-inset props are off for the same
              // reason: a modal's safe-area or keyboard inset must not move the photo either.
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
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
      </SafeAreaProvider>
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
  prepCompareTag: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  prepCompareTagBad: { color: '#FF6B6B' },
  prepCompareTagGood: { color: '#4ADE80' },
  prepTitle: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 10, lineHeight: 33, textAlign: 'center' },
  prepIntro: { fontSize: 15, color: '#999999', lineHeight: 21, marginBottom: 30, textAlign: 'center' },
  prepTips: { gap: 14 },
  prepTipRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  prepTipChip: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(74,222,128,0.12)', alignItems: 'center', justifyContent: 'center' },
  prepTipText: { flex: 1, fontSize: 15, color: '#999999', lineHeight: 20 },
  prepTipBold: { color: '#FFFFFF', fontWeight: '700' },
  prepFootnote: { fontSize: 13, color: '#777777', textAlign: 'center', marginTop: 28, lineHeight: 19 },
  prepActions: { paddingTop: 8 },
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
  // One-row strip; its height is set inline to the tile size so it can never balloon vertically.
  // flexGrow here is HORIZONTAL: it lets a short row centre its tiles, and a long row scrolls.
  reviewStrip: { flexGrow: 0, marginHorizontal: -24, marginBottom: 4 },
  reviewStripContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  photoThumb: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1A1A1A' }, // width/height set inline (responsive)
  reviewHeaderRight: { alignItems: 'flex-end', gap: 4 },
  // Fullscreen tap-to-zoom overlay.
  zoomOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 100 },
  // Exactly the viewport, so UIScrollView has no inset to compute at any zoom level.
  zoomScrollContent: { width: SCREEN_W, height: SCREEN_H },
  zoomImage: { width: SCREEN_W, height: SCREEN_H },
  zoomHint: { position: 'absolute', bottom: 8, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 13 },
  zoomHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  zoneGroup: { marginBottom: 2 },
  zoneHeader: { fontSize: 12, fontWeight: '700', color: '#4ADE80', marginTop: 14, marginBottom: 8, letterSpacing: 0.3 },
  reviewPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  reviewPhotoPhText: { color: '#888888', fontSize: 13 },
  // No fixed width: the list lives inside the step's 24px horizontal padding, so forcing width
  // SCREEN_W made the content 48px wider than its viewport → sideways scroll + left-clipped chips.
  reviewItemsScroll: { paddingTop: 0, paddingBottom: 20 },
  // Same look as the Pantry tab's section headers (sectionHeader / sectionTitle / sectionCount).
  reviewAisleHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 8, paddingHorizontal: 2 },
  reviewAisleCard: { backgroundColor: '#141414', borderRadius: 14, overflow: 'hidden' },
  reviewRowHairline: { position: 'absolute', top: 0, left: 14, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  reviewAisleTitle: { flex: 1, fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  reviewAisleCount: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  reviewCountHero: { fontSize: 27, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  reviewInstruction: { fontSize: 13, color: '#888888', marginTop: 3, fontWeight: '600' },
  // Uniform full-width row per detected item — scans cleanly at 20+ items where ragged pills didn't.
  // The Pantry tab's row: same padding, same card, divider drawn as an inset hairline, not a border.
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  reviewRowText: { fontSize: 16, fontWeight: '500', color: '#FFFFFF' },
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
  // Settled size — a touch smaller than before (24) since the hero beat already delivered the words.
  cameraTitle: { fontSize: 21, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  cameraHeroWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  cameraHeroTitle: { fontSize: 38, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.8, lineHeight: 44, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  cameraSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 20, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
  // Anchors the camera's top chrome below the status bar. zIndex keeps it over the CameraView.
  cameraTopSafe: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  cameraTopBar: {
    marginTop: 4,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cameraTopCenter: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  cameraCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bracket: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(255,255,255,0.6)',
    borderWidth: 3,
  },
  bracketTL: { top: '12%', left: '4%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  bracketTR: { top: '12%', right: '4%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  // Bottom brackets must clear the filmstrip — they frame the shot, so they have to sit above
  // everything that isn't the shot, and at 27% they were drawn straight through the first
  // thumbnail. 40% overcorrected and left ~100pt of dead frame; dropping the per-photo labels
  // lowered the strip another ~20pt. 30% leaves roughly a 30pt gap above the thumbnails' ✕ badges.
  bracketBL: { bottom: '30%', left: '4%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  bracketBR: { bottom: '30%', right: '4%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
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
  // Camera filmstrip (bottom of the capture screen). 56pt image keeps the tap-to-review target
  // at Apple's 44pt minimum; the ✕ is pushed outside that square so the two don't overlap.
  // Negative margins cancel cameraBottomOverlay's 24pt padding so the strip bleeds to both screen
  // edges — a row that stops short of the edge reads as a finished list, not a scrollable one.
  // Same height as a filmstrip tile so the tiles replace it in place rather than pushing the shutter.
  importingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 64, alignSelf: 'stretch' },
  importingText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  filmstrip: { alignSelf: 'stretch', maxHeight: 84, marginBottom: 2, marginHorizontal: -24 },
  filmstripContent: { gap: 12, paddingHorizontal: 24, paddingTop: 8 },
  filmItem: { alignItems: 'center', width: 56 },
  filmImg: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.35)',
  },
  filmImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  filmRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cameraScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',      // full width of the overlay — the one action on this screen
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 15,
    borderRadius: 30,
  },
  cameraScanBtnBusy: { opacity: 0.65 },
  // Height matches cameraCloseBtn so the pill centres on the back arrow whatever the pill's own
  // height is. left/right clear the 36pt top-bar controls (which start at 16) — without that a long
  // tip grows under the back arrow, since the pill is centred and free to widen in both directions.
  cameraScanBtnText: { fontSize: 15, fontWeight: '700', color: '#000000' },

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
  // Bordered pill = "this is tappable"; the bare row read as static caption text.
  cameraTipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)', backgroundColor: 'rgba(74,222,128,0.10)',
  },
  cameraTipMore: { fontSize: 12, fontWeight: '800', color: '#4ADE80', letterSpacing: 0.2 },
  // Hairline between the hint and the action so the pill reads as two parts, not one run-on line.
  cameraTipDivider: { width: 1, height: 12, backgroundColor: 'rgba(74,222,128,0.35)', marginHorizontal: 2 },
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
