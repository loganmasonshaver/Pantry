import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Image,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Search, Flame, Compass, Utensils } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'

// Lifecycle filters mirror the home-tab logic so Discover shows the same trending
// pool. They live here as a temporary duplicate; Phase 3b moves Trending out of
// Home entirely and these become the single source of truth.
function isCreatorRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000
  if (ageDays <= 14) return true
  if (ageDays <= 30 && ((m.vote_score ?? 0) >= 3 || (m.log_count ?? 0) >= 10)) return true
  return false
}
function isYouTubeRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000
  return ageDays <= 3
}
function filterTrendingByLifecycle(rows: any[]): any[] {
  return rows.filter(m => {
    if (m.trend_source === 'creator' || m.creators) return isCreatorRecipeVisible(m)
    return isYouTubeRecipeVisible(m)
  })
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
}

// Filter chips are visual-only in 3a — selection state changes pill styling but does
// not yet narrow results. 3b wires real filtering from the trending pool against
// derived signals (protein density, prep time bucket, dessert keyword match, etc.).
const FILTERS = ['All', 'High Protein', 'Quick', 'Desserts', 'Vegetarian'] as const

export default function DiscoverScreen() {
  const router = useRouter()
  const [trending, setTrending] = useState<DiscoverMeal[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<typeof FILTERS[number]>('All')

  const fetchTrending = useCallback(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
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
      }))
      .sort((a, b) => (b.vote_score ?? 0) - (a.vote_score ?? 0))
    setTrending(mapped)
    setLoading(false)
  }, [])

  useEffect(() => { fetchTrending() }, [fetchTrending])
  // Re-sync when returning to the tab so creator-recipe edits and overnight cron runs
  // are reflected without a manual reload.
  useFocusEffect(useCallback(() => { fetchTrending() }, [fetchTrending]))

  const featured = trending[0]
  const rail = trending.slice(1)

  const openMeal = (meal: DiscoverMeal) => {
    router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
        </View>

        {/* Search bar — visual scaffold for now; 3c wires real search */}
        <View style={styles.searchBar}>
          <Search size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search recipes…"
            placeholderTextColor={COLORS.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
          />
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

        {/* Trending rail */}
        {!loading && rail.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={styles.railHeader}>
              <Text style={styles.railTitle}>Trending Now</Text>
              <Text style={styles.railSeeAll}>See all →</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
            >
              {rail.map(meal => (
                <TouchableOpacity
                  key={meal.id}
                  style={styles.railCard}
                  activeOpacity={0.85}
                  onPress={() => openMeal(meal)}
                >
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
              ))}
            </ScrollView>
          </View>
        )}

        {/* Empty state */}
        {!loading && trending.length === 0 && (
          <View style={styles.emptyState}>
            <Compass size={36} stroke={COLORS.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No trending recipes yet</Text>
            <Text style={styles.emptySub}>Check back tomorrow — new picks drop daily.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textWhite,
    padding: 0,
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
  railTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  railSeeAll: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: -0.1,
  },
  railCard: {
    width: 200,
    height: 240,
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
})
