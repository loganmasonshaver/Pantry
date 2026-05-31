import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  AppState,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Flame, Compass, Utensils, Plus } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import CreatorRecipeModal from '@/components/CreatorRecipeModal'

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
const TARGET_DISCOVER_COUNT = 6
const MAX_PER_PROTEIN = 2
function applyVarietyFill(meals: any[]): any[] {
  const result: any[] = []
  const proteinCounts = new Map<string, number>()
  for (const m of meals) {
    if (result.length >= TARGET_DISCOVER_COUNT) break
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
const FILTERS = ['All', 'High Protein', 'Quick', 'Desserts', 'Vegetarian'] as const
type FilterKey = typeof FILTERS[number]

// Keyword heuristics — fast, no extra columns required. Dessert reclassification is
// the same fix flagged in the handoff (LLM mis-tags "Cottage Cheese Brownie Bake" as
// meal). Vegetarian uses a deny-list because the trending pool doesn't carry a tag.
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

function passesFilter(meal: DiscoverMeal, filter: FilterKey): boolean {
  if (filter === 'All') return true
  const nameLower = meal.name.toLowerCase()
  if (filter === 'Quick') return meal.prepTime > 0 && meal.prepTime <= 20
  if (filter === 'High Protein') {
    // Protein density ≥ 25% of calories — same bar the trending pipeline uses.
    return meal.calories > 0 && (meal.protein * 4) / meal.calories >= 0.25
  }
  if (filter === 'Desserts') return DESSERT_KEYWORDS.some(k => nameLower.includes(k))
  if (filter === 'Vegetarian') {
    if (MEAT_KEYWORDS.some(k => nameLower.includes(k))) return false
    const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
    return !ingredientNames.some(n => MEAT_KEYWORDS.some(k => n.includes(k)))
  }
  return true
}

export default function DiscoverScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { promoActive } = usePremium()
  const [trending, setTrending] = useState<DiscoverMeal[]>([])
  const [loading, setLoading] = useState(true)
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

  const fetchTrending = useCallback(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    // 30-day window is the absolute upper bound (creator lifecycle ceiling).
    // Lifecycle filtering below further trims YouTube to 7d and creators by engagement.
    // The !creator_id syntax is PostgREST's foreign-key embed — joins one creator per meal.
    const { data } = await supabase.from('trending_meals')
      .select('*, creators!creator_id(name, handle, avatar_url, instagram_url, tiktok_url, youtube_url, user_id)')
      .gte('generated_at', thirtyDaysAgo)
      .order('generated_at', { ascending: false })
      .order('id')

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
    setLoading(false)
  }, [])

  useEffect(() => { fetchTrending() }, [fetchTrending])
  // Re-sync when returning to the tab so creator-recipe edits and overnight cron runs
  // are reflected without a manual reload.
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
  const filtered = useMemo(
    () => applyVarietyFill(
      trending
        .filter(m => passesDietTags(m, dietType, dietaryRestrictions))
        .filter(m => passesDietary(m, foodDislikes))
        .filter(m => passesFilter(m, activeFilter))
    ),
    [trending, activeFilter, foodDislikes, dietaryRestrictions, dietType]
  )
  const featured = filtered[0]
  // Rail caps keep the editorial density right (Spotify/NYT-ish ~6-8 per shelf) and
  // prevent the rails from feeling like a long random scroll once the trending pool
  // grows past a dozen items. Overflow goes to the future v2 vertical "Discover more"
  // grid below the rails.
  const RAIL_CAPS = { youtube: 8, creator: 6 }
  const youtubeRail = useMemo(
    () => filtered.filter(m => m.id !== featured?.id && !m.creator).slice(0, RAIL_CAPS.youtube),
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
              <TouchableOpacity
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Featured hero */}
        {loading ? (
          <View style={[styles.featuredHero, styles.featuredSkeleton]}>
            <Compass size={32} stroke="#333" strokeWidth={1.5} />
          </View>
        ) : featured ? (
          <TouchableOpacity
            style={styles.featuredHero}
            activeOpacity={0.9}
            onPress={() => openMeal(featured)}
          >
            {featured.image && featured.image.startsWith('http') ? (
              <Image source={{ uri: featured.image }} style={styles.featuredImage} resizeMode="cover" />
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
          </TouchableOpacity>
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
              {youtubeRail.map(meal => <RailCard key={meal.id} meal={meal} onPress={() => openMeal(meal)} />)}
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
                <TouchableOpacity onPress={() => setShowCreatorModal(true)} hitSlop={10} activeOpacity={0.7}>
                  <Plus size={18} color="#4ADE80" strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>
            {creatorRail.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
              >
                {creatorRail.map(meal => <RailCard key={meal.id} meal={meal} onPress={() => openMeal(meal)} />)}
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
            <TouchableOpacity
              onPress={() => setActiveFilter('All')}
              style={styles.emptyResetBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyResetText}>Show all recipes</Text>
            </TouchableOpacity>
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

// Reusable rail card — same dimensions for both Trending Now and From Creators
// rails so the two shelves visually rhyme.
function RailCard({ meal, onPress }: { meal: DiscoverMeal; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.railCard} activeOpacity={0.85} onPress={onPress}>
      {meal.image && meal.image.startsWith('http') ? (
        <Image source={{ uri: meal.image }} style={styles.railImage} resizeMode="cover" />
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
          ? <TouchableOpacity onPress={() => Linking.openURL(socialUrl)} activeOpacity={0.7}>{badge}</TouchableOpacity>
          : badge
      })()}
      <View style={styles.railContent}>
        <Text style={styles.railName} numberOfLines={2}>{meal.name}</Text>
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          {meal.prepTime > 0 && <Pill label={`${meal.prepTime}m`} tint="amber" small />}
          <Pill label={`${meal.calories} CAL`} tint="white" small />
          {meal.protein > 0 && <Pill label={`${meal.protein}P`} tint="green" small />}
          {meal.log_count >= 10 && <Pill label={`${meal.log_count} cooked`} tint="teal" small />}
        </View>
      </View>
    </TouchableOpacity>
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
        small && { fontSize: 9 },
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
    // ~160 wide — a little bigger than the first pass while still letting the next
    // card peek so the rail reads as scrollable.
    width: 160,
    height: 210,
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
    padding: 14,
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
