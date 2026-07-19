import { useState, useRef, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
  Dimensions,
  Animated,
  ActivityIndicator,  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Reanimated, { FadeIn } from 'react-native-reanimated'
import PressableScale from '../../components/PressableScale'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MealImage, prefetchMealImages } from '@/components/MealImage'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router'
import { Bookmark, Search, X, Utensils, Clock, Plus, Link } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAIConsent } from '../../context/AIConsentContext'
import { trackAIError } from '../../lib/analytics'
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

// Per-user cache key so the Saved list paints instantly on tab focus (stale-while-revalidate)
// and never shows one account's meals to another.
const savedCacheKey = (uid: string) => `pantry_saved_meals_${uid}`

// Tinted macro pill — matches the Discover rail cards so Saved visually rhymes with them.
function Pill({ label, tint }: { label: string; tint: 'amber' | 'green' | 'white' }) {
  const t = {
    amber: { bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.3)', color: '#F59E0B' },
    green: { bg: 'rgba(74,222,128,0.18)', border: 'rgba(74,222,128,0.3)', color: '#4ADE80' },
    white: { bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.2)', color: COLORS.textWhite },
  }[tint]
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.pillText, { color: t.color }]}>{label}</Text>
    </View>
  )
}

function MealCard({ meal, onUnsave, onEdit }: { meal: SavedMeal; onUnsave: () => void; onEdit?: () => void }) {
  const router = useRouter()
  const handlePress = () => {
    const mealData = JSON.stringify({
      id: meal.id,
      name: meal.name,
      prepTime: meal.prep_time,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs ?? 0,
      fat: meal.fat ?? 0,
      ingredients: (meal.ingredients ?? []).map((ing: any, i: number) => ({
        ...ing,
        id: ing.id ?? String(i),
      })),
      steps: meal.steps ?? [],
      image: meal.image,
      is_user_created: meal.is_user_created,
    })
    router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData } })
  }
  return (
    <PressableScale style={styles.card} scaleTo={0.98} onPress={handlePress}>
      {meal.image ? (
        <MealImage uri={meal.image} style={styles.cardImageReal} recyclingKey={String(meal.id)} />
      ) : (
        <View style={[styles.cardImageReal, styles.cardImagePlaceholder]}>
          <Utensils size={28} stroke="#555555" strokeWidth={1.5} />
        </View>
      )}
      {/* Gradient so the overlaid name + pills stay legible over any photo */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} locations={[0.35, 1]} style={styles.cardGradient} />
      {meal.is_user_created && (
        <View style={styles.myRecipeBadge}>
          <Text style={styles.myRecipeBadgeText}>My Recipe</Text>
        </View>
      )}
      <PressableScale
        style={styles.cardBookmark}
        onPress={onUnsave}
        haptic
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Bookmark size={18} stroke="#4ADE80" fill="#4ADE80" strokeWidth={1.5} />
      </PressableScale>
      <View style={styles.cardContent}>
        <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>
        <View style={styles.cardPillRow}>
          {meal.prep_time != null && meal.prep_time > 0 && <Pill label={`${meal.prep_time}m`} tint="amber" />}
          {meal.calories != null && <Pill label={`${meal.calories} CAL`} tint="white" />}
          {meal.protein != null && meal.protein > 0 && <Pill label={`${meal.protein}P`} tint="green" />}
        </View>
      </View>
    </PressableScale>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function SavedScreen() {
  const { user } = useAuth()
  const { requestConsent } = useAIConsent()
  const { sharedUrl } = useLocalSearchParams<{ sharedUrl?: string }>()
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [removed, setRemoved] = useState<{ meal: SavedMeal; index: number } | null>(null)
  const [showRecipeForm, setShowRecipeForm] = useState(false)
  const [editingMeal, setEditingMeal] = useState<SavedMeal | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)

  // Triggered by the iOS Share Sheet extension (Info.plist NSExtensionActivationRule).
  // Expo Router parses the incoming URL's params; this effect lifts the sharedUrl param
  // into the import-modal state so the user lands directly in the "import flow" UI.
  useEffect(() => {
    if (sharedUrl) {
      setImportUrl(sharedUrl)
      setShowImportModal(true)
    }
  }, [sharedUrl])

  const handleImportFromUrl = async () => {
    const url = importUrl.trim()
    if (!url) return
    // Regex matches both youtube.com and youtu.be (shortlink) plus tiktok.com.
    // No other sources are supported by the extract-recipe-from-url edge function yet
    // (Instagram is RA-blocked; we'd need oEmbed + caption parsing).
    if (!/youtu\.?be|tiktok\.com/.test(url)) {
      Alert.alert('Unsupported link', 'Please paste a YouTube or TikTok URL.')
      return
    }
    // Sends video to OpenAI/Anthropic — must obtain explicit AI consent first.
    const ok = await requestConsent()
    if (!ok) return
    setImporting(true)
    try {
      const { data, error } = await supabase.functions.invoke('extract-recipe-from-url', {
        body: { url },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      // Auto-fill the recipe form with extracted data
      setShowImportModal(false)
      setImportUrl('')
      setEditingMeal({
        id: '',
        name: data.name || '',
        prep_time: data.prepTime ?? null,
        calories: data.calories ?? null,
        protein: data.protein ?? null,
        carbs: data.carbs ?? null,
        fat: data.fat ?? null,
        ingredients: data.ingredients || [],
        steps: data.steps || [],
        is_user_created: true,
        tags: [],
      } as any)
      setShowRecipeForm(true)
    } catch (e: any) {
      trackAIError('extract-recipe-from-url', e)
      Alert.alert('Import failed', e.message || 'Could not extract recipe from this link.')
    } finally {
      setImporting(false)
    }
  }

  const toastOpacity = useRef(new Animated.Value(0)).current
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Clear the undo-toast timer on unmount — otherwise dismissToast fires after the user
  // navigates away, calling setState on a dead component.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  // Guards against overlapping image backfills when the tab is refocused rapidly.
  const backfillRef = useRef(false)
  const hasContentRef = useRef(false) // once we've shown meals (from cache or a fetch), refocus refetches silently

  // Instant paint: load the last-cached saved meals on mount so the tab never flashes a
  // spinner; the fetch below then revalidates in the background and re-caches.
  useEffect(() => {
    if (!user) return
    AsyncStorage.getItem(savedCacheKey(user.id)).then(raw => {
      if (!raw) return
      try {
        const cached = JSON.parse(raw)
        if (Array.isArray(cached) && cached.length) {
          setMeals(cached); hasContentRef.current = true; setLoading(false)
          prefetchMealImages(cached.slice(0, 8).map((m: SavedMeal) => m.image)) // warm visible cards before scroll
        }
      } catch {}
    })
  }, [user])

  const fetchMeals = useCallback(async () => {
    if (!user) { setLoading(false); return }
    if (!hasContentRef.current) setLoading(true) // spinner only when there's nothing to show yet
    const { data, error } = await supabase
      .from('saved_meals')
      .select('id, name, prep_time, calories, protein, carbs, fat, ingredients, steps, is_user_created, image_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (!error && data) {
      // Use the stored image_url first (preserves trending meal images and any image used at save time).
      // Only meals saved BEFORE image_url was added to the schema (and AI-photo-imported recipes) have null here.
      const mealsWithTags = data.map(row => ({
        ...row,
        tags: deriveTags(row),
        image: row.image_url ?? null as string | null,
        is_user_created: row.is_user_created ?? false,
      }))
      setMeals(mealsWithTags)
      hasContentRef.current = true
      // Cache for instant paint on the next focus / app launch (stale-while-revalidate).
      AsyncStorage.setItem(savedCacheKey(user.id), JSON.stringify(mealsWithTags)).catch(() => {})
      prefetchMealImages(mealsWithTags.slice(0, 8).map(m => m.image)) // warm the visible cards' photos
      // Lazy backfill for legacy saves with no stored image. Two key guards vs the old
      // version: (1) we PERSIST the generated image back to saved_meals.image_url, so it's
      // generated once ever — not re-fetched on every tab focus; (2) we process in small
      // concurrent batches instead of firing one request per meal all at once (which was a
      // thundering herd at scale). A ref guard also prevents overlapping runs on refocus.
      const toFill = mealsWithTags
        .map((meal, i) => ({ meal, i }))
        .filter(x => !x.meal.image)
      if (toFill.length && !backfillRef.current) {
        backfillRef.current = true
        ;(async () => {
          const BATCH = 3
          for (let b = 0; b < toFill.length; b += BATCH) {
            await Promise.all(toFill.slice(b, b + BATCH).map(async ({ meal, i }) => {
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
                  // Persist so future loads read it directly and skip the function entirely.
                  supabase.from('saved_meals').update({ image_url: imgData.image }).eq('id', meal.id).then(() => {}, () => {})
                }
              } catch {}
            }))
          }
          backfillRef.current = false
        })()
      }
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
    if (timerRef.current) clearTimeout(timerRef.current) // cancel prior timer if user unsaves multiple meals rapidly
    timerRef.current = setTimeout(dismissToast, 4000) // 4s undo window — long enough to read, short enough to feel responsive
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
    // Re-insert with the SAME id so any references (e.g. routing, meal_logs.food_id)
    // remain valid. Supabase respects client-provided uuid as long as the row is gone.
    // Re-insert ALL columns — not just name/macros — or the meal reloads truncated on the
    // next fetch (NULL carbs/fat/ingredients/steps/image, lost is_user_created flag).
    await supabase.from('saved_meals').insert({
      id: removed.meal.id,
      user_id: user.id,
      name: removed.meal.name,
      prep_time: removed.meal.prep_time,
      calories: removed.meal.calories,
      protein: removed.meal.protein,
      carbs: removed.meal.carbs,
      fat: removed.meal.fat,
      ingredients: removed.meal.ingredients,
      steps: removed.meal.steps,
      image_url: removed.meal.image ?? null,
      is_user_created: removed.meal.is_user_created,
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
        <PressableScale style={styles.createBtn} onPress={() => { setEditingMeal(null); setShowRecipeForm(true) }}>
          <Plus size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </PressableScale>
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
          <PressableScale onPress={() => setSearchQuery('')}>
            <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
          </PressableScale>
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
          <PressableScale
            key={f}
            style={[styles.filterPill, activeFilter === f && styles.filterPillActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </PressableScale>
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
          <Text style={styles.emptySub}>Tap the bookmark on any meal to save it</Text>
        </View>
      ) : (
        <Reanimated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
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
        </Reanimated.View>
      )}

      {/* ── Undo toast ── */}
      {removed && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>Meal removed</Text>
          <PressableScale onPress={undo}>
            <Text style={styles.toastUndo}>Undo</Text>
          </PressableScale>
        </Animated.View>
      )}
      {/* ── Import URL modal ── */}
      <Modal visible={showImportModal} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.importOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.importSheet}>
            <Text style={styles.importTitle}>Import from URL</Text>
            <Text style={styles.importSub}>Paste a YouTube or TikTok recipe link</Text>
            <TextInput
              style={styles.importInput}
              placeholder="https://..."
              placeholderTextColor={COLORS.textMuted}
              value={importUrl}
              onChangeText={setImportUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
            />
            <PressableScale
              style={[styles.importBtn, (!importUrl.trim() || importing) && { opacity: 0.4 }]}
              onPress={handleImportFromUrl}
              haptic
              disabled={!importUrl.trim() || importing}
            >
              {importing ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.importBtnText}>Extract Recipe</Text>
              )}
            </PressableScale>
            <PressableScale style={styles.importCancel} onPress={() => { setShowImportModal(false); setImportUrl('') }}>
              <Text style={styles.importCancelText}>Cancel</Text>
            </PressableScale>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
    height: 210,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cardImageReal: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    backgroundColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  cardBookmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
    lineHeight: 18,
  },
  cardPillRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  pill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

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

  importOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  importSheet: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  importTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  importSub: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  importInput: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.textWhite,
  },
  importBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  importBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  importCancel: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  importCancelText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
})
