import { useState, useRef, useCallback, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { X, Search, ScanBarcode, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { trackMealLogged } from '@/lib/analytics'
import {
  searchFoods,
  getFoodById,
  findFoodByBarcode,
  parseMacros,
  FoodSearchResult,
  FoodDetail,
  FoodServing,
} from '@/lib/fatsecret'
import { getFoodKey, getOverride, MacroOverride } from '@/hooks/useMacroOverrides'
import MacroEditModal from '@/components/MacroEditModal'

type Tab = 'search' | 'scan'
type Step = 'browse' | 'detail'

type Props = {
  visible: boolean
  slots: string[]
  defaultSlot: string
  onClose: () => void
  onLogged: () => void
  logDate?: string
  // Edit mode — pre-load a logged entry for editing
  editLogId?: string
  initialFoodId?: string
  initialServingId?: string
  initialQuantity?: number
  initialSlot?: string
}

// ── Macro description parser ─────────────────────────────────────────────
// food_description format: "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"

function quickMacros(desc: string) {
  const cal = desc.match(/Calories:\s*([\d.]+)/)?.[1] ?? '?'
  const prot = desc.match(/Protein:\s*([\d.]+)/)?.[1] ?? '?'
  const carb = desc.match(/Carbs:\s*([\d.]+)/)?.[1] ?? '?'
  const fat = desc.match(/Fat:\s*([\d.]+)/)?.[1] ?? '?'
  const per = desc.match(/^(Per [^-]+)/)?.[1] ?? ''
  return { cal, prot, carb, fat, per }
}

export default function FoodSearchModal({ visible, slots, defaultSlot, onClose, onLogged, logDate, editLogId, initialFoodId, initialServingId, initialQuantity, initialSlot }: Props) {
  const insets = useSafeAreaInsets()
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
  // ref (not state) so the guard is synchronous and doesn't cause a re-render
  const scanningRef = useRef(false) // synchronous guard — state updates are async and allow duplicate fires

  // Detail state
  const [selectedFood, setSelectedFood] = useState<FoodDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedServing, setSelectedServing] = useState<FoodServing | null>(null)
  const [selectedSlot, setSelectedSlot] = useState(defaultSlot)
  const [saving, setSaving] = useState(false)

  // Sync slot when modal opens with a new defaultSlot
  useEffect(() => {
    if (visible) setSelectedSlot(initialSlot ?? defaultSlot)
  }, [visible])

  // Portion quantity
  const [quantity, setQuantity] = useState('1')

  // Override state
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [activeOverride, setActiveOverride] = useState<MacroOverride | null>(null)
  const [macroEditVisible, setMacroEditVisible] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Recent foods
  type RecentFood = { food_id: string; food_name: string; brand_name?: string; cal: number; prot: number; serving: string }
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([])
  const RECENT_FOODS_KEY = 'pantry_recent_foods'

  useEffect(() => {
    if (visible) {
      AsyncStorage.getItem(RECENT_FOODS_KEY).then(data => {
        if (data) setRecentFoods(JSON.parse(data))
      })
    }
  }, [visible])

  const addToRecents = async (food: { food_id: string; food_name: string; brand_name?: string }, cal: number, prot: number, serving: string) => {
    const entry: RecentFood = { food_id: food.food_id, food_name: food.food_name, brand_name: food.brand_name, cal, prot, serving }
    const existing = await AsyncStorage.getItem(RECENT_FOODS_KEY)
    let recents: RecentFood[] = existing ? JSON.parse(existing) : []
    // Remove duplicate if exists
    recents = recents.filter(r => r.food_id !== food.food_id)
    // Add to front, cap at 15
    recents = [entry, ...recents].slice(0, 15)
    await AsyncStorage.setItem(RECENT_FOODS_KEY, JSON.stringify(recents))
    setRecentFoods(recents)
  }

  // Pre-load food when opening in edit mode
  useEffect(() => {
    if (!visible || !editLogId || !initialFoodId) return
    setDetailLoading(true)
    setStep('detail')
    if (initialSlot) setSelectedSlot(initialSlot)
    if (initialQuantity) setQuantity(String(initialQuantity))
    getFoodById(initialFoodId)
      .then(food => {
        setSelectedFood(food)
        const serving = initialServingId
          ? food.servings.find(s => s.serving_id === initialServingId) ?? food.servings[0]
          : food.servings[0]
        setSelectedServing(serving ?? null)
        loadOverride(food.food_id)
      })
      .catch(() => Alert.alert('Error', 'Could not load food details.'))
      .finally(() => setDetailLoading(false))
  }, [visible, editLogId])

  const reset = () => {
    scanningRef.current = false
    setTab('search')
    setStep('browse')
    setQuery('')
    setResults([])
    setSearching(false)
    setScanned(false)
    setScanLoading(false)
    setSelectedFood(null)
    setSelectedServing(null)
    setSelectedSlot(defaultSlot)
    setSaving(false)
    setQuantity('1')
    setScannedBarcode(null)
    setActiveOverride(null)
    setMacroEditVisible(false)
  }

  const handleClose = () => { reset(); onClose() }

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setResultMacros({}); return }
    setSearching(true)
    setResultMacros({})
    try {
      const res = await searchFoods(q.trim())
      setResults(res)
      // fetch full nutrition details in background after showing initial results
      res.forEach(async (food) => {
        try {
          const detail = await getFoodById(food.food_id)
          const s = detail.servings[0]
          if (s) {
            setResultMacros(prev => ({
              ...prev,
              [food.food_id]: {
                cal: Math.round(parseFloat(s.calories) || 0),
                prot: Math.round(parseFloat(s.protein) || 0),
                serving: s.serving_description,
              },
            }))
          }
        } catch {}
      })
    } catch {
      Alert.alert('Search failed', 'Could not reach FatSecret. Check your connection.')
    } finally {
      setSearching(false)
    }
  }, [])

  const onQueryChange = (text: string) => {
    setQuery(text)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    // debounce to avoid firing a search on every keystroke
    searchTimeout.current = setTimeout(() => doSearch(text), 500)
  }

  const loadOverride = async (foodId: string, barcode?: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setCurrentUserId(user.id)
    const key = getFoodKey(barcode ? { barcode } : { foodId })
    const override = await getOverride(user.id, key)
    setActiveOverride(override)
  }

  const openDetail = async (foodId: string) => {
    setDetailLoading(true)
    setStep('detail')
    setScannedBarcode(null)
    setQuantity('1')
    try {
      const food = await getFoodById(foodId)
      setSelectedFood(food)
      setSelectedServing(food.servings[0] ?? null)
      await loadOverride(food.food_id)
    } catch {
      Alert.alert('Error', 'Could not load food details.')
      setStep('browse')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (scanningRef.current) return
    scanningRef.current = true
    setScanned(true)
    setScanLoading(true)
    try {
      const food = await findFoodByBarcode(data)
      if (!food) {
        Alert.alert('Not found', 'Couldn\'t find nutrition data for this product. Try searching by name instead.', [
          { text: 'Try Again', onPress: () => { scanningRef.current = false; setScanned(false); setScanLoading(false) } },
          { text: 'Search by Name', onPress: () => { scanningRef.current = false; setScanned(false); setScanLoading(false); setTab('search') } },
        ])
        return
      }
      setSelectedFood(food)
      setSelectedServing(food.servings[0] ?? null)
      setScannedBarcode(data)
      setStep('detail')
      await loadOverride(food.food_id, data)
    } catch {
      Alert.alert('Scan failed', 'Could not look up this barcode.')
      scanningRef.current = false
      setScanned(false)
    } finally {
      setScanLoading(false)
    }
  }

  const saveLog = async () => {
    if (!selectedFood || !selectedServing) return
    setSaving(true)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const uid = authUser?.id
      if (!uid) { Alert.alert('Error', 'Not signed in. Please restart the app.'); return }
      const parsed = parseMacros(selectedServing)
      const qty = Math.max(0.1, parseFloat(quantity) || 1)
      const base = activeOverride
        ? { calories: activeOverride.calories, protein: activeOverride.protein, carbs: activeOverride.carbs ?? parsed.carbs, fat: activeOverride.fat ?? parsed.fat }
        : { calories: parsed.calories, protein: parsed.protein, carbs: parsed.carbs, fat: parsed.fat }
      const macros = {
        calories: Math.round(base.calories * qty),
        protein: Math.round(base.protein * qty),
        carbs: Math.round(base.carbs * qty),
        fat: Math.round(base.fat * qty),
      }
      const logDay = logDate || new Date().toISOString().split('T')[0]
      let error: any
      if (editLogId) {
        ;({ error } = await supabase.from('meal_logs').update({
          calories: macros.calories,
          protein: macros.protein,
          carbs: macros.carbs,
          fat: macros.fat,
          serving_id: selectedServing.serving_id,
          quantity: qty,
        }).eq('id', editLogId))
      } else {
        ;({ error } = await supabase.from('meal_logs').insert({
          user_id: uid,
          meal_name: selectedFood.food_name,
          calories: macros.calories,
          protein: macros.protein,
          carbs: macros.carbs,
          fat: macros.fat,
          slot: selectedSlot,
          logged_at: logDay,
          food_id: selectedFood.food_id,
          serving_id: selectedServing.serving_id,
          quantity: qty,
        }))
      }
      if (error) { Alert.alert('Error', error.message); return }
      if (!editLogId) {
        trackMealLogged(selectedSlot, macros.calories, macros.protein)
        addToRecents(selectedFood, macros.calories, macros.protein, selectedServing.serving_description ?? '')
      }
      onLogged()
      handleClose()
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to log meal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

        {/* ── Detail view ── */}
        {step === 'detail' && (
          <View style={styles.step}>
            <View style={[styles.topBar, { paddingTop: insets.top - 4 }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => { setStep('browse'); setSelectedFood(null) }} activeOpacity={0.7}>
                <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.topTitle} numberOfLines={1}>
                {selectedFood?.food_name ?? 'Loading...'}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {detailLoading || !selectedFood ? (
              <View style={styles.centered}>
                <ActivityIndicator color="#4ADE80" size="large" />
                <Text style={styles.loadingText}>Loading nutrition data...</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

                {/* Macro display */}
                {selectedServing && (() => {
                  const qty = Math.max(0.1, parseFloat(quantity) || 1)
                  const raw = {
                    calories: parseFloat(selectedServing.calories) || 0,
                    protein: parseFloat(selectedServing.protein) || 0,
                    carbs: parseFloat(selectedServing.carbohydrate) || 0,
                    fat: parseFloat(selectedServing.fat) || 0,
                  }
                  const base = activeOverride
                    ? { calories: activeOverride.calories, protein: activeOverride.protein, carbs: activeOverride.carbs, fat: activeOverride.fat }
                    : raw
                  const m = {
                    calories: Math.round(base.calories * qty),
                    protein: Math.round(base.protein * qty),
                    carbs: Math.round(base.carbs * qty),
                    fat: Math.round(base.fat * qty),
                  }
                  const ringSize = 150
                  const strokeWidth = 10
                  const radius = (ringSize - strokeWidth) / 2
                  // circumference = 2πr
                  const circumference = 2 * Math.PI * radius

                  // Macro split: calories from each macro
                  const proteinCal = m.protein * 4
                  const carbsCal = m.carbs * 4
                  const fatCal = m.fat * 9
                  const totalMacroCal = proteinCal + carbsCal + fatCal || 1
                  const proteinPct = proteinCal / totalMacroCal
                  const carbsPct = carbsCal / totalMacroCal
                  const fatPct = fatCal / totalMacroCal

                  // Build ring segments — only include macros > 0
                  const segments = [
                    { pct: proteinPct, color: '#4ADE80' },
                    { pct: carbsPct, color: '#F59E0B' },
                    { pct: fatPct, color: '#60A5FA' },
                  ].filter(s => s.pct > 0.01)
                  // 4-degree visual gap between ring segments
                  const gapDeg = segments.length > 1 ? 4 : 0 // 4 degree gap
                  const totalGapDeg = gapDeg * segments.length
                  const availableDeg = 360 - totalGapDeg
                  let rotationCursor = 0
                  // each segment arc length = circumference × macro fraction
                  const ringSegments = segments.map(s => {
                    const segDeg = availableDeg * s.pct
                    const segLen = (segDeg / 360) * circumference
                    const rotation = rotationCursor
                    rotationCursor += segDeg + gapDeg
                    return { ...s, segLen, rotation }
                  })

                  return (
                    <>
                      {/* Macro split ring */}
                      <View style={styles.calorieRingWrap}>
                        <View style={{ width: ringSize, height: ringSize }}>
                          <Svg width={ringSize} height={ringSize} style={{ position: 'absolute' }}>
                            <Circle cx={ringSize / 2} cy={ringSize / 2} r={radius} stroke="#1A1A1A" strokeWidth={strokeWidth} fill="none" />
                          </Svg>
                          {ringSegments.map((seg, i) => (
                            <Svg key={i} width={ringSize} height={ringSize} style={{ position: 'absolute', transform: [{ rotate: `${seg.rotation - 90}deg` }] }}>
                              <Circle cx={ringSize / 2} cy={ringSize / 2} r={radius} stroke={seg.color} strokeWidth={strokeWidth} fill="none"
                                strokeDasharray={`${seg.segLen} ${circumference - seg.segLen}`} strokeDashoffset={0} />
                            </Svg>
                          ))}
                        </View>
                        <View style={styles.calorieRingCenter}>
                          <Text style={styles.calorieRingValue}>{m.calories}</Text>
                          <Text style={styles.calorieRingLabel}>KCAL</Text>
                        </View>
                      </View>

                      {/* Macro legend */}
                      <View style={styles.macroLegend}>
                        {[
                          { label: 'Protein', pct: proteinPct, color: '#4ADE80' },
                          { label: 'Carbs', pct: carbsPct, color: '#F59E0B' },
                          { label: 'Fat', pct: fatPct, color: '#60A5FA' },
                        ].filter(l => l.pct > 0.01).map(l => (
                          <View key={l.label} style={styles.macroLegendItem}>
                            <View style={[styles.macroLegendDot, { backgroundColor: l.color }]} />
                            <Text style={styles.macroLegendText}>{l.label} {Math.round(l.pct * 100)}%</Text>
                          </View>
                        ))}
                      </View>

                      {/* Macro cards */}
                      <View style={styles.macroGrid}>
                        {[
                          { label: 'PROTEIN', value: m.protein, unit: 'g', color: '#4ADE80' },
                          { label: 'CARBS',   value: m.carbs,   unit: 'g', color: '#F59E0B' },
                          { label: 'FAT',     value: m.fat,     unit: 'g', color: '#60A5FA' },
                          { label: 'FIBER',   value: Math.round(Number(selectedServing.fiber || 0) * qty), unit: 'g', color: COLORS.textMuted },
                        ].map(macro => (
                          <View key={macro.label} style={styles.macroCell}>
                            <View style={[styles.macroDot, { backgroundColor: macro.color }]} />
                            <Text style={styles.macroCellLabel}>{macro.label}</Text>
                            <Text style={styles.macroCellValue}>{macro.value}<Text style={styles.macroCellUnit}>{macro.unit}</Text></Text>
                          </View>
                        ))}
                      </View>

                      <TouchableOpacity
                        style={styles.fixLink}
                        onPress={() => setMacroEditVisible(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.fixLinkText}>
                          {activeOverride ? 'Custom values applied · Edit →' : 'Something off? Fix it →'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )
                })()}

                {/* Serving size + Quantity row */}
                <View style={styles.servingQtyRow}>
                  {selectedFood.servings.length > 1 ? (
                    <View style={styles.servingSizeWrap}>
                      <Text style={styles.servingQtyLabel}>SERVING SIZE</Text>
                      <TouchableOpacity
                        style={styles.servingDropdown}
                        onPress={() => {
                          const options = selectedFood!.servings.map(s => s.serving_description)
                          Alert.alert('Serving Size', '', options.map(opt => ({
                            text: opt,
                            onPress: () => {
                              const s = selectedFood!.servings.find(sv => sv.serving_description === opt)
                              if (s) setSelectedServing(s)
                            },
                          })).concat([{ text: 'Cancel', style: 'cancel' } as any]))
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.servingDropdownText} numberOfLines={1}>
                          {selectedServing?.serving_description ?? 'Select'}
                        </Text>
                        <ChevronDown size={14} stroke={COLORS.textMuted} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.servingSizeWrap}>
                      <Text style={styles.servingQtyLabel}>SERVING SIZE</Text>
                      <View style={styles.servingDropdown}>
                        <Text style={styles.servingDropdownText}>{selectedServing?.serving_description ?? '1 serving'}</Text>
                      </View>
                    </View>
                  )}
                  <View style={styles.qtyWrap}>
                    <Text style={styles.servingQtyLabel}>QTY</Text>
                    <View style={styles.qtyBox}>
                      <TextInput
                        style={styles.qtyInput}
                        value={quantity}
                        onChangeText={setQuantity}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>
                </View>

                {/* Slot picker */}
                <Text style={styles.slotLabel}>ADD TO MEAL</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotScroll}>
                  <View style={styles.slotChips}>
                    {slots.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.slotChip, selectedSlot === s && styles.slotChipActive]}
                        onPress={() => setSelectedSlot(s)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.slotChipText, selectedSlot === s && styles.slotChipTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={[styles.logBtn, (!selectedServing || saving) && { opacity: 0.5 }]}
                  onPress={saveLog}
                  activeOpacity={0.85}
                  disabled={!selectedServing || saving}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.logBtnText}>{editLogId ? 'Update Log' : `Log to ${selectedSlot}`}</Text>
                  }
                </TouchableOpacity>

                {/* Attribution — required by FatSecret free tier */}
                <View style={styles.attribution}>
                  <Image
                    source={{ uri: 'https://platform.fatsecret.com/api/static/images/powered_by_fatsecret.png' }}
                    style={styles.attributionLogo}
                    resizeMode="contain"
                  />
                </View>

                <View style={{ height: 16 }} />
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Browse view ── */}
        {step === 'browse' && (
          <View style={styles.step}>
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
              <Text style={styles.topTitle}>Search Food</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
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
                  if (!cameraPermission?.granted) await requestCameraPermission()
                  setTab('scan')
                  setScanned(false)
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
                    <View style={{ paddingHorizontal: 4, paddingTop: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Recently Logged</Text>
                      {recentFoods.map((food, i) => (
                        <TouchableOpacity
                          key={`recent-${food.food_id}-${i}`}
                          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.06)' }}
                          activeOpacity={0.7}
                          onPress={() => {
                            setDetailLoading(true)
                            setStep('detail')
                            getFoodById(food.food_id)
                              .then(detail => {
                                setSelectedFood(detail)
                                setSelectedServing(detail.servings[0] ?? null)
                                loadOverride(detail.food_id)
                              })
                              .catch(() => { setStep('browse'); Alert.alert('Error', 'Could not load food') })
                              .finally(() => setDetailLoading(false))
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.textWhite }}>{food.food_name}</Text>
                            <Text style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                              {food.cal} cal · {food.prot}g protein{food.brand_name ? ` · ${food.brand_name}` : ''}
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
                        <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.5, marginBottom: 8, marginTop: 4, textTransform: 'uppercase' }}>Previously Logged</Text>
                        {matchingRecents.map((food, i) => (
                          <TouchableOpacity
                            key={`recent-match-${food.food_id}-${i}`}
                            style={styles.resultRow}
                            onPress={() => openDetail(food.food_id)}
                            activeOpacity={0.75}
                          >
                            <View style={styles.resultInfo}>
                              <Text style={styles.resultName} numberOfLines={1}>{food.food_name}</Text>
                              <Text style={styles.resultBrand}>{food.cal} cal, {food.prot}g protein</Text>
                            </View>
                            <ChevronRight size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
                          </TouchableOpacity>
                        ))}
                        <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.5, marginBottom: 8, marginTop: 16, textTransform: 'uppercase' }}>Results</Text>
                      </>
                    )
                  })()}
                  {results.map((food, i) => {
                    const rm = resultMacros[food.food_id]
                    const subtitle = rm
                      ? [
                          `${rm.cal} cal`,
                          `${rm.prot}g protein`,
                          rm.serving,
                          food.brand_name || null,
                        ].filter(Boolean).join(', ')
                      : food.brand_name || ''
                    return (
                      <TouchableOpacity
                        key={`${food.food_id}-${i}`}
                        style={styles.resultRow}
                        onPress={() => openDetail(food.food_id)}
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
                    <TouchableOpacity style={styles.permissionBtn} onPress={requestCameraPermission} activeOpacity={0.85}>
                      <Text style={styles.permissionBtnText}>Allow Camera</Text>
                    </TouchableOpacity>
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

      {/* Macro override editor */}
      {macroEditVisible && selectedFood && currentUserId && selectedServing && (() => {
        const parsed = parseMacros(selectedServing)
        const key = getFoodKey(scannedBarcode ? { barcode: scannedBarcode } : { foodId: selectedFood.food_id })
        return (
          <MacroEditModal
            visible
            onClose={() => setMacroEditVisible(false)}
            foodKey={key}
            foodName={selectedFood.food_name}
            userId={currentUserId}
            originalCalories={parsed.calories}
            originalProtein={parsed.protein}
            originalCarbs={parsed.carbs}
            originalFat={parsed.fat}
            onSaved={async (overrideActive) => {
              if (overrideActive) {
                const override = await getOverride(currentUserId, key)
                setActiveOverride(override)
              } else {
                setActiveOverride(null)
              }
            }}
          />
        )
      })()}
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
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
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
  resultBrand: { fontSize: 12, color: COLORS.textMuted },
  resultMacros: { fontSize: 12, color: COLORS.textMuted },
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
  brandName: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 20, marginTop: -12, marginBottom: 0 },

  // Calorie ring
  calorieRingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  calorieRingCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  calorieRingValue: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -1,
  },
  calorieRingLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 2,
    marginTop: -2,
  },

  // Macro legend
  macroLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 24,
  },
  macroLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  macroLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroLegendText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },

  // Macro grid
  macroDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  macroCell: {
    width: '47%',
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  macroCellLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  macroCellValue: { fontSize: 28, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  macroCellUnit: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },

  // Serving + Qty row (Stitch style)
  servingQtyRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  servingSizeWrap: {
    flex: 1,
    gap: 8,
  },
  servingQtyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  servingDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  servingDropdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textWhite,
    flex: 1,
  },
  qtyWrap: {
    width: 80,
    gap: 8,
  },
  qtyBox: {
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  qtyInput: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textWhite,
    textAlign: 'center',
    padding: 0,
    minWidth: 36,
  },

  // Slot picker
  slotLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  slotScroll: { marginBottom: 24 },
  slotChips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 4 },
  slotChip: {
    backgroundColor: '#141414',
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  slotChipActive: { backgroundColor: '#4ADE80' },
  slotChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  slotChipTextActive: { color: '#000000' },

  // Attribution (subtle)
  attribution: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 12,
    opacity: 0.4,
  },
  attributionLogo: { width: 120, height: 16 },
  attributionSmall: { alignItems: 'center', paddingVertical: 16 },
  attributionLogoSmall: { width: 90, height: 18, opacity: 0.4 },

  // Fix link
  fixLink: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 8,
  },
  fixLinkText: {
    fontSize: 12,
    color: COLORS.textMuted,
    textDecorationLine: 'underline',
  },

  // Log button
  logBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    marginHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logBtnText: { fontSize: 16, fontWeight: '700', color: '#000000' },
})
