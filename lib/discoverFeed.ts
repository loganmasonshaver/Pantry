import { supabase } from './supabase'
import { todayStr } from './localDate'

// The Discover feed's data layer, split out of app/(tabs)/discover.tsx so the screen and the
// background prefetch run the SAME query, mapping and cache format. Duplicating any of it is how
// the two would drift — the missing-ingredient badge and the meal-cache date key both rotted
// exactly that way, from a copy that stopped tracking its original.

export type DiscoverMeal = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  prepTime: number
  servings: number
  shelf_tag: string | null
  source_verified: boolean
  ingredients: any[]
  steps: any[]
  image: string | null
  trend_source: string | null
  /** YouTube id of the source video. Stored since the pipeline began and surfaced nowhere. */
  video_id: string | null
  creator: any | null
  vote_score: number
  log_count: number
  generated_at: string
  compatible_diets: string[] | null
  is_dairy_free: boolean | null
  is_gluten_free: boolean | null
  is_nut_free: boolean | null
}

// Newest-first, capped. At ~15 meals/day and 30-day retention the pool tops out near 450, so 600
// leaves headroom. This is a CEILING, not pagination: if a fetch ever returns exactly this many,
// the tail is silently unreachable and this needs a real generated_at cursor.
export const TRENDING_FETCH_LIMIT = 600

// MUST match RETENTION_DAYS in supabase/functions/generate-trending-meals — if they drift, either
// the feed hides rows that exist or the pipeline deletes rows the feed wanted. Was 7; freshness is
// now conveyed by the "New today" section rather than by throwing meals away, which is what kept
// the browsable pool tiny.
const YOUTUBE_VISIBLE_DAYS = 30

// Creator recipes get a longer shelf life than YouTube (14d guaranteed, up to 30d if engagement is
// strong) — creators earn revenue share, so we honor their content longer.
function isCreatorRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000 // ms → days
  if (ageDays <= 14) return true
  if (ageDays <= 30 && ((m.vote_score ?? 0) >= 3 || (m.log_count ?? 0) >= 10)) return true
  return false
}

function isYouTubeRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000
  return ageDays <= YOUTUBE_VISIBLE_DAYS
}

export function filterTrendingByLifecycle(rows: any[]): any[] {
  return rows.filter(m => {
    if (m.trend_source === 'creator' || m.creators) return isCreatorRecipeVisible(m)
    return isYouTubeRecipeVisible(m)
  })
}

// Query + lifecycle filter + map + sort. Deliberately free of user preferences: diet, dislikes and
// prep-time filtering all happen later, against component state. That is what makes this callable
// from a background prefetch that has no screen behind it.
export async function loadTrendingMeals(): Promise<DiscoverMeal[] | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  // The !creator_id syntax is PostgREST's foreign-key embed — joins one creator per meal.
  const { data } = await supabase.from('trending_meals')
    .select('*, creators!creator_id(name, handle, avatar_url, instagram_url, tiktok_url, youtube_url)')
    .gte('generated_at', thirtyDaysAgo)
    .order('generated_at', { ascending: false })
    .order('id')
    .limit(TRENDING_FETCH_LIMIT)

  if (!data) return null

  if (data.length >= TRENDING_FETCH_LIMIT) {
    console.warn(`[discover] fetch hit the ${TRENDING_FETCH_LIMIT}-row ceiling — tail unreachable, add generated_at pagination`)
  }

  return filterTrendingByLifecycle(data)
    .map((m: any) => ({
      id: m.id, name: m.name, calories: m.calories, protein: m.protein,
      carbs: m.carbs, fat: m.fat, prepTime: m.prep_time, servings: m.servings ?? 1,
      shelf_tag: m.shelf_tag ?? null, source_verified: m.source_verified === true,
      ingredients: m.ingredients, steps: m.steps, image: m.image,
      trend_source: m.trend_source,
      video_id: m.video_id ?? null,
      creator: m.creators ?? null,
      vote_score: m.vote_score ?? 0,
      log_count: m.log_count ?? 0,
      generated_at: m.generated_at,
      compatible_diets: m.compatible_diets ?? null,
      is_dairy_free: m.is_dairy_free ?? null,
      is_gluten_free: m.is_gluten_free ?? null,
      is_nut_free: m.is_nut_free ?? null,
    }))
    // Recency first (newest day → oldest), then vote_score within each day, so today's freshly
    // curated batch sits at the front of the rail and yesterday's leftovers shift to the end.
    .sort((a, b) => {
      const dateDiff = new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      if (dateDiff !== 0) return dateDiff
      return (b.vote_score ?? 0) - (a.vote_score ?? 0)
    })
}

// ── Cache ────────────────────────────────────────────────────────────────────────────────────
//
// Stamped with the LOCAL day it was written. Without that stamp the screen painted yesterday's
// shelves instantly and then visibly re-laid-out 2-3s later when the fetch landed — worst on a new
// day, because the overnight cron adds meals AND dayOfYearNow() ticks over, so rotateByDay
// reshuffles every shelf at once. A stale-day cache is now simply not painted: a skeleton for two
// seconds is honest, where showing yesterday's feed and rearranging it under the reader is not.

export const discoverCacheKey = (uid: string) => `pantry_discover_${uid}`

// Only the first 60 are kept — enough to fill the rail on first paint without storing the pool.
const CACHE_SLICE = 60

export async function writeDiscoverCache(uid: string, meals: DiscoverMeal[]): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
  await AsyncStorage.setItem(
    discoverCacheKey(uid),
    JSON.stringify({ day: todayStr(), meals: meals.slice(0, CACHE_SLICE) }),
  ).catch(() => {})
}

// Returns cached meals only when they were written TODAY. A legacy bare-array entry (written
// before the stamp existed) has no day and is treated as stale, which self-heals on first write.
export async function readDiscoverCache(uid: string): Promise<DiscoverMeal[] | null> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
    const raw = await AsyncStorage.getItem(discoverCacheKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return null // legacy, undated
    if (parsed?.day !== todayStr()) return null
    return Array.isArray(parsed.meals) && parsed.meals.length ? parsed.meals : null
  } catch {
    return null
  }
}

// Warm the cache so opening the tab paints today's feed immediately instead of starting the fetch
// on arrival. The Discover screen is not mounted until it is first opened, so nothing inside it
// can do this — the prefetch has to live out here and hand the screen a fresh cache to hydrate.
// Silent and best-effort: a failure just means the screen fetches on open, as it did before.
let inflight: Promise<void> | null = null
export function prefetchDiscover(userId: string | undefined): Promise<void> {
  if (!userId) return Promise.resolve()
  if (inflight) return inflight // one at a time — foreground + mount can both fire
  inflight = (async () => {
    try {
      const meals = await loadTrendingMeals()
      if (meals?.length) await writeDiscoverCache(userId, meals)
    } catch {
      // ignored on purpose
    } finally {
      inflight = null
    }
  })()
  return inflight
}
