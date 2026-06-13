import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
import { X, ScanLine, Check, Plus, Zap, ImageIcon, HelpCircle } from 'lucide-react-native'
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
const LOADING_STAGES = [
  { atMs: 0,      title: 'Uploading photos...',         sub: 'Sending your shelves to our AI vision model' },
  { atMs: 4000,   title: 'Reading the shelves...',      sub: 'First pass — identifying every item we can see' },
  { atMs: 20000,  title: 'Decoding labels & packaging', sub: 'Brand names, product types, sizes' },
  { atMs: 40000,  title: 'Catching what we missed',     sub: 'Second pass — small items, back rows, door shelves' },
  { atMs: 65000,  title: 'Looking up barcodes',         sub: 'Cross-referencing the Open Food Facts database' },
  { atMs: 85000,  title: 'Categorizing everything',     sub: 'Sorting by produce, protein, condiments, dairy' },
  { atMs: 110000, title: 'Almost there...',             sub: 'Big kitchens take a little longer to process' },
  { atMs: 140000, title: 'Still working...',            sub: "Hang tight — we'll let you add anything we missed at the end" },
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

// One row of the prep / "how scanning works" screen.
function PrepTip({ emoji, bold, rest }: { emoji: string; bold: string; rest: string }) {
  return (
    <View style={styles.prepTipRow}>
      <Text style={styles.prepTipEmoji}>{emoji}</Text>
      <Text style={styles.prepTipText}>
        <Text style={styles.prepTipBold}>{bold}</Text>{rest}
      </Text>
    </View>
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
      // First-run consent gate — discloses that pantry photos are sent to OpenAI Vision
      const ok = await requestConsent()
      if (!ok) { onClose(); return }
      try {
        // Race the invoke against a hard timeout. supabase-js doesn't honor an
        // AbortSignal cleanly for functions.invoke, so we use Promise.race —
        // the scan keeps running server-side but the client surfaces a recoverable
        // error instead of leaving the user stuck on an infinite spinner.
        const { data, error } = await Promise.race([
          supabase.functions.invoke('scan-pantry', { body: { images: base64Images } }),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error('Scan is taking too long. Tap retry to try again.') }), SCAN_HARD_TIMEOUT_MS)
          ),
        ])
        if (error) throw error
        const result = data as { layout: string; zones: { zone: string; items: { name: string; category: string; photo?: number }[] }[] }
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

  // Pick the message stage based on actual elapsed scan time. Re-evaluates
  // every second so the visible copy advances in lockstep with what the server
  // is most likely doing — never repeats, never overshoots reality.
  useEffect(() => {
    if (step !== 5 || showDone) return
    const startedAt = Date.now()
    setLoadingMessageIdx(0)
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt
      // Pick the latest stage whose atMs ≤ elapsed. Stages are ordered ascending.
      let idx = 0
      for (let i = 0; i < LOADING_STAGES.length; i++) {
        if (LOADING_STAGES[i].atMs <= elapsed) idx = i
        else break
      }
      setLoadingMessageIdx(idx)
    }, 1000)
    return () => clearInterval(interval)
  }, [step, showDone])

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
      timer = setTimeout(tick, 350 + next * 110) // gap grows ~110ms per item
    }
    timer = setTimeout(tick, 450)
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
              <Text style={styles.prepTitle}>Help Pantry catch everything</Text>
              <Text style={styles.prepIntro}>
                Pantry reads what the camera sees — food fully hidden behind other items is its blind spot. A few seconds of prep fixes that.
              </Text>
              <View style={styles.prepTips}>
                <PrepTip emoji="🫳" bold="Front-face your shelves" rest=" — pull items forward, one layer deep." />
                <PrepTip emoji="🔍" bold="One shelf or section per photo" rest=" — get close so small jars and labels stay sharp. (Up to 8.)" />
                <PrepTip emoji="🏷️" bold="Labels toward the camera" rest=" — so it can tell similar products apart." />
                <PrepTip emoji="🍽️" bold="Packed or deep? Lay it on the counter" rest=" — spread flat in one layer." />
              </View>
              <Text style={styles.prepFootnote}>You'll review every photo and fix misses in one tap.</Text>
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
                  <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 10, paddingHorizontal: 12 }]}>
                    {showDone
                      ? 'Tap below to review and add anything we missed'
                      : LOADING_STAGES[loadingMessageIdx].title}
                  </Text>
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
        {step === 55 && (
          <View style={stepWithSafeTop}>
            <View style={styles.topBar}>
              {/* X always on the LEFT; title sits to its right. */}
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={[styles.topTitle, { marginLeft: 12 }]}>Detected Items</Text>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Photo */}
              {photos.length > 0 && photos[photos.length - 1]?.uri && (
                <View style={styles.zoneImageWrap}>
                  <Image
                    source={{ uri: photos[photos.length - 1].uri }}
                    style={styles.zoneImage}
                    resizeMode="cover"
                  />
                </View>
              )}

              <Text style={[styles.subtitle, { marginTop: 12, marginBottom: 16 }]}>
                {detectedItems.length} item{detectedItems.length !== 1 ? 's' : ''} spotted — tap X to remove, or add missed items below
              </Text>

              {/* Zone sections */}
              {zones.map(zoneGroup => {
                const liveItems = zoneGroup.items.filter(i => detectedItems.some(d => d.id === i.id))
                if (liveItems.length === 0) return null
                return (
                  <View key={zoneGroup.zone} style={styles.zoneSection}>
                    <Text style={styles.zoneLabel}>{zoneGroup.zone}</Text>
                    <View style={styles.zoneChipWrap}>
                      {liveItems.map(item => (
                        <View key={item.id} style={styles.zoneChip}>
                          <Text style={styles.zoneChipText}>{item.name}</Text>
                          <TouchableOpacity
                            onPress={() => setDetectedItems(prev => prev.filter(d => d.id !== item.id))}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <X size={13} stroke={COLORS.textMuted} strokeWidth={2} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                )
              })}

              {/* Missed-something input — type items we missed, comma-separated.
                  Helper auto-categorizes each via the LLM-backed categorizer. */}
              <View style={styles.missedSection}>
                <Text style={styles.zoneLabel}>Missed something?</Text>
                <TextInput
                  style={styles.missedInput}
                  placeholder="e.g. salt, pepper, soy sauce"
                  placeholderTextColor={COLORS.textMuted}
                  value={missedInput}
                  onChangeText={setMissedInput}
                  multiline
                  blurOnSubmit
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.missedAddBtn, (!missedInput.trim() || addingMissed) && { opacity: 0.5 }]}
                  onPress={addMissedItems}
                  disabled={!missedInput.trim() || addingMissed}
                  activeOpacity={0.7}
                >
                  {addingMissed
                    ? <ActivityIndicator color="#4ADE80" size="small" />
                    : <Text style={styles.missedAddBtnText}>Add to list</Text>}
                </TouchableOpacity>
              </View>

              <View style={{ height: 8 }} />
            </ScrollView>

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
        )}

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
  prepScroll: { paddingBottom: 24, flexGrow: 1, justifyContent: 'center' },
  prepTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 14, lineHeight: 31 },
  prepIntro: { fontSize: 15, color: '#AAAAAA', lineHeight: 22, marginBottom: 26 },
  prepTips: { gap: 18 },
  prepTipRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  prepTipEmoji: { fontSize: 22, lineHeight: 26, width: 28 },
  prepTipText: { flex: 1, fontSize: 15, color: '#CCCCCC', lineHeight: 21 },
  prepTipBold: { color: '#FFFFFF', fontWeight: '700' },
  prepFootnote: { fontSize: 13, color: '#888888', fontStyle: 'italic', marginTop: 26, lineHeight: 19 },
  prepActions: { paddingBottom: 8, paddingTop: 8 },

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
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  zoneChipText: {
    fontSize: 13,
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
