import { useState, useRef, useCallback } from 'react'
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
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { X, Search, ScanBarcode, ChevronLeft, ChevronRight } from 'lucide-react-native'
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

type Tab = 'search' | 'scan'
type Step = 'browse' | 'detail'

type Props = {
  visible: boolean
  slots: string[]
  defaultSlot: string
  onClose: () => void
  onLogged: () => void
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

export default function FoodSearchModal({ visible, slots, defaultSlot, onClose, onLogged }: Props) {
  const [tab, setTab] = useState<Tab>('search')
  const [step, setStep] = useState<Step>('browse')

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Scan state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const scanningRef = useRef(false) // synchronous guard — state updates are async and allow duplicate fires

  // Detail state
  const [selectedFood, setSelectedFood] = useState<FoodDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedServing, setSelectedServing] = useState<FoodServing | null>(null)
  const [selectedSlot, setSelectedSlot] = useState(defaultSlot)
  const [saving, setSaving] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }

  const handleClose = () => { reset(); onClose() }

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await searchFoods(q.trim())
      setResults(res)
    } catch {
      Alert.alert('Search failed', 'Could not reach FatSecret. Check your connection.')
    } finally {
      setSearching(false)
    }
  }, [])

  const onQueryChange = (text: string) => {
    setQuery(text)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => doSearch(text), 500)
  }

  const openDetail = async (foodId: string) => {
    setDetailLoading(true)
    setStep('detail')
    try {
      const food = await getFoodById(foodId)
      setSelectedFood(food)
      setSelectedServing(food.servings[0] ?? null)
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
      setStep('detail')
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
      const macros = parseMacros(selectedServing)
      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase.from('meal_logs').insert({
        user_id: uid,
        meal_name: selectedFood.food_name,
        calories: macros.calories,
        protein: macros.protein,
        slot: selectedSlot,
        logged_at: today,
      })
      if (error) { Alert.alert('Error', error.message); return }
      trackMealLogged(selectedSlot, macros.calories, macros.protein)
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
            <View style={styles.topBar}>
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
                {selectedFood.brand_name && (
                  <Text style={styles.brandName}>{selectedFood.brand_name}</Text>
                )}

                {/* Serving picker */}
                {selectedFood.servings.length > 1 && (
                  <View style={styles.servingSection}>
                    <Text style={styles.servingLabel}>Serving size</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.servingChips}>
                        {selectedFood.servings.map(s => (
                          <TouchableOpacity
                            key={s.serving_id}
                            style={[styles.servingChip, selectedServing?.serving_id === s.serving_id && styles.servingChipActive]}
                            onPress={() => setSelectedServing(s)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.servingChipText, selectedServing?.serving_id === s.serving_id && styles.servingChipTextActive]}>
                              {s.serving_description}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Macro grid */}
                {selectedServing && (() => {
                  const m = parseMacros(selectedServing)
                  return (
                    <View style={styles.macroGrid}>
                      {[
                        { label: 'Calories', value: m.calories, unit: 'kcal', color: '#FFFFFF' },
                        { label: 'Protein',  value: m.protein,  unit: 'g',    color: '#4ADE80' },
                        { label: 'Carbs',    value: m.carbs,    unit: 'g',    color: '#F59E0B' },
                        { label: 'Fat',      value: m.fat,      unit: 'g',    color: '#60A5FA' },
                      ].map(macro => (
                        <View key={macro.label} style={styles.macroCell}>
                          <View style={[styles.macroDot, { backgroundColor: macro.color }]} />
                          <Text style={styles.macroCellLabel}>{macro.label}</Text>
                          <Text style={styles.macroCellValue}>{macro.value}<Text style={styles.macroCellUnit}>{macro.unit}</Text></Text>
                        </View>
                      ))}
                    </View>
                  )
                })()}

                {/* Slot picker */}
                <Text style={styles.slotLabel}>Add to meal</Text>
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

                {/* Attribution — required by FatSecret free tier */}
                <View style={styles.attribution}>
                  <Text style={styles.attributionText}>Nutrition data</Text>
                  <Image
                    source={{ uri: 'https://platform.fatsecret.com/api/static/images/powered_by_fatsecret.png' }}
                    style={styles.attributionLogo}
                    resizeMode="contain"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.logBtn, (!selectedServing || saving) && { opacity: 0.5 }]}
                  onPress={saveLog}
                  activeOpacity={0.85}
                  disabled={!selectedServing || saving}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.logBtnText}>Log to {selectedSlot}</Text>
                  }
                </TouchableOpacity>

                <View style={{ height: 16 }} />
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Browse view ── */}
        {step === 'browse' && (
          <View style={styles.step}>
            <View style={styles.topBar}>
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
                  {results.length === 0 && !query && (
                    <Text style={styles.hintText}>Type to search millions of foods and brands</Text>
                  )}
                  {results.map((food, i) => {
                    const m = quickMacros(food.food_description)
                    return (
                      <TouchableOpacity
                        key={`${food.food_id}-${i}`}
                        style={styles.resultRow}
                        onPress={() => openDetail(food.food_id)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{food.food_name}</Text>
                          {food.brand_name && <Text style={styles.resultBrand}>{food.brand_name}</Text>}
                          <Text style={styles.resultMacros}>{m.per} · {m.cal} kcal · {m.prot}g protein</Text>
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
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  step: { flex: 1, paddingTop: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
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
  brandName: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 20, marginBottom: 16 },
  servingSection: { paddingHorizontal: 20, marginBottom: 20 },
  servingLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.4, marginBottom: 10 },
  servingChips: { flexDirection: 'row', gap: 8 },
  servingChip: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  servingChipActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  servingChipText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  servingChipTextActive: { color: '#000000', fontWeight: '600' },

  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  macroCell: {
    width: '47%',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  macroDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  macroCellLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.4 },
  macroCellValue: { fontSize: 22, fontWeight: '700', color: COLORS.textWhite },
  macroCellUnit: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },

  slotLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, paddingHorizontal: 20, marginBottom: 10 },
  slotScroll: { marginBottom: 4 },
  slotChips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 4 },
  slotChip: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  slotChipActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  slotChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  slotChipTextActive: { color: '#000000' },

  attribution: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 20,
    marginTop: 8,
  },
  attributionText: { fontSize: 11, color: COLORS.textMuted },
  attributionLogo: { width: 100, height: 20 },
  attributionSmall: { alignItems: 'center', paddingVertical: 16 },
  attributionLogoSmall: { width: 90, height: 18, opacity: 0.6 },

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
