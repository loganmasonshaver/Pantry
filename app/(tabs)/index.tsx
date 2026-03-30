import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Clock, RefreshCw, Utensils, ScanLine, Milk, UtensilsCrossed, Droplets, ChevronDown, Pencil, Plus, X, Trash2, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { COLORS } from '@/constants/colors'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackMealsGenerated, trackMealRegenerated, trackUpgradePromptShown } from '../../lib/analytics'
import AILogModal from '../../components/AILogModal'
import FoodSearchModal from '../../components/FoodSearchModal'
import EditPortionModal from '../../components/EditPortionModal'
import { useFocusEffect } from 'expo-router'
import { useMealSuggestions } from '../../lib/useMealSuggestions'
import { GeneratedMeal } from '../../lib/meals'
import { supabase } from '../../lib/supabase'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const { width } = Dimensions.get('window')

type LogEntry = {
  id: string
  name: string
  time: string
  calories: number
  protein: number
  carbs: number
  fat: number
  Icon: React.ElementType
  food_id: string | null
  serving_id: string | null
  quantity: number
}

type MealSlot = {
  id: string
  label: string
  entries: LogEntry[]
}

const INITIAL_SLOTS: MealSlot[] = [
  { id: 'breakfast', label: 'Breakfast', entries: [] },
  { id: 'lunch', label: 'Lunch', entries: [] },
  { id: 'dinner', label: 'Dinner', entries: [] },
]

function iconForSlot(label: string): React.ElementType {
  const l = label.toLowerCase()
  if (l.includes('breakfast') || l.includes('morning')) return Milk
  if (l.includes('lunch') || l.includes('midday')) return Utensils
  if (l.includes('dinner') || l.includes('supper') || l.includes('evening')) return UtensilsCrossed
  if (l.includes('snack')) return Droplets
  return Utensils
}

function MacroCard({
  calorieGoal,
  proteinGoal,
  carbsGoal,
  fatGoal,
  caloriesConsumed,
  proteinConsumed,
  carbsConsumed,
  fatConsumed,
}: {
  calorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
  caloriesConsumed: number
  proteinConsumed: number
  carbsConsumed: number
  fatConsumed: number
}) {
  const [expanded, setExpanded] = useState(false)

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpanded(prev => !prev)
  }

  const macroRows = [
    { label: 'Calories', consumed: caloriesConsumed, goal: calorieGoal, unit: 'kcal', color: '#FFFFFF' },
    { label: 'Protein',  consumed: proteinConsumed,  goal: proteinGoal, unit: 'g',    color: '#4ADE80' },
    { label: 'Carbs',    consumed: carbsConsumed,     goal: carbsGoal,   unit: 'g',    color: '#F59E0B' },
    { label: 'Fat',      consumed: fatConsumed,       goal: fatGoal,     unit: 'g',    color: '#60A5FA' },
  ]

  const cal  = macroRows[0]
  const prot = macroRows[1]

  return (
    <TouchableOpacity style={styles.macroCard} activeOpacity={0.85} onPress={toggle}>
      {!expanded && (
        <View style={styles.macroColRow}>
          <View style={styles.macroCol}>
            <Text style={styles.macroColLabel}>Total Daily Cals</Text>
            <Text style={styles.macroColValue}>
              <Text style={styles.macroColBold}>{cal.consumed.toLocaleString()} / {cal.goal.toLocaleString()} kcal</Text>
            </Text>
            <View style={styles.macroBarTrack}>
              <View style={[styles.macroBarFill, { width: `${Math.min(cal.consumed / cal.goal, 1) * 100}%`, backgroundColor: '#FFFFFF' }]} />
            </View>
            <Text style={styles.macroColRemaining}>{Math.max(cal.goal - cal.consumed, 0).toLocaleString()} kcal left</Text>
          </View>
          <View style={styles.macroColDivider} />
          <View style={styles.macroCol}>
            <Text style={styles.macroColLabel}>Protein</Text>
            <Text style={styles.macroColValue}>
              <Text style={styles.macroColBold}>{prot.consumed} / {prot.goal}g</Text>
            </Text>
            <View style={styles.macroBarTrack}>
              <View style={[styles.macroBarFill, { width: `${Math.min(prot.consumed / prot.goal, 1) * 100}%`, backgroundColor: '#4ADE80' }]} />
            </View>
          </View>
        </View>
      )}
      {expanded && (
        <View style={styles.macroExpandedBlock}>
          {macroRows.map((row, i) => (
            <View key={row.label}>
              {i > 0 && <View style={styles.macroExpandedDivider} />}
              <View style={styles.macroExpandedRow}>
                <Text style={styles.macroExpandedLabel}>{row.label}</Text>
                <View style={styles.macroExpandedBarTrack}>
                  <View style={[styles.macroBarFill, { width: `${Math.min(row.consumed / row.goal, 1) * 100}%`, backgroundColor: row.color }]} />
                </View>
                <Text style={styles.macroExpandedValue}>
                  <Text style={styles.macroExpandedBold}>{row.consumed.toLocaleString()}</Text>
                  <Text style={styles.macroExpandedUnit}> / {row.goal.toLocaleString()}{row.label === 'Calories' ? '' : row.unit}</Text>
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={styles.macroChevronRow}>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <ChevronDown size={14} stroke={COLORS.textMuted} strokeWidth={2} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

function ShimmerBox({ style }: { style: any }) {
  const shimmer = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start()
  }, [])
  return (
    <Animated.View style={[style, { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }]} />
  )
}

function MealCard({
  meal,
  rating,
  onRate,
}: {
  meal: GeneratedMeal
  rating: 1 | -1 | null
  onRate: (r: 1 | -1) => void
}) {
  const router = useRouter()
  return (
    <TouchableOpacity
      style={styles.mealCard}
      activeOpacity={0.75}
      onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })}
    >
      {meal.image && meal.image.startsWith('http') ? (
        <Image source={{ uri: meal.image }} style={styles.mealImageReal} resizeMode="cover" />
      ) : (
        <ShimmerBox style={styles.mealImagePlaceholder} />
      )}
      <View style={styles.mealInfo}>
        <Text style={styles.mealName}>{meal.name}</Text>
        <View style={styles.mealMeta}>
          <Clock size={13} stroke={COLORS.textMuted} strokeWidth={1.8} />
          <Text style={styles.mealMetaText}>{meal.prepTime} min prep</Text>
        </View>
        <View style={styles.mealMacros}>
          <Text style={styles.mealMacroText}>
            <Text style={styles.mealMacroBold}>{meal.calories} kcal</Text>
          </Text>
          <View style={styles.macroDot} />
          <Text style={styles.mealMacroText}>
            <Text style={styles.mealMacroBold}>{meal.protein}g</Text> Protein
          </Text>
        </View>
      </View>
      <View style={styles.ratingBtns}>
        <TouchableOpacity
          style={[styles.ratingBtn, rating === 1 && styles.ratingBtnUp]}
          onPress={(e) => { e.stopPropagation(); onRate(1) }}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
        >
          <ThumbsUp size={15} stroke={rating === 1 ? '#4ADE80' : COLORS.textMuted} strokeWidth={2} fill={rating === 1 ? 'rgba(74,222,128,0.15)' : 'none'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ratingBtn, rating === -1 && styles.ratingBtnDown]}
          onPress={(e) => { e.stopPropagation(); onRate(-1) }}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <ThumbsDown size={15} stroke={rating === -1 ? '#EF4444' : COLORS.textMuted} strokeWidth={2} fill={rating === -1 ? 'rgba(239,68,68,0.15)' : 'none'} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

function SlotCard({
  slot,
  expanded,
  onToggle,
  onDeleteEntry,
  onEditEntry,
  onRemoveSlot,
  onLog,
}: {
  slot: MealSlot
  expanded: boolean
  onToggle: () => void
  onDeleteEntry: (entryId: string) => void
  onEditEntry: (entry: LogEntry) => void
  onRemoveSlot: () => void
  onLog: () => void
}) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState(false)
  const slotCal = slot.entries.reduce((s, e) => s + e.calories, 0)

  return (
    <View style={styles.slotCard}>
      <TouchableOpacity
        style={styles.slotHeader}
        onPress={pendingDelete ? undefined : onToggle}
        onLongPress={() => setPendingDelete(true)}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <Text style={styles.slotLabel}>{slot.label}</Text>
        {pendingDelete ? (
          <View style={styles.slotDeleteRow}>
            <TouchableOpacity onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onRemoveSlot() }} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.slotRemoveText}>Remove Slot</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPendingDelete(false)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.slotCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.slotHeaderRight}>
            <Text style={styles.slotCal}>{slot.entries.length === 0 ? 'Empty' : `${slotCal} kcal`}</Text>
            <ChevronDown size={16} stroke={COLORS.textMuted} strokeWidth={2} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
          </View>
        )}
      </TouchableOpacity>
      {expanded && slot.entries.length > 0 && (
        <View style={styles.slotEntries}>
          {slot.entries.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <View style={styles.slotDivider} />}
              <Swipeable
                renderRightActions={() => (
                  <TouchableOpacity style={styles.deleteAction} onPress={() => onDeleteEntry(entry.id)} activeOpacity={0.8}>
                    <Trash2 size={18} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                )}
                overshootRight={false}
              >
                <TouchableOpacity style={styles.logCard} activeOpacity={0.7} onPress={() => onEditEntry(entry)}>
                  <View style={styles.logIconCircle}>
                    <entry.Icon size={12} stroke="#888888" strokeWidth={1.8} />
                  </View>
                  <View style={styles.logInfo}>
                    <Text style={styles.logName}>{entry.name}</Text>
                    <Text style={styles.logTime}>{entry.time}</Text>
                  </View>
                  <View style={styles.logMacros}>
                    <Text style={styles.logCal}>{entry.calories} kcal</Text>
                    <Text style={styles.logPro}>{entry.protein}g protein</Text>
                  </View>
                </TouchableOpacity>
              </Swipeable>
            </View>
          ))}
        </View>
      )}
      {expanded && slot.entries.length === 0 && (
        <View style={styles.slotEmpty}>
          <Text style={styles.slotEmptyText}>Nothing logged yet</Text>
          <TouchableOpacity style={styles.slotLogBtn} onPress={onLog} activeOpacity={0.7}>
            <Plus size={14} stroke="#4ADE80" strokeWidth={2} />
            <Text style={styles.slotLogBtnText}>Log</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

export default function HomeScreen() {
  const { user } = useAuth()
  const router = useRouter()
  const { isPremium } = usePremium()
  const { registerPlacement } = useSuperwall()
  const [mealMode, setMealMode] = useState<'cookNow' | 'mealPlan'>('cookNow')
  const cookNow = useMealSuggestions(user?.id, isPremium, 'cookNow')
  const mealPlan = useMealSuggestions(user?.id, isPremium, 'mealPlan')
  const { meals, loading, error, regenerate } = mealMode === 'cookNow' ? cookNow : mealPlan

  const ESSENTIAL_STAPLES = [
    'salt', 'pepper', 'olive oil', 'garlic', 'butter', 'onion',
    'soy sauce', 'eggs', 'rice', 'flour', 'sugar', 'milk',
    'paprika', 'cumin', 'chili powder', 'oregano', 'lemon', 'vinegar',
  ]
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  const [missingStaples, setMissingStaples] = useState<string[]>([])
  const [staplesDismissed, setStaplesDismissed] = useState(false)

  // Fetch pantry names and compute missing staples
  useEffect(() => {
    if (!user) return
    supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
      .then(({ data }) => {
        const names = new Set((data ?? []).map(i => i.name.toLowerCase()))
        setPantryNames(names)
        const missing = ESSENTIAL_STAPLES.filter(s => !names.has(s))
        setMissingStaples(missing)
      })
  }, [user])

  const addStapleToPantry = async (name: string) => {
    if (!user) return
    setPantryNames(prev => { const n = new Set(prev); n.add(name); return n })
    setMissingStaples(prev => prev.filter(s => s !== name))
    const { data: existing } = await supabase.from('pantry_items').select('id').eq('user_id', user.id).ilike('name', name).limit(1)
    if (existing && existing.length > 0) {
      await supabase.from('pantry_items').update({ in_stock: true }).eq('id', existing[0].id)
    } else {
      await supabase.from('pantry_items').insert({ user_id: user.id, name, category: 'Condiments & Spices', in_stock: true })
    }
  }

  const addStapleToGrocery = async (name: string) => {
    if (!user) return
    setMissingStaples(prev => prev.filter(s => s !== name))
    await supabase.from('grocery_items').insert({ user_id: user.id, name, category: 'Condiments & Spices' })
  }

  const [showPrefBanner, setShowPrefBanner] = useState(false)
  const [showIntroPopup, setShowIntroPopup] = useState(false)
  const [calorieGoal, setCalorieGoal] = useState(2400)
  const [proteinGoal, setProteinGoal] = useState(180)
  const [carbsGoal, setCarbsGoal] = useState(250)
  const [fatGoal, setFatGoal] = useState(80)

  useEffect(() => {
    if (!loading && meals.length > 0) trackMealsGenerated(meals.length)
  }, [loading])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('food_prefs_banner_dismissed, food_intro_popup_dismissed, calorie_goal, protein_goal, carbs_goal, fat_goal')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data?.food_prefs_banner_dismissed) setShowPrefBanner(true)
        if (!data?.food_intro_popup_dismissed) setShowIntroPopup(true)
        if (data?.calorie_goal) setCalorieGoal(data.calorie_goal)
        if (data?.protein_goal) setProteinGoal(data.protein_goal)
        if (data?.carbs_goal) setCarbsGoal(data.carbs_goal)
        if (data?.fat_goal) setFatGoal(data.fat_goal)
      })
  }, [user])

  const dismissBanner = async () => {
    setShowPrefBanner(false)
    if (!user) return
    await supabase
      .from('profiles')
      .update({ food_prefs_banner_dismissed: true })
      .eq('id', user.id)
  }

  const dismissIntroPopup = async () => {
    setShowIntroPopup(false)
    if (!user) return
    await supabase
      .from('profiles')
      .update({ food_intro_popup_dismissed: true })
      .eq('id', user.id)
  }

  const rateMeal = async (meal: GeneratedMeal, rating: 1 | -1) => {
    if (!user) return
    // Toggle off if same rating tapped again
    const current = ratings[meal.id]
    const next = current === rating ? null : rating
    setRatings(prev => {
      const updated = { ...prev }
      if (next === null) delete updated[meal.id]
      else updated[meal.id] = next
      return updated
    })
    if (next === null) {
      await supabase.from('meal_ratings').delete()
        .eq('user_id', user.id).eq('meal_name', meal.name)
    } else {
      await supabase.from('meal_ratings').upsert({
        user_id: user.id,
        meal_name: meal.name,
        rating: next,
      }, { onConflict: 'user_id,meal_name' })
    }
  }

  const [mealsExpanded, setMealsExpanded] = useState(false)
  const chevronAnim = useRef(new Animated.Value(0)).current

  const toggleMeals = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    Animated.timing(chevronAnim, { toValue: mealsExpanded ? 0 : 1, duration: 250, useNativeDriver: true }).start()
    setMealsExpanded(prev => !prev)
  }

  const chevronRotation = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] })

  const [slots, setSlots] = useState<MealSlot[]>(INITIAL_SLOTS)
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set(['breakfast']))

  const fetchTodayLogs = useCallback(async () => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('meal_logs')
      .select('id, meal_name, calories, protein, carbs, fat, slot, created_at, food_id, serving_id, quantity')
      .eq('user_id', user.id)
      .eq('logged_at', today)
      .order('created_at', { ascending: true })
    if (!data) return

    const slotMap = new Map<string, LogEntry[]>()
    ;['Breakfast', 'Lunch', 'Dinner'].forEach(s => slotMap.set(s, []))

    for (const row of data) {
      const label = row.slot || 'Other'
      if (!slotMap.has(label)) slotMap.set(label, [])
      const time = new Date(row.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      slotMap.get(label)!.push({
        id: row.id,
        name: row.meal_name,
        time,
        calories: row.calories ?? 0,
        protein: row.protein ?? 0,
        carbs: row.carbs ?? 0,
        fat: row.fat ?? 0,
        Icon: iconForSlot(label),
        food_id: row.food_id ?? null,
        serving_id: row.serving_id ?? null,
        quantity: row.quantity ?? 1,
      })
    }

    const result: MealSlot[] = []
    const seen = new Set<string>()
    for (const label of ['Breakfast', 'Lunch', 'Dinner']) {
      result.push({ id: label.toLowerCase(), label, entries: slotMap.get(label) ?? [] })
      seen.add(label)
    }
    for (const [label, entries] of slotMap) {
      if (!seen.has(label)) {
        result.push({ id: label.toLowerCase().replace(/\s+/g, '-'), label, entries })
      }
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setSlots(result)
  }, [user?.id])

  useFocusEffect(useCallback(() => {
    fetchTodayLogs()
  }, [fetchTodayLogs]))

  const toggleSlot = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpandedSlots(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const deleteEntry = async (slotId: string, entryId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, entries: s.entries.filter(e => e.id !== entryId) } : s))
    await supabase.from('meal_logs').delete().eq('id', entryId)
  }

  const removeSlot = async (slotId: string) => {
    const slot = slots.find(s => s.id === slotId)
    setSlots(prev => prev.filter(s => s.id !== slotId))
    setExpandedSlots(prev => { const next = new Set(prev); next.delete(slotId); return next })
    if (slot && user) {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('meal_logs').delete()
        .eq('user_id', user.id)
        .eq('slot', slot.label)
        .eq('logged_at', today)
    }
  }

  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({})
  const [editEntry, setEditEntry] = useState<LogEntry | null>(null)

  const handleEntryUpdated = (logId: string, calories: number, protein: number) => {
    setSlots(prev => prev.map(s => ({
      ...s,
      entries: s.entries.map(e => e.id === logId ? { ...e, calories, protein } : e),
    })))
  }

  const [showAILogModal, setShowAILogModal] = useState(false)
  const [showFoodSearchModal, setShowFoodSearchModal] = useState(false)
  const [foodSearchSlot, setFoodSearchSlot] = useState('Breakfast')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newSlotName, setNewSlotName] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [logName, setLogName] = useState('')
  const [logCals, setLogCals] = useState('')
  const [logProtein, setLogProtein] = useState('')
  const [logCarbs, setLogCarbs] = useState('')
  const [logFat, setLogFat] = useState('')
  const [logSlot, setLogSlot] = useState('Breakfast')
  const [logSaving, setLogSaving] = useState(false)

  const confirmAddSlot = () => {
    const trimmed = newSlotName.trim()
    if (!trimmed) return
    const id = trimmed.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    setSlots(prev => [...prev, { id, label: trimmed, entries: [] }])
    setNewSlotName('')
    setShowAddModal(false)
  }

  const openLogModal = () => {
    setLogName('')
    setLogCals('')
    setLogProtein('')
    setLogCarbs('')
    setLogFat('')
    setLogSlot(slots[0]?.label ?? 'Breakfast')
    setShowLogModal(true)
  }

  const saveManualLog = async () => {
    const name = logName.trim()
    if (!name || !user) return
    setLogSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: name,
      calories: parseInt(logCals) || 0,
      protein: parseInt(logProtein) || 0,
      carbs: parseInt(logCarbs) || 0,
      fat: parseInt(logFat) || 0,
      slot: logSlot,
      logged_at: today,
    })
    setLogSaving(false)
    if (!error) {
      setShowLogModal(false)
      fetchTodayLogs()
    }
  }

  const allEntries = slots.flatMap(s => s.entries)
  const totalCal = allEntries.reduce((s, e) => s + e.calories, 0)
  const totalPro = allEntries.reduce((s, e) => s + e.protein, 0)
  const totalCarbs = allEntries.reduce((s, e) => s + e.carbs, 0)
  const totalFat = allEntries.reduce((s, e) => s + e.fat, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>
                {(user?.user_metadata?.full_name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={styles.hiText}>
                Hi, {user?.user_metadata?.full_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'}
              </Text>
              <Text style={styles.greetText}>Ready to eat well today?</Text>
            </View>
          </View>
        </View>

        {/* ── Food preferences one-time banner ── */}
        {showPrefBanner && (
          <TouchableOpacity
            style={styles.prefBanner}
            activeOpacity={0.85}
            onPress={() => {
              dismissBanner()
              router.push('/food-preferences')
            }}
          >
            <View style={styles.prefBannerText}>
              <Text style={styles.prefBannerTitle}>Not loving your suggestions?</Text>
              <Text style={styles.prefBannerSub}>Tell Pantry what to avoid →</Text>
            </View>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); dismissBanner() }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        <MacroCard
          calorieGoal={calorieGoal}
          proteinGoal={proteinGoal}
          carbsGoal={carbsGoal}
          fatGoal={fatGoal}
          caloriesConsumed={totalCal}
          proteinConsumed={totalPro}
          carbsConsumed={totalCarbs}
          fatConsumed={totalFat}
        />

        <View style={[styles.panel, !mealsExpanded && styles.panelCollapsed]}>
          <TouchableOpacity style={[styles.sectionHeader, mealsExpanded && styles.sectionHeaderExpanded]} onPress={toggleMeals} activeOpacity={0.7}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Suggested Meals</Text>
              {!mealsExpanded && (
                <Text style={styles.mealsCollapsedSub}>
                  {loading ? 'Generating...' : `${meals.length} meals ready`}
                </Text>
              )}
            </View>
            <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
              <ChevronDown size={20} stroke={COLORS.textMuted} strokeWidth={2} />
            </Animated.View>
          </TouchableOpacity>

          {mealsExpanded && (
            <>
              {/* Mode toggle */}
              <View style={styles.mealModeToggle}>
                <TouchableOpacity
                  style={[styles.mealModeBtn, mealMode === 'cookNow' && styles.mealModeBtnActive]}
                  onPress={() => setMealMode('cookNow')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mealModeBtnText, mealMode === 'cookNow' && styles.mealModeBtnTextActive]}>Cook Now</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mealModeBtn, mealMode === 'mealPlan' && styles.mealModeBtnActive]}
                  onPress={() => setMealMode('mealPlan')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mealModeBtnText, mealMode === 'mealPlan' && styles.mealModeBtnTextActive]}>Meal Plan</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.mealModeSub}>
                {mealMode === 'cookNow' ? 'Only uses ingredients in your pantry' : 'May include items you need to buy'}
              </Text>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="#4ADE80" size="large" />
                  <Text style={styles.loadingText}>
                    {mealMode === 'cookNow' ? 'Finding meals from your pantry...' : 'Planning meals for the week...'}
                  </Text>
                </View>
              ) : error ? (
                <View style={styles.loadingContainer}>
                  <Text style={styles.errorText}>Failed to generate meals</Text>
                  <TouchableOpacity style={styles.regenButton} onPress={regenerate} activeOpacity={0.8}>
                    <RefreshCw size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                    <Text style={styles.regenText}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.mealList}>
                    {meals.map((meal) => (
                      <MealCard
                        key={meal.id}
                        meal={meal}
                        rating={ratings[meal.id] ?? null}
                        onRate={(r) => rateMeal(meal, r)}
                      />
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.regenButton}
                    onPress={() => {
                      if (!isPremium) {
                        trackUpgradePromptShown('regen_limit')
                        Alert.alert(
                          'Upgrade to Premium',
                          'Free accounts get 1 set of suggestions per day. Upgrade for unlimited regeneration.',
                          [
                            { text: 'Not now', style: 'cancel' },
                            { text: 'Upgrade', onPress: () => {
                              registerPlacement('regen_limit')
                            }},
                          ]
                        )
                        return
                      }
                      trackMealRegenerated()
                      regenerate()
                    }}
                    activeOpacity={0.8}
                  >
                    <RefreshCw size={18} stroke={isPremium ? COLORS.textWhite : COLORS.textMuted} strokeWidth={2} />
                    <Text style={[styles.regenText, !isPremium && { color: COLORS.textMuted }]}>
                      {isPremium ? 'Regenerate' : 'Regenerate · Premium'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </View>

        {/* ── Missing staples nudge ── */}
        {missingStaples.length >= 3 && !staplesDismissed && !loading && (
          <View style={styles.staplesCard}>
            <View style={styles.staplesHeader}>
              <View>
                <Text style={styles.staplesTitle}>Missing kitchen basics?</Text>
                <Text style={styles.staplesSub}>Adding these helps us suggest tastier meals</Text>
              </View>
              <TouchableOpacity onPress={() => setStaplesDismissed(true)} activeOpacity={0.7}>
                <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
            {missingStaples.slice(0, 6).map(name => (
              <View key={name} style={styles.stapleRow}>
                <Text style={styles.stapleName}>{name}</Text>
                <View style={styles.stapleActions}>
                  <TouchableOpacity onPress={() => addStapleToPantry(name)} activeOpacity={0.7}>
                    <Text style={styles.stapleHaveIt}>I have this</Text>
                  </TouchableOpacity>
                  <Text style={{ color: '#333', fontSize: 11 }}>|</Text>
                  <TouchableOpacity onPress={() => addStapleToGrocery(name)} activeOpacity={0.7}>
                    <Text style={styles.stapleGrocery}>+ Grocery</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Today's Log</Text>
          </View>
          <TouchableOpacity style={styles.aiEstimateBtn} activeOpacity={0.85} onPress={() => setShowAILogModal(true)}>
            <ScanLine size={20} stroke="#000000" strokeWidth={2} />
            <Text style={styles.aiEstimateBtnText}>Estimate with AI</Text>
          </TouchableOpacity>

          {slots.map(slot => (
            <SlotCard
              key={slot.id}
              slot={slot}
              expanded={expandedSlots.has(slot.id)}
              onToggle={() => toggleSlot(slot.id)}
              onDeleteEntry={(entryId) => deleteEntry(slot.id, entryId)}
              onEditEntry={(entry) => setEditEntry(entry)}
              onRemoveSlot={() => removeSlot(slot.id)}
              onLog={() => { setFoodSearchSlot(slot.label); setShowFoodSearchModal(true) }}
            />
          ))}

          <TouchableOpacity style={styles.addSlotBtn} activeOpacity={0.6} onPress={() => setShowAddModal(true)}>
            <Plus size={15} stroke={COLORS.textMuted} strokeWidth={2} />
            <Text style={styles.addSlotText}>Add Meal</Text>
          </TouchableOpacity>

          <Text style={styles.logTotal}>
            Total today: {totalCal.toLocaleString()} kcal · {totalPro}g protein
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Meal Slot</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Pre-Workout, Evening Snack"
              placeholderTextColor={COLORS.textMuted}
              value={newSlotName}
              onChangeText={setNewSlotName}
              autoFocus
              onSubmitEditing={confirmAddSlot}
            />
            <TouchableOpacity style={styles.modalConfirm} activeOpacity={0.8} onPress={confirmAddSlot}>
              <Text style={styles.modalConfirmText}>Add Slot</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Manual Log Modal ── */}
      <Modal visible={showLogModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowLogModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log a Meal</Text>
              <TouchableOpacity onPress={() => setShowLogModal(false)} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Meal name"
              placeholderTextColor={COLORS.textMuted}
              value={logName}
              onChangeText={setLogName}
              autoFocus
            />

            <View style={styles.logModalRow}>
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Calories"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logCals}
                onChangeText={setLogCals}
              />
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Protein (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logProtein}
                onChangeText={setLogProtein}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Carbs (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logCarbs}
                onChangeText={setLogCarbs}
              />
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                placeholder="Fat (g)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={logFat}
                onChangeText={setLogFat}
              />
            </View>

            <View style={styles.logSlotRow}>
              {slots.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.logSlotChip, logSlot === s.label && styles.logSlotChipActive]}
                  onPress={() => setLogSlot(s.label)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.logSlotChipText, logSlot === s.label && styles.logSlotChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.modalConfirm, (!logName.trim() || logSaving) && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={saveManualLog}
              disabled={!logName.trim() || logSaving}
            >
              <Text style={styles.modalConfirmText}>{logSaving ? 'Saving...' : 'Log Meal'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── AI Log Modal ── */}
      <AILogModal
        visible={showAILogModal}
        slots={slots.map(s => s.label)}
        defaultSlot={slots[0]?.label ?? 'Breakfast'}
        onClose={() => setShowAILogModal(false)}
        onLogged={fetchTodayLogs}
      />

      {/* ── Food Search Modal (FatSecret) ── */}
      <FoodSearchModal
        visible={showFoodSearchModal}
        slots={slots.map(s => s.label)}
        defaultSlot={foodSearchSlot}
        onClose={() => setShowFoodSearchModal(false)}
        onLogged={fetchTodayLogs}
      />

      {/* ── Edit portion — reuse FoodSearchModal in edit mode ── */}
      {editEntry && editEntry.food_id && (
        <FoodSearchModal
          visible={!!editEntry}
          slots={slots.map(s => s.label)}
          defaultSlot={editEntry.name}
          onClose={() => { setEditEntry(null); fetchTodayLogs() }}
          onLogged={() => { setEditEntry(null); fetchTodayLogs() }}
          editLogId={editEntry.id}
          initialFoodId={editEntry.food_id ?? undefined}
          initialServingId={editEntry.serving_id ?? undefined}
          initialQuantity={editEntry.quantity}
          initialSlot={slots.find(s => s.entries.some(e => e.id === editEntry.id))?.label}
        />
      )}
      {/* Fallback for AI-logged entries (no food_id) */}
      {editEntry && !editEntry.food_id && (
        <EditPortionModal
          visible={!!editEntry}
          onClose={() => setEditEntry(null)}
          logId={editEntry.id}
          logName={editEntry.name}
          foodId={null}
          initialServingId={null}
          initialQuantity={editEntry.quantity}
          currentCalories={editEntry.calories}
          currentProtein={editEntry.protein}
          onUpdated={handleEntryUpdated}
        />
      )}

      {/* ── Food intro one-time popup ── */}
      <Modal visible={showIntroPopup} transparent animationType="fade">
        <View style={styles.introOverlay}>
          <View style={styles.introCard}>
            <Text style={styles.introEmoji}>🍽️</Text>
            <Text style={styles.introTitle}>What foods do you hate?</Text>
            <Text style={styles.introSub}>
              Tell Pantry what to avoid and we'll never suggest it again.
            </Text>
            <TouchableOpacity
              style={styles.introCtaBtn}
              activeOpacity={0.85}
              onPress={() => {
                dismissIntroPopup()
                router.push('/food-preferences')
              }}
            >
              <Text style={styles.introCtaText}>Set Food Preferences</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.introSkipBtn}
              activeOpacity={0.7}
              onPress={dismissIntroPopup}
            >
              <Text style={styles.introSkipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  prefBanner: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: 'rgba(0,201,167,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.3)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  prefBannerText: { flex: 1, gap: 2 },
  prefBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.1,
  },
  prefBannerSub: {
    fontSize: 13,
    color: '#00C9A7',
    fontWeight: '500',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  hiText: { fontSize: 20, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.3 },
  greetText: { fontSize: 14, color: COLORS.textDim, marginTop: 1 },
  macroCard: { marginHorizontal: 20, marginBottom: 24, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#1A1A1A', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 },
  macroColRow: { flexDirection: 'row', gap: 16 },
  macroCol: { flex: 1, gap: 6 },
  macroColDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 2 },
  macroColValue: { fontSize: 13, color: COLORS.textDim },
  macroColBold: { fontSize: 16, fontWeight: '700', color: COLORS.textWhite },
  macroColLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '500', marginBottom: 4 },
  macroColRemaining: { fontSize: 11, color: COLORS.textMuted, fontWeight: '400', marginTop: 5 },
  macroBarTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 2, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: 2 },
  macroChevronRow: { alignItems: 'center', marginTop: 10 },
  macroExpandedBlock: { marginTop: 14, gap: 0 },
  macroExpandedDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 8 },
  macroExpandedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  macroExpandedLabel: { width: 62, fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  macroExpandedBarTrack: { flex: 1, height: 5, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 3, overflow: 'hidden' },
  macroExpandedValue: { width: 100, fontSize: 12, color: COLORS.textMuted, textAlign: 'right' },
  macroExpandedBold: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  macroExpandedUnit: { fontSize: 12, fontWeight: '400', color: COLORS.textMuted },
  panel: { backgroundColor: COLORS.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginHorizontal: 20, minHeight: 500, paddingTop: 12, paddingHorizontal: 24, paddingBottom: 36 },
  panelCollapsed: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, minHeight: 0, paddingTop: 0, paddingBottom: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, marginBottom: 0 },
  sectionHeaderExpanded: { paddingBottom: 0, marginBottom: 20 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, letterSpacing: -0.4 },
  mealsCollapsedSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealList: { gap: 14, marginBottom: 28 },
  mealCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#EBEBEB', backgroundColor: COLORS.card, padding: 16, gap: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  mealImageReal: { width: 72, height: 72, borderRadius: 12 },
  mealImagePlaceholder: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#2C2C2C', alignItems: 'center', justifyContent: 'center' },
  mealInfo: { flex: 1, gap: 6 },
  ratingBtns: { flexDirection: 'column', gap: 8, alignItems: 'center' },
  ratingBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  ratingBtnUp: { backgroundColor: 'rgba(74,222,128,0.12)' },
  ratingBtnDown: { backgroundColor: 'rgba(239,68,68,0.12)' },
  mealName: { fontSize: 16, fontWeight: '700', color: COLORS.text, letterSpacing: -0.2 },
  mealMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealMetaText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealMacros: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealMacroText: { fontSize: 13, color: COLORS.text, fontWeight: '400' },
  mealMacroBold: { fontWeight: '700' },
  macroDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.textMuted },
  regenButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: COLORS.background, borderRadius: 16, paddingVertical: 18 },
  regenText: { color: COLORS.textWhite, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  mealModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 3,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  mealModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
  },
  mealModeBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  mealModeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  mealModeBtnTextActive: {
    color: '#000000',
  },
  mealModeSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  loadingContainer: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  loadingText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, color: '#EF4444', textAlign: 'center' },
  staplesCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  staplesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  staplesTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite },
  staplesSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  stapleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  stapleName: { fontSize: 14, fontWeight: '500', color: COLORS.textWhite, textTransform: 'capitalize' },
  stapleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stapleHaveIt: { fontSize: 12, fontWeight: '600', color: '#4ADE80' },
  stapleGrocery: { fontSize: 12, fontWeight: '600', color: '#00C9A7' },
  logSection: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 40, gap: 10 },
  logHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  aiEstimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#4ADE80',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  aiEstimateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  logTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.4 },
  logPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  logPillBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textWhite },
  slotCard: { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', overflow: 'hidden' },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  slotLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite },
  slotHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotCal: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  slotDeleteRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  slotRemoveText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  slotCancelText: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted },
  slotEntries: { paddingHorizontal: 12, paddingBottom: 12 },
  slotDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 4 },
  slotEmpty: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotEmptyText: { fontSize: 12, color: COLORS.textMuted },
  slotLogBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(74,222,128,0.1)', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  slotLogBtnText: { fontSize: 12, fontWeight: '600', color: '#4ADE80' },
  deleteAction: { width: 80, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  logCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 0, gap: 10, backgroundColor: '#1A1A1A' },
  logIconCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  logInfo: { flex: 1, gap: 2 },
  logName: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.1 },
  logTime: { fontSize: 11, color: COLORS.textMuted },
  logMacros: { alignItems: 'flex-end', gap: 2 },
  logCal: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  logPro: { fontSize: 11, color: COLORS.textMuted },
  addSlotBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addSlotText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  logTotal: { fontSize: 12, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: '#1A1A1A', borderRadius: 20, padding: 20, gap: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite },
  modalInput: { backgroundColor: '#2A2A2A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textWhite },
  modalConfirm: { backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 14, alignItems: 'center' },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  logModalRow: { flexDirection: 'row', gap: 10 },
  logSlotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  logSlotChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#2A2A2A' },
  logSlotChipActive: { backgroundColor: 'rgba(74,222,128,0.15)' },
  logSlotChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  logSlotChipTextActive: { color: '#4ADE80' },

  // Food intro popup
  introOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  introCard: {
    backgroundColor: '#111111',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    width: '100%',
    gap: 0,
  },
  introEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 10,
  },
  introSub: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  introCtaBtn: {
    backgroundColor: '#00C9A7',
    borderRadius: 30,
    paddingVertical: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: 12,
  },
  introCtaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  introSkipBtn: {
    paddingVertical: 8,
  },
  introSkipText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

})
