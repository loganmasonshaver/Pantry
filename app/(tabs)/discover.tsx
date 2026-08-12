import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  Linking,
  AppState,
  RefreshControl,
} from 'react-native'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Flame, Compass, Utensils, Plus } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { MealImage, prefetchMealImages } from '@/components/MealImage'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import CreatorRecipeModal from '@/components/CreatorRecipeModal'
import PressableScale from '../../components/PressableScale'

// Lifecycle filters mirror the home-tab logic so Discover shows the same trending
// pool. They live here as a temporary duplicate; Phase 3b moves Trending out of
// Home entirely and these become the single source of truth.
// Creator recipes get a longer shelf life than YouTube (14d guaranteed, up to 30d if
// engagement is strong) — creators earn revenue share, so we honor their content longer.
function isCreatorRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000 // ms → days
  if (ageDays <= 14) return true
  if (ageDays <= 30 && ((m.vote_score ?? 0) >= 3 || (m.log_count ?? 0) >= 10)) return true
  return false
}
// YouTube-sourced recipes are pure editorial filler — drop them after a week so the
// feed stays fresh and we don't keep showing stale trending picks.
function isYouTubeRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000
  return ageDays <= 7
}
function filterTrendingByLifecycle(rows: any[]): any[] {
  return rows.filter(m => {
    if (m.trend_source === 'creator' || m.creators) return isCreatorRecipeVisible(m)
    return isYouTubeRecipeVisible(m)
  })
}

// Mirrors the pipeline's PROTEIN_KEYWORDS — order matters (specific first).
const DISCOVER_PROTEIN_KEYWORDS = [
  'chicken', 'turkey', 'beef', 'pork', 'lamb', 'bacon', 'ham',
  'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'cod', 'tilapia', 'fish',
  'cottage cheese', 'paneer', 'greek yogurt', 'skyr', 'feta', 'ricotta', 'mozzarella',
  'tofu', 'tempeh', 'seitan',
  'lentil', 'chickpea', 'black bean', 'kidney bean', 'edamame', 'soy',
  'protein powder', 'whey',
  'egg',
]
// Only check first 3 ingredients — GPT lists them in order of prominence, so the
// "primary" protein is essentially always in the first few. Cheaper than scanning all
// ingredients and avoids false matches like "splash of cream" being tagged as dairy.
function detectPrimaryProtein(meal: any): string {
  const ings = (meal.ingredients || []).slice(0, 3).map((i: any) => i.name ?? '').join(' ')
  const haystack = `${meal.name ?? ''} ${ings}`.toLowerCase()
  for (const kw of DISCOVER_PROTEIN_KEYWORDS) {
    if (haystack.includes(kw)) return kw
  }
  return 'other'
}

// Variety-fill: prefer newest meals first, but cap each primary protein source at
// MAX_PER_PROTEIN to keep the feed varied. Solves the "today only produced 2 meals
// and they're both chicken-adjacent" problem by backfilling from prior days with
// other proteins, while preventing any single source from dominating.
const MAX_PER_PROTEIN = 2
// Variety-fill a single rail's pool: newest-first, capping each primary protein at
// MAX_PER_PROTEIN so one source can't dominate, up to `limit`. Applied PER RAIL — the old
// version capped the combined pool to 6 BEFORE the per-rail caps (8/6), so the rails were
// permanently starved and could never reach their intended density.
function applyVarietyFill(meals: any[], limit: number): any[] {
  const result: any[] = []
  const proteinCounts = new Map<string, number>()
  for (const m of meals) {
    if (result.length >= limit) break
    const protein = detectPrimaryProtein(m)
    const count = proteinCounts.get(protein) ?? 0
    if (count >= MAX_PER_PROTEIN) continue
    result.push(m)
    proteinCounts.set(protein, count + 1)
  }
  return result
}

type DiscoverMeal = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  prepTime: number
  ingredients: any[]
  steps: any[]
  image: string | null
  trend_source: string | null
  creator: any | null
  vote_score: number
  log_count: number
  generated_at: string
  compatible_diets: string[] | null
  is_dairy_free: boolean | null
  is_gluten_free: boolean | null
  is_nut_free: boolean | null
}

// Filter chips narrow the trending pool against derived signals. "All" is a no-op.
const FILTERS = ['All', 'Breakfast', 'Lunch', 'Dinner', 'High Protein', 'Quick', 'Desserts', 'Vegetarian'] as const
type FilterKey = typeof FILTERS[number]

// Keyword heuristics — fast, no extra columns required. Dessert reclassification is
// the same fix flagged in the handoff (LLM mis-tags "Cottage Cheese Brownie Bake" as
// meal). Vegetarian uses a deny-list because the trending pool doesn't carry a tag.
// Meal-time classification. Trending meals carry no `slot` (unlike generated cook-now meals), so
// it's derived from the name — same approach as Desserts/Vegetarian below.
//
// Breakfast has strong, unambiguous keywords. Lunch vs dinner genuinely does not: a chicken bowl or
// a salad is legitimately either. So DINNER_ONLY covers dishes nobody eats at 8am, and anything
// that's neither breakfast nor dessert stays eligible for BOTH lunch and dinner — showing a
// reasonable meal in both beats hiding it from the one the user picked.
const BREAKFAST_KEYWORDS = [
  'oat', 'oatmeal', 'overnight oats', 'pancake', 'waffle', 'french toast', 'omelet', 'omelette',
  'scramble', 'frittata', 'benedict', 'breakfast', 'granola', 'cereal', 'parfait', 'yogurt bowl',
  'smoothie', 'bagel', 'english muffin', 'hash brown', 'chia pudding', 'avocado toast', 'porridge',
]
const DINNER_ONLY_KEYWORDS = [
  'roast', 'steak', 'casserole', 'lasagna', 'stew', 'braise', 'chili', 'curry', 'pot pie',
  'meatloaf', 'sheet pan', 'ribs', 'brisket', 'risotto', 'shepherd', 'pot roast',
]

const DESSERT_KEYWORDS = [
  'brownie', 'cake', 'cheesecake', 'cookie', 'donut', 'doughnut', 'muffin',
  'pudding', 'pie', 'ice cream', 'mousse', 'parfait', 'tart', 'scone',
  'cupcake', 'tiramisu', 'custard', 'frosting', 'truffle',
]
const MEAT_KEYWORDS = [
  'chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal',
  'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'fish', 'anchovy',
  'prosciutto', 'pepperoni', 'salami', 'ham', 'meat',
]


// Food dislikes are arbitrary user strings (can't be precomputed), so they stay a
// runtime substring check. Diet identity + allergens now use the meal's precomputed
// tags (see passesDietTags) instead of the old substring keyword scan.
function passesDietary(meal: DiscoverMeal, dislikes: string[]): boolean {
  const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
  const nameLower = meal.name.toLowerCase()
  for (const dislike of dislikes) {
    const d = dislike.toLowerCase().trim()
    if (!d) continue
    if (ingredientNames.some(n => n.includes(d)) || nameLower.includes(d)) return false
  }
  return true
}

// Diet identity (Classic/Pescatarian/Vegetarian/Vegan) + allergen restrictions,
// matched against the generation-time tags. Classic matches everything. Legacy
// rows with null tags pass permissively so nothing vanishes during rollout.
function passesDietTags(meal: DiscoverMeal, dietType: string, restrictions: string[]): boolean {
  if (dietType && dietType !== 'Classic' && meal.compatible_diets) {
    if (!meal.compatible_diets.includes(dietType)) return false
  }
  for (const r of restrictions) {
    const key = r.toLowerCase()
    if (key === 'dairy-free' && meal.is_dairy_free === false) return false
    if (key === 'gluten-free' && meal.is_gluten_free === false) return false
    if (key === 'nut-free' && meal.is_nut_free === false) return false
  }
  return true
}

// Whole-word keyword match. Plain `includes` produced real misclassifications, because these
// lists contain short words that live inside unrelated ones: 'cake' matches "panCAKE" (so every
// pancake was tagged a dessert) and 'oat' matches "gOAT" (so Goat Cheese Salad was breakfast).
//
// The (s|es)? suffix is required, not cosmetic: the keyword lists are singular but real dish names
// are plural ("Skyr Pancakes", "Protein Brownies"), and a bare \b would match neither list — worse
// than the substring bug it replaces. Multi-word keys like 'ice cream' work unchanged.
const matchesKeyword = (nameLower: string, keywords: string[]): boolean =>
  keywords.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`, 'i').test(nameLower))

// Which eating occasion is it right now. Drives ORDERING of the "All" feed, not filtering —
// see timeOfDayRank. Dinner covers the evening through the small hours; nobody browsing at 1am
// wants pancakes surfaced first.
function currentMealTime(hour: number): 'Breakfast' | 'Lunch' | 'Dinner' {
  if (hour >= 4 && hour < 11) return 'Breakfast'
  if (hour >= 11 && hour < 16) return 'Lunch'
  return 'Dinner'
}

// Lower sorts first. Deliberately a SORT and not a filter: auto-switching the chip to Breakfast
// at 7am would show an empty feed on any day the pool happens to have no breakfast dishes,
// whereas demoting the mismatches can't ever empty it. The chips stay as explicit overrides.
function timeOfDayRank(meal: DiscoverMeal, mealTime: 'Breakfast' | 'Lunch' | 'Dinner'): number {
  const nameLower = meal.name.toLowerCase()
  const isBreakfast = matchesKeyword(nameLower, BREAKFAST_KEYWORDS)
  // Breakfast wins on genuine overlap ('parfait' is in both lists), same rule passesFilter uses.
  const isDessert = !isBreakfast && matchesKeyword(nameLower, DESSERT_KEYWORDS)
  const isDinnerOnly = matchesKeyword(nameLower, DINNER_ONLY_KEYWORDS)
  if (mealTime === 'Breakfast') {
    if (isBreakfast) return 0
    // Desserts are never wrong for the time of day, but they shouldn't lead the feed either.
    return isDessert || isDinnerOnly ? 2 : 1
  }
  // Lunch/dinner: a breakfast dish at 6pm is the mismatch worth demoting.
  if (isBreakfast) return 2
  if (isDessert) return 1
  if (mealTime === 'Lunch') return isDinnerOnly ? 1 : 0
  return 0
}

function passesFilter(meal: DiscoverMeal, filter: FilterKey): boolean {
  if (filter === 'All') return true
  const nameLower = meal.name.toLowerCase()
  if (filter === 'Quick') return meal.prepTime > 0 && meal.prepTime <= 20
  if (filter === 'High Protein') {
    // Protein density ≥ 25% of calories — same bar the trending pipeline uses.
    return meal.calories > 0 && (meal.protein * 4) / meal.calories >= 0.25
  }
  if (filter === 'Desserts') return matchesKeyword(nameLower, DESSERT_KEYWORDS)
  if (filter === 'Breakfast' || filter === 'Lunch' || filter === 'Dinner') {
    const isDessert = matchesKeyword(nameLower, DESSERT_KEYWORDS)
    const isBreakfast = matchesKeyword(nameLower, BREAKFAST_KEYWORDS)
    // Breakfast wins on overlap: "parfait" is in both lists, and a Greek yogurt parfait is
    // breakfast to most people even if a chocolate one isn't.
    if (filter === 'Breakfast') return isBreakfast
    // Lunch/dinner: exclude breakfast dishes and desserts; dinner-only mains are hidden from lunch.
    if (isBreakfast || isDessert) return false
    if (filter === 'Lunch') return !matchesKeyword(nameLower, DINNER_ONLY_KEYWORDS)
    return true
  }
  if (filter === 'Vegetarian') {
    // Deliberately substring, not whole-word, unlike the lists above. This one is a dietary
    // filter, so the two error directions aren't equal: over-matching hides a safe meal
    // (harmless), under-matching shows meat to a vegetarian. \bmeat\b would stop matching
    // "Meatballs" — exactly the miss that matters most.
    if (MEAT_KEYWORDS.some(k => nameLower.includes(k))) return false
    const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
    return !ingredientNames.some(n => MEAT_KEYWORDS.some(k => n.includes(k)))
  }
  return true
}

// Per-user cache so the rail paints instantly on tab focus / app launch (stale-while-revalidate),
// the same pattern the Saved tab uses. Without it Discover fetched trending_meals cold on every
// mount and showed a spinner each time. Capped to 60 to keep the stored payload light.
const discoverCacheKey = (uid: string) => `pantry_discover_${uid}`

export default function DiscoverScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { promoActive } = usePremium()
  const [trending, setTrending] = useState<DiscoverMeal[]>([])
  const [loading, setLoading] = useState(true)
  const hasContentRef = useRef(false) // once meals are shown (cache or fetch), refocus refetches silently
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All')
  const [showCreatorModal, setShowCreatorModal] = useState(false)
  const [foodDislikes, setFoodDislikes] = useState<string[]>([])
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([])
  const [dietType, setDietType] = useState<string>('Classic')

  // Profile-based dietary filters apply to every Discover view (always-on safety
  // filter — users with nut allergies should never see almond recipes regardless
  // of which chip they have selected). Chip filter narrows further on top.
  useEffect(() => {
    if (!user) return
    supabase.from('profiles')
      .select('food_dislikes, dietary_restrictions, diet_type')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.food_dislikes) setFoodDislikes(data.food_dislikes ?? [])
        if (data?.dietary_restrictions) {
          setDietaryRestrictions((data.dietary_restrictions ?? []).filter((r: string) => r !== 'None'))
        }
        if (data?.diet_type) setDietType(data.diet_type)
      })
  }, [user])

  // Serve the in-state pool instead of re-hitting Postgres on every tab-return / foreground.
  // The trending feed only changes once a day (cron) or on a creator edit, so a 300-row +
  // creator-join round-trip per focus was pure waste. 5-min TTL still picks up the overnight
  // batch and creator edits (any return after the window refetches); rapid tab-switching skips.
  const lastFetchRef = useRef(0)
  const TRENDING_TTL_MS = 5 * 60 * 1000

  // Instant paint: hydrate the last-cached rail on mount so the tab never flashes a spinner;
  // fetchTrending below revalidates in the background and re-caches.
  useEffect(() => {
    if (!user) return
    AsyncStorage.getItem(discoverCacheKey(user.id)).then(raw => {
      if (!raw) return
      try {
        const cached = JSON.parse(raw)
        if (Array.isArray(cached) && cached.length) {
          setTrending(cached); hasContentRef.current = true; setLoading(false)
          prefetchMealImages(cached.slice(0, 8).map((m: DiscoverMeal) => m.image)) // warm the rail before scroll
        }
      } catch {}
    })
  }, [user])

  const fetchTrending = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetchRef.current < TRENDING_TTL_MS) return // fresh enough
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    // 30-day window is the absolute upper bound (creator lifecycle ceiling).
    // Lifecycle filtering below further trims YouTube to 7d and creators by engagement.
    // The !creator_id syntax is PostgREST's foreign-key embed — joins one creator per meal.
    const { data } = await supabase.from('trending_meals')
      .select('*, creators!creator_id(name, handle, avatar_url, instagram_url, tiktok_url, youtube_url)')
      .gte('generated_at', thirtyDaysAgo)
      .order('generated_at', { ascending: false })
      .order('id')
      .limit(300) // newest 300 within the 30d window — lifecycle filter + variety-fill trim
                  // to a rail of ~6 anyway, so an unbounded fetch only wastes payload

    if (!data) { setLoading(false); return }

    const mapped = filterTrendingByLifecycle(data)
      .map(m => ({
        id: m.id, name: m.name, calories: m.calories, protein: m.protein,
        carbs: m.carbs, fat: m.fat, prepTime: m.prep_time,
        ingredients: m.ingredients, steps: m.steps, image: m.image,
        trend_source: m.trend_source,
        creator: (m as any).creators ?? null,
        vote_score: (m as any).vote_score ?? 0,
        log_count: (m as any).log_count ?? 0,
        generated_at: m.generated_at,
        compatible_diets: (m as any).compatible_diets ?? null,
        is_dairy_free: (m as any).is_dairy_free ?? null,
        is_gluten_free: (m as any).is_gluten_free ?? null,
        is_nut_free: (m as any).is_nut_free ?? null,
      }))
      // Sort by recency first (newest day → oldest), then by vote_score within each
      // day. So today's freshly-curated batch sits at the front of the rail and
      // yesterday's leftovers shift to the end.
      .sort((a, b) => {
        const dateDiff = new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
        if (dateDiff !== 0) return dateDiff
        return (b.vote_score ?? 0) - (a.vote_score ?? 0)
      })
    // Store the FULL ranked pool. Variety-fill now runs AFTER the per-user diet
    // filter (in `filtered` below) so a vegetarian's 6 are picked from the
    // diet-compatible pool with backfill — not capped to 6 before filtering.
    setTrending(mapped)
    hasContentRef.current = true
    lastFetchRef.current = Date.now() // mark fresh only on success — a failed fetch retries next focus
    setLoading(false)
    // Cache a light slice for instant paint on the next focus / app launch (stale-while-revalidate).
    if (user) AsyncStorage.setItem(discoverCacheKey(user.id), JSON.stringify(mapped.slice(0, 60))).catch(() => {})
    prefetchMealImages(mapped.slice(0, 8).map(m => m.image)) // warm the visible rail's photos
  }, [user])

  // Initial mount + every tab return: useFocusEffect already fires on first focus
  // (which for a tab screen IS mount), so a separate mount useEffect would just
  // double-fetch on cold load. This single hook covers both — plus it re-syncs
  // creator-recipe edits and overnight cron runs without a manual reload.
  useFocusEffect(useCallback(() => { fetchTrending() }, [fetchTrending]))

  // Foreground refetch: useFocusEffect doesn't re-fire when the app is backgrounded
  // and resumed (the tab is still "focused" the whole time), so without this users
  // would see yesterday's batch until they force-quit and relaunch. Mirrors the
  // pattern Home uses for its own dynamic data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') fetchTrending()
    })
    return () => sub.remove()
  }, [fetchTrending])

  // Pull-to-refresh: manual escape hatch when the user wants to force a refetch
  // without waiting for tab-switch or app-resume. Matches Home's pull-to-refresh UX.
  const [refreshing, setRefreshing] = useState(false)
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await fetchTrending() } finally { setRefreshing(false) }
  }, [fetchTrending])

  // Two-stage filter:
  //   1. Dietary safety (profile dietary_restrictions + food_dislikes — always on).
  //   2. Active chip (All / High Protein / Quick / Desserts / Vegetarian).
  // Featured is then the top item from the combined filtered pool (already sorted by
  // vote_score); each rail excludes whatever is currently the hero. Search filtering
  // was wired in 3c but removed pre-launch — see v2 todo for restoration trigger.
  // Full diet/chip-filtered pool (NOT variety-capped here — variety-fill is applied per
  // rail below so the global cap can't starve the rails).
  // Recomputed on each focus/resume (fetchTrending re-runs), so the ordering follows the clock
  // across a session rather than freezing at whatever time the app was first opened.
  const mealTime = currentMealTime(new Date().getHours())
  const filtered = useMemo(
    () => trending
      .filter(m => passesDietTags(m, dietType, dietaryRestrictions))
      .filter(m => passesDietary(m, foodDislikes))
      .filter(m => passesFilter(m, activeFilter))
      // Time-of-day ordering applies only to "All". Once the user picks a chip they've stated
      // the occasion explicitly, and re-sorting under them would fight that choice.
      .sort((a, b) => activeFilter === 'All'
        ? timeOfDayRank(a, mealTime) - timeOfDayRank(b, mealTime)
        : 0),
    [trending, activeFilter, foodDislikes, dietaryRestrictions, dietType, mealTime]
  )
  const featured = filtered[0]
  // Rail caps keep the editorial density right (Spotify/NYT-ish ~6-8 per shelf) and
  // prevent the rails from feeling like a long random scroll once the trending pool
  // grows past a dozen items. Overflow goes to the future v2 vertical "Discover more"
  // grid below the rails.
  const RAIL_CAPS = { youtube: 8, creator: 6 }
  // YouTube rail gets the protein-variety cap (it's the large algorithmic pool). Creators
  // are hand-submitted/curated, so they're just sliced — no protein cap dropping their posts.
  const youtubeRail = useMemo(
    () => applyVarietyFill(filtered.filter(m => m.id !== featured?.id && !m.creator), RAIL_CAPS.youtube),
    [filtered, featured]
  )
  const creatorRail = useMemo(
    () => filtered.filter(m => m.id !== featured?.id && !!m.creator).slice(0, RAIL_CAPS.creator),
    [filtered, featured]
  )

  const openMeal = (meal: DiscoverMeal) => {
    router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor="#4ADE80" colors={['#4ADE80']} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {FILTERS.map(f => {
            const active = activeFilter === f
            return (
              <PressableScale
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </PressableScale>
            )
          })}
        </ScrollView>

        {/* Featured hero */}
        {loading ? (
          <View style={[styles.featuredHero, styles.featuredSkeleton]}>
            <Compass size={32} stroke="#333" strokeWidth={1.5} />
          </View>
        ) : featured ? (
          <Animated.View entering={FadeIn.duration(350)}>
          <PressableScale
            style={styles.featuredHero}
            scaleTo={0.98}
            onPress={() => openMeal(featured)}
          >
            {featured.image && featured.image.startsWith('http') ? (
              <MealImage uri={featured.image} style={styles.featuredImage} recyclingKey={String(featured.id)} priority="high" />
            ) : (
              <View style={[styles.featuredImage, styles.featuredImagePlaceholder]}>
                <Utensils size={36} stroke="#444" strokeWidth={1.4} />
              </View>
            )}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.92)']}
              locations={[0.25, 0.6, 1]}
              style={styles.featuredGradient}
            />
            <View style={styles.featuredBadge}>
              <Flame size={11} stroke="#000" fill="#000" strokeWidth={2} />
              <Text style={styles.featuredBadgeText}>FEATURED</Text>
            </View>
            <View style={styles.featuredContent}>
              <Text style={styles.featuredName} numberOfLines={2}>{featured.name}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                {featured.prepTime > 0 && <Pill label={`${featured.prepTime} MIN`} tint="amber" />}
                <Pill label={`${featured.calories} CAL`} tint="white" />
                {featured.protein > 0 && <Pill label={`${featured.protein}P`} tint="green" />}
              </View>
            </View>
          </PressableScale>
          </Animated.View>
        ) : null}

        {/* Trending Now rail — YouTube-sourced editorial-trendy recipes */}
        {!loading && youtubeRail.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={styles.railHeader}>
              <Text style={styles.railTitle}>Trending Now</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
            >
              {youtubeRail.map((meal, index) => (
                <Animated.View key={meal.id} entering={FadeInDown.duration(260).delay(Math.min(index, 8) * 40)}>
                  <RailCard meal={meal} onPress={() => openMeal(meal)} />
                </Animated.View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* From Creators rail — user-submitted recipes. Admin "+" (promo flag) is the
            entry point for posting new creator content; it lives here in 3b instead of
            on Home, where it used to sit attached to the now-removed trending row. */}
        {!loading && (creatorRail.length > 0 || promoActive) && (
          <View style={{ marginTop: 28 }}>
            <View style={styles.railHeader}>
              <Text style={styles.railTitle}>From Creators</Text>
              {promoActive && (
                <PressableScale onPress={() => setShowCreatorModal(true)} hitSlop={10}>
                  <Plus size={18} color="#4ADE80" strokeWidth={2.5} />
                </PressableScale>
              )}
            </View>
            {creatorRail.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
              >
                {creatorRail.map((meal, index) => (
                  <Animated.View key={meal.id} entering={FadeInDown.duration(260).delay(Math.min(index, 8) * 40)}>
                    <RailCard meal={meal} onPress={() => openMeal(meal)} />
                  </Animated.View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.creatorRailEmpty}>No creator recipes yet — tap + to post one.</Text>
            )}
          </View>
        )}

        {/* Empty states — distinguish "nothing trending at all" from "filter narrowed to zero" */}
        {!loading && trending.length === 0 && (
          <View style={styles.emptyState}>
            <Compass size={36} stroke={COLORS.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No trending recipes yet</Text>
            <Text style={styles.emptySub}>Check back tomorrow — new picks drop daily.</Text>
          </View>
        )}
        {!loading && trending.length > 0 && filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No {activeFilter} recipes right now</Text>
            <Text style={styles.emptySub}>Try a different filter — the daily pool changes every morning.</Text>
            <PressableScale
              onPress={() => setActiveFilter('All')}
              style={styles.emptyResetBtn}
              haptic
            >
              <Text style={styles.emptyResetText}>Show all recipes</Text>
            </PressableScale>
          </View>
        )}
      </ScrollView>

      <CreatorRecipeModal
        visible={showCreatorModal}
        mealToEdit={null}
        onClose={() => setShowCreatorModal(false)}
        onSubmitted={() => {
          setShowCreatorModal(false)
          fetchTrending()
        }}
      />
    </SafeAreaView>
  )
}

// Creator social links are user-submitted and written straight to the DB, so a
// malicious creator could store a javascript:/file:/custom-scheme URL — Linking.openURL
// on that is an injection vector. Only follow plain http(s) web links; ignore the rest.
function safeOpenSocialUrl(url: string) {
  if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => {})
}

// Reusable rail card — same dimensions for both Trending Now and From Creators
// rails so the two shelves visually rhyme.
function RailCard({ meal, onPress }: { meal: DiscoverMeal; onPress: () => void }) {
  return (
    <PressableScale style={styles.railCard} scaleTo={0.98} onPress={onPress}>
      {meal.image && meal.image.startsWith('http') ? (
        <MealImage uri={meal.image} style={styles.railImage} recyclingKey={String(meal.id)} />
      ) : (
        <View style={[styles.railImage, styles.featuredImagePlaceholder]}>
          <Utensils size={28} stroke="#444" strokeWidth={1.4} />
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} locations={[0.3, 1]} style={styles.railGradient} />
      {meal.creator && (() => {
        const socialUrl = meal.creator.instagram_url || meal.creator.tiktok_url || meal.creator.youtube_url
        const badge = (
          <View style={styles.creatorBadge}>
            {meal.creator.avatar_url ? (
              <Image source={{ uri: meal.creator.avatar_url }} style={styles.creatorAvatar} />
            ) : null}
            <Text style={styles.creatorHandle}>@{meal.creator.handle}</Text>
          </View>
        )
        return socialUrl
          ? <PressableScale scaleTo={0.98} onPress={() => safeOpenSocialUrl(socialUrl)}>{badge}</PressableScale>
          : badge
      })()}
      <View style={styles.railContent}>
        <Text style={styles.railName} numberOfLines={2}>{meal.name}</Text>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {meal.prepTime > 0 && <Pill label={`${meal.prepTime} min`} tint="amber" small />}
          <Pill label={`${meal.calories} CAL`} tint="white" small />
          {meal.protein > 0 && <Pill label={`${meal.protein}P`} tint="green" small />}
          {meal.log_count >= 10 && <Pill label={`${meal.log_count} cooked`} tint="teal" small />}
        </View>
      </View>
    </PressableScale>
  )
}

// Tinted pill — single component instead of inline-styling per call site.
function Pill({ label, tint, small }: { label: string; tint: 'amber' | 'green' | 'teal' | 'white'; small?: boolean }) {
  const tintMap = {
    amber: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.25)', color: '#F59E0B' },
    green: { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.25)', color: '#4ADE80' },
    teal:  { bg: 'rgba(0,201,167,0.15)',  border: 'rgba(0,201,167,0.25)',  color: '#00C9A7' },
    white: { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', color: COLORS.textWhite },
  }[tint]
  return (
    <View style={[
      styles.pill,
      { backgroundColor: tintMap.bg, borderColor: tintMap.border },
    ]}>
      <Text style={[
        styles.pillText,
        // Slightly larger text on the rail cards; tighter letter-spacing keeps all three
        // pills on one line within the reclaimed edge spacing (no wrap even at "20m").
        small && { fontSize: 10, letterSpacing: 0.4 },
        { color: tintMap.color },
      ]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },

  chipsRow: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 18,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  chipActive: {
    backgroundColor: COLORS.textWhite,
    borderColor: COLORS.textWhite,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: -0.1,
  },
  chipTextActive: {
    color: '#000000',
  },

  featuredHero: {
    marginHorizontal: 20,
    marginTop: 4,
    height: 340,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A1A',
  },
  featuredSkeleton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  featuredImagePlaceholder: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 240,
  },
  featuredBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4ADE80',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  featuredBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1.2,
  },
  featuredContent: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  featuredName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textWhite,
    lineHeight: 26,
    letterSpacing: -0.4,
  },

  railHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 14,
  },
  creatorRailEmpty: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  railTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  railCard: {
    width: 175,
    height: 225,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A1A',
  },
  railImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    opacity: 0.85,
  },
  railGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  railContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Tight left/right inset gives the pill row max horizontal room so the protein
    // pill stays on one line even with a 2-digit prep time (e.g. "20m"). Pills keep
    // their own size; only this edge spacing + the row gap were reduced. Vertical unchanged.
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  railName: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
    lineHeight: 18,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  creatorBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 2,
  },
  creatorAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  creatorHandle: {
    fontSize: 10,
    color: COLORS.textWhite,
    fontWeight: '700',
  },

  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyResetBtn: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: COLORS.textWhite,
  },
  emptyResetText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
})
