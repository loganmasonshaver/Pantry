import { useState, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Bookmark, Search, X, Utensils, Clock } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'

const { width } = Dimensions.get('window')
const CARD_WIDTH = (width - 20 * 2 - 12) / 2

// ── Types & mock data ──────────────────────────────────────────────────

type SavedMeal = {
  id: string
  name: string
  prepTime: number
  calories: number
  protein: number
  tags: string[]
}

const INITIAL_MEALS: SavedMeal[] = [
  { id: '1', name: 'Steak & Rice Bowl',    prepTime: 15, calories: 550, protein: 45, tags: ['High Protein'] },
  { id: '2', name: 'Salmon & Quinoa',       prepTime: 18, calories: 490, protein: 44, tags: ['High Protein', 'Low Carb'] },
  { id: '3', name: 'Chicken Pesto Pasta',   prepTime: 20, calories: 620, protein: 52, tags: ['High Protein'] },
  { id: '4', name: 'Greek Yogurt Bowl',     prepTime: 5,  calories: 320, protein: 28, tags: ['Quick', 'Breakfast'] },
  { id: '5', name: 'Tuna Avocado Wrap',     prepTime: 10, calories: 410, protein: 38, tags: ['Quick', 'Low Carb'] },
  { id: '6', name: 'Egg & Veggie Scramble', prepTime: 12, calories: 380, protein: 32, tags: ['Quick', 'Breakfast'] },
]

const FILTERS = ['All', 'High Protein', 'Quick', 'Low Carb', 'Breakfast']

// ── Meal card ──────────────────────────────────────────────────────────

function MealCard({ meal, onUnsave }: { meal: SavedMeal; onUnsave: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardImage}>
        <Utensils size={24} stroke="#555555" strokeWidth={1.5} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>
        <View style={styles.cardMeta}>
          <Clock size={11} stroke={COLORS.textMuted} strokeWidth={1.8} />
          <Text style={styles.cardMetaText}>{meal.prepTime} min</Text>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.cardMacros}>
            <Text style={styles.cardMacroText}>{meal.calories} kcal</Text>
            <Text style={styles.cardMacroDot}>·</Text>
            <Text style={styles.cardMacroText}>{meal.protein}g pro</Text>
          </View>
          <TouchableOpacity onPress={onUnsave} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Bookmark size={16} stroke="#4ADE80" fill="#4ADE80" strokeWidth={1.5} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const [meals, setMeals] = useState<SavedMeal[]>(INITIAL_MEALS)
  const [activeFilter, setActiveFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [removed, setRemoved] = useState<{ meal: SavedMeal; index: number } | null>(null)

  const toastOpacity = useRef(new Animated.Value(0)).current
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const unsave = (id: string) => {
    setMeals(prev => {
      const index = prev.findIndex(m => m.id === id)
      const meal = prev[index]
      setRemoved({ meal, index })
      showToast()
      startTimer()
      return prev.filter(m => m.id !== id)
    })
  }

  const undo = () => {
    if (!removed) return
    if (timerRef.current) clearTimeout(timerRef.current)
    setMeals(prev => {
      const next = [...prev]
      next.splice(removed.index, 0, removed.meal)
      return next
    })
    dismissToast()
  }

  const filtered = meals.filter(m => {
    const matchesFilter = activeFilter === 'All' || m.tags.includes(activeFilter)
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const isEmpty = filtered.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved Meals</Text>
        <Text style={styles.headerSub}>
          {meals.length} meal{meals.length !== 1 ? 's' : ''} saved
        </Text>
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

      {isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Bookmark size={32} stroke="#4ADE80" strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>No saved meals yet</Text>
          <Text style={styles.emptySub}>Tap the bookmark on any meal to save it</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map(meal => (
            <MealCard key={meal.id} meal={meal} onUnsave={() => unsave(meal.id)} />
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
})
