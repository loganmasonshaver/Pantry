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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { X, Check, Receipt, Camera, ImageIcon } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
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
  const [step, setStep] = useState<'pick' | 'scanning' | 'review' | 'saving'>('pick')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [items, setItems] = useState<ParsedItem[]>([])
  const [error, setError] = useState<string | null>(null)

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

  const handleClose = () => {
    setStep('pick')
    setImageUri(null)
    setItems([])
    setError(null)
    onClose()
  }

  const launchCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Please allow camera access in Settings.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    })
    if (!result.canceled && result.assets[0]) {
      await processImage(result.assets[0].uri, result.assets[0].base64 ?? null)
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
      setStep('review')
    } catch (e: any) {
      setError('Failed to read receipt. Make sure the image is clear and well-lit.')
      setStep('pick')
    }
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
      setStep('review')
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

        {/* ── Pick step ── */}
        {step === 'pick' && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <Text style={styles.topTitle}>Scan Receipt</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <View style={styles.heroArea}>
              <View style={styles.heroIcon}>
                <Receipt size={48} stroke="#4ADE80" strokeWidth={1.4} />
              </View>
              <Text style={styles.heroTitle}>Photograph your receipt</Text>
              <Text style={styles.heroSub}>
                AI reads your grocery receipt and automatically adds everything to your pantry
              </Text>
            </View>

            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={launchCamera} activeOpacity={0.85}>
                <Camera size={18} stroke="#000000" strokeWidth={2} />
                <Text style={styles.primaryBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={launchLibrary} activeOpacity={0.85}>
                <ImageIcon size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                <Text style={styles.secondaryBtnText}>Choose from Library</Text>
              </TouchableOpacity>
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

        {/* ── Review step ── */}
        {(step === 'review' || step === 'saving') && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <Text style={styles.topTitle}>Review Items</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={styles.reviewSub}>
              Found {items.length} item{items.length !== 1 ? 's' : ''} — deselect anything you already have
            </Text>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {grouped.map(group => (
                <View key={group.category} style={styles.resultGroup}>
                  <Text style={styles.resultGroupLabel}>{group.category}</Text>
                  <View style={styles.resultCard}>
                    {group.items.map((item, i) => (
                      <View key={item.id}>
                        {i > 0 && <View style={styles.resultDivider} />}
                        <TouchableOpacity
                          style={styles.resultRow}
                          onPress={() => toggleItem(item.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.resultName, !item.checked && styles.resultNameUnchecked]}>
                            {item.name}
                          </Text>
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
                style={[styles.primaryBtn, step === 'saving' && { opacity: 0.6 }]}
                onPress={saveItems}
                activeOpacity={0.85}
                disabled={step === 'saving'}
              >
                {step === 'saving'
                  ? <ActivityIndicator color="#000000" />
                  : <Text style={styles.primaryBtnText}>Add {checkedCount} Item{checkedCount !== 1 ? 's' : ''} to Pantry</Text>
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
  step: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 20,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },

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

  heroArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
  },
  heroIcon: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.2)',
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
