import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Dimensions,
  Image,
} from 'react-native'
let Haptics: any = null
try { Haptics = require('expo-haptics') } catch {}
const hapticSelection = () => Haptics?.selectionAsync?.().catch?.(() => {})
const hapticImpact = () => Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Medium).catch?.(() => {})
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Utensils } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { autoCategoryMatches } from '@/lib/categories'
import { MOCK_MEAL_DETAILS, MealDetail } from '@/constants/mock'
import { GeneratedMeal } from '../../lib/meals'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackMealViewed, trackMealSaved, trackMealSaveBlocked, trackMealLogged, trackUpgradePromptShown } from '../../lib/analytics'

type PortionMode = 'Visual' | 'Grams'

// Common cooking basics that everyone has — don't count as "missing"
const COOKING_BASICS = new Set(['salt', 'pepper', 'black pepper', 'water', 'cooking spray'])

function cleanIngredientName(name: string): string {
  return name.replace(/\s*\*\s*$/, '').trim()
}

function isNeedToBuy(name: string): boolean {
  return name.trim().endsWith('*')
}

// Check if an item is already covered by existing names
// "chicken breast" matches "chicken", "chicken" matches "chicken breast"
function isAlreadyInList(itemName: string, existingNames: Set<string>): boolean {
  const lower = cleanIngredientName(itemName).toLowerCase()
  for (const existing of existingNames) {
    if (lower === existing) return true
    if (lower.includes(existing) || existing.includes(lower)) return true
  }
  return false
}

function renderStepText(step: string) {
  // Strip "Step 1:", "Step 2:", etc. prefix since we show numbered circles
  const cleaned = step.replace(/^Step\s*\d+\s*:\s*/i, '')
  const parts = cleaned.split(/\*\*(.+?)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <Text key={i} style={{ fontWeight: '700', color: '#FFFFFF' }}>{part}</Text>
      : part
  )
}

export default function MealDetailScreen() {
  const { id, mealData } = useLocalSearchParams<{ id: string; mealData?: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium } = usePremium()
  const { registerPlacement } = useSuperwall()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logging, setLogging] = useState(false)
  const [logged, setLogged] = useState(false)
  const [portionMode, setPortionMode] = useState<PortionMode>('Visual')
  const [addedToGrocery, setAddedToGrocery] = useState<Set<string>>(new Set())
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  const [groceryNames, setGroceryNames] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
      .then(({ data }) => setPantryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
    supabase.from('grocery_items').select('name').eq('user_id', user.id)
      .then(({ data }) => setGroceryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
  }, [user])

  const addToGrocery = async (ingredientName: string) => {
    if (!user || addedToGrocery.has(ingredientName)) return
    setAddedToGrocery(prev => new Set(prev).add(ingredientName))
    await supabase.from('grocery_items').insert({
      user_id: user.id,
      name: ingredientName,
      meal: meal?.name ?? '',
      category: autoCategoryMatches(ingredientName)[0] || 'Other',
      checked: false,
    })
  }

  let meal: MealDetail | null = null
  if (mealData) {
    try {
      const generated: GeneratedMeal = JSON.parse(mealData)
      meal = {
        ...generated,
        ingredients: generated.ingredients.map((ing, i) => ({
          id: String(i),
          visual: ing.visual,
          grams: ing.grams,
          name: cleanIngredientName(ing.name),
          inPantry: true,
          needToBuy: isNeedToBuy(ing.name),
        })),
      }
    } catch {
      meal = MOCK_MEAL_DETAILS[id ?? ''] ?? null
    }
  } else {
    meal = MOCK_MEAL_DETAILS[id ?? ''] ?? null
  }

  const missingIngredients = meal?.ingredients.filter(
    i => !isAlreadyInList(i.name, pantryNames) && !COOKING_BASICS.has(i.name.toLowerCase())
  ) ?? []
  const missingNotInGrocery = missingIngredients.filter(
    i => !isAlreadyInList(i.name, new Set([...groceryNames, ...[...addedToGrocery].map(n => n.toLowerCase())]))
  )

  const addAllMissingToGrocery = async () => {
    if (!user || !meal) return
    const alreadyAdded = new Set([...groceryNames, ...[...addedToGrocery].map(n => n.toLowerCase())])
    const toAdd = missingIngredients.filter(i => !isAlreadyInList(i.name, alreadyAdded))
    if (toAdd.length === 0) {
      Alert.alert('Already on your list', 'All missing ingredients are already in your grocery list.')
      return
    }
    setAddedToGrocery(prev => {
      const next = new Set(prev)
      toAdd.forEach(i => next.add(i.name))
      return next
    })
    setGroceryNames(prev => {
      const next = new Set(prev)
      toAdd.forEach(i => next.add(i.name.toLowerCase()))
      return next
    })
    await supabase.from('grocery_items').insert(
      toAdd.map(i => ({
        user_id: user.id,
        name: i.name,
        meal: meal.name,
        category: autoCategoryMatches(i.name)[0] || 'Other',
        checked: false,
      }))
    )
    Alert.alert('Added to grocery list', `${toAdd.length} item${toAdd.length !== 1 ? 's' : ''} added`)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (meal) trackMealViewed(meal.name) }, [mealData, id])

  if (!meal) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.notFound}>Meal not found.</Text>
      </SafeAreaView>
    )
  }

  const showProteinWarning = meal.protein < 30

  async function handleSave() {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to save meals.')
      return
    }
    if (saved) return

    if (!isPremium) {
      const { count } = await supabase
        .from('saved_meals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(r => ({ count: r.count ?? 0 }))
      if (count >= 5) {
        trackUpgradePromptShown('meal_save_limit')
        trackMealSaveBlocked()
        Alert.alert(
          'Upgrade to Premium',
          'Free accounts can save up to 5 meals. Upgrade for unlimited saves.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Upgrade', onPress: () => {
              registerPlacement('meal_save_limit')
            }},
          ]
        )
        return
      }
    }

    setSaving(true)
    const { error } = await supabase.rpc('insert_saved_meal', {
      p_user_id: user.id,
      p_name: meal!.name,
      p_calories: meal!.calories,
      p_protein: meal!.protein,
      p_carbs: meal!.carbs,
      p_fat: meal!.fat,
      p_prep_time: meal!.prepTime ?? null,
      p_ingredients: meal!.ingredients,
      p_steps: meal!.steps,
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setSaved(true)
      trackMealSaved(meal!.name, meal!.calories, meal!.protein)
    }
  }

  const logToSlot = async (slot: string) => {
    if (!user || !meal) return
    setLogging(true)
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      slot,
      logged_at: today,
    })
    setLogging(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setLogged(true)
      trackMealLogged(slot, meal.calories, meal.protein)
    }
  }

  const SLOT_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
  const ITEM_HEIGHT = 50
  const [showSlotPicker, setShowSlotPicker] = useState(false)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0)
  const [customSlotName, setCustomSlotName] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const slotScrollRef = useRef<ScrollView>(null)
  const lastHapticIndex = useRef(-1)

  const handleLog = () => {
    if (!meal || logged) return
    setSelectedSlotIndex(0)
    setShowCustomInput(false)
    setCustomSlotName('')
    lastHapticIndex.current = -1
    setShowSlotPicker(true)
    setTimeout(() => slotScrollRef.current?.scrollTo({ y: 0, animated: false }), 50)
  }

  const onSlotScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    const index = Math.round(y / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(index, SLOT_OPTIONS.length - 1))
    if (clamped !== lastHapticIndex.current) {
      lastHapticIndex.current = clamped
      setSelectedSlotIndex(clamped)
      hapticSelection()
    }
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ChevronLeft size={24} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{meal.name}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ── */}
        {meal.image ? (
          <Image source={{ uri: meal.image }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={styles.hero}>
            <Utensils size={40} stroke="#555555" strokeWidth={1.5} />
          </View>
        )}

        {/* ── Macro bar ── */}
        {(() => {
          const calculatedCal = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9
          const diff = Math.abs(calculatedCal - meal.calories)
          const correctedCal = diff > 30 ? calculatedCal : meal.calories
          return (
            <View style={styles.macroBar}>
              {[
                { label: 'Calories', value: String(correctedCal), unit: 'kcal' },
                { label: 'Protein',  value: `${meal.protein}g`,    unit: ''     },
                { label: 'Carbs',    value: `${meal.carbs}g`,      unit: ''     },
                { label: 'Fat',      value: `${meal.fat}g`,        unit: ''     },
              ].map((stat, i, arr) => (
                <View key={stat.label} style={[styles.macroStat, i < arr.length - 1 && styles.macroStatBorder]}>
                  <Text style={styles.macroValue}>{stat.value}</Text>
                  <Text style={styles.macroLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )
        })()}

        {/* ── Protein warning ── */}
        {showProteinWarning && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>⚠ Add a protein source — this meal is light on protein</Text>
          </View>
        )}

        {/* ── Ingredients ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ingredients</Text>
            <View style={styles.pillToggle}>
              {(['Visual', 'Grams'] as PortionMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.pillOption, portionMode === mode && styles.pillOptionActive]}
                  onPress={() => setPortionMode(mode)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillOptionText, portionMode === mode && styles.pillOptionTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.ingredientList}>
            {meal.ingredients.map((ing, i) => {
              const inPantry = isAlreadyInList(ing.name, pantryNames)
              const isBasic = COOKING_BASICS.has(ing.name.toLowerCase())
              const needsBuy = (ing as any).needToBuy === true
              return (
                <View key={ing.id} style={[styles.ingredientRow, i < meal.ingredients.length - 1 && styles.ingredientBorder]}>
                  <Text style={styles.ingredientPortion}>
                    {portionMode === 'Visual' ? ing.visual : ing.grams}
                  </Text>
                  <View style={styles.ingredientRight}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    {inPantry ? (
                      <Text style={styles.inPantryLabel}>In pantry</Text>
                    ) : isBasic ? (
                      <Text style={styles.basicLabel}>Basic</Text>
                    ) : (
                      <View style={styles.ingredientActions}>
                        <TouchableOpacity onPress={() => {
                          if (!user) return
                          supabase.from('pantry_items').insert({ user_id: user.id, name: ing.name, category: autoCategoryMatches(ing.name)[0] || 'Other', in_stock: true })
                          setPantryNames(prev => { const n = new Set(prev); n.add(ing.name.toLowerCase()); return n })
                        }} activeOpacity={0.7}>
                          <Text style={styles.inPantryAction}>I have this</Text>
                        </TouchableOpacity>
                        <Text style={{ color: '#333', fontSize: 11 }}>|</Text>
                        <TouchableOpacity onPress={() => addToGrocery(ing.name)} activeOpacity={0.7}>
                          <Text style={[styles.groceryAction, addedToGrocery.has(ing.name) && { color: COLORS.textMuted }]}>
                            {addedToGrocery.has(ing.name) ? '✓ On list' : '+ Grocery list'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}
          </View>

        </View>

        {/* ── Steps ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <View style={styles.stepList}>
            {meal.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{renderStepText(step)}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* ── Fixed bottom buttons ── */}
      <View style={styles.bottomBar}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[styles.logButton, (logged || logging) && styles.logButtonDone]}
            activeOpacity={0.85}
            onPress={handleLog}
            disabled={logged || logging}
          >
            <Text style={styles.logButtonText}>
              {logging ? 'Logging…' : logged ? 'Logged ✓' : 'Log Meal'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, (saved || saving) && styles.saveButtonDone]}
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={saved || saving}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Slot picker modal ── */}
      <Modal visible={showSlotPicker} transparent animationType="slide" onRequestClose={() => setShowSlotPicker(false)}>
        <TouchableOpacity style={styles.slotOverlay} activeOpacity={1} onPress={() => setShowSlotPicker(false)}>
          <View style={styles.slotCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.slotTitle}>Log to which meal?</Text>

            {/* Scroll wheel */}
            <View style={styles.wheelContainer}>
              <View style={styles.wheelHighlight} pointerEvents="none" />
              <ScrollView
                ref={slotScrollRef}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}
                decelerationRate="fast"
                onScroll={onSlotScroll}
                scrollEventThrottle={16}
                contentContainerStyle={{ paddingVertical: ITEM_HEIGHT }}
              >
                {SLOT_OPTIONS.map((slot, i) => (
                  <View key={slot} style={styles.wheelItem}>
                    <Text style={[styles.wheelItemText, selectedSlotIndex === i && styles.wheelItemTextActive]}>
                      {slot}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Custom option */}
            {showCustomInput ? (
              <View style={styles.slotCustomRow}>
                <TextInput
                  style={styles.slotCustomInput}
                  placeholder="e.g. Post-workout"
                  placeholderTextColor={COLORS.textMuted}
                  value={customSlotName}
                  onChangeText={setCustomSlotName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (customSlotName.trim()) {
                      setShowSlotPicker(false)
                      logToSlot(customSlotName.trim())
                      setCustomSlotName('')
                    }
                  }}
                />
                <TouchableOpacity
                  style={[styles.slotCustomBtn, !customSlotName.trim() && { opacity: 0.4 }]}
                  disabled={!customSlotName.trim()}
                  onPress={() => {
                    setShowSlotPicker(false)
                    logToSlot(customSlotName.trim())
                    setCustomSlotName('')
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.slotCustomBtnText}>Log</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowCustomInput(true)} activeOpacity={0.7}>
                <Text style={styles.slotCustomLink}>+ Custom meal</Text>
              </TouchableOpacity>
            )}

            {/* Confirm */}
            <TouchableOpacity
              style={styles.slotConfirmBtn}
              onPress={() => {
                hapticImpact()
                setShowSlotPicker(false)
                logToSlot(SLOT_OPTIONS[selectedSlotIndex])
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.slotConfirmText}>Log to {SLOT_OPTIONS[selectedSlotIndex]}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  notFound: {
    color: COLORS.textWhite,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginHorizontal: 4,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // Hero
  hero: {
    height: 220,
    width: '100%',
    backgroundColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    height: 240,
    width: '100%',
  },

  // Macro bar
  macroBar: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  macroStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 18,
    gap: 5,
  },
  macroStatBorder: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  macroValue: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontSize: 11,
    color: COLORS.textDim,
    fontWeight: '500',
  },

  // Protein warning
  warningBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#2A1F00',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  warningText: {
    color: '#FFB020',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  // Sections
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
  },

  // Portion pill toggle
  pillToggle: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 3,
  },
  pillOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  pillOptionActive: {
    backgroundColor: COLORS.textWhite,
  },
  pillOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  pillOptionTextActive: {
    color: '#000000',
  },

  // Ingredients
  ingredientList: {
    backgroundColor: '#111111',
    borderRadius: 16,
    overflow: 'hidden',
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16,
  },
  ingredientBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  ingredientPortion: {
    width: 56,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
    paddingTop: 1,
  },
  ingredientRight: {
    flex: 1,
    gap: 3,
  },
  ingredientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  missingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF4444',
  },
  ingredientName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textWhite,
  },
  addToGrocery: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '500',
  },
  addToGroceryDone: {
    color: COLORS.textMuted,
  },
  nudgeBanner: {
    backgroundColor: 'rgba(0,201,167,0.08)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.25)',
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nudgeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  nudgeActionBtn: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.3)',
    backgroundColor: 'rgba(0,201,167,0.08)',
  },
  nudgeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#00C9A7',
  },
  inPantryLabel: {
    fontSize: 11,
    color: '#4ADE80',
    fontWeight: '600',
  },
  basicLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  needToBuyLabel: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '600',
  },
  ingredientActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inPantryAction: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4ADE80',
  },
  groceryAction: {
    fontSize: 11,
    fontWeight: '600',
    color: '#00C9A7',
  },

  // Slot picker
  slotOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  slotCard: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  slotTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    textAlign: 'center',
  },
  wheelContainer: {
    height: 150,
    overflow: 'hidden',
    position: 'relative',
  },
  wheelHighlight: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    height: 50,
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    zIndex: 1,
  },
  wheelItem: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontSize: 18,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.3)',
  },
  wheelItemTextActive: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  slotCustomLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4ADE80',
    textAlign: 'center',
  },
  slotCustomRow: {
    flexDirection: 'row',
    gap: 8,
  },
  slotCustomInput: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.textWhite,
  },
  slotCustomBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCustomBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  slotConfirmBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  slotConfirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },

  // Steps
  stepList: {
    gap: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 22,
    fontWeight: '400',
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  logButton: {
    flex: 2,
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButtonDone: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  logButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  saveButtonDone: {
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderColor: 'rgba(74,222,128,0.3)',
  },
  saveButtonText: {
    color: COLORS.textWhite,
    fontSize: 15,
    fontWeight: '700',
  },
})
