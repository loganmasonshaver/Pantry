import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { X, Camera, FileText, ImageIcon, ChevronRight, Zap } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { trackMealLogged } from '@/lib/analytics'

const { width: SCREEN_W } = Dimensions.get('window')
// ── Types ────────────────────────────────────────────────────────────────

type MacroEstimate = {
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

type ScanMode = 'food' | 'describe'
type Step = 'input' | 'analyzing' | 'review'

// ── GPT helpers ──────────────────────────────────────────────────────────

async function estimateFromText(description: string): Promise<MacroEstimate> {
  const { data, error } = await supabase.functions.invoke('estimate-meal-macros', {
    body: { mode: 'describe', description },
  })
  if (error) throw error
  return data as MacroEstimate
}

async function estimateFromPhoto(base64: string): Promise<MacroEstimate> {
  const { data, error } = await supabase.functions.invoke('estimate-meal-macros', {
    body: { mode: 'photo', base64 },
  })
  if (error) throw error
  return data as MacroEstimate
}

// ── Props ────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean
  slots: string[]
  defaultSlot: string
  onClose: () => void
  onLogged: () => void
}

// ── Component ────────────────────────────────────────────────────────────

export default function AILogModal({ visible, slots, defaultSlot, onClose, onLogged }: Props) {
  const { user } = useAuth()
  const [step, setStep] = useState<Step>('input')
  const [scanMode, setScanMode] = useState<ScanMode>('food')
  const [description, setDescription] = useState('')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [flashOn, setFlashOn] = useState(false)
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()

  // Review state
  const [mealName, setMealName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [selectedSlot, setSelectedSlot] = useState(defaultSlot)
  const [saving, setSaving] = useState(false)
  const [lastEditedMacro, setLastEditedMacro] = useState<'protein' | 'carbs' | 'fat' | null>(null)
  const originalMacros = useRef<{ calories: number; protein: number; carbs: number; fat: number } | null>(null)

  // Pulse animation for analyzing step
  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    setSelectedSlot(defaultSlot)
  }, [defaultSlot])

  useEffect(() => {
    if (step !== 'analyzing') return
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ]),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [step])

  const reset = () => {
    setStep('input')
    setDescription('')
    setImageUri(null)
    setImageBase64(null)
    setMealName('')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
    setSaving(false)
  }

  const handleClose = () => { reset(); onClose() }

  // Request camera permission on mount
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission()
    }
  }, [visible])

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
        setImageUri(fixed.uri)
        setImageBase64(fixed.base64 ?? null)
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
      setImageUri(result.assets[0].uri)
      setImageBase64(result.assets[0].base64 ?? null)
    }
  }

  const analyze = async () => {
    const hasText = description.trim().length > 0
    const hasPhoto = !!imageBase64
    if (!hasText && !hasPhoto) return

    setStep('analyzing')
    try {
      // Prefer photo if available, fall back to text
      const estimate = hasPhoto
        ? await estimateFromPhoto(imageBase64!)
        : await estimateFromText(description.trim())

      setMealName(estimate.name)
      setCalories(String(estimate.calories))
      setProtein(String(estimate.protein))
      setCarbs(String(estimate.carbs))
      setFat(String(estimate.fat))
      originalMacros.current = {
        calories: estimate.calories,
        protein: estimate.protein,
        carbs: estimate.carbs,
        fat: estimate.fat,
      }
      setStep('review')
    } catch {
      Alert.alert('Analysis failed', 'Could not estimate macros. Try again with a clearer description.')
      setStep('input')
    }
  }

  const saveLog = async () => {
    if (!user || !mealName.trim()) return
    setSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const cals = parseInt(calories) || 0
    const prot = parseInt(protein) || 0
    const crbs = parseInt(carbs) || 0
    const ft = parseInt(fat) || 0
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: mealName.trim(),
      calories: cals,
      protein: prot,
      carbs: crbs,
      fat: ft,
      slot: selectedSlot,
      logged_at: today,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    trackMealLogged(selectedSlot, cals, prot)
    onLogged()
    handleClose()
  }

  const canAnalyze = !!imageUri || description.trim().length > 0

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

          {/* ── Input step ── */}
          {step === 'input' && (
            <View style={styles.step}>

              {/* Inline camera viewfinder */}
              {!imageUri && (
                <View style={styles.cameraContainer}>
                  {permission?.granted ? (
                    <CameraView
                      ref={cameraRef}
                      style={styles.camera}
                      facing="back"
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
                    <Text style={styles.cameraTitle}>Pantry</Text>
                    <View style={{ width: 36 }} />
                  </View>
                </View>
              )}

              {/* Captured photo preview + describe */}
              {imageUri && (
                <View style={{ flex: 1 }}>
                  <View style={[styles.cameraContainer, { flex: 3 }]}>
                    <Image source={{ uri: imageUri }} style={styles.camera} resizeMode="cover" />
                    <View style={styles.cameraTopBar}>
                      <TouchableOpacity style={styles.cameraCloseBtn} onPress={handleClose}>
                        <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                      </TouchableOpacity>
                      <Text style={styles.cameraTitle}>Pantry</Text>
                      <View style={{ width: 36 }} />
                    </View>
                    <TouchableOpacity style={styles.retakeBadge} onPress={() => { setImageUri(null); setImageBase64(null) }} activeOpacity={0.8}>
                      <Text style={styles.retakeBadgeText}>Retake</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.capturedDescribeArea}>
                    <Text style={styles.describeOrText}>Add details (optional)</Text>
                    <TextInput
                      style={styles.describeInputCompact}
                      placeholder="e.g. grilled, with rice, extra sauce..."
                      placeholderTextColor={COLORS.textMuted}
                      value={description}
                      onChangeText={setDescription}
                      multiline
                      returnKeyType="done"
                      blurOnSubmit
                    />
                  </View>
                </View>
              )}

              {/* Bottom controls */}
              <View style={styles.cameraBottom}>
                {/* Shutter + Gallery — when camera is live */}
                {!imageUri && (
                  <>
                    <View style={styles.modeTabs}>
                      <TouchableOpacity style={[styles.modeTab, styles.modeTabActive]} activeOpacity={0.8}>
                        <Camera size={18} stroke="#000" strokeWidth={2} />
                        <Text style={[styles.modeTabText, styles.modeTabTextActive]}>Scan Food</Text>
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
                  </>
                )}

                {/* Estimate button — after capture */}
                {imageUri && (
                  <TouchableOpacity
                    style={[styles.analyzeBtn, !canAnalyze && { opacity: 0.4 }]}
                    onPress={analyze}
                    activeOpacity={0.85}
                    disabled={!canAnalyze}
                  >
                    <Text style={styles.analyzeBtnText}>Estimate Macros</Text>
                    <ChevronRight size={18} stroke="#000000" strokeWidth={2.5} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* ── Analyzing step ── */}
          {step === 'analyzing' && (
            <View style={[styles.step, styles.centered]}>
              <View style={styles.pulseWrap}>
                <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
                <View style={styles.pulseCore}>
                  <ActivityIndicator color="#4ADE80" size="small" />
                </View>
              </View>
              <Text style={styles.analyzingTitle}>Estimating macros...</Text>
              <Text style={styles.analyzingSub}>
                {imageUri ? 'AI is analyzing your meal photo' : 'AI is calculating your macros'}
              </Text>
            </View>
          )}

          {/* ── Review step ── */}
          {step === 'review' && (
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              <View style={styles.step}>
                <View style={styles.topBar}>
                  <Text style={styles.topTitle}>Review & Log</Text>
                  <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                    <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.reviewSub}>AI estimate — tap any value to edit</Text>

                {/* Meal name */}
                <View style={styles.reviewField}>
                  <Text style={styles.reviewFieldLabel}>Meal Name</Text>
                  <TextInput
                    style={styles.reviewFieldInput}
                    value={mealName}
                    onChangeText={setMealName}
                    placeholderTextColor={COLORS.textMuted}
                    placeholder="Meal name"
                  />
                </View>

                {/* Macro grid */}
                <View style={styles.macroGrid}>
                  {[
                    { label: 'Calories', value: calories, onChange: setCalories, unit: 'kcal', color: '#FFFFFF', onBlur: () => {
                      const orig = originalMacros.current
                      if (!orig || orig.calories === 0) return
                      const newCal = parseInt(calories) || 0
                      if (newCal > 0 && newCal !== orig.calories) {
                        const ratio = newCal / orig.calories
                        setProtein(String(Math.round(orig.protein * ratio)))
                        setCarbs(String(Math.round(orig.carbs * ratio)))
                        setFat(String(Math.round(orig.fat * ratio)))
                      }
                    }},
                    { label: 'Protein', key: 'protein' as const, value: protein, onChange: (v: string) => { setProtein(v); setLastEditedMacro('protein') }, unit: 'g', color: '#4ADE80' },
                    { label: 'Carbs', key: 'carbs' as const, value: carbs, onChange: (v: string) => { setCarbs(v); setLastEditedMacro('carbs') }, unit: 'g', color: '#F59E0B' },
                    { label: 'Fat', key: 'fat' as const, value: fat, onChange: (v: string) => { setFat(v); setLastEditedMacro('fat') }, unit: 'g', color: '#60A5FA' },
                  ].map((m: any) => (
                    <View key={m.label} style={styles.macroCell}>
                      <View style={[styles.macroDot, { backgroundColor: m.color }]} />
                      <Text style={styles.macroCellLabel}>{m.label}</Text>
                      <View style={styles.macroCellInputRow}>
                        <TextInput
                          style={styles.macroCellInput}
                          value={m.value}
                          onChangeText={m.onChange}
                          onBlur={m.onBlur}
                          keyboardType="numeric"
                          placeholderTextColor={COLORS.textMuted}
                          placeholder="0"
                        />
                        <Text style={styles.macroCellUnit}>{m.unit}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Macro mismatch warning with suggestion for last edited macro */}
                {(() => {
                  const p = parseInt(protein) || 0
                  const c = parseInt(carbs) || 0
                  const f = parseInt(fat) || 0
                  const cal = parseInt(calories) || 0
                  const macroCals = p * 4 + c * 4 + f * 9
                  const diff = Math.abs(macroCals - cal)
                  if (cal === 0 && macroCals > 0) {
                    return (
                      <View style={styles.mismatchBanner}>
                        <Text style={styles.mismatchText}>
                          Calories are 0 but macros add up to {macroCals} kcal. Set calories or clear macros.
                        </Text>
                      </View>
                    )
                  }
                  if (cal > 0 && diff > 50 && lastEditedMacro) {
                    let sugLabel = lastEditedMacro
                    let sugValue = 0
                    let sugUnit = 'g'
                    let onApply = () => {}
                    if (lastEditedMacro === 'protein') {
                      sugValue = Math.max(0, Math.round((cal - (c * 4 + f * 9)) / 4))
                      onApply = () => { setProtein(String(sugValue)); setLastEditedMacro(null) }
                    } else if (lastEditedMacro === 'carbs') {
                      sugValue = Math.max(0, Math.round((cal - (p * 4 + f * 9)) / 4))
                      onApply = () => { setCarbs(String(sugValue)); setLastEditedMacro(null) }
                    } else if (lastEditedMacro === 'fat') {
                      sugValue = Math.max(0, Math.round((cal - (p * 4 + c * 4)) / 9))
                      onApply = () => { setFat(String(sugValue)); setLastEditedMacro(null) }
                    }
                    return (
                      <View style={styles.mismatchBanner}>
                        <Text style={styles.mismatchText}>
                          Macros add up to {macroCals} kcal ({macroCals > cal ? '+' : ''}{macroCals - cal} off).
                        </Text>
                        <TouchableOpacity style={styles.mismatchSuggest} onPress={onApply} activeOpacity={0.7}>
                          <Text style={styles.mismatchSuggestText}>
                            Set {sugLabel} to {sugValue}{sugUnit} to match →
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )
                  }
                  if (cal > 0 && diff > 50 && !lastEditedMacro) {
                    return (
                      <View style={styles.mismatchBanner}>
                        <Text style={styles.mismatchText}>
                          Macros add up to {macroCals} kcal ({macroCals > cal ? '+' : ''}{macroCals - cal} off). Adjust a macro to match.
                        </Text>
                      </View>
                    )
                  }
                  return null
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
                        <Text style={[styles.slotChipText, selectedSlot === s && styles.slotChipTextActive]}>
                          {s}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={[styles.analyzeBtn, (!mealName.trim() || saving || (() => {
                    const p = parseInt(protein) || 0, c = parseInt(carbs) || 0, f = parseInt(fat) || 0, cal = parseInt(calories) || 0
                    const macroCals = p * 4 + c * 4 + f * 9
                    if (cal === 0 && macroCals > 0) return true
                    if (cal > 0 && Math.abs(macroCals - cal) > 50) return true
                    return false
                  })()) && { opacity: 0.5 }]}
                  onPress={saveLog}
                  activeOpacity={0.85}
                  disabled={!mealName.trim() || saving || (() => {
                    const p = parseInt(protein) || 0, c = parseInt(carbs) || 0, f = parseInt(fat) || 0, cal = parseInt(calories) || 0
                    const macroCals = p * 4 + c * 4 + f * 9
                    if (cal === 0 && macroCals > 0) return true
                    if (cal > 0 && Math.abs(macroCals - cal) > 50) return true
                    return false
                  })()}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.analyzeBtnText}>Log Meal</Text>
                  }
                </TouchableOpacity>

                <View style={styles.reviewBottomLinks}>
                  <TouchableOpacity onPress={() => {
                    if (originalMacros.current) {
                      setCalories(String(originalMacros.current.calories))
                      setProtein(String(originalMacros.current.protein))
                      setCarbs(String(originalMacros.current.carbs))
                      setFat(String(originalMacros.current.fat))
                      setLastEditedMacro(null)
                    }
                  }} activeOpacity={0.7}>
                    <Text style={styles.backLinkText}>Reset macros</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setStep('input')} activeOpacity={0.7}>
                    <Text style={styles.backLinkText}>← Re-analyze</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

        </KeyboardAvoidingView>
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
    paddingBottom: 24,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
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

  // Mode toggle
  // Camera inline view
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
    top: 50,
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
  retakeBadge: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  retakeBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
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
  describeFullArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  capturedDescribeArea: {
    flex: 1,
    paddingHorizontal: 4,
    paddingTop: 12,
    gap: 6,
  },
  describeInputCompact: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: COLORS.textWhite,
    lineHeight: 20,
    minHeight: 44,
    maxHeight: 60,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  describeOrText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted, marginBottom: 4 },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 4,
    marginBottom: 28,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 11,
  },
  modeOptionActive: { backgroundColor: '#FFFFFF' },
  modeOptionText: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },
  modeOptionTextActive: { color: '#000000' },

  // Describe
  describeArea: { gap: 6, marginTop: 12 },
  inputLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  describeInput: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: COLORS.textWhite,
    lineHeight: 22,
    minHeight: 60,
    maxHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inputHint: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17 },

  // Photo
  photoArea: { flex: 1, gap: 16 },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 200,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderStyle: 'dashed',
  },
  photoPlaceholderText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  photoPreviewWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', minHeight: 200 },
  photoPreview: { width: '100%', height: '100%' },
  photoRetakeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  photoRetakeText: { fontSize: 13, color: COLORS.textWhite, fontWeight: '600' },
  photoButtons: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.textWhite },

  // Analyze button
  analyzeBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 20,
  },
  analyzeBtnText: { fontSize: 16, fontWeight: '700', color: '#000000' },

  // Analyzing
  pulseWrap: { width: 90, height: 90, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  pulseRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(74,222,128,0.18)',
  },
  pulseCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  analyzingSub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center' },

  // Review
  reviewSub: { fontSize: 13, color: COLORS.textMuted, marginBottom: 20, marginTop: -12 },
  reviewField: {
    backgroundColor: '#111111',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  reviewFieldLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  reviewFieldInput: { fontSize: 16, fontWeight: '600', color: COLORS.textWhite, padding: 0 },

  calCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 14,
    gap: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  mismatchBanner: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  mismatchText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#EF4444',
    lineHeight: 17,
  },
  mismatchSuggest: {
    marginTop: 6,
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  mismatchSuggestText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4ADE80',
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
  macroCellInputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  macroCellInput: { fontSize: 22, fontWeight: '700', color: COLORS.textWhite, padding: 0, minWidth: 48 },
  macroCellUnit: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },

  slotLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted, marginBottom: 10 },
  slotScroll: { marginBottom: 4 },
  slotChips: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
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

  reviewBottomLinks: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16 },
  backLink: { alignItems: 'center', paddingVertical: 16 },
  backLinkText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
})
