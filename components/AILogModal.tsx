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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { X, Camera, FileText, ImageIcon, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { trackMealLogged } from '@/lib/analytics'
// ── Types ────────────────────────────────────────────────────────────────

type MacroEstimate = {
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

type InputMode = 'describe' | 'photo'
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
  const [mode, setMode] = useState<InputMode>('describe')
  const [description, setDescription] = useState('')
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)

  // Review state
  const [mealName, setMealName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [selectedSlot, setSelectedSlot] = useState(defaultSlot)
  const [saving, setSaving] = useState(false)

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
    setMode('describe')
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
      setImageUri(result.assets[0].uri)
      setImageBase64(result.assets[0].base64 ?? null)
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
    if (mode === 'describe' && !description.trim()) return
    if (mode === 'photo' && !imageBase64) return

    setStep('analyzing')
    try {
      const estimate = mode === 'describe'
        ? await estimateFromText(description.trim())
        : await estimateFromPhoto(imageBase64!)

      setMealName(estimate.name)
      setCalories(String(estimate.calories))
      setProtein(String(estimate.protein))
      setCarbs(String(estimate.carbs))
      setFat(String(estimate.fat))
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
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: mealName.trim(),
      calories: cals,
      protein: prot,
      slot: selectedSlot,
      logged_at: today,
    })
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    trackMealLogged(selectedSlot, cals, prot)
    onLogged()
    handleClose()
  }

  const canAnalyze = mode === 'describe' ? description.trim().length > 0 : !!imageUri

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

          {/* ── Input step ── */}
          {step === 'input' && (
            <View style={styles.step}>
              <View style={styles.topBar}>
                <Text style={styles.topTitle}>Log with AI</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                  <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Mode toggle */}
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeOption, mode === 'describe' && styles.modeOptionActive]}
                  onPress={() => setMode('describe')}
                  activeOpacity={0.8}
                >
                  <FileText size={15} stroke={mode === 'describe' ? '#000' : COLORS.textMuted} strokeWidth={2} />
                  <Text style={[styles.modeOptionText, mode === 'describe' && styles.modeOptionTextActive]}>
                    Describe
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeOption, mode === 'photo' && styles.modeOptionActive]}
                  onPress={() => setMode('photo')}
                  activeOpacity={0.8}
                >
                  <Camera size={15} stroke={mode === 'photo' ? '#000' : COLORS.textMuted} strokeWidth={2} />
                  <Text style={[styles.modeOptionText, mode === 'photo' && styles.modeOptionTextActive]}>
                    Photo
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Describe mode */}
              {mode === 'describe' && (
                <View style={styles.describeArea}>
                  <Text style={styles.inputLabel}>What did you eat?</Text>
                  <TextInput
                    style={styles.describeInput}
                    placeholder={"e.g. 2 scrambled eggs, toast with butter,\nand a coffee with oat milk"}
                    placeholderTextColor={COLORS.textMuted}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    autoFocus
                    returnKeyType="done"
                    blurOnSubmit
                  />
                  <Text style={styles.inputHint}>Be as specific as you like — portions, ingredients, cooking method.</Text>
                </View>
              )}

              {/* Photo mode */}
              {mode === 'photo' && (
                <View style={styles.photoArea}>
                  {imageUri ? (
                    <TouchableOpacity style={styles.photoPreviewWrap} onPress={launchCamera} activeOpacity={0.9}>
                      <Image source={{ uri: imageUri }} style={styles.photoPreview} resizeMode="cover" />
                      <View style={styles.photoRetakeOverlay}>
                        <Text style={styles.photoRetakeText}>Tap to retake</Text>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Camera size={40} stroke="#333333" strokeWidth={1.5} />
                      <Text style={styles.photoPlaceholderText}>Photo of your meal</Text>
                    </View>
                  )}
                  <View style={styles.photoButtons}>
                    <TouchableOpacity style={styles.photoBtn} onPress={launchCamera} activeOpacity={0.85}>
                      <Camera size={17} stroke={COLORS.textWhite} strokeWidth={2} />
                      <Text style={styles.photoBtnText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoBtn} onPress={launchLibrary} activeOpacity={0.85}>
                      <ImageIcon size={17} stroke={COLORS.textWhite} strokeWidth={2} />
                      <Text style={styles.photoBtnText}>Library</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[styles.analyzeBtn, !canAnalyze && { opacity: 0.4 }]}
                onPress={analyze}
                activeOpacity={0.85}
                disabled={!canAnalyze}
              >
                <Text style={styles.analyzeBtnText}>Estimate Macros</Text>
                <ChevronRight size={18} stroke="#000" strokeWidth={2.5} />
              </TouchableOpacity>
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
                {mode === 'photo' ? 'AI is analyzing your meal photo' : 'AI is calculating your macros'}
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
                    { label: 'Calories', value: calories, onChange: setCalories, unit: 'kcal', color: '#FFFFFF' },
                    { label: 'Protein', value: protein, onChange: setProtein, unit: 'g', color: '#4ADE80' },
                    { label: 'Carbs', value: carbs, onChange: setCarbs, unit: 'g', color: '#F59E0B' },
                    { label: 'Fat', value: fat, onChange: setFat, unit: 'g', color: '#60A5FA' },
                  ].map(m => (
                    <View key={m.label} style={styles.macroCell}>
                      <View style={[styles.macroDot, { backgroundColor: m.color }]} />
                      <Text style={styles.macroCellLabel}>{m.label}</Text>
                      <View style={styles.macroCellInputRow}>
                        <TextInput
                          style={styles.macroCellInput}
                          value={m.value}
                          onChangeText={m.onChange}
                          keyboardType="numeric"
                          placeholderTextColor={COLORS.textMuted}
                          placeholder="0"
                        />
                        <Text style={styles.macroCellUnit}>{m.unit}</Text>
                      </View>
                    </View>
                  ))}
                </View>

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
                  style={[styles.analyzeBtn, (!mealName.trim() || saving) && { opacity: 0.5 }]}
                  onPress={saveLog}
                  activeOpacity={0.85}
                  disabled={!mealName.trim() || saving}
                >
                  {saving
                    ? <ActivityIndicator color="#000000" />
                    : <Text style={styles.analyzeBtnText}>Log Meal</Text>
                  }
                </TouchableOpacity>

                <TouchableOpacity style={styles.backLink} onPress={() => setStep('input')} activeOpacity={0.7}>
                  <Text style={styles.backLinkText}>← Re-analyze</Text>
                </TouchableOpacity>
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
  describeArea: { flex: 1, gap: 12 },
  inputLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  describeInput: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: COLORS.textWhite,
    lineHeight: 22,
    minHeight: 120,
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

  backLink: { alignItems: 'center', paddingVertical: 16 },
  backLinkText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
})
