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
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { X, ScanLine, Check, Plus, Zap, ImageIcon, HelpCircle, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { usePremium } from '@/context/SuperwallContext'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import { trackUpgradePromptShown } from '@/lib/analytics'
import { trackAIError } from '@/lib/analytics'
import { categorizeItem } from '@/lib/categories'

const { width: SCREEN_W } = Dimensions.get('window')

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
}

type ZoneGroup = {
  zone: string
  items: DetectedItem[]
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

const EXTRA_OPTIONS = [
  { id: 'freezer', label: 'Freezer' },
  { id: 'fridge2', label: 'Second Fridge' },
  { id: 'shelf',   label: 'Extra Shelf' },
  { id: 'custom',  label: 'Custom' },
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
}

export default function PantryScanModal({ visible, onClose, onItemsAdded }: Props) {
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
  const [customLabel, setCustomLabel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])
  const [zones, setZones] = useState<ZoneGroup[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // synchronous in-flight guard so a double-tap / close race can't double-insert
  const [showPrep, setShowPrep] = useState(false) // first-run "how scanning works" overlay (sets expectations + coaches better photos)
  // Per-photo review carousel state
  const [currentPhoto, setCurrentPhoto] = useState(0)
  const pagerRef = useRef<ScrollView>(null)
  const nudgedRef = useRef(false) // one-time "it swipes" nudge guard
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0)
  const [missedInput, setMissedInput] = useState('')
  const [addingMissed, setAddingMissed] = useState(false)
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

  const pulseScale   = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0.4)).current

  // Loading animation + actual AI scan. retryNonce is in the dep list so the
  // user's "Retry" tap on the error screen re-fires this effect without
  // needing them to re-take photos.
  useEffect(() => {
    if (step !== 5) return
    setScanError(null)
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale,   { toValue: 1.35, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseScale,   { toValue: 1,    duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 1,   duration: 900, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        ]),
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
        const result = scanResult.data as { layout: string; zones: { zone: string; items: { name: string; category: string; photo?: number }[] }[] }
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
            }
            return detected
          })
          allItems.push(...zoneItems)
          zoneGroups.push({ zone: zoneData.zone, items: zoneItems })
        }

        setDetectedItems(allItems)
        setZones(zoneGroups)
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

  // Phase 1 — live ramp WHILE scanning. Ticks up with a decelerating gap (fast at
  // first, then crawling) toward a soft cap, so it feels like the AI is spotting
  // items in real time during the 30s-2min scan. Resets when the scan (re)starts.
  useEffect(() => {
    if (step !== 5 || showDone || scanError) return
    setSpottedCount(0)
    spottedCountRef.current = 0
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (cancelled) return
      const n = spottedCountRef.current
      if (n >= 24) return // soft cap — real total replaces this on completion
      const next = n + 1
      spottedCountRef.current = next
      setSpottedCount(next)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}) // a light tap per "spotted" item — makes the climb feel like real discovery
      timer = setTimeout(tick, 280 + next * 80) // gap grows ~80ms per item (was 110 — felt too slow as the count climbed)
    }
    timer = setTimeout(tick, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [step, showDone, scanError])

  // Phase 2 — settle from the live value to the true total when results land
  // (counts up or down a few from wherever the ramp was, so there's no jarring jump).
  useEffect(() => {
    const target = detectedItems.length
    if (!showDone || target === 0) return
    let current = spottedCountRef.current
    if (current === target) return
    const dir = target > current ? 1 : -1
    const id = setInterval(() => {
      current += dir
      spottedCountRef.current = current
      setSpottedCount(current)
      if (current === target) clearInterval(id)
    }, 45)
    return () => clearInterval(id)
  }, [showDone, detectedItems.length])

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
      setShowDone(false)
      setCustomLabel('')
      setShowCustomInput(false)
      setDetectedItems([])
      setZones([])
      setFlashOn(false)
      setMissedInput('')
      setAddingMissed(false)
      setCurrentPhoto(0)
      nudgedRef.current = false
      setScanError(null)
      setRetryNonce(0)
    }, 350)
  }

  // Parse comma- or newline-separated names, categorize each via the LLM-backed
  // helper, append to the detected list under a "Added manually" zone.
  const addMissedItems = async () => {
    const names = missedInput
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (names.length === 0) return
    setAddingMissed(true)
    try {
      const newItems: DetectedItem[] = await Promise.all(
        names.map(async (name, i) => ({
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

        {/* ── Steps 1-3: Camera steps ── */}
        {(step === 1 || step === 2 || step === 3) && (() => {
          const stepConfig = {
            1: { dotIndex: 0, label: 'Pantry', title: 'Photograph your pantry', subtitle: 'Open your cabinets and capture the full shelves', next: 2 },
            2: { dotIndex: 1, label: 'Fridge', title: 'Now photograph your fridge', subtitle: 'Open it up and capture the full interior', next: 3 },
            3: { dotIndex: 2, label: 'Counter', title: 'Anything on your counter?', subtitle: 'Fruits, oils, or anything sitting out', next: 4 },
          }[step]!
          return (
            <View style={styles.step}>
              {/* Camera viewfinder */}
              <View style={styles.cameraContainer}>
                {permission?.granted ? (
                  <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing="back"
                    enableTorch={flashOn}
                  />
                ) : (
                  <View style={[styles.camera, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: COLORS.textMuted }}>Camera permission required</Text>
                  </View>
                )}

                {/* Corner brackets */}
                <View style={[styles.bracket, styles.bracketTL]} />
                <View style={[styles.bracket, styles.bracketTR]} />
                <View style={[styles.bracket, styles.bracketBL]} />
                <View style={[styles.bracket, styles.bracketBR]} />

                {/* Top bar overlay */}
                <View style={[styles.cameraTopBar, { top: insets.top + 12 }]}>
                  <TouchableOpacity style={styles.cameraCloseBtn} onPress={handleClose}>
                    <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                  <View style={styles.cameraTopCenter}>
                    <ProgressDots total={3} active={stepConfig.dotIndex} />
                  </View>
                  <TouchableOpacity style={styles.cameraCloseBtn} onPress={() => setShowPrep(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <HelpCircle size={20} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                {/* Photo thumbnails overlay */}
                {photos.length > 0 && (
                  <View style={styles.cameraPhotoRow}>
                    {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} uri={p.uri} />)}
                  </View>
                )}
              </View>

              {/* Bottom controls */}
              <View style={styles.cameraBottom}>
                <View style={styles.stepTextCompact}>
                  <Text style={styles.title}>{stepConfig.title}</Text>
                  <Text style={styles.subtitle}>{stepConfig.subtitle}</Text>
                  <Text style={styles.cameraTip}>
                    💡 {CAMERA_TIPS[photos.length % CAMERA_TIPS.length]}
                  </Text>
                </View>

                <View style={styles.shutterRow}>
                  <TouchableOpacity style={styles.flashBtn} onPress={() => setFlashOn(f => !f)} activeOpacity={0.7}>
                    <Zap size={20} stroke={flashOn ? '#FFD700' : COLORS.textMuted} strokeWidth={2} fill={flashOn ? '#FFD700' : 'none'} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shutterBtn} onPress={() => capturePhoto(stepConfig.label, stepConfig.next)} activeOpacity={0.85}>
                    <View style={styles.shutterInner} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.flashBtn} onPress={() => launchGallery(stepConfig.label, stepConfig.next)} activeOpacity={0.7}>
                    <ImageIcon size={20} stroke={COLORS.textMuted} strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={() => setStep(stepConfig.next)} activeOpacity={0.7}>
                  <Text style={styles.skipText}>Skip</Text>
                </TouchableOpacity>
              </View>
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
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.addMoreScroll}>
              <Text style={styles.title}>Want to add more?</Text>
              <Text style={[styles.subtitle, { marginBottom: 20 }]}>Add any other storage areas in your kitchen</Text>
              {photos.length > 0 && (
                <View style={[styles.photoRow, { marginBottom: 20 }]}>
                  {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} uri={p.uri} />)}
                </View>
              )}
              <View style={styles.extraGrid}>
                {EXTRA_OPTIONS.map(opt => {
                  const taken = photos.some(p => p.label === opt.label)
                  if (opt.id === 'custom') {
                    return (
                      <View key={opt.id} style={styles.extraCardWrap}>
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
                                addExtraPhoto(customLabel.trim())
                                setCustomLabel('')
                                setShowCustomInput(false)
                              }}
                              disabled={!customLabel.trim()}
                            >
                              <Text style={styles.customAddBtnText}>Add</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={styles.extraCard} onPress={() => setShowCustomInput(true)} activeOpacity={0.7}>
                            <Plus size={20} stroke="#4ADE80" strokeWidth={2} />
                            <Text style={styles.extraCardText}>Custom</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  }
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.extraCard, styles.extraCardWrap, taken && styles.extraCardTaken]}
                      onPress={() => !taken && addExtraPhoto(opt.label)}
                      activeOpacity={0.7}
                    >
                      {taken && (
                        <View style={styles.extraCheckBadge}>
                          <Check size={10} stroke="#000" strokeWidth={3} />
                        </View>
                      )}
                      <ScanLine size={20} stroke={taken ? '#4ADE80' : COLORS.textDim} strokeWidth={1.8} />
                      <Text style={[styles.extraCardText, taken && { color: '#4ADE80' }]}>{opt.label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </ScrollView>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(5)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>
                  Scan {photos.length} Photo{photos.length !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep(3)} activeOpacity={0.7}>
                <Text style={styles.skipText}>Back</Text>
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

            {/* Centered loading indicator (fills available space) */}
            <View style={styles.loadingBody}>
              <View style={styles.pulseWrap}>
                <Animated.View
                  style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
                />
                <View style={styles.pulseCore}>
                  <ScanLine size={32} stroke={scanError ? '#F87171' : '#4ADE80'} strokeWidth={1.6} />
                </View>
              </View>
              {scanError ? (
                <>
                  <Text style={[styles.title, { textAlign: 'center', marginTop: 36 }]}>Scan failed</Text>
                  <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8, paddingHorizontal: 12 }]}>{scanError}</Text>
                </>
              ) : (
                <>
                  {/* Hero count — ramps live while scanning, settles to the real total. */}
                  <Text style={styles.scanCount}>{spottedCount}</Text>
                  <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 2, fontWeight: '700', color: COLORS.textWhite }]}>
                    item{spottedCount === 1 ? '' : 's'} spotted
                  </Text>
                  <Animated.Text
                    style={[
                      styles.subtitle,
                      { textAlign: 'center', marginTop: 10, paddingHorizontal: 12 },
                      showDone ? null : { opacity: msgAnim, transform: [{ translateY: msgAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
                    ]}
                  >
                    {showDone
                      ? 'Tap below to review and add anything we missed'
                      : SCAN_STATUS_LINES[loadingMessageIdx]}
                  </Animated.Text>
                </>
              )}
            </View>

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

        {/* ── Step 5.5: Zone-based visual review ── */}
        {step === 55 && (() => {
          // One review page per captured photo — each shows that photo full + ONLY the items
          // the AI attributed to it (item.photo), so the user compares photo-vs-list to catch
          // misses. Items the model didn't attribute fall onto a trailing "More" page.
          // Single photo: every item belongs to it — skip the per-photo split entirely so the
          // model omitting a `photo` index can't dump everything onto a phantom "More" page.
          const pages: { uri?: string; label: string; items: DetectedItem[]; photoIdx: number | null }[] =
            photos.length <= 1
              ? [{ uri: photos[0]?.uri, label: 'Photo 1', items: detectedItems, photoIdx: 0 }]
              : photos.map((p, idx) => ({ uri: p.uri, label: `Photo ${idx + 1}`, items: detectedItems.filter(d => d.photo === idx), photoIdx: idx }))
          if (photos.length > 1) {
            const orphans = detectedItems.filter(d => d.photo == null || d.photo < 0 || d.photo >= photos.length)
            if (orphans.length > 0) pages.push({ uri: undefined, label: 'More', items: orphans, photoIdx: null })
          }
          const total = pages.length || 1
          const cur = Math.min(currentPhoto, total - 1)
          const goTo = (i: number) => {
            const c = Math.max(0, Math.min(i, total - 1))
            pagerRef.current?.scrollTo({ x: c * SCREEN_W, animated: true })
            setCurrentPhoto(c)
          }
          return (
            <View style={stepWithSafeTop}>
              <View style={styles.topBar}>
                <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                  <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
                <Text style={[styles.topTitle, { marginLeft: 12 }]}>Review your scan</Text>
              </View>

              {/* Pager controls — chevrons + "Photo N of M" + dots make the swipe obvious */}
              <View style={styles.pagerCtrl}>
                <TouchableOpacity onPress={() => goTo(cur - 1)} disabled={cur === 0} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <ChevronLeft size={24} stroke={cur === 0 ? '#3A3A3A' : COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.pagerLabel}>{pages[cur]?.label}{total > 1 ? `  ·  ${cur + 1} of ${total}` : ''}</Text>
                  {total > 1 && (
                    <View style={styles.dotsRow}>
                      {pages.map((_, i) => <View key={i} style={[styles.pagerDot, i === cur && styles.pagerDotActive]} />)}
                    </View>
                  )}
                </View>
                <TouchableOpacity onPress={() => goTo(cur + 1)} disabled={cur >= total - 1} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <ChevronRight size={24} stroke={cur >= total - 1 ? '#3A3A3A' : COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Horizontal pager — one full page per photo */}
              <ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => setCurrentPhoto(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
              >
                {pages.map((page, idx) => {
                  // Group this page's items by the zone/shelf the model assigned so the review
                  // mirrors the physical layout (top shelf, door, drawer…). Headers only show
                  // when there's >1 zone — a single zone reads cleaner as a flat list.
                  const byZone = new Map<string, DetectedItem[]>()
                  for (const it of page.items) {
                    const z = (it.zone || '').trim() || 'Other'
                    if (!byZone.has(z)) byZone.set(z, [])
                    byZone.get(z)!.push(it)
                  }
                  const zoneEntries = Array.from(byZone.entries())
                  const showZoneHeaders = zoneEntries.length > 1
                  const renderChip = (item: DetectedItem) => (
                    <View key={item.id} style={styles.zoneChip}>
                      <Text style={styles.zoneChipText}>{item.name}</Text>
                      <TouchableOpacity
                        onPress={() => setDetectedItems(prev => prev.filter(d => d.id !== item.id))}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <X size={13} stroke={COLORS.textMuted} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                  )
                  return (
                  <View key={idx} style={{ width: SCREEN_W }}>
                    {page.uri ? (
                      // Pinch-to-zoom IN PLACE (maximumZoomScale) so the photo can be inspected
                      // for misses while the item list stays visible below — no fullscreen
                      // takeover. Pinch is two-finger so it doesn't fight the pager's swipe.
                      <View style={styles.reviewPhoto}>
                        <ScrollView
                          style={StyleSheet.absoluteFill}
                          contentContainerStyle={styles.reviewPhotoZoomContent}
                          maximumZoomScale={3}
                          minimumZoomScale={1}
                          bouncesZoom
                          centerContent
                          showsVerticalScrollIndicator={false}
                          showsHorizontalScrollIndicator={false}
                        >
                          <Image source={{ uri: page.uri }} style={styles.reviewPhotoImg} resizeMode="contain" />
                        </ScrollView>
                        <View style={styles.zoomHint} pointerEvents="none">
                          <Maximize2 size={12} stroke="#FFFFFF" strokeWidth={2} />
                          <Text style={styles.zoomHintText}>Zoom</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={[styles.reviewPhoto, styles.reviewPhotoPlaceholder]}>
                        <ImageIcon size={28} stroke="#555" strokeWidth={1.4} />
                        <Text style={styles.reviewPhotoPhText}>Items the AI couldn't place to a photo</Text>
                      </View>
                    )}
                    <ScrollView style={{ flex: 1, width: SCREEN_W }} contentContainerStyle={styles.reviewItemsScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                      <Text style={styles.reviewFoundLabel}>
                        {page.items.length > 0
                          ? `Found ${page.items.length} here — tap ✕ if it's wrong`
                          : 'Nothing detected here — add anything you see below'}
                      </Text>
                      {showZoneHeaders
                        ? zoneEntries.map(([zone, items]) => (
                            <View key={zone} style={styles.zoneGroup}>
                              <Text style={styles.zoneHeader}>{zone}</Text>
                              <View style={styles.zoneChipWrap}>{items.map(renderChip)}</View>
                            </View>
                          ))
                        : <View style={styles.zoneChipWrap}>{page.items.map(renderChip)}</View>}
                    </ScrollView>
                  </View>
                  )
                })}
              </ScrollView>

              {/* Add-missing — contextual to the photo currently on screen */}
              <View style={styles.missedBar}>
                <TextInput
                  style={styles.missedBarInput}
                  placeholder={total > 1 ? `Add what's missing in ${pages[cur]?.label}…` : 'Add what it missed — e.g. salt, soy sauce'}
                  placeholderTextColor={COLORS.textMuted}
                  value={missedInput}
                  onChangeText={setMissedInput}
                  returnKeyType="done"
                  onSubmitEditing={addMissedItems}
                />
                <TouchableOpacity
                  style={[styles.missedBarBtn, (!missedInput.trim() || addingMissed) && { opacity: 0.5 }]}
                  onPress={addMissedItems}
                  disabled={!missedInput.trim() || addingMissed}
                  activeOpacity={0.7}
                >
                  {addingMissed ? <ActivityIndicator color="#000" size="small" /> : <Plus size={20} stroke="#000" strokeWidth={2.5} />}
                </TouchableOpacity>
              </View>

              <View style={styles.actions}>
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
                    const rows = selected.map(item => ({
                      user_id: user.id,
                      name: item.name,
                      category: item.category,
                      in_stock: true,
                    }))
                    const { error } = await supabase.from('pantry_items').insert(rows)
                    setSaving(false)
                    savingRef.current = false
                    if (error) {
                      Alert.alert('Save failed', error.message)
                      return
                    }
                    onItemsAdded?.()
                    handleClose()
                  }}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.primaryBtnText}>Add {detectedItems.length} Item{detectedItems.length !== 1 ? 's' : ''} to Pantry</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
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
            <View style={styles.actions}>
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
                  const { error } = await supabase.from('pantry_items').insert(
                    selected.map(item => ({
                      user_id: user.id,
                      name: item.name,
                      category: item.category,
                      in_stock: true,
                    }))
                  )
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

  // ── Per-photo review carousel ──
  pagerCtrl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 4 },
  pagerLabel: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 },
  dotsRow: { flexDirection: 'row', gap: 6, marginTop: 7, alignItems: 'center' },
  pagerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  pagerDotActive: { backgroundColor: '#4ADE80', width: 18 },
  reviewPhoto: { width: '100%', height: 300, backgroundColor: '#0A0A0A', overflow: 'hidden' },
  reviewPhotoImg: { width: SCREEN_W, height: 300 },
  reviewPhotoZoomContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  zoomHint: { position: 'absolute', bottom: 8, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 13 },
  zoomHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  zoneGroup: { marginBottom: 2 },
  zoneHeader: { fontSize: 12, fontWeight: '700', color: '#4ADE80', marginTop: 14, marginBottom: 8, letterSpacing: 0.3 },
  reviewPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  reviewPhotoPhText: { color: '#888888', fontSize: 13 },
  reviewItemsScroll: { width: SCREEN_W, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  reviewFoundLabel: { fontSize: 13, color: '#888888', marginBottom: 12, fontWeight: '600' },
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
    paddingBottom: 8,
  },

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
    bottom: 12,
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
  bracketTL: { top: '20%', left: '10%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  bracketTR: { top: '20%', right: '10%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bracketBL: { bottom: '20%', left: '10%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  bracketBR: { bottom: '20%', right: '10%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  cameraBottom: {
    paddingTop: 12,
    paddingBottom: 4,
    gap: 12,
    alignItems: 'center',
  },
  stepTextCompact: { gap: 4, alignSelf: 'stretch' },
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
  pulseWrap: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(74,222,128,0.18)',
  },
  pulseCore: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

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
    // Pin to the content width (screen minus the list's 20px side padding). Inside the
    // horizontal pager the wrap was computing against an unbounded width, so long chips
    // ran off the right edge instead of wrapping. An explicit width forces clean wrapping.
    width: SCREEN_W - 40,
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
  cameraTip: {
    fontSize: 11,
    color: '#666666',
    fontWeight: '500',
    marginTop: 6,
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
