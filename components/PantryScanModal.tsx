import { useState, useEffect, useRef } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X, ScanLine, Check, Plus } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────

type PhotoEntry = {
  id: string
  label: string
}

type DetectedItem = {
  id: string
  name: string
  category: string
  checked: boolean
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

function PhotoThumbnail({ label }: { label: string }) {
  return (
    <View style={styles.thumbnail}>
      <View style={styles.thumbnailImg}>
        <ScanLine size={16} stroke="#4ADE80" strokeWidth={1.5} />
      </View>
      <View style={styles.thumbnailCheck}>
        <Check size={8} stroke="#000" strokeWidth={3} />
      </View>
      <Text style={styles.thumbnailLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function CameraPreview() {
  return (
    <View style={styles.cameraPreview}>
      <ScanLine size={48} stroke="#4ADE80" strokeWidth={1.5} />
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
  const [step, setStep] = useState(1)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [showDone, setShowDone] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>(MOCK_DETECTED)
  const [saving, setSaving] = useState(false)

  const pulseScale   = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0.4)).current

  // Loading animation + 3s auto-reveal
  useEffect(() => {
    if (step !== 5) return
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
    const timer = setTimeout(() => setShowDone(true), 3000)
    return () => { loop.stop(); clearTimeout(timer) }
  }, [step])

  const handleClose = () => {
    setStep(1)
    setPhotos([])
    setShowDone(false)
    setCustomLabel('')
    setShowCustomInput(false)
    setDetectedItems(MOCK_DETECTED)
    onClose()
  }

  const takePhoto = (label: string, next: number) => {
    setPhotos(prev => [...prev, { id: String(Date.now()), label }])
    setStep(next)
  }

  const addExtraPhoto = (label: string) => {
    setPhotos(prev => [...prev, { id: String(Date.now()), label }])
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

        {/* ── Step 1: Fridge ── */}
        {step === 1 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <ProgressDots total={3} active={0} />
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <CameraPreview />
            <View style={styles.stepText}>
              <Text style={styles.title}>Photograph your fridge</Text>
              <Text style={styles.subtitle}>Open it up and capture the full interior</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => takePhoto('Fridge', 2)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep(2)} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 2: Pantry ── */}
        {step === 2 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <ProgressDots total={3} active={1} />
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <View style={styles.photoRow}>
                {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} />)}
              </View>
            )}
            <CameraPreview />
            <View style={styles.stepText}>
              <Text style={styles.title}>Now photograph your pantry or shelves</Text>
              <Text style={styles.subtitle}>Any cabinets where you store dry goods</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => takePhoto('Pantry', 3)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep(3)} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 3: Counter ── */}
        {step === 3 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <ProgressDots total={3} active={2} />
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <View style={styles.photoRow}>
                {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} />)}
              </View>
            )}
            <CameraPreview />
            <View style={styles.stepText}>
              <Text style={styles.title}>Anything on your counter?</Text>
              <Text style={styles.subtitle}>Fruits, oils, or anything sitting out</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => takePhoto('Counter', 4)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep(4)} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 4: Add More ── */}
        {step === 4 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.addMoreScroll}>
              <Text style={styles.title}>Want to add more?</Text>
              <Text style={[styles.subtitle, { marginBottom: 20 }]}>Add any other storage areas in your kitchen</Text>
              {photos.length > 0 && (
                <View style={[styles.photoRow, { marginBottom: 20 }]}>
                  {photos.map(p => <PhotoThumbnail key={p.id} label={p.label} />)}
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
          <View style={[styles.step, styles.centered]}>
            <TouchableOpacity style={[styles.closeBtn, styles.closeBtnAbs]} onPress={handleClose}>
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.pulseWrap}>
              <Animated.View
                style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
              />
              <View style={styles.pulseCore}>
                <ScanLine size={32} stroke="#4ADE80" strokeWidth={1.6} />
              </View>
            </View>
            <Text style={[styles.title, { textAlign: 'center', marginTop: 36 }]}>
              AI is scanning your kitchen...
            </Text>
            <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8 }]}>
              Detecting ingredients from your photos
            </Text>
            {showDone && (
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 44, width: 220 }]}
                onPress={() => setStep(6)}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>View Results</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Step 6: Results ── */}
        {step === 6 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
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
                  const selected = detectedItems.filter(i => i.checked)
                  if (selected.length === 0) { handleClose(); return }
                  setSaving(true)
                  await supabase.from('pantry_items').insert(
                    selected.map(item => ({
                      user_id: user.id,
                      name: item.name,
                      category: item.category,
                      in_stock: true,
                    }))
                  )
                  setSaving(false)
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

  // Camera preview
  cameraPreview: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
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
})
