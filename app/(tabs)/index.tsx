import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated as RNAnimated,
  Easing,
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
import { useScrollToTop } from '@react-navigation/native'
import { Clock, RefreshCw, Utensils, ScanLine, Milk, UtensilsCrossed, Droplets, ChevronDown, ChevronLeft, Pencil, Plus, X, Trash2, ChevronRight, ThumbsUp, ThumbsDown, Camera, Flame, Dumbbell } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackMealsGenerated, trackMealRegenerated, trackUpgradePromptShown } from '../../lib/analytics'
import AILogModal from '../../components/AILogModal'
import FoodSearchModal from '../../components/FoodSearchModal'
import EditPortionModal from '../../components/EditPortionModal'
import PantryScanModal from '../../components/PantryScanModal'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
  meal_data: any | null
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

function CalorieGauge({ consumed, goal }: { consumed: number; goal: number }) {
  const remaining = goal - consumed
  const isOver = remaining < 0
  const progress = goal > 0 ? Math.min(consumed / goal, 1) : 0
  const size = 170
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const animProgress = useRef(new RNAnimated.Value(0)).current
  const [displayRemaining, setDisplayRemaining] = useState(goal)
  const [displayOffset, setDisplayOffset] = useState(circumference)

  useEffect(() => {
    if (isOver) {
      // Over goal — show full red ring immediately, display how much over
      setDisplayRemaining(remaining)
      setDisplayOffset(0)
      return
    }
    animProgress.setValue(0)
    setDisplayRemaining(goal)
    setDisplayOffset(circumference)
    RNAnimated.timing(animProgress, { toValue: progress, duration: 1800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
    const listener = animProgress.addListener(({ value }) => {
      setDisplayRemaining(Math.round(goal - goal * value))
      setDisplayOffset(circumference * (1 - value))
    })
    return () => animProgress.removeListener(listener)
  }, [consumed, goal])

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <SvgCircle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.10)" strokeWidth={strokeWidth} fill="transparent" />
        <SvgCircle cx={size / 2} cy={size / 2} r={radius} stroke={isOver ? '#EF4444' : '#4ADE80'} strokeWidth={strokeWidth} fill="transparent"
          strokeDasharray={`${circumference}`} strokeDashoffset={isOver ? 0 : displayOffset} strokeLinecap="round" />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 38, fontWeight: '800', color: isOver ? '#EF4444' : COLORS.textWhite, letterSpacing: -1 }}>{isOver ? `-${Math.abs(remaining).toLocaleString()}` : displayRemaining.toLocaleString()}</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: isOver ? '#EF4444' : '#4ADE80', textTransform: 'uppercase', letterSpacing: 1.5 }}>{isOver ? 'OVER' : 'KCAL LEFT'}</Text>
      </View>
    </View>
  )
}

function MacroBar({ label, consumed, goal, color }: { label: string; consumed: number; goal: number; color: string }) {
  const progress = goal > 0 ? Math.min(consumed / goal, 1) : 0
  const animWidth = useRef(new RNAnimated.Value(0)).current

  useEffect(() => {
    animWidth.setValue(0)
    RNAnimated.timing(animWidth, { toValue: progress * 100, duration: 1800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [consumed, goal])

  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textWhite }}>{label}</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textWhite }}>{consumed}<Text style={{ color: COLORS.textMuted, fontWeight: '500' }}> / {goal}g</Text></Text>
      </View>
      <View style={{ height: 5, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 3, overflow: 'hidden' }}>
        {progress > 0 && <RNAnimated.View style={{ height: 5, backgroundColor: color, borderRadius: 3, width: animWidth.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />}
      </View>
    </View>
  )
}

function ShimmerBox({ style }: { style: any }) {
  const shimmer = useRef(new RNAnimated.Value(0)).current
  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        RNAnimated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start()
  }, [])
  return (
    <RNAnimated.View style={[style, { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }) }]} />
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
              <View style={styles.logCard}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} activeOpacity={0.7} onPress={() => {
                    if (entry.food_id) {
                      onEditEntry(entry)
                    } else if (entry.meal_data) {
                      router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify(entry.meal_data) }})
                    } else {
                      router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify({
                        name: entry.name, calories: entry.calories, protein: entry.protein,
                        carbs: entry.carbs, fat: entry.fat, ingredients: [], steps: [], image: null,
                      })}})
                    }
                  }}>
                    <View style={styles.logIconCircle} />
                    <View style={styles.logInfo}>
                      <Text style={styles.logName}>{entry.name}</Text>
                      <Text style={styles.logTime}>{entry.time}</Text>
                    </View>
                    <View style={styles.logMacros}>
                      <Text style={styles.logCal}>{entry.calories} kcal</Text>
                      <Text style={styles.logPro}>{entry.protein}g protein</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ padding: 8, marginLeft: 4 }}
                    activeOpacity={0.6}
                    onPress={() => onDeleteEntry(entry.id)}
                  >
                    <Trash2 size={16} stroke="#EF4444" strokeWidth={1.8} />
                  </TouchableOpacity>
              </View>
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
  const { isPremium, triggerUpgrade } = usePremium()
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
  const [pantryFetched, setPantryFetched] = useState(false)
  const [missingStaples, setMissingStaples] = useState<string[]>([])
  const [staplesDismissed, setStaplesDismissed] = useState(false)

  // Fetch pantry names and compute missing staples
  useEffect(() => {
    if (!user) return
    supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
      .then(({ data }) => {
        const names = new Set((data ?? []).map(i => i.name.toLowerCase()))
        setPantryNames(names)
        setPantryFetched(true)
        const missing = ESSENTIAL_STAPLES.filter(s => !names.has(s))
        setMissingStaples(missing)
      })
  }, [user])

  // Show scan CTA only after fetch completes and pantry is confirmed empty
  useEffect(() => {
    if (!pantryFetched) return
    if (pantryNames.size > 0) { setShowScanCta(false); return }
    AsyncStorage.getItem('pantry_scan_cta_dismissed').then(val => {
      if (!val) setShowScanCta(true)
    })
  }, [pantryFetched, pantryNames])

  const addStapleToPantry = async (name: string) => {
    if (!user) return
    setPantryNames(prev => { const n = new Set(prev); n.add(name); return n })
    setMissingStaples(prev => prev.filter(s => s !== name))
    const { data: existing } = await supabase.from('pantry_items').select('id').eq('user_id', user.id).ilike('name', name).limit(1)
    if (existing && existing.length > 0) {
      await supabase.from('pantry_items').update({ in_stock: true }).eq('id', existing[0].id)
    } else {
      await supabase.from('pantry_items').insert({ user_id: user.id, name, category: 'Spices & Seasonings', in_stock: true })
    }
  }

  const addStapleToGrocery = async (name: string) => {
    if (!user) return
    setMissingStaples(prev => prev.filter(s => s !== name))
    await supabase.from('grocery_items').insert({ user_id: user.id, name, category: 'Spices & Seasonings' })
  }

  const [showPrefBanner, setShowPrefBanner] = useState(false)
  const [showScanCta, setShowScanCta] = useState(false)
  const [showPantryScanFromHome, setShowPantryScanFromHome] = useState(false)
  const [trendingMeals, setTrendingMeals] = useState<any[]>([])

  // Fetch trending meals from cache (generated daily, kept 3 days for fallback)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]

    const mapRows = (rows: any[]) => rows.map(m => ({
      id: m.id, name: m.name, calories: m.calories, protein: m.protein,
      carbs: m.carbs, fat: m.fat, prepTime: m.prep_time,
      ingredients: m.ingredients, steps: m.steps, image: m.image,
      trend_source: m.trend_source,
    }))

    // Pull last 3 days' worth, newest first — gives us a deep enough pool even if today's
    // generation was thin. We sort/order client-side to prioritize today's meals.
    supabase.from('trending_meals')
      .select('*')
      .gte('generated_at', threeDaysAgo)
      .order('generated_at', { ascending: false })
      .order('id')
      .then(({ data }) => {
        const todayRows = (data ?? []).filter(r => r.generated_at === today)
        const olderRows = (data ?? []).filter(r => r.generated_at !== today)

        if (todayRows.length > 0) {
          // Show today's meals first; fall back to older days only if today has fewer than 4
          const combined = todayRows.length >= 4
            ? todayRows
            : [...todayRows, ...olderRows].slice(0, 10)
          setTrendingMeals(mapRows(combined))
        } else if (olderRows.length > 0) {
          // No meals for today yet — show yesterday's while we trigger fresh generation
          setTrendingMeals(mapRows(olderRows.slice(0, 10)))
          supabase.functions.invoke('generate-trending-meals').then(({ data: res }) => {
            if (res?.meals && res.meals.length > 0) {
              setTrendingMeals(res.meals.map((m: any) => ({
                id: m.id || String(Math.random()), name: m.name, calories: m.calories, protein: m.protein,
                carbs: m.carbs, fat: m.fat, prepTime: m.prepTime || m.prep_time,
                ingredients: m.ingredients, steps: m.steps, image: m.image || null,
                trend_source: m.trend_source,
              })))
            }
          })
        } else {
          // Completely empty — trigger fresh generation
          supabase.functions.invoke('generate-trending-meals').then(({ data: res }) => {
            if (res?.meals) {
              setTrendingMeals(res.meals.map((m: any) => ({
                id: m.id || String(Math.random()), name: m.name, calories: m.calories, protein: m.protein,
                carbs: m.carbs, fat: m.fat, prepTime: m.prepTime || m.prep_time,
                ingredients: m.ingredients, steps: m.steps, image: m.image || null,
                trend_source: m.trend_source,
              })))
            }
          })
        }
      })
  }, [])

  const [showIntroPopup, setShowIntroPopup] = useState(false)
  const [calorieGoal, setCalorieGoal] = useState(2400)
  const [proteinGoal, setProteinGoal] = useState(180)
  const [carbsGoal, setCarbsGoal] = useState(250)
  const [fatGoal, setFatGoal] = useState(80)
  const [foodDislikes, setFoodDislikes] = useState<string[]>([])
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([])

  // Keyword map for dietary restrictions → forbidden ingredient substrings for trending meal filtering
  const RESTRICTION_KEYWORDS: Record<string, string[]> = {
    vegetarian: ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal', 'pepperoni', 'prosciutto', 'salami', 'anchovies', 'tuna', 'salmon', 'shrimp', 'crab', 'lobster', 'fish', 'meat'],
    vegan: ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'fish', 'shrimp', 'tuna', 'salmon', 'crab', 'lobster', 'meat', 'egg', 'eggs', 'milk', 'cheese', 'butter', 'cream', 'yogurt', 'whey', 'honey'],
    'gluten-free': ['bread', 'pasta', 'flour', 'wheat', 'barley', 'rye', 'soy sauce', 'breadcrumbs', 'croutons', 'tortilla', 'noodles', 'ramen', 'udon', 'couscous'],
    'dairy-free': ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'whey', 'ghee', 'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'brie', 'feta'],
    'nut-free': ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'nut butter'],
    'nut allergy': ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'nut butter'],
    'peanut allergy': ['peanut', 'peanut butter', 'peanut sauce'],
    pescatarian: ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal'],
    halal: ['pork', 'bacon', 'ham', 'prosciutto', 'lard', 'pepperoni', 'salami'],
    kosher: ['pork', 'bacon', 'ham', 'shrimp', 'lobster', 'crab', 'shellfish'],
  }

  const trendingMealPassesFilters = (meal: any): boolean => {
    const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
    const mealNameLower = (meal.name ?? '').toLowerCase()
    for (const dislike of foodDislikes) {
      const d = dislike.toLowerCase()
      if (ingredientNames.some((ing: string) => ing.includes(d)) || mealNameLower.includes(d)) return false
    }
    for (const restriction of dietaryRestrictions) {
      const keywords = RESTRICTION_KEYWORDS[restriction.toLowerCase()] ?? []
      for (const kw of keywords) {
        if (ingredientNames.some((ing: string) => ing.includes(kw)) || mealNameLower.includes(kw)) return false
      }
    }
    return true
  }

  useEffect(() => {
    if (!loading && meals.length > 0) trackMealsGenerated(meals.length)
  }, [loading])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('food_prefs_banner_dismissed, food_intro_popup_dismissed, calorie_goal, protein_goal, carbs_goal, fat_goal, food_dislikes, dietary_restrictions')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data?.food_prefs_banner_dismissed) setShowPrefBanner(true)
        if (!data?.food_intro_popup_dismissed) setShowIntroPopup(true)
        if (data?.calorie_goal) setCalorieGoal(data.calorie_goal)
        if (data?.protein_goal) setProteinGoal(data.protein_goal)
        if (data?.carbs_goal) setCarbsGoal(data.carbs_goal)
        if (data?.fat_goal) setFatGoal(data.fat_goal)
        if (data?.food_dislikes) setFoodDislikes(data.food_dislikes ?? [])
        if (data?.dietary_restrictions) setDietaryRestrictions((data.dietary_restrictions ?? []).filter((r: string) => r !== 'None'))
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
      // Show learning feedback so user sees the AI improving
      showRatingToast(next === 1 ? "Got it — we'll suggest more like this" : "Noted — we'll skip this kind of meal")
    }
  }

  const showRatingToast = (message: string) => {
    setRatingToastMessage(message)
    setShowRatingToast_(true)
    RNAnimated.sequence([
      RNAnimated.timing(ratingToastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      RNAnimated.delay(1800),
      RNAnimated.timing(ratingToastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowRatingToast_(false))
  }

  const [mealsExpanded, setMealsExpanded] = useState(false)
  const chevronAnim = useRef(new RNAnimated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)
  useScrollToTop(scrollRef)

  const toggleMeals = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    RNAnimated.timing(chevronAnim, { toValue: mealsExpanded ? 0 : 1, duration: 250, useNativeDriver: true }).start()
    setMealsExpanded(prev => !prev)
  }

  const chevronRotation = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] })

  const [slots, setSlots] = useState<MealSlot[]>(INITIAL_SLOTS)
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set(['breakfast']))
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  const goBackDay = () => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    setSelectedDate(d.toISOString().split('T')[0])
  }
  const goForwardDay = () => {
    if (isToday) return
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const fetchTodayLogs = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('meal_logs')
      .select('id, meal_name, calories, protein, carbs, fat, slot, created_at, food_id, serving_id, quantity, meal_data')
      .eq('user_id', user.id)
      .eq('logged_at', selectedDate)
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
        meal_data: row.meal_data ?? null,
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
  }, [user?.id, selectedDate])

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
  const [showRatingToast_, setShowRatingToast_] = useState(false)
  const [ratingToastMessage, setRatingToastMessage] = useState('')
  const ratingToastOpacity = useRef(new RNAnimated.Value(0)).current
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
    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: name,
      calories: parseInt(logCals) || 0,
      protein: parseInt(logProtein) || 0,
      carbs: parseInt(logCarbs) || 0,
      fat: parseInt(logFat) || 0,
      slot: logSlot,
      logged_at: selectedDate,
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
      {/* ── Rating feedback toast ── */}
      {showRatingToast_ && (
        <RNAnimated.View style={[styles.ratingToast, { opacity: ratingToastOpacity }]}>
          <Text style={styles.ratingToastText}>{ratingToastMessage}</Text>
        </RNAnimated.View>
      )}
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.brandText}>Pantry</Text>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>
                {(user?.user_metadata?.full_name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.headerGreeting}>
            <Text style={styles.hiText}>
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {user?.user_metadata?.full_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'}
            </Text>
            <Text style={styles.greetText}>
              {totalCal === 0 ? "Let's start tracking today" : totalCal >= calorieGoal ? 'Goal reached! Nice work' : 'Ready for your next meal?'}
            </Text>
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

        {/* ── Day navigation ── */}
        <View style={styles.dayNav}>
          <TouchableOpacity onPress={goBackDay} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft size={20} stroke={COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedDate(new Date().toISOString().split('T')[0])} activeOpacity={0.7}>
            <Text style={styles.dayNavText}>
              {isToday ? 'Today' : (() => {
                const d = new Date(selectedDate + 'T12:00:00')
                const yesterday = new Date()
                yesterday.setDate(yesterday.getDate() - 1)
                if (selectedDate === yesterday.toISOString().split('T')[0]) return 'Yesterday'
                return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              })()}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goForwardDay} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronRight size={20} stroke={isToday ? '#333' : COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* ── Hero Dashboard Card ── */}
        <View style={styles.heroCard}>
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <CalorieGauge consumed={totalCal} goal={calorieGoal} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Flame size={13} stroke="#4ADE80" strokeWidth={2} fill="rgba(74,222,128,0.25)" />
              <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textMuted }}>
                {totalCal > 0 ? `${totalCal.toLocaleString()} consumed` : 'Keep logging!'}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <MacroBar label="Protein" consumed={totalPro} goal={proteinGoal} color="#4ADE80" />
            <MacroBar label="Carbs" consumed={totalCarbs} goal={carbsGoal} color="#F59E0B" />
            <MacroBar label="Fat" consumed={totalFat} goal={fatGoal} color="#60A5FA" />
          </View>
        </View>

        {/* ── First-time pantry scan CTA ── */}
        {showScanCta && (
          <TouchableOpacity
            style={styles.scanCtaCard}
            activeOpacity={0.85}
            onPress={() => setShowPantryScanFromHome(true)}
          >
            <View style={styles.scanCtaInner}>
              <View style={styles.scanCtaIconWrap}>
                <Camera size={22} stroke="#4ADE80" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scanCtaTitle}>See what you can cook tonight</Text>
                <Text style={styles.scanCtaSub}>Scan your pantry in 10 seconds</Text>
              </View>
              <ChevronRight size={16} stroke="#4ADE80" strokeWidth={2} />
            </View>
            <TouchableOpacity
              style={styles.scanCtaLaterWrap}
              onPress={async (e) => {
                e.stopPropagation()
                setShowScanCta(false)
                await AsyncStorage.setItem('pantry_scan_cta_dismissed', '1')
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.scanCtaLaterText}>Later</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* ── Suggested For You — Horizontal Scroll ── */}
        <View style={{ marginBottom: 28 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginBottom: 16 }}>
            <Text style={styles.sectionTitle}>Suggested For You</Text>
            <TouchableOpacity
              onPress={() => {
                if (!isPremium) {
                  trackUpgradePromptShown('regen_limit')
                  Alert.alert('Upgrade to Premium', 'Free accounts get 1 set of suggestions per day.', [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Upgrade', onPress: () => triggerUpgrade('regen_limit') },
                  ])
                  return
                }
                trackMealRegenerated()
                regenerate()
              }}
              activeOpacity={0.7}
            >
              <RefreshCw size={16} stroke="#4ADE80" strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#4ADE80" size="large" />
              <Text style={styles.loadingText}>Finding meals from your pantry...</Text>
            </View>
          ) : error ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.errorText}>Failed to generate meals</Text>
              <TouchableOpacity style={styles.regenButton} onPress={regenerate} activeOpacity={0.8}>
                <RefreshCw size={18} stroke="#000" strokeWidth={2} />
                <Text style={styles.regenText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}>
              {meals.map((meal) => (
                <TouchableOpacity
                  key={meal.id}
                  style={styles.heroMealCard}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })}
                >
                  {meal.image && meal.image.startsWith('http') ? (
                    <Image source={{ uri: meal.image }} style={styles.heroMealImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.heroMealImage, { backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' }]}>
                      <Utensils size={32} stroke="#555" strokeWidth={1.5} />
                    </View>
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
                    locations={[0.3, 0.6, 1]}
                    style={styles.heroMealGradient}
                  />
                  <View style={styles.heroMealContent}>
                    <Text style={styles.heroMealName} numberOfLines={2}>{meal.name}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                      {meal.prepTime > 0 && (
                        <View style={[styles.heroMealPill, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.25)' }]}>
                          <Text style={[styles.heroMealPillText, { color: '#F59E0B' }]}>{meal.prepTime} MIN</Text>
                        </View>
                      )}
                      <View style={[styles.heroMealPill, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' }]}>
                        <Text style={styles.heroMealPillText}>{meal.calories} CAL</Text>
                      </View>
                      {meal.protein > 0 && (
                        <View style={[styles.heroMealPill, { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.25)' }]}>
                          <Text style={[styles.heroMealPillText, { color: '#4ADE80' }]}>{meal.protein}P</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── Trending Now ── */}
        {(() => {
          const filteredTrending = trendingMeals.filter(trendingMealPassesFilters)
          if (filteredTrending.length === 0) return null
          return (
        <View style={{ marginBottom: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginBottom: 16 }}>
            <Flame size={14} stroke="#EF4444" strokeWidth={2} fill="#EF4444" />
            <Text style={styles.sectionTitle}>Trending</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
            {filteredTrending.map((meal, i) => (
              <TouchableOpacity
                key={`trending-${meal.id}-${i}`}
                style={styles.trendingCard}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify({ ...meal, image: meal.image }) } })}
              >
                {meal.image && meal.image.startsWith('http') ? (
                  <Image source={{ uri: meal.image }} style={styles.trendingImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.trendingImage, { backgroundColor: '#2A2A2A' }]} />
                )}
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} locations={[0.2, 0.9]} style={styles.trendingGradient} />
                <View style={styles.trendingContent}>
                  <Text style={styles.trendingName} numberOfLines={2}>{meal.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 5, marginTop: 6 }}>
                    {meal.prepTime > 0 && (
                      <View style={[styles.heroMealPill, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.25)' }]}>
                        <Text style={[styles.heroMealPillText, { color: '#F59E0B' }]}>{meal.prepTime}m</Text>
                      </View>
                    )}
                    <View style={[styles.heroMealPill, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' }]}>
                      <Text style={styles.heroMealPillText}>{meal.calories} CAL</Text>
                    </View>
                    {meal.protein > 0 && (
                      <View style={[styles.heroMealPill, { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.25)' }]}>
                        <Text style={[styles.heroMealPillText, { color: '#4ADE80' }]}>{meal.protein}P</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
          )
        })()}

        {/* ── Missing staples nudge — only shown after user has scanned their pantry ── */}
        {missingStaples.length >= 3 && !staplesDismissed && !loading && pantryNames.size > 0 && (
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

        {/* ── Daily Meal Log — Cards ── */}
        <View style={styles.logSection}>
          <Text style={styles.logTitle}>Daily Meal Log</Text>

          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#0A0A0A', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, marginTop: 14,
              borderWidth: 1.5, borderColor: 'rgba(74,222,128,0.4)',
              shadowColor: '#4ADE80', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 12,
            }}
            activeOpacity={0.8}
            onPress={() => setShowAILogModal(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(74,222,128,0.12)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Camera size={18} stroke="#4ADE80" strokeWidth={2.5} />
              </View>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>Snap & Log with AI</Text>
                <Text style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Point your camera at any food</Text>
              </View>
            </View>
            <View style={{
              width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(74,222,128,0.15)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <ScanLine size={16} stroke="#4ADE80" strokeWidth={2} />
            </View>
          </TouchableOpacity>

          <View style={{ marginTop: 12, gap: 10 }}>
            {slots.map((slot) => {
              const hasEntries = slot.entries.length > 0
              const slotCal = slot.entries.reduce((s, e) => s + e.calories, 0)
              const SlotIcon = iconForSlot(slot.label)
              return (
                <View key={slot.id} style={styles.mealSlotCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <View style={styles.mealSlotIcon}>
                      <SlotIcon size={18} stroke={hasEntries ? '#4ADE80' : COLORS.textMuted} strokeWidth={1.8} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.mealSlotLabel}>{slot.label}</Text>
                        <TouchableOpacity
                          style={styles.mealSlotLogBtn}
                          onPress={() => { setFoodSearchSlot(slot.label); setShowFoodSearchModal(true) }}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.mealSlotLogBtnText}>{hasEntries ? '+' : 'Log'}</Text>
                        </TouchableOpacity>
                      </View>
                      {hasEntries ? (
                        slot.entries.map((entry, idx) => (
                          <View key={entry.id} style={{ flexDirection: 'row', alignItems: 'center',
                              paddingTop: 8, marginTop: idx > 0 ? 8 : 4,
                              borderTopWidth: idx > 0 ? 1 : 0,
                              borderTopColor: 'rgba(255,255,255,0.12)' }}>
                            <TouchableOpacity onPress={() => {
                              if (entry.food_id) {
                                setEditEntry(entry)
                              } else if (entry.meal_data) {
                                router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify(entry.meal_data) }})
                              } else {
                                router.push({ pathname: '/meal/[id]', params: { id: entry.id, mealData: JSON.stringify({
                                  name: entry.name, calories: entry.calories, protein: entry.protein,
                                  carbs: entry.carbs, fat: entry.fat, ingredients: [], steps: [], image: null,
                                })}})
                              }
                            }} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ fontSize: 13, color: COLORS.textWhite, fontWeight: '500', flex: 1 }}>{entry.name}</Text>
                              <Text style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: '600', marginLeft: 8 }}>{entry.calories} kcal</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => deleteEntry(slot.id, entry.id)} activeOpacity={0.6} style={{ paddingLeft: 12, paddingVertical: 4 }}>
                              <X size={14} stroke="#666" strokeWidth={2} />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>Nothing logged yet</Text>
                      )}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>

          <TouchableOpacity style={styles.addSlotBtn} activeOpacity={0.6} onPress={() => setShowAddModal(true)}>
            <Plus size={15} stroke="#4ADE80" strokeWidth={2} />
            <Text style={styles.addSlotText}>+ Add Meal</Text>
          </TouchableOpacity>

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
        logDate={selectedDate}
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

      {/* ── Pantry scan from home CTA ── */}
      <PantryScanModal
        visible={showPantryScanFromHome}
        onClose={() => setShowPantryScanFromHome(false)}
        onItemsAdded={() => {
          setShowPantryScanFromHome(false)
          setShowScanCta(false)
          AsyncStorage.setItem('pantry_scan_cta_dismissed', '1')
        }}
      />

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
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  brandText: { fontSize: 18, fontWeight: '800', color: '#4ADE80', letterSpacing: -0.3 },
  headerGreeting: { gap: 4 },
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
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.trackDark },
  avatarInitial: { fontSize: 14, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  hiText: { fontSize: 26, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  greetText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  macroCard: { marginHorizontal: 20, marginBottom: 24, borderRadius: 16, borderWidth: 1, borderColor: COLORS.trackDark, backgroundColor: COLORS.cardElevated, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  macroSectionLabel: { fontSize: 10, fontWeight: '700', color: '#4ADE80', textTransform: 'uppercase', letterSpacing: 2 },
  macroCalorieText: { fontSize: 32, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  macroRingsRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 20, marginTop: 4 },
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
  panel: { backgroundColor: 'transparent', marginHorizontal: 20, paddingTop: 12, paddingHorizontal: 0, paddingBottom: 16 },
  panelCollapsed: { paddingTop: 0, paddingBottom: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, marginBottom: 0 },
  sectionHeaderExpanded: { paddingBottom: 0, marginBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
  mealsCollapsedSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealList: { gap: 14, marginBottom: 28 },
  mealCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: COLORS.trackDark, backgroundColor: COLORS.cardElevated, padding: 16, gap: 16 },
  mealImageReal: { width: 72, height: 72, borderRadius: 12 },
  mealImagePlaceholder: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#3A3A3A', alignItems: 'center', justifyContent: 'center' },
  mealInfo: { flex: 1, gap: 6 },
  ratingBtns: { flexDirection: 'column', gap: 8, alignItems: 'center' },
  ratingBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  ratingBtnUp: { backgroundColor: 'rgba(74,222,128,0.12)' },
  ratingBtnDown: { backgroundColor: 'rgba(239,68,68,0.12)' },
  ratingToast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 100,
  },
  ratingToastText: { color: '#4ADE80', fontSize: 14, fontWeight: '600' },
  mealName: { fontSize: 16, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  mealMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealMetaText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealMacros: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealMacroText: { fontSize: 13, color: COLORS.textDim, fontWeight: '400' },
  mealMacroBold: { fontWeight: '700', color: COLORS.textWhite },
  macroDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.textMuted },
  regenButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#4ADE80', borderRadius: 30, paddingVertical: 16, shadowColor: '#4ADE80', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12 },
  regenText: { color: '#000000', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  mealModeToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 24,
    padding: 3,
    marginBottom: 6,
  },
  mealModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
  },
  mealModeBtnActive: {
    backgroundColor: '#4ADE80',
  },
  mealModeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    backgroundColor: COLORS.cardElevated,
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
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#4ADE80',
    borderRadius: 30,
    paddingVertical: 14,
    marginBottom: 16,
  },
  aiEstimateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4ADE80',
  },
  logTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
  logPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  logPillBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textWhite },
  slotCard: { backgroundColor: COLORS.cardElevated, borderRadius: 14, borderWidth: 1, borderColor: COLORS.trackDark, overflow: 'hidden' },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  slotLabel: { fontSize: 10, fontWeight: '700', color: '#4ADE80', textTransform: 'uppercase', letterSpacing: 1.5 },
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
  logCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 0, gap: 10, backgroundColor: COLORS.cardElevated },
  logIconCircle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  logInfo: { flex: 1, gap: 2 },
  logName: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.1 },
  logTime: { fontSize: 11, color: COLORS.textMuted },
  logMacros: { alignItems: 'flex-end', gap: 2 },
  logCal: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  logPro: { fontSize: 11, color: COLORS.textMuted },
  addSlotBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 6 },
  addSlotText: { fontSize: 14, color: '#4ADE80', fontWeight: '600' },
  logTotal: { fontSize: 12, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: COLORS.cardElevated, borderRadius: 20, padding: 20, gap: 16, borderWidth: 1, borderColor: COLORS.trackDark },
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

  // Hero dashboard card
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 8,
    marginHorizontal: 20,
    marginBottom: 4,
  },
  dayNavText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textWhite,
    minWidth: 100,
    textAlign: 'center',
  },
  heroCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: '#0F0F0F',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.08)',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
  },

  // Hero meal cards (horizontal scroll)
  heroMealCard: {
    width: 240,
    height: 280,
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A1A',
  },
  heroMealImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    borderRadius: 28,
  },
  heroMealGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroMealContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 18,
  },
  heroMealPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  heroMealPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textWhite,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroMealName: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textWhite,
    lineHeight: 22,
  },

  // Trending cards
  trendingCard: {
    width: 200,
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: COLORS.cardElevated,
  },
  trendingImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    opacity: 0.8,
  },
  trendingGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  trendingBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  trendingBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.textWhite,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendingContent: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
  },
  trendingName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textWhite,
    lineHeight: 17,
    marginBottom: 4,
  },
  trendingKcal: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4ADE80',
  },

  // Meal slot cards (MyFitnessPal style)
  mealSlotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  mealSlotIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealSlotLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  mealSlotLogBtn: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  mealSlotLogBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ADE80',
  },


  // Timeline dots
  timelineDotFilled: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    marginTop: 4,
  },
  timelineDotEmpty: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    backgroundColor: COLORS.background,
    marginTop: 4,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 4,
  },

  // First-time pantry scan CTA
  scanCtaCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 10,
  },
  scanCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  scanCtaIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(74,222,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCtaTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
    marginBottom: 2,
  },
  scanCtaSub: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  scanCtaLaterWrap: {
    alignSelf: 'flex-end',
  },
  scanCtaLaterText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
})
