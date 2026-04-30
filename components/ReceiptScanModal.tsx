import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  Animated,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { X, Check, Receipt, Camera, ImageIcon, Zap, Plus } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { usePremium } from '@/context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackUpgradePromptShown } from '@/lib/analytics'
// ── Types ────────────────────────────────────────────────────────────────

type ParsedItem = {
  id: string
  name: string
  category: string
  checked: boolean
}

const CATEGORIES = ['Protein', 'Carbs', 'Produce', 'Condiments', 'Dairy', 'Pantry Staples', 'Other']

// ── Brand normalization ──────────────────────────────────────────────────

// Common grocery brand name patterns to strip from ingredient names.
// Matches leading brand words followed by a space + actual ingredient.
const BRAND_PATTERNS: RegExp[] = [
  // Major national brands
  /^(Kraft|Heinz|Nestlé|Nestle|Kellogg'?s?|General Mills|Pepperidge Farm|Pepperidge|Dole|Del Monte|Hunt'?s?|Libby'?s?|Progresso|Campbell'?s?|Swanson|Birds Eye|Green Giant|Pillsbury|Betty Crocker|Duncan Hines|Quaker|Cheerios|Tropicana|Minute Maid|Simply|Welch'?s?|Ocean Spray|Smucker'?s?|Jif|Skippy|Peter Pan|Planters|Blue Diamond|Horizon|Organic Valley|Tillamook|Cabot|Land O'? ?Lakes?|Kerrygold|Daisy|Breakstone'?s?|Knorr|Lipton|McCormick|Lawry'?s?|Morton|Diamond Crystal|Arm & Hammer|Arm and Hammer|Bob'?s? Red Mill|King Arthur|Gold Medal|Hodgson Mill|Argo|Domino|C&H|Imperial|Dixie Crystals|Rumford|Clabber Girl|Davis|Fleischmann'?s?|Red Star|Hodgson|Barilla|Ronzoni|Mueller'?s?|De Cecco|Dreamfields|Classico|Prego|Ragu|Newman'?s? Own|Annie'?s?|Amy'?s?|Eden|365|Simple Truth|Private Selection|Signature Select|Great Value|Good & Gather|Sprouts|Market Pantry|Archer Farms)\s+/i,
  // Store brand prefixes
  /^(Trader Joe'?s?|Whole Foods|Costco|Kirkland|President'?s? Choice|PC|Store Brand|Generic|House Brand|Our Brand)\s+/i,
  // Organic / descriptor prefixes that aren't the ingredient
  /^(Organic|Natural|All Natural|Non-GMO|Free Range|Grass[- ]Fed|Pasture[- ]Raised|Cage[- ]Free|Wild[- ]Caught|Farm[- ]Fresh)\s+/i,
]

/**
 * Strips leading brand names and descriptor prefixes from an ingredient name,
 * then title-cases the result.
 */
function normalizeIngredientName(raw: string): string {
  let name = raw.trim()

  // Remove trailing parenthetical size/weight info: "Chicken Breast (2 lbs)" → "Chicken Breast"
  name = name.replace(/\s*\(.*?\)\s*$/, '').trim()

  // Remove leading item codes or numbers: "1234 Whole Milk" → "Whole Milk"
  name = name.replace(/^\d[\d\s\-#]*\s+/, '')

  // Apply brand pattern stripping iteratively (some items have stacked prefixes)
  let changed = true
  while (changed) {
    changed = false
    for (const pattern of BRAND_PATTERNS) {
      const stripped = name.replace(pattern, '')
      if (stripped !== name) {
        name = stripped.trim()
        changed = true
      }
    }
  }

  // Title-case the result (e.g. "whole milk" → "Whole Milk")
  name = name
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())

  return name
}

// ── Receipt parsing via Edge Function ─────────────────────────────────────

async function parseReceiptImage(base64: string): Promise<ParsedItem[]> {
  const { data, error } = await supabase.functions.invoke('parse-receipt', {
    body: { base64 },
  })
  if (error) throw error
  const parsed = data as { name: string; category: string }[]
  return parsed.map((item, i) => ({
    id: String(i),
    name: normalizeIngredientName(item.name),
    category: CATEGORIES.includes(item.category) ? item.category : 'Other',
    checked: true,
  }))
}

// ── Main modal ───────────────────────────────────────────────────────────

type Props = {
  visible: boolean
  onClose: () => void
  onItemsAdded?: () => void
}

export default function ReceiptScanModal({ visible, onClose, onItemsAdded }: Props) {
  const { user } = useAuth()
  const { requestConsent } = useAIConsent()
  const { isPremium, triggerUpgrade } = usePremium()
  const { registerPlacement } = useSuperwall()
  const [step, setStep] = useState<'pick' | 'scanning' | 'visualReview' | 'saving'>('pick')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [items, setItems] = useState<ParsedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addItemText, setAddItemText] = useState('')

  // Camera
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [flashOn, setFlashOn] = useState(false)

  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    if (step !== 'scanning') return
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.35, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        ]),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [step])

  // Request camera permission when modal opens
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission()
    }
  }, [visible])

  const handleClose = () => {
    setStep('pick')
    setImageUri(null)
    setItems([])
    setError(null)
    setFlashOn(false)
    setAddItemText('')
    onClose()
  }

  const capturePhoto = async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 })
      if (photo) {
        const fixed = await ImageManipulator.manipulateAsync(
          photo.uri,
          [],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        )
        await processImage(fixed.uri, fixed.base64 ?? null)
      }
    } catch (e) {
      Alert.alert('Capture failed', 'Could not take photo.')
    }
  }

  const launchLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photo access needed', 'Please allow photo library access in Settings.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    })
    if (!result.canceled && result.assets[0]) {
      await processImage(result.assets[0].uri, result.assets[0].base64 ?? null)
    }
  }

  const processImage = async (uri: string, base64: string | null) => {
    if (!base64) { Alert.alert('Error', 'Could not read image.'); return }
    if (!isPremium) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('receipt_scan_count')
        .eq('id', user!.id)
        .single()
      const count = profile?.receipt_scan_count ?? 0
      if (count >= 3) {
        trackUpgradePromptShown('scan_limit')
        await triggerUpgrade('receipt_scan_limit')
        onClose()
        return
      }
      await supabase
        .from('profiles')
        .update({ receipt_scan_count: count + 1 })
        .eq('id', user!.id)
    }
    const ok = await requestConsent()
    if (!ok) return
    setImageUri(uri)
    setStep('scanning')
    setError(null)
    try {
      const parsed = await parseReceiptImage(base64)
      if (parsed.length === 0) {
        setError('No grocery items found on this receipt. Try a clearer photo.')
        setStep('pick')
        return
      }
      setItems(parsed)
      setStep('visualReview')
    } catch (e: any) {
      setError('Failed to read receipt. Make sure the image is clear and well-lit.')
      setStep('pick')
    }
  }

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i))
  }

  const saveItems = async () => {
    if (!user) return
    const selected = items.filter(i => i.checked)
    if (selected.length === 0) { handleClose(); return }
    setStep('saving')
    const rows = selected.map(item => ({
      user_id: user.id,
      name: item.name,
      category: item.category,
      in_stock: true,
    }))
    const { error } = await supabase.from('pantry_items').insert(rows)
    if (error) {
      Alert.alert('Save failed', error.message)
      setStep('visualReview')
      return
    }
    onItemsAdded?.()
    handleClose()
  }

  const grouped = CATEGORIES.map(cat => ({
    category: cat,
    items: items.filter(i => i.category === cat && i.checked !== undefined),
  })).filter(g => g.items.length > 0)

  const checkedCount = items.filter(i => i.checked).length

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

        {/* ── Pick step: inline camera ── */}
        {step === 'pick' && (
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
              <View style={styles.cameraTopBar}>
                <TouchableOpacity style={styles.cameraCloseBtn} onPress={handleClose}>
                  <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>Scan Receipt</Text>
                <View style={{ width: 36 }} />
              </View>
            </View>

            {error && (
              <View style={[styles.errorBanner, { marginTop: 8 }]}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Bottom controls */}
            <View style={styles.cameraBottom}>
              <View style={styles.modeTabs}>
                <TouchableOpacity style={[styles.modeTab, styles.modeTabActive]} activeOpacity={0.8}>
                  <Camera size={18} stroke="#000" strokeWidth={2} />
                  <Text style={[styles.modeTabText, styles.modeTabTextActive]}>Scan Receipt</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modeTab} onPress={launchLibrary} activeOpacity={0.8}>
                  <ImageIcon size={18} stroke={COLORS.textMuted} strokeWidth={2} />
                  <Text style={styles.modeTabText}>Gallery</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.shutterRow}>
                <TouchableOpacity style={styles.flashBtn} onPress={() => setFlashOn(f => !f)} activeOpacity={0.7}>
                  <Zap size={20} stroke={flashOn ? '#FFD700' : COLORS.textMuted} strokeWidth={2} fill={flashOn ? '#FFD700' : 'none'} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.shutterBtn} onPress={capturePhoto} activeOpacity={0.85}>
                  <View style={styles.shutterInner} />
                </TouchableOpacity>
                <View style={{ width: 44 }} />
              </View>
            </View>
          </View>
        )}

        {/* ── Scanning step ── */}
        {step === 'scanning' && (
          <View style={[styles.step, styles.centered]}>
            <TouchableOpacity style={[styles.closeBtn, styles.closeBtnAbs]} onPress={handleClose}>
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>

            {imageUri && (
              <Image source={{ uri: imageUri }} style={styles.receiptThumb} resizeMode="cover" />
            )}

            <View style={styles.pulseWrap}>
              <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
              <View style={styles.pulseCore}>
                <Receipt size={28} stroke="#4ADE80" strokeWidth={1.6} />
              </View>
            </View>

            <Text style={[styles.heroTitle, { textAlign: 'center', marginTop: 28 }]}>
              Reading your receipt...
            </Text>
            <Text style={[styles.heroSub, { textAlign: 'center', marginTop: 6 }]}>
              AI is extracting your grocery items
            </Text>
            <ActivityIndicator color="#4ADE80" style={{ marginTop: 20 }} />
          </View>
        )}

        {/* ── Visual review step ── */}
        {step === 'visualReview' && (
          <KeyboardAvoidingView style={styles.step} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.topBar}>
              <Text style={styles.topTitle}>Items Found</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <View style={{ flex: 1 }}>
              {imageUri && (
                <View style={styles.visualImageWrap}>
                  <Image source={{ uri: imageUri }} style={styles.visualImage} resizeMode="cover" />
                  <View style={styles.visualOverlay} />
                </View>
              )}

              <Text style={styles.visualSubtitle}>
                {items.length} item{items.length !== 1 ? 's' : ''} detected — tap X to remove any
              </Text>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chipContainer}>
                {items.map(item => (
                  <View key={item.id} style={styles.chip}>
                    <Text style={styles.chipText}>{item.name}</Text>
                    <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <X size={14} stroke={COLORS.textMuted} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.addItemRow}>
                <TextInput
                  style={styles.addItemInput}
                  placeholder="Add missing item..."
                  placeholderTextColor={COLORS.textMuted}
                  value={addItemText}
                  onChangeText={setAddItemText}
                  onSubmitEditing={() => {
                    const name = addItemText.trim()
                    if (!name) return
                    setItems(prev => [...prev, { id: String(Date.now()), name, category: 'Other', checked: true }])
                    setAddItemText('')
                  }}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addItemBtn, !addItemText.trim() && { opacity: 0.4 }]}
                  disabled={!addItemText.trim()}
                  onPress={() => {
                    const name = addItemText.trim()
                    if (!name) return
                    setItems(prev => [...prev, { id: String(Date.now()), name, category: 'Other', checked: true }])
                    setAddItemText('')
                  }}
                  activeOpacity={0.7}
                >
                  <Plus size={18} stroke="#000" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.primaryBtn, step === 'saving' && { opacity: 0.6 }]}
                onPress={saveItems}
                activeOpacity={0.85}
                disabled={step === 'saving'}
              >
                {step === 'saving'
                  ? <ActivityIndicator color="#000000" />
                  : <Text style={styles.primaryBtnText}>Add {items.length} Item{items.length !== 1 ? 's' : ''} to Pantry</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose} activeOpacity={0.85}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}


      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  step: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 20,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },

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
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  cameraCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
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
    gap: 16,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modeTabActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  modeTabTextActive: {
    color: '#000000',
  },
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

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
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

  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  heroSub: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  errorBanner: {
    backgroundColor: '#2A0A0A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },

  actions: { gap: 10 },
  primaryBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  secondaryBtnText: {
    color: COLORS.textWhite,
    fontSize: 16,
    fontWeight: '600',
  },

  // Scanning
  receiptThumb: {
    width: 120,
    height: 160,
    borderRadius: 12,
    marginBottom: 32,
    opacity: 0.6,
  },
  pulseWrap: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(74,222,128,0.18)',
  },
  pulseCore: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Visual review
  visualImageWrap: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  visualImage: {
    width: '100%',
    height: '100%',
  },
  visualOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  visualSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 14,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textWhite,
  },
  addItemRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  addItemInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
    color: COLORS.textWhite,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  addItemBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Review
  reviewSub: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 20,
    marginTop: -16,
  },
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
    color: COLORS.textWhite,
    fontWeight: '400',
  },
  resultNameUnchecked: {
    color: COLORS.textMuted,
    textDecorationLine: 'line-through',
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
})
