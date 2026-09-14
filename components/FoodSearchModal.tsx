import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  InputAccessoryView,
  KeyboardAvoidingView,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { X, Search, ScanBarcode, ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { COLORS } from '@/constants/colors'
import { todayStr } from '@/lib/localDate'
import { supabase } from '@/lib/supabase'
import { trackMealLogged } from '@/lib/analytics'
import { useAuth } from '@/context/AuthContext'
import {
  searchFoods,
  getFoodById,
  findFoodByBarcode,
  parseMacros,
  pickDefaultServing,
  FoodSearchResult,
  FoodDetail,
} from '@/lib/fatsecret'
import { getFoodKey, loadOverrideMap, peekOverrideMap, refreshOverrideMap, saveOverride, type MacroOverride } from '@/hooks/useMacroOverrides'
import { loadFood, peekFood, rememberFood, foodFromSearchResult } from '@/lib/foodCache'
import {
  pickerUnits, applyOverride, calorieSplit, convertAmount, dayImpact,
  fatsecretNutrients, findServing, formatAmount, legacyBasis, logFields, metricBasis, metricOf,
  parseAmount, portionMetric, portionText, sameUnit, servingTitle, unitFromKey, unitFromLog,
  unitKey, unitLabel, type Nutrients, type Override, type Unit,
} from '@/lib/foodPortion'
import { loadRecentFoods, pushRecentFood, type RecentFood } from '@/lib/recentFoods'
import MacroEditModal from '@/components/MacroEditModal'

type Tab = 'search' | 'scan'
type Step = 'browse' | 'detail'

type Props = {
  visible: boolean
  // The user's own meal structure (profiles.meal_slots), not Home's rendered sections.
  slots: string[]
  defaultSlot: string
  onClose: () => void
  onLogged: () => void
  logDate?: string
  // Feed "TODAY AFTER THIS". Without them the section is simply not drawn.
  goals?: { calories: number; protein: number }
  dayTotals?: { calories: number; protein: number }
  // Edit mode — pre-load a logged entry for editing
  editLogId?: string
  initialFoodId?: string
  initialServingId?: string
  initialQuantity?: number
  initialSlot?: string
  // The entry's current values, already inside dayTotals, so an edit replaces them instead of adding.
  editOriginal?: { calories: number; protein: number }
  // Edit mode: removes the entry. Home does the delete (optimistic, no confirmation, same as its row ✕).
  onDelete?: () => void
}

// Everything that belongs to ONE opened food, replaced as a unit. It used to be six separate state
// fields, and every path that opened a food reset a different subset of them — a Recent opened at the
// previous food's quantity, and a correction could be saved under the previous product's barcode.
type Detail = {
  food: FoodDetail
  unit: Unit
  amount: number   // the last valid amount: what the numbers show and what gets logged
  text: string     // what the amount box shows, possibly mid-typing
  override: Override | null
}

// ── Macro description parser ─────────────────────────────────────────────
// food_description format: "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"

function quickMacros(desc: string) {
  const cal = desc.match(/Calories:\s*([\d.]+)/)?.[1] ?? '?'
  const prot = desc.match(/Protein:\s*([\d.]+)/)?.[1] ?? '?'
  const per = desc.match(/^(Per [^-]+)/)?.[1] ?? ''
  return { cal, prot, per }
}

// A correction saved before corrections carried a basis gets one on first read: the food's default
// serving, which is the only serving the old screen ever opened on. Persisted so it is fixed for good.
// The write's error is logged, not swallowed — a refused upgrade would otherwise be invisible and the
// row would stay basis-less forever.
function withBasis(userId: string, row: MacroOverride, food: FoodDetail): Override {
  if (row.basis_amount || row.serving_id) return row
  const basis = legacyBasis(food.servings, pickDefaultServing(food.servings))
  if (!basis) return row
  const upgraded = { ...row, ...basis }
  saveOverride(userId, upgraded).then(({ error }) => { if (error) console.log('[food] correction basis upgrade refused:', error) })
  return upgraded
}

const EXTRAS: { key: 'fiber' | 'sugar' | 'saturated_fat' | 'sodium' | 'cholesterol' | 'potassium'; label: string; unit: string }[] = [
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'saturated_fat', label: 'Saturated fat', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
]

const RING = 76
const RING_STROKE = 7
const RING_R = (RING - RING_STROKE) / 2
const RING_C = 2 * Math.PI * RING_R

export default function FoodSearchModal({ visible, slots, defaultSlot, onClose, onLogged, logDate, goals, dayTotals, editLogId, initialFoodId, initialServingId, initialQuantity, initialSlot, editOriginal, onDelete }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('search')
  const [step, setStep] = useState<Step>('browse')

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [resultMacros, setResultMacros] = useState<Record<string, { cal: number; prot: number; serving: string }>>({})

  // Scan state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const scanningRef = useRef(false) // synchronous guard — state updates are async and allow duplicate fires

  // Detail state
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // A newer open (or a back) makes an older food's late response a no-op.
  const openSeq = useRef(0)
  const [selectedSlot, setSelectedSlot] = useState(defaultSlot)
  const [saving, setSaving] = useState(false)
  // A ref as well as state: two taps inside one render both saw `saving` false and inserted twice.
  const savingRef = useRef(false)
  const [unitSheet, setUnitSheet] = useState(false)
  const [macroEditVisible, setMacroEditVisible] = useState(false)

  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([])
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic search id — lets a newer search discard a slower older one's late response.
  const searchSeq = useRef(0)

  // Keyboard: decimal-pad has no return key, so the accessory bar carries a Done.
  const AMOUNT_ACCESSORY_ID = 'food-amount-done'
  const amountFocused = useRef(false)
  const detailScrollRef = useRef<ScrollView>(null)
  const scrollY = useRef(0)
  const viewportH = useRef(0)
  const amountBottom = useRef(0)

  // Sync slot when modal opens with a new defaultSlot
  useEffect(() => {
    if (visible) setSelectedSlot(initialSlot ?? defaultSlot)
  }, [visible])

  useEffect(() => {
    if (!visible || !user) return
    loadRecentFoods(user.id).then(setRecentFoods)
    // Corrections are read from memory/disk on open; this keeps that copy current across devices.
    refreshOverrideMap(user.id).catch(() => {})
  }, [visible, user?.id])

  // Bring the amount card above the keypad only if it is under it. keyboardDidShow, not onFocus:
  // the KeyboardAvoidingView has resized the scroll area by then, so the viewport height is real.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (!amountFocused.current) return
      requestAnimationFrame(() => {
        const target = amountBottom.current - viewportH.current + 16
        if (target > scrollY.current) detailScrollRef.current?.scrollTo({ y: target, animated: true })
      })
    })
    return () => sub.remove()
  }, [])

  // The scanner stays locked while its food is open. Every way back to the camera unlocks it — only
  // the failure path used to, so after one successful scan the camera never scanned again.
  const rearmScanner = () => { scanningRef.current = false; setScanned(false) }

  const openFood = async (
    foodId: string,
    load: () => Promise<FoodDetail>,
    start?: (food: FoodDetail) => { unit: Unit; amount: number } | null,
    // A search result already carries the food's servings, so the screen paints from it at once;
    // food.get then runs behind it to pick up any serving the search response left out.
    seed?: FoodDetail,
  ) => {
    const seq = ++openSeq.current
    Keyboard.dismiss()
    setUnitSheet(false)
    setMacroEditVisible(false)
    setStep('detail')
    const key = getFoodKey({ foodId })
    const build = (food: FoodDetail, row: MacroOverride | null): Detail => {
      const def = pickDefaultServing(food.servings)
      const initial = start?.(food) ?? (def ? { unit: { kind: 'serving', servingId: def.serving_id } as Unit, amount: 1 } : null)
      if (!initial || !fatsecretNutrients(initial.unit, initial.amount, food.servings)) throw new Error('no serving data')
      const override = row && user ? withBasis(user.id, row, food) : null
      return { food, unit: initial.unit, amount: initial.amount, text: formatAmount(initial.amount, initial.unit), override }
    }
    // Once a food and the user's corrections are both in memory, the screen is built in the same
    // tick as the step change — no await, no frame with nothing to draw, no spinner. That is every
    // open after the first, and every edit of an entry (a food already fetched to log it).
    const refreshSeed = () => {
      if (!seed) return
      getFoodById(foodId).then(full => {
        rememberFood(full)
        if (seq !== openSeq.current) return
        setDetail(d => (d && d.food.food_id === full.food_id && full.servings.length > d.food.servings.length ? { ...d, food: full } : d))
      }).catch(() => {})
    }
    const memFood = seed ?? peekFood(foodId)
    const memOverrides = user ? peekOverrideMap(user.id) : new Map<string, MacroOverride>()
    if (memFood && memOverrides) {
      try {
        setDetail(build(memFood, memOverrides.get(key) ?? null))
        setDetailLoading(false)
        refreshSeed()
        return
      } catch {}
    }
    setDetail(null)
    setDetailLoading(true)
    try {
      // The correction map is read alongside the food, not after it, and both land before the
      // first paint, so the numbers never show FatSecret's and then jump to the user's own.
      const [food, map] = await Promise.all([
        memFood ? Promise.resolve(memFood) : load(),
        user ? loadOverrideMap(user.id) : Promise.resolve(new Map<string, MacroOverride>()),
      ])
      if (seq !== openSeq.current) return
      setDetail(build(food, map.get(key) ?? null))
      refreshSeed()
    } catch {
      if (seq !== openSeq.current) return
      Alert.alert('Error', 'Could not load food details.')
      if (editLogId) handleClose()
      else { setStep('browse'); rearmScanner() }
    } finally {
      if (seq === openSeq.current) setDetailLoading(false)
    }
  }

  // Pre-load the entry when opening in edit mode, at the unit and amount it was logged with.
  useEffect(() => {
    if (!visible || !editLogId || !initialFoodId) return
    if (initialSlot) setSelectedSlot(initialSlot)
    openFood(
      initialFoodId,
      () => loadFood(initialFoodId),
      food => unitFromLog(initialServingId, initialQuantity, food.servings, pickDefaultServing(food.servings)),
    )
  }, [visible, editLogId])

  const openRecent = (r: RecentFood) => openFood(
    r.food_id,
    () => loadFood(r.food_id),
    food => {
      const unit = unitFromKey(r.unit_key, food.servings)
      return unit && r.amount ? { unit, amount: r.amount } : null
    },
  )

  const reset = () => {
    openSeq.current++
    scanningRef.current = false
    savingRef.current = false
    setTab('search')
    setStep('browse')
    setQuery('')
    setResults([])
    setSearching(false)
    setScanned(false)
    setScanLoading(false)
    setDetail(null)
    setDetailLoading(false)
    setSelectedSlot(defaultSlot)
    setSaving(false)
    setUnitSheet(false)
    setMacroEditVisible(false)
  }

  const handleClose = () => { reset(); onClose() }

  // Keyboard up → these close the keyboard first. They are the nearest controls to the keypad, and
  // people tap them just to get rid of it.
  const closeOrDismiss = () => { if (Keyboard.isVisible()) { Keyboard.dismiss(); return } handleClose() }
  const goBack = () => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return }
    openSeq.current++
    setDetail(null)
    setDetailLoading(false)
    setUnitSheet(false)
    setStep('browse')
    rearmScanner()
  }

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setResultMacros({}); setSearching(false); return }
    const seq = ++searchSeq.current
    setSearching(true)
    setResultMacros({})
    try {
      const res = await searchFoods(q.trim())
      if (seq !== searchSeq.current) return // a newer search started — drop this stale response
      setResults(res)
      // Rows show the SAME serving the detail screen will open on — same picker, same servings
      // array (v3 search returns them inline, so this is still one API call, not an N+1).
      // quickMacros stays as the fallback for any food v3 returns without servings.
      const macros: Record<string, { cal: number; prot: number; serving: string }> = {}
      for (const food of res) {
        const def = pickDefaultServing(food.servings)
        if (def) {
          const m = parseMacros(def) // exact values — round here because this is display-only
          macros[food.food_id] = { cal: Math.round(m.calories), prot: Math.round(m.protein), serving: def.serving_description }
        } else {
          const q = quickMacros(food.food_description)
          macros[food.food_id] = { cal: Math.round(parseFloat(q.cal)) || 0, prot: Math.round(parseFloat(q.prot)) || 0, serving: q.per }
        }
      }
      setResultMacros(macros)
    } catch {
      if (seq === searchSeq.current) Alert.alert('Search failed', 'Could not reach FatSecret. Check your connection.')
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }, [])

  const onQueryChange = (text: string) => {
    setQuery(text)
    // Searching from the first keystroke, not from when the debounce fires — otherwise the empty
    // state read "No results for 'chedd'" for half a second while the search had not even started.
    setSearching(!!text.trim())
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    // debounce to avoid firing a search on every keystroke
    searchTimeout.current = setTimeout(() => doSearch(text), 500)
  }

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (scanningRef.current) return
    scanningRef.current = true
    setScanned(true) // freezes the CameraView's onBarcodeScanned by passing undefined below
    setScanLoading(true)
    try {
      const food = await findFoodByBarcode(data)
      if (!food) {
        Alert.alert('Not found', 'Couldn\'t find nutrition data for this product. Try searching by name instead.', [
          { text: 'Try Again', onPress: () => { rearmScanner(); setScanLoading(false) } },
          { text: 'Search by Name', onPress: () => { rearmScanner(); setScanLoading(false); setTab('search') } },
        ])
        return
      }
      // Corrections are keyed by the FatSecret food, never the barcode: the same product reached by
      // search or Recents is the same food, and used to be a different correction.
      rememberFood(food)
      openFood(food.food_id, async () => food)
    } catch {
      Alert.alert('Scan failed', 'Could not look up this barcode.')
      rearmScanner()
    } finally {
      setScanLoading(false)
    }
  }

  // ── Derived numbers for the open food ──────────────────────────────────
  const computed = useMemo(() => {
    if (!detail) return null
    const { food, unit, amount, override } = detail
    const fs = fatsecretNutrients(unit, amount, food.servings)
    if (!fs) return null
    const { nutrients, overridden } = applyOverride(fs, override, unit, amount, food.servings)
    const shown: Nutrients = {
      calories: Math.round(nutrients.calories),
      protein: Math.round(nutrients.protein),
      carbs: Math.round(nutrients.carbs),
      fat: Math.round(nutrients.fat),
    }
    return { fs, shown, overridden, split: calorieSplit(nutrients) }
  }, [detail])

  const onAmountText = (t: string) => setDetail(d => d && { ...d, text: t, amount: parseAmount(t) ?? d.amount })
  // Commit on blur: the box shows exactly the amount that will be logged.
  const commitAmount = () => {
    amountFocused.current = false
    setDetail(d => {
      if (!d) return d
      const amount = Number(formatAmount(d.amount, d.unit)) || d.amount
      return { ...d, amount, text: formatAmount(amount, d.unit) }
    })
  }

  // Switching unit keeps the portion: 1 cup shredded becomes 113 g, not 1 g.
  const chooseUnit = (next: Unit) => {
    setUnitSheet(false)
    setDetail(d => {
      if (!d || sameUnit(d.unit, next)) return d
      const converted = Number(formatAmount(convertAmount(d.unit, d.amount, next, d.food.servings), next))
      const amount = converted > 0 ? converted : 1
      return { ...d, unit: next, amount, text: formatAmount(amount, next) }
    })
  }

  const reloadOverride = async () => {
    if (!user || !detail) return
    // saveOverride / deleteOverride already updated the map, so this is a memory read.
    const { food } = detail
    const map = await loadOverrideMap(user.id)
    const row = map.get(getFoodKey({ foodId: food.food_id })) ?? null
    const override = row ? withBasis(user.id, row, food) : null
    setDetail(d => (d && d.food.food_id === food.food_id ? { ...d, override } : d))
  }

  const saveLog = async () => {
    if (!detail || !computed || !user || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const { food, unit, amount } = detail
    const macros = computed.shown
    const { serving_id, quantity } = logFields(unit, amount)
    try {
      const { error } = editLogId
        // `slot` is written on edit too — the chips were tappable and the change was silently dropped.
        ? await supabase.from('meal_logs').update({ ...macros, serving_id, quantity, slot: selectedSlot }).eq('id', editLogId)
        : await supabase.from('meal_logs').insert({
            user_id: user.id,
            meal_name: food.food_name,
            ...macros,
            slot: selectedSlot,
            logged_at: logDate || todayStr(), // LOCAL day — see lib/localDate.ts
            food_id: food.food_id,
            serving_id,
            quantity,
          })
      if (error) { Alert.alert('Error', error.message); return }
      if (!editLogId) {
        trackMealLogged(selectedSlot, macros.calories, macros.protein)
        pushRecentFood(user.id, {
          food_id: food.food_id,
          food_name: food.food_name,
          brand_name: food.brand_name,
          unit_key: unitKey(unit),
          amount,
          portion: portionText(unit, amount, food.servings),
          cal: macros.calories,
          prot: macros.protein,
        }).then(setRecentFoods).catch(() => {})
      }
      onLogged()
      handleClose()
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to log meal')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Chips are the user's own slots. The slot they came from is added only if it is not one of them —
  // an old entry's one-off section, or the entry being edited — so it can still be kept.
  const chipSlots = slots.includes(selectedSlot) ? slots : [...slots, selectedSlot]
  const dayLabel = logDate && logDate !== todayStr()
    ? new Date(logDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : null
  const ctaText = editLogId ? 'Save changes' : `Log to ${selectedSlot}${dayLabel ? ` · ${dayLabel}` : ''}`

  const renderRing = (split: { protein: number; carbs: number; fat: number } | null, kcal: number) => {
    const parts = split
      ? [
          { pct: split.protein, color: COLORS.macroProtein },
          { pct: split.carbs, color: COLORS.macroCarbs },
          { pct: split.fat, color: COLORS.macroFat },
        ].filter(p => p.pct > 0)
      : []
    const gap = parts.length > 1 ? 3 : 0
    const usable = RING_C - gap * parts.length
    let cursor = 0
    return (
      <View style={{ width: RING, height: RING }}>
        <Svg width={RING} height={RING} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke="#262626" strokeWidth={RING_STROKE} fill="none" />
          {parts.map((p, i) => {
            const len = (usable * p.pct) / 100
            const offset = cursor
            cursor += len + gap
            return (
              <Circle key={i} cx={RING / 2} cy={RING / 2} r={RING_R} stroke={p.color} strokeWidth={RING_STROKE} fill="none"
                strokeDasharray={`${len} ${RING_C - len}`} strokeDashoffset={-offset} />
            )
          })}
        </Svg>
        <View style={styles.ringCenter}>
          <Text style={styles.ringKcal}>{kcal.toLocaleString()}</Text>
          <Text style={styles.ringUnit}>kcal</Text>
        </View>
      </View>
    )
  }

  const renderImpact = (label: string, goal: number, consumed: number, adding: number, replacing: number, color: string, fade: string, unit: string) => {
    const d = dayImpact(goal, consumed, adding, replacing)
    const left = Math.round(d.left)
    return (
      <View style={{ marginTop: 8 }}>
        <View style={styles.impactRow}>
          <Text style={styles.impactLabel}>{label}</Text>
          <Text style={[styles.impactLeft, left < 0 && label === 'Calories' && { color: '#EF4444' }]}>
            {left >= 0 ? `${left.toLocaleString()}${unit} left` : `${(-left).toLocaleString()}${unit} over`}
          </Text>
        </View>
        <View style={styles.impactTrack}>
          <View style={{ width: `${d.basePct}%`, backgroundColor: color }} />
          <View style={{ width: `${d.addPct}%`, backgroundColor: fade }} />
        </View>
      </View>
    )
  }

  const units = detail ? pickerUnits(detail.food.servings, detail.unit) : []
  const basis = detail ? metricBasis(detail.food.servings) : null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

        {/* ── Detail view ── */}
        {step === 'detail' && (
          <KeyboardAvoidingView behavior="padding" style={styles.step}>
            {/* No manual top inset here: SafeAreaView already applies it. Adding insets.top on top of
                it put ~50pt of dead black above the title, measured against MyFitnessPal's screen. */}
            <View style={styles.detailTop}>
              {/* Edit mode has no way back to search. Back-then-another-food used to overwrite the
                  entry with that food's numbers while keeping the old name. */}
              {editLogId ? <View style={{ width: 34 }} /> : (
                <TouchableOpacity style={styles.iconBtn} onPress={goBack} activeOpacity={0.7} hitSlop={8}>
                  <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.iconBtn} onPress={closeOrDismiss} activeOpacity={0.7} hitSlop={8}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {detailLoading || !detail || !computed ? (
              <View style={styles.centered}>
                <ActivityIndicator color="#4ADE80" size="large" />
                <Text style={styles.loadingText}>Loading nutrition data...</Text>
              </View>
            ) : (
              <>
                <ScrollView
                  ref={detailScrollRef}
                  showsVerticalScrollIndicator={false}
                  style={{ flex: 1 }}
                  // 'handled' so a tap on the amount box is delivered, not spent dismissing a keyboard.
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  scrollEventThrottle={16}
                  onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }}
                  onLayout={e => { viewportH.current = e.nativeEvent.layout.height }}
                >
                  {editLogId && <Text style={styles.eyebrow}>EDIT ENTRY</Text>}
                  <Text style={styles.foodName}>{detail.food.food_name}</Text>
                  {detail.food.brand_name ? <Text style={styles.brand}>{detail.food.brand_name}</Text> : null}

                  {/* ── Result: ring + each macro's share of calories over its grams ── */}
                  <View style={[styles.card, { marginTop: 14 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {renderRing(computed.split, computed.shown.calories)}
                      <View style={styles.macroCols}>
                        {/* Protein first, and % of CALORIES above grams: the % is how Logan reads a
                            food's protein per calorie, and it does not change with the amount. */}
                        {([
                          ['Protein', computed.split?.protein, computed.shown.protein, COLORS.macroProtein],
                          ['Carbs', computed.split?.carbs, computed.shown.carbs, COLORS.macroCarbs],
                          ['Fat', computed.split?.fat, computed.shown.fat, COLORS.macroFat],
                        ] as const).map(([label, pct, grams, color]) => (
                          <View key={label} style={styles.macroCol}>
                            <Text style={[styles.macroPct, { color }]}>{pct === undefined ? '—' : `${pct}%`}</Text>
                            <Text style={styles.macroGrams}>{grams}g</Text>
                            <Text style={styles.macroLabel}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {goals && dayTotals && goals.calories > 0 && (
                      <View style={styles.impact}>
                        <Text style={styles.label}>{dayLabel ? `${dayLabel.toUpperCase()} AFTER THIS` : 'TODAY AFTER THIS'}</Text>
                        {renderImpact('Calories', goals.calories, dayTotals.calories, computed.shown.calories, editOriginal?.calories ?? 0, '#FFFFFF', 'rgba(255,255,255,0.35)', '')}
                        {goals.protein > 0 && renderImpact('Protein', goals.protein, dayTotals.protein, computed.shown.protein, editOriginal?.protein ?? 0, COLORS.macroProtein, 'rgba(74,222,128,0.4)', 'g')}
                      </View>
                    )}
                  </View>

                  {/* ── Amount + meal ── */}
                  <View style={styles.card} onLayout={e => { amountBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height }}>
                    <Text style={styles.label}>AMOUNT</Text>
                    <View style={styles.amountRow}>
                      <View style={styles.amountBox}>
                        <TextInput
                          style={styles.amountInput}
                          value={detail.text}
                          onChangeText={onAmountText}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          inputAccessoryViewID={AMOUNT_ACCESSORY_ID}
                          onFocus={() => { amountFocused.current = true }}
                          onBlur={commitAmount}
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.unitPill}
                        onPress={() => { Keyboard.dismiss(); setUnitSheet(true) }}
                        disabled={units.length <= 1}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.unitText} numberOfLines={1}>{unitLabel(detail.unit, detail.food.servings)}</Text>
                        {units.length > 1 && <ChevronDown size={16} stroke={COLORS.textMuted} strokeWidth={2} />}
                      </TouchableOpacity>
                    </View>
                    {(() => {
                      if (detail.unit.kind === 'g' || detail.unit.kind === 'ml') return null
                      const m = portionMetric(detail.unit, detail.amount, detail.food.servings)
                      return m ? <Text style={styles.metricHint}>{Math.round(m.amount)} {m.unit}</Text> : null
                    })()}

                    <Text style={[styles.label, { marginTop: 16 }]}>MEAL</Text>
                    <View style={styles.chips}>
                      {chipSlots.map(s => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.chip, selectedSlot === s && styles.chipActive]}
                          onPress={() => setSelectedSlot(s)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.chipText, selectedSlot === s && styles.chipTextActive]}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* ── Correction link ── */}
                  <View style={styles.linkRow}>
                    <View />
                    <TouchableOpacity onPress={() => setMacroEditVisible(true)} activeOpacity={0.7} hitSlop={8}>
                      <Text style={[styles.linkText, computed.overridden && { color: '#4ADE80' }]}>
                        {computed.overridden ? 'Your numbers · Edit' : 'Edit nutrition'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {/* Inline, no toggle: the screen had ~500pt of nothing under the meal chips, and a
                      toggle over dead space was a tap for nothing. Only what FatSecret actually has —
                      a value it lacks used to render as "0g". */}
                  {(() => {
                    const extras = EXTRAS.filter(x => computed.fs[x.key] !== undefined)
                    if (extras.length === 0) return null
                    return (
                      <View style={styles.card}>
                        <Text style={[styles.label, { marginBottom: 2 }]}>NUTRITION DETAILS</Text>
                        {extras.map((x, i) => (
                          <View key={x.key} style={[styles.extraRow, i > 0 && styles.extraDivider]}>
                            <Text style={styles.extraLabel}>{x.label}</Text>
                            <Text style={styles.extraValue}>{Math.round(computed.fs[x.key] ?? 0)} {x.unit}</Text>
                          </View>
                        ))}
                      </View>
                    )
                  })()}
                  {/* Edit mode only. Home's row ✕ does the same thing; someone already in here should
                      not have to back out to find it. No confirmation — Home has none either. */}
                  {editLogId && onDelete && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => { onDelete(); handleClose() }} activeOpacity={0.7} hitSlop={8}>
                      <Text style={styles.deleteText}>Delete entry</Text>
                    </TouchableOpacity>
                  )}

                  {/* Attribution — required by FatSecret free tier */}
                  <View style={styles.attribution}>
                    <Image
                      source={{ uri: 'https://platform.fatsecret.com/api/static/images/powered_by_fatsecret.png' }}
                      style={styles.attributionLogo}
                      resizeMode="contain"
                    />
                  </View>
                </ScrollView>

                {/* Pinned, so the one action is always on screen — and above the keypad, since the
                    KeyboardAvoidingView lifts it with the keyboard. */}
                <View style={styles.ctaBar}>
                  <TouchableOpacity
                    style={[styles.cta, saving && { opacity: 0.5 }]}
                    onPress={saveLog}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color="#000000" />
                      : <Text style={styles.ctaText} numberOfLines={1}>{ctaText}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ── Unit sheet ── */}
            {unitSheet && detail && (
              <View style={StyleSheet.absoluteFill}>
                <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setUnitSheet(false)} />
                <View style={styles.sheet}>
                  <View style={styles.sheetGrip} />
                  <Text style={styles.sheetTitle}>Unit</Text>
                  <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                    {(() => {
                      const servings = detail.food.servings
                      // What ONE of a unit gives, correction included — the same numbers it would log.
                      const kcalFor = (u: Unit, amount: number) => {
                        const fs = fatsecretNutrients(u, amount, servings)
                        return fs ? Math.round(applyOverride(fs, detail.override, u, amount, servings).nutrients.calories) : null
                      }
                      const row = (u: Unit, title: string, sub: string | null) => (
                        <TouchableOpacity key={unitKey(u)} style={styles.sheetRow} onPress={() => chooseUnit(u)} activeOpacity={0.7}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sheetRowTitle}>{title}</Text>
                            {sub ? <Text style={styles.sheetRowSub}>{sub}</Text> : null}
                          </View>
                          {sameUnit(u, detail.unit) && <Check size={18} stroke="#4ADE80" strokeWidth={2.5} />}
                        </TouchableOpacity>
                      )
                      const servingUnits = units.filter(u => u.kind === 'serving')
                      const metricUnits = units.filter(u => u.kind !== 'serving')
                      return (
                        <>
                          <Text style={styles.sheetSection}>SERVINGS</Text>
                          {servingUnits.map(u => {
                            const s = findServing(u, servings)!
                            const m = metricOf(s)
                            const kcal = kcalFor(u, 1)
                            const sub = [m ? `${Math.round(m.amount)} ${m.unit}` : null, kcal !== null ? `${kcal} kcal` : null].filter(Boolean).join(' · ')
                            return row(u, servingTitle(s), sub || null)
                          })}
                          {metricUnits.length > 0 && (
                            <Text style={styles.sheetSection}>{basis?.unit === 'ml' ? 'BY VOLUME' : 'BY WEIGHT'}</Text>
                          )}
                          {metricUnits.map(u => {
                            if (u.kind === 'g') return row(u, 'grams', `${kcalFor(u, 100) ?? '—'} kcal per 100 g`)
                            if (u.kind === 'oz') return row(u, 'ounces', `${kcalFor(u, 1) ?? '—'} kcal per oz`)
                            return row(u, 'milliliters', `${kcalFor(u, 100) ?? '—'} kcal per 100 ml`)
                          })}
                        </>
                      )
                    })()}
                  </ScrollView>
                </View>
              </View>
            )}
          </KeyboardAvoidingView>
        )}

        {/* ── Browse view ── */}
        {step === 'browse' && (
          <View style={styles.step}>
            <View style={[styles.topBar, { paddingTop: 8 }]}>
              <Text style={styles.topTitle}>Search Food</Text>
              <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {/* Tab toggle */}
            <View style={styles.tabToggle}>
              <TouchableOpacity
                style={[styles.tabOption, tab === 'search' && styles.tabOptionActive]}
                onPress={() => setTab('search')}
                activeOpacity={0.8}
              >
                <Search size={15} stroke={tab === 'search' ? '#000' : COLORS.textMuted} strokeWidth={2} />
                <Text style={[styles.tabOptionText, tab === 'search' && styles.tabOptionTextActive]}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabOption, tab === 'scan' && styles.tabOptionActive]}
                onPress={async () => {
                  if (!cameraPermission?.granted && cameraPermission?.canAskAgain !== false) await requestCameraPermission()
                  setTab('scan')
                  rearmScanner()
                }}
                activeOpacity={0.8}
              >
                <ScanBarcode size={15} stroke={tab === 'scan' ? '#000' : COLORS.textMuted} strokeWidth={2} />
                <Text style={[styles.tabOptionText, tab === 'scan' && styles.tabOptionTextActive]}>Scan Barcode</Text>
              </TouchableOpacity>
            </View>

            {/* Search tab */}
            {tab === 'search' && (
              <>
                <View style={styles.searchBar}>
                  <Search size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search any food..."
                    placeholderTextColor={COLORS.textMuted}
                    value={query}
                    onChangeText={onQueryChange}
                    autoFocus
                    returnKeyType="search"
                    onSubmitEditing={() => doSearch(query)}
                  />
                  {searching && <ActivityIndicator color={COLORS.textMuted} size="small" />}
                </View>

                <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {results.length === 0 && !searching && query.length > 0 && (
                    <Text style={styles.emptyText}>No results for "{query}"</Text>
                  )}
                  {results.length === 0 && !query && recentFoods.length > 0 && (
                    <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
                      <Text style={styles.sectionLabel}>Recently Logged</Text>
                      {recentFoods.map((food, i) => (
                        <TouchableOpacity
                          key={`recent-${food.food_id}-${i}`}
                          style={[styles.recentRow, i > 0 && styles.recentDivider]}
                          activeOpacity={0.7}
                          onPress={() => openRecent(food)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultName}>{food.food_name}</Text>
                            {/* Numbers for the portion it was logged at — which is also what it opens at. */}
                            <Text style={styles.resultBrand}>
                              {[`${food.cal} cal`, `${food.prot}g protein`, food.portion, food.brand_name].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          <ChevronRight size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {results.length === 0 && !query && recentFoods.length === 0 && (
                    <Text style={styles.hintText}>Type to search millions of foods and brands</Text>
                  )}
                  {/* Matching recents shown first */}
                  {results.length > 0 && (() => {
                    const q = query.toLowerCase()
                    const matchingRecents = recentFoods.filter(r =>
                      r.food_name.toLowerCase().includes(q) &&
                      !results.some(res => res.food_id === r.food_id)
                    )
                    if (matchingRecents.length === 0) return null
                    return (
                      <>
                        <Text style={[styles.sectionLabel, { paddingHorizontal: 20, marginTop: 4 }]}>Previously Logged</Text>
                        {matchingRecents.map((food, i) => (
                          <TouchableOpacity
                            key={`recent-match-${food.food_id}-${i}`}
                            style={styles.resultRow}
                            onPress={() => openRecent(food)}
                            activeOpacity={0.75}
                          >
                            <View style={styles.resultInfo}>
                              <Text style={styles.resultName} numberOfLines={1}>{food.food_name}</Text>
                              <Text style={styles.resultBrand}>{[`${food.cal} cal`, `${food.prot}g protein`, food.portion].filter(Boolean).join(' · ')}</Text>
                            </View>
                            <ChevronRight size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
                          </TouchableOpacity>
                        ))}
                        <Text style={[styles.sectionLabel, { paddingHorizontal: 20, marginTop: 16 }]}>Results</Text>
                      </>
                    )
                  })()}
                  {results.map((food, i) => {
                    const rm = resultMacros[food.food_id]
                    const subtitle = rm
                      ? [`${rm.cal} cal`, `${rm.prot}g protein`, rm.serving, food.brand_name || null].filter(Boolean).join(', ')
                      : food.brand_name || ''
                    return (
                      <TouchableOpacity
                        key={`${food.food_id}-${i}`}
                        style={styles.resultRow}
                        onPress={() => openFood(food.food_id, () => loadFood(food.food_id), undefined, foodFromSearchResult(food) ?? undefined)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{food.food_name}</Text>
                          {subtitle ? <Text style={styles.resultBrand}>{subtitle}</Text> : null}
                        </View>
                        <ChevronRight size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
                      </TouchableOpacity>
                    )
                  })}
                  {results.length > 0 && (
                    <View style={styles.attributionSmall}>
                      <Image
                        source={{ uri: 'https://platform.fatsecret.com/api/static/images/powered_by_fatsecret.png' }}
                        style={styles.attributionLogoSmall}
                        resizeMode="contain"
                      />
                    </View>
                  )}
                  <View style={{ height: 40 }} />
                </ScrollView>
              </>
            )}

            {/* Scan tab */}
            {tab === 'scan' && (
              <View style={styles.scanArea}>
                {!cameraPermission?.granted ? (
                  <View style={styles.centered}>
                    <Text style={styles.permissionText}>Camera permission required to scan barcodes</Text>
                    {/* Denied once, iOS will not show its prompt again — requesting silently did
                        nothing and the button was dead forever. Settings is the only way back. */}
                    {cameraPermission?.canAskAgain === false ? (
                      <TouchableOpacity style={styles.permissionBtn} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
                        <Text style={styles.permissionBtnText}>Open Settings</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.permissionBtn} onPress={requestCameraPermission} activeOpacity={0.85}>
                        <Text style={styles.permissionBtnText}>Allow Camera</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : scanLoading ? (
                  <View style={styles.centered}>
                    <ActivityIndicator color="#4ADE80" size="large" />
                    <Text style={styles.loadingText}>Looking up barcode...</Text>
                  </View>
                ) : (
                  <>
                    <CameraView
                      style={StyleSheet.absoluteFillObject}
                      facing="back"
                      onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
                      // Limit to retail product barcodes — QR/PDF417 would trigger false positives
                      // from any junk in the viewfinder. EAN/UPC are the formats FatSecret indexes.
                      barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                    />
                    {/* Viewfinder overlay */}
                    <View style={styles.scanOverlay}>
                      <View style={styles.scanFrame}>
                        <View style={[styles.scanCorner, styles.scanCornerTL]} />
                        <View style={[styles.scanCorner, styles.scanCornerTR]} />
                        <View style={[styles.scanCorner, styles.scanCornerBL]} />
                        <View style={[styles.scanCorner, styles.scanCornerBR]} />
                      </View>
                      <Text style={styles.scanHint}>Point at a barcode</Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        )}

      </SafeAreaView>
      </GestureHandlerRootView>

      <InputAccessoryView nativeID={AMOUNT_ACCESSORY_ID}>
        <View style={styles.accessoryBar}>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={10} activeOpacity={0.7}>
            <Text style={styles.accessoryDone}>Done</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>

      {/* Correction editor — entered against the portion the LABEL uses, chosen in the sheet */}
      {macroEditVisible && detail && user && (
        <MacroEditModal
          visible
          onClose={() => setMacroEditVisible(false)}
          foodKey={getFoodKey({ foodId: detail.food.food_id })}
          foodName={detail.food.food_name}
          userId={user.id}
          servings={detail.food.servings}
          override={detail.override}
          onSaved={reloadOverride}
        />
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  step: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 4,
    gap: 10,
  },
  topTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tab toggle
  tabToggle: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 4,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  tabOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 11,
  },
  tabOptionActive: { backgroundColor: '#FFFFFF' },
  tabOptionText: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },
  tabOptionTextActive: { color: '#000000' },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textWhite,
    padding: 0,
  },

  // Results
  sectionLabel: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  recentDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 12,
  },
  resultInfo: { flex: 1, gap: 3 },
  resultName: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  resultBrand: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  emptyText: { textAlign: 'center', color: COLORS.textMuted, marginTop: 40, fontSize: 14 },
  hintText: { textAlign: 'center', color: COLORS.textMuted, marginTop: 40, fontSize: 14, paddingHorizontal: 32 },

  // Scan
  scanArea: { flex: 1, position: 'relative', overflow: 'hidden', borderRadius: 0 },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  scanFrame: {
    width: 240,
    height: 140,
    position: 'relative',
  },
  scanCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#4ADE80',
    borderWidth: 3,
  },
  scanCornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  scanCornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  scanCornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  scanCornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanHint: { color: '#FFFFFF', fontSize: 14, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  permissionText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 32 },
  permissionBtn: { backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 14, paddingHorizontal: 28 },
  permissionBtnText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  loadingText: { fontSize: 14, color: COLORS.textMuted },

  // Detail
  detailTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2, paddingHorizontal: 20, marginTop: 4 },
  foodName: { fontSize: 24, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5, paddingHorizontal: 20, marginTop: 2 },
  brand: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 20, marginTop: 3 },
  card: { backgroundColor: '#141414', borderRadius: 16, marginHorizontal: 16, marginBottom: 10, padding: 14 },
  label: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },

  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringKcal: { fontSize: 19, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  ringUnit: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginTop: -2 },
  macroCols: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  macroCol: { alignItems: 'center', minWidth: 60 },
  macroPct: { fontSize: 13, fontWeight: '700' },
  macroGrams: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3, marginTop: 2 },
  macroLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginTop: 1 },

  impact: { borderTopWidth: 1, borderTopColor: '#262626', marginTop: 14, paddingTop: 12 },
  impactRow: { flexDirection: 'row', justifyContent: 'space-between' },
  impactLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textWhite },
  impactLeft: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  impactTrack: { height: 6, borderRadius: 3, backgroundColor: '#262626', flexDirection: 'row', overflow: 'hidden', marginTop: 6 },

  amountRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  // The input fills its box, so every point of the visible box focuses it.
  amountBox: { width: 76, backgroundColor: COLORS.cardElevated, borderRadius: 12, overflow: 'hidden' },
  amountInput: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite, textAlign: 'center', paddingVertical: 12, paddingHorizontal: 6, width: '100%' },
  unitPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.cardElevated, borderRadius: 12, paddingHorizontal: 14, gap: 8 },
  unitText: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  metricHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 6 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { backgroundColor: COLORS.cardElevated, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 9 },
  chipActive: { backgroundColor: '#4ADE80' },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  chipTextActive: { color: '#000000' },

  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 8 },
  deleteBtn: { alignSelf: 'center', paddingVertical: 10, marginTop: 6 },
  deleteText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  linkText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  extraRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 },
  extraDivider: { borderTopWidth: 1, borderTopColor: '#222222' },
  extraLabel: { fontSize: 14, color: COLORS.textWhite },
  extraValue: { fontSize: 14, color: COLORS.textMuted },

  ctaBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#000000', borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  cta: { backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#000000' },

  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#141414', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  sheetGrip: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#333333', alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite, marginBottom: 4 },
  sheetSection: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2, marginTop: 14, marginBottom: 2 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#222222', gap: 12 },
  sheetRowTitle: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  sheetRowSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  accessoryDone: { fontSize: 16, fontWeight: '700', color: '#4ADE80' },

  // Attribution (subtle)
  attribution: { alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 16, opacity: 0.4 },
  attributionLogo: { width: 120, height: 16 },
  attributionSmall: { alignItems: 'center', paddingVertical: 16 },
  attributionLogoSmall: { width: 90, height: 18, opacity: 0.4 },
})
