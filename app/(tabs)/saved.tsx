import { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  Animated,
  ActivityIndicator,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Bookmark, Search, X, Utensils, Clock, Plus } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import RecipeFormModal from '@/components/RecipeFormModal'

const { width } = Dimensions.get('window')
const CARD_WIDTH = (width - 20 * 2 - 12) / 2

// ── Types ──────────────────────────────────────────────────────────────

type SavedMeal = {
  id: string
  name: string
  prep_time: number | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  ingredients: any[] | null
  steps: string[] | null
  is_user_created: boolean
  tags: string[]
  image?: string | null
}

function deriveTags(meal: { protein: number | null; prep_time: number | null }): string[] {
  const tags: string[] = []
  if (meal.protein && meal.protein >= 30) tags.push('High Protein')
  if (meal.prep_time && meal.prep_time <= 10) tags.push('Quick')
  return tags
}

const FILTERS = ['All', 'High Protein', 'Quick', 'My Recipes']

// ── Meal card ──────────────────────────────────────────────────────────

function MealCard({ meal, onUnsave, onEdit }: { meal: SavedMeal; onUnsave: () => void; onEdit?: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onLongPress={meal.is_user_created ? onEdit : undefined}>
      {meal.is_user_created && (
        <View style={styles.myRecipeBadge}>
          <Text style={styles.myRecipeBadgeText}>My Recipe</Text>
        </View>
      )}
      {meal.image ? (
        <Image source={{ uri: meal.image }} style={styles.cardImageReal} resizeMode="cover" />
      ) : (
        <View style={styles.cardImage}>
          <Utensils size={24} stroke="#555555" strokeWidth={1.5} />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>
        {meal.prep_time != null && (
          <View style={styles.cardMeta}>
            <Clock size={11} stroke={COLORS.textMuted} strokeWidth={1.8} />
            <Text style={styles.cardMetaText}>{meal.prep_time} min</Text>
          </View>
        )}
        <View style={styles.cardFooter}>
          <View style={styles.cardMacros}>
            {meal.calories != null && <Text style={styles.cardMacroText}>{meal.calories} kcal</Text>}
            {meal.calories != null && meal.protein != null && <Text style={styles.cardMacroDot}>·</Text>}
            {meal.protein != null && <Text style={styles.cardMacroText}>{meal.protein}g pro</Text>}
          </View>
          <TouchableOpacity onPress={onUnsave} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Bookmark size={16} stroke="#4ADE80" fill="#4ADE80" strokeWidth={1.5} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const { user } = useAuth()
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [removed, setRemoved] = useState<{ meal: SavedMeal; index: number } | null>(null)
  const [showRecipeForm, setShowRecipeForm] = useState(false)
  const [editingMeal, setEditingMeal] = useState<SavedMeal | null>(null)

  const toastOpacity = useRef(new Animated.Value(0)).current
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchMeals = useCallback(async () => {
    if (!user) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('saved_meals')
      .select('id, name, prep_time, calories, protein, carbs, fat, ingredients, steps, is_user_created')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (!error && data) {
      const mealsWithTags = data.map(row => ({ ...row, tags: deriveTags(row), image: null as string | null, is_user_created: row.is_user_created ?? false }))
      setMeals(mealsWithTags)
      // Fetch cached images in background
      mealsWithTags.forEach(async (meal, i) => {
        try {
          const { data: imgData } = await supabase.functions.invoke('generate-meal-image', {
            body: { mealName: meal.name },
          })
          if (imgData?.image) {
            setMeals(prev => {
              const updated = [...prev]
              if (updated[i]) updated[i] = { ...updated[i], image: imgData.image }
              return updated
            })
          }
        } catch {}
      })
    }
    setLoading(false)
  }, [user])

  useFocusEffect(useCallback(() => {
    fetchMeals()
  }, [fetchMeals]))

  const showToast = () => {
    toastOpacity.setValue(0)
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
  }

  const dismissToast = () => {
    Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setRemoved(null)
    })
  }

  const startTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(dismissToast, 4000)
  }

  const unsave = async (id: string) => {
    const { error } = await supabase.from('saved_meals').delete().eq('id', id)
    if (error) return
    setMeals(prev => {
      const index = prev.findIndex(m => m.id === id)
      const meal = prev[index]
      setRemoved({ meal, index })
      showToast()
      startTimer()
      return prev.filter(m => m.id !== id)
    })
  }

  const undo = async () => {
    if (!removed || !user) return
    if (timerRef.current) clearTimeout(timerRef.current)
    // Re-insert the removed meal
    await supabase.from('saved_meals').insert({
      id: removed.meal.id,
      user_id: user.id,
      name: removed.meal.name,
      prep_time: removed.meal.prep_time,
      calories: removed.meal.calories,
      protein: removed.meal.protein,
    })
    setMeals(prev => {
      const next = [...prev]
      next.splice(removed.index, 0, removed.meal)
      return next
    })
    dismissToast()
  }

  const filtered = meals.filter(m => {
    const matchesFilter = activeFilter === 'All'
      ? true
      : activeFilter === 'My Recipes'
        ? m.is_user_created
        : m.tags.includes(activeFilter)
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const isEmpty = !loading && filtered.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Saved Meals</Text>
          <Text style={styles.headerSub}>
            {meals.length} meal{meals.length !== 1 ? 's' : ''} saved
          </Text>
        </View>
        <TouchableOpacity style={styles.createBtn} onPress={() => { setEditingMeal(null); setShowRecipeForm(true) }} activeOpacity={0.7}>
          <Plus size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchBar}>
        <Search size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search saved meals..."
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
            <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Filter pills ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, activeFilter === f && styles.filterPillActive]}
            onPress={() => setActiveFilter(f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={COLORS.textWhite} />
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Bookmark size={32} stroke="#4ADE80" strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>No saved meals yet</Text>
          <Text style={styles.emptySub}>Save a meal from the Home screen to see it here</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map(meal => (
            <MealCard key={meal.id} meal={meal} onUnsave={() => unsave(meal.id)} onEdit={() => { setEditingMeal(meal); setShowRecipeForm(true) }} />
          ))}
          {filtered.length % 2 !== 0 && <View style={{ width: CARD_WIDTH }} />}
        </ScrollView>
      )}

      {/* ── Undo toast ── */}
      {removed && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>Meal removed</Text>
          <TouchableOpacity onPress={undo} activeOpacity={0.7}>
            <Text style={styles.toastUndo}>Undo</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      <RecipeFormModal
        visible={showRecipeForm}
        onClose={() => { setShowRecipeForm(false); setEditingMeal(null) }}
        onSaved={() => { setShowRecipeForm(false); setEditingMeal(null); fetchMeals() }}
        editMeal={editingMeal}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  toast: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toastText: {
    fontSize: 14,
    color: COLORS.textWhite,
    fontWeight: '500',
  },
  toastUndo: {
    fontSize: 14,
    color: '#4ADE80',
    fontWeight: '700',
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 3,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textWhite,
    padding: 0,
  },

  filterScroll: { flexGrow: 0, marginBottom: 20 },
  filterRow: { paddingHorizontal: 20, gap: 8 },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 30,
    backgroundColor: '#1A1A1A',
  },
  filterPillActive: { backgroundColor: COLORS.textWhite },
  filterText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  filterTextActive: { color: '#000000', fontWeight: '600' },

  scroll: { flex: 1 },
  grid: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  card: {
    width: CARD_WIDTH,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cardImageReal: {
    height: 110,
    width: '100%',
  },
  cardImage: {
    height: 110,
    backgroundColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: 12, gap: 5 },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaText: { fontSize: 11, color: COLORS.textMuted },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  cardMacros: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMacroText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '500' },
  cardMacroDot: { fontSize: 11, color: COLORS.textMuted },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myRecipeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
  myRecipeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: 0.3,
  },
})
