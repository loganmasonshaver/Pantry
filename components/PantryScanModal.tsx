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
  Image,
  Alert,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { X, ScanLine, Check, Plus, Zap, ImageIcon } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { usePremium } from '@/context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackUpgradePromptShown } from '@/lib/analytics'

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

const LOADING_MESSAGES = [
  { title: 'AI is scanning your kitchen...', sub: 'Looking at every shelf and corner' },
  { title: 'Detecting ingredients...', sub: 'Identifying each item in your photos' },
  { title: 'Reading labels & packaging...', sub: 'Checking brand names and product details' },
  { title: 'Identifying fresh produce...', sub: 'Spotting fruits, veggies, and herbs' },
  { title: 'Categorizing everything...', sub: 'Sorting items by grocery aisle' },
  { title: 'Almost ready...', sub: 'Putting the finishing touches together' },
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
  const [step, setStep] = useState(1)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [showDone, setShowDone] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])
  const [zones, setZones] = useState<ZoneGroup[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingMessageIdx, setLoadingMessageIdx] = useState(0)

  // Camera
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [flashOn, setFlashOn] = useState(false)

  const pulseScale   = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0.4)).current

  // Loading animation + actual AI scan
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

    const scanPhotos = async () => {
      const base64Images = photos.filter(p => p.base64).map(p => p.base64!)
      if (base64Images.length === 0) {
        setShowDone(true)
        return
      }
      if (!isPremium) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('pantry_scan_count')
          .eq('id', user!.id)
          .single()
        const count = profile?.pantry_scan_count ?? 0
        // free tier is capped at 3 pantry scans
        if (count >= 3) {
          trackUpgradePromptShown('scan_limit')
          await triggerUpgrade('pantry_scan_limit')
          handleClose()
          return
        }
        await supabase
          .from('profiles')
          .update({ pantry_scan_count: count + 1 })
          .eq('id', user!.id)
      }
      const ok = await requestConsent()
      if (!ok) { onClose(); return }
      try {
        const { data, error } = await supabase.functions.invoke('scan-pantry', {
          body: { images: base64Images },
        })
        if (error) throw error
        const result = data as { layout: string; zones: { zone: string; items: { name: string; category: string }[] }[] }
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
            }
            return detected
          })
          allItems.push(...zoneItems)
          zoneGroups.push({ zone: zoneData.zone, items: zoneItems })
        }

        setDetectedItems(allItems)
        setZones(zoneGroups)
      } catch (e: any) {
        Alert.alert('Scan failed', e.message || 'Failed to analyze photos')
      }
      setShowDone(true)
    }
    scanPhotos()

    return () => { loop.stop() }
  }, [step])

  // Cycle through loading messages while scan is in progress
  useEffect(() => {
    if (step !== 5 || showDone) return
    setLoadingMessageIdx(0)
    // rotate encouraging messages every 2.2s while AI processes
    const interval = setInterval(() => {
      setLoadingMessageIdx(prev => (prev + 1) % LOADING_MESSAGES.length)
    }, 2200)
    return () => clearInterval(interval)
  }, [step, showDone])

  // Request camera permission when modal opens
  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission()
    }
  }, [visible])

  const handleClose = () => {
    setStep(1)
    setPhotos([])
    setShowDone(false)
    setCustomLabel('')
    setShowCustomInput(false)
    setDetectedItems([])
    setZones([])
    setFlashOn(false)
    onClose()
  }

  const capturePhoto = async (label: string, next: number) => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 })
      if (photo) {
        const fixed = await ImageManipulator.manipulateAsync(
          photo.uri,
          [],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        )
        setPhotos(prev => [...prev, {
          id: String(Date.now()),
          label,
          uri: fixed.uri,
          base64: fixed.base64 ?? undefined,
        }])
      }
    } catch (e) {
      Alert.alert('Capture failed', 'Could not take photo.')
    }
    setStep(next)
  }

  const launchGallery = async (label: string, next: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photo access needed', 'Please allow photo library access in Settings.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotos(prev => [...prev, {
        id: String(Date.now()),
        label,
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 ?? undefined,
      }])
      setStep(next)
    }
  }

  const addExtraPhoto = async (label: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') return
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotos(prev => [...prev, {
        id: String(Date.now()),
        label,
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 ?? undefined,
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

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
                <View style={styles.cameraTopBar}>
                  <TouchableOpacity style={styles.cameraCloseBtn} onPress={handleClose}>
                    <X size={20} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                  <View style={styles.cameraTopCenter}>
                    <ProgressDots total={3} active={stepConfig.dotIndex} />
                  </View>
                  <View style={{ width: 36 }} />
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
          <View style={styles.step}>
            <TouchableOpacity style={[styles.closeBtn, styles.closeBtnAbs]} onPress={handleClose}>
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>

            {/* Centered loading indicator (fills available space) */}
            <View style={styles.loadingBody}>
              <View style={styles.pulseWrap}>
                <Animated.View
                  style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
                />
                <View style={styles.pulseCore}>
                  <ScanLine size={32} stroke="#4ADE80" strokeWidth={1.6} />
                </View>
              </View>
              <Text style={[styles.title, { textAlign: 'center', marginTop: 36 }]}>
                {showDone ? 'Scan complete' : LOADING_MESSAGES[loadingMessageIdx].title}
              </Text>
              <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8, paddingHorizontal: 12 }]}>
                {showDone ? `Found ${detectedItems.length} item${detectedItems.length === 1 ? '' : 's'} in your kitchen` : LOADING_MESSAGES[loadingMessageIdx].sub}
              </Text>
            </View>

            {/* View Results button (fixed at bottom) */}
            {showDone && (
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
          </View>
        )}

        {/* ── Step 5.5: Zone-based visual review ── */}
        {step === 55 && (
          <View style={styles.step}>
            <View style={styles.topBar}>
              <Text style={styles.topTitle}>Detected Items</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
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
                {detectedItems.length} item{detectedItems.length !== 1 ? 's' : ''} detected — tap X to remove
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
              <View style={{ height: 8 }} />
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                disabled={saving}
                activeOpacity={0.85}
                onPress={async () => {
                  if (!user) return
                  const selected = detectedItems.filter(i => i.checked)
                  if (selected.length === 0) { handleClose(); return }
                  setSaving(true)
                  const rows = selected.map(item => ({
                    user_id: user.id,
                    name: item.name,
                    category: item.category,
                    in_stock: true,
                  }))
                  const { error } = await supabase.from('pantry_items').insert(rows)
                  setSaving(false)
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
    top: 30,
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
})
